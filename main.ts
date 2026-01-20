//% color="#006400" weight=85 icon="\uf124"
//% groups="["GNSS", "Output", "Satellites"]"
namespace bq357 {

    let isGnssSerial = false;
    let lastGGA: string = "";
    let lastRMC: string = "";
    let lastVTG: string = "";

    interface Satellite {
        id: number;
        elevation: number;   // °
        azimuth: number;     // °
        snr: number;         // dB-Hz
    }

    let gpsSatellites: Satellite[] = [];
    let bdsSatellites: Satellite[] = [];

    // Clean old data when no recent sentences
    let lastValidFixMs = 0;

    /**
     * Redirect serial pins to GNSS module (P0=RX, P1=TX, 9600 baud default)
     */
    //% block="use GNSS serial pins P0 RX P1 TX baud $baud"
    //% group="GNSS" weight=100
    export function useGnssSerial(baud: number = 9600): void {
        serial.redirect(
            SerialPin.P0,   // micro:bit RX ← module TX
            SerialPin.P1,   // micro:bit TX → module RX
            BaudRate.BaudRate9600   // change if you used PCAS01 command
        );
        isGnssSerial = true;
        basic.pause(50); // stabilize
    }

    /**
     * Redirect serial back to USB for console output
     */
    //% block="use USB serial for console output"
    //% group="Output" weight=90
    export function useUsbSerial(): void {
        serial.redirectToUSB();
        isGnssSerial = false;
        basic.pause(50);
    }

    /**
     * Read one line from GNSS and parse it if valid NMEA
     * Call this frequently in a loop
     */
    //% block="read and parse one NMEA line from GNSS"
    //% group="GNSS" weight=80
    export function readAndParseLine(): void {
        if (!isGnssSerial) return;

        let line = serial.readLine();
        if (!line || line.length < 8 || line.charAt(0) !== "$") return;

        let parts = line.split(",");
        if (parts.length < 3) return;

        let talker = parts[0].substr(1, 2); // GP / GN / BD ...
        let sentence = parts[0].substr(3, 3);

        // Keep last relevant sentences
        if (sentence === "GGA") lastGGA = line;
        else if (sentence === "RMC") lastRMC = line;
        else if (sentence === "VTG") lastVTG = line;
        else if (sentence === "GSV") {
            parseGSV(line);
        }

        // Update fix timeout
        if (sentence === "GGA" || sentence === "RMC") {
            if (parts.length > 6 && parts[6] === "1" || parts[2] === "A") {
                lastValidFixMs = control.millis();
            }
        }
    }

    // -----------------------------------------------------------------------------
    // Updated parseGSV function
    // -----------------------------------------------------------------------------

    function parseGSV(line: string): void {
        let parts = line.split(",");
        if (parts.length < 8) return;

        let talker = parts[0].substr(1, 2);
        let isBDS = (talker === "BD" || talker === "GB");

        let idx = 4;
        while (idx + 3 < parts.length) {
            let idRaw = parts[idx++];
            let elvRaw = parts[idx++];
            let azRaw = parts[idx++];
            let snrRaw = parts[idx++];

            if (!idRaw || !snrRaw || snrRaw.trim() === "") continue;

            let id = parseInt(idRaw);
            let elv = parseInt(elvRaw) || 0;
            let az = parseInt(azRaw) || 0;
            let snr = parseInt(snrRaw) || 0;

            if (id > 0 && snr > 0) {
                let sat: Satellite = { id: id, elevation: elv, azimuth: az, snr: snr };

                let satellites = isBDS ? bdsSatellites : gpsSatellites;

                // Manual search for existing satellite by ID
                let pos = -1;
                for (let i = 0; i < satellites.length; i++) {
                    if (satellites[i].id === id) {
                        pos = i;
                        break;
                    }
                }

                if (pos >= 0) {
                    satellites[pos] = sat;   // update
                } else {
                    satellites.push(sat);    // append
                }
            }
        }

  
    }

    // ────────────────────────────────────────────────
    // Getters
    // ────────────────────────────────────────────────

    /**
     * Returns "outdoor" if recent 3D fix or good satellite view, else "indoor"
     */
    //% block="GNSS status"
    //% group="GNSS" weight=70
    export function status(): string {
        let age = control.millis() - lastValidFixMs;
        if (age > 8000) return "indoor";

        let nGGA = extractField(lastGGA, 6);
        if (nGGA === "1" || nGGA === "2") return "outdoor";

        let fixRMC = extractField(lastRMC, 2);
        if (fixRMC === "A") return "outdoor";

        // fallback: satellite count + signal quality
        let total = gpsSatellites.length + bdsSatellites.length;
        let good = gpsSatellites.filter(s => s.snr >= 30).length +
            bdsSatellites.filter(s => s.snr >= 30).length;

        return (total >= 6 && good >= 4) ? "outdoor" : "indoor";
    }

    /**
     * UTC time HH:MM:SS from GGA or RMC (empty if no fix)
     */
    //% block="UTC time"
    //% group="GNSS"
    export function utcTime(): string {
        let t = extractField(lastGGA, 1) || extractField(lastRMC, 1);
        if (!t || t.length < 6) return "";
        let hh = t.substr(0, 2);
        let mm = t.substr(2, 2);
        let ss = t.substr(4, 2);
        return `${hh}:${mm}:${ss}`;
    }

    /**
     * Latitude in decimal degrees (positive = N, negative = S)
     */
    //% block="latitude (decimal degrees)"
    //% group="GNSS"
    export function latitude(): number {
        if (status() !== "outdoor") return -999;
        let raw = extractField(lastGGA, 2) || extractField(lastRMC, 3);
        if (!raw || raw.length < 4) return -999;
        let deg = parseInt(raw.substr(0, 2));
        let min = parseFloat(raw.substr(2));
        let dec = deg + min / 60;
        return extractField(lastGGA, 3) === "S" ? -dec : dec;
    }

    /**
     * Longitude in decimal degrees (positive = E, negative = W)
     */
    //% block="longitude (decimal degrees)"
    //% group="GNSS"
    export function longitude(): number {
        if (status() !== "outdoor") return -999;
        let raw = extractField(lastGGA, 4) || extractField(lastRMC, 5);
        if (!raw || raw.length < 5) return -999;
        let deg = parseInt(raw.substr(0, 3));
        let min = parseFloat(raw.substr(3));
        let dec = deg + min / 60;
        return extractField(lastGGA, 5) === "W" ? -dec : dec;
    }

    /**
     * Ground speed in km/h (from VTG or RMC)
     */
    //% block="speed km/h"
    //% group="GNSS"
    export function speedKmh(): number {
        if (status() !== "outdoor") return -999;
        let vtg = extractField(lastVTG, 7); // km/h field
        if (vtg && vtg !== "") return parseFloat(vtg);
        let rmc = extractField(lastRMC, 7); // knots
        if (rmc && rmc !== "") return parseFloat(rmc) * 1.852;
        return -999;
    }

    // ────────────────────────────────────────────────
    // Satellite lists (read-only views)
    // ────────────────────────────────────────────────

    /**
     * Number of detected GPS satellites
     */
    //% block="number of GPS satellites"
    //% group="Satellites"
    export function gpsSatelliteCount(): number {
        return gpsSatellites.length;
    }

    /**
     * GPS satellite info at index (0-based)
     */
    //% block="GPS satellite $index azimuth ° elevation ° SNR dB"
    //% group="Satellites"
    export function gpsSatelliteInfo(index: number): string {
        if (index < 0 || index >= gpsSatellites.length) return "—";
        let s = gpsSatellites[index];
        return `ID${s.id} Az${s.azimuth}° El${s.elevation}° ${s.snr}dB`;
    }

    /**
     * Number of detected BeiDou satellites
     */
    //% block="number of BeiDou satellites"
    //% group="Satellites"
    export function bdsSatelliteCount(): number {
        return bdsSatellites.length;
    }

    /**
     * BeiDou satellite info at index (0-based)
     */
    //% block="BeiDou satellite $index azimuth ° elevation ° SNR dB"
    //% group="Satellites"
    export function bdsSatelliteInfo(index: number): string {
        if (index < 0 || index >= bdsSatellites.length) return "—";
        let s = bdsSatellites[index];
        return `ID${s.id} Az${s.azimuth}° El${s.elevation}° ${s.snr}dB`;
    }

    // ────────────────────────────────────────────────
    // Helper
    // ────────────────────────────────────────────────

    function extractField(sentence: string, idx: number): string {
        if (!sentence) return "";
        let p = sentence.split(",");
        return (idx < p.length) ? p[idx] : "";
    }

    /**
     * Clear satellite lists (call when changing location / debug)
     */
    //% block="clear satellite lists"
    //% group="GNSS" advanced=true
    export function clearSatellites(): void {
        gpsSatellites = [];
        bdsSatellites = [];
    }
}