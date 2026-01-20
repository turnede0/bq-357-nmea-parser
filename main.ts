//% color="#006400" weight=85 icon="\uf124"
//% groups='["GNSS", "Output", "Satellites"]'
namespace bq357 {

    let isGnssSerial = false;
    let lastGGA: string = "";
    let lastRMC: string = "";
    let lastVTG: string = "";
    let gpsSatellites: Satellite[] = [];
    let bdsSatellites: Satellite[] = [];

    interface Satellite {
        id: number;
        elevation: number;
        azimuth: number;
        snr: number;
    }

    let lastValidFixMs = 0;

    // -------------------------------------------------------------------------
    // Serial control
    // -------------------------------------------------------------------------

    /**
     * Redirect serial to GNSS module (P0 = RX ← module TX, P1 = TX → module RX)
     */
    //% block="use GNSS serial pins P0 RX P1 TX baud $baud"
    //% group="GNSS" weight=100
    export function useGnssSerial(baud: number = 9600): void {
        serial.redirect(SerialPin.P0, SerialPin.P1, baud);
        isGnssSerial = true;
        basic.pause(50);
    }

    /**
     * Redirect serial back to USB console
     */
    //% block="use USB serial for console output"
    //% group="Output" weight=90
    export function useUsbSerial(): void {
        serial.redirectToUSB();
        isGnssSerial = false;
        basic.pause(50);
    }

    /**
     * Read one line from GNSS and parse if valid NMEA
     */
    //% block="read and parse one NMEA line from GNSS"
    //% group="GNSS" weight=80
    export function readAndParseLine(): void {
        if (!isGnssSerial) return;

        let line = serial.readLine();
        if (!line || line.length < 8 || line.charAt(0) !== "$") return;

        let parts = line.split(",");
        if (parts.length < 3) return;

        let talker = parts[0].substr(1, 2);
        let sentence = parts[0].substr(3, 3);

        if (sentence === "GGA") lastGGA = line;
        else if (sentence === "RMC") lastRMC = line;
        else if (sentence === "VTG") lastVTG = line;
        else if (sentence === "GSV") {
            parseGSV(line);
        }

        // Update fix timeout
        if (sentence === "GGA" || sentence === "RMC") {
            if ((parts.length > 6 && parts[6] === "1") || (parts.length > 2 && parts[2] === "A")) {
                lastValidFixMs = control.millis();
            }
        }
    }

    function parseGSV(line: string): void {
        let parts = line.split(",");
        if (parts.length < 8) return;

        let talker = parts[0].substr(1, 2);
        let isBDS = (talker === "BD" || talker === "GB");

        let idx = 4;
        let satellites = isBDS ? bdsSatellites : gpsSatellites;

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

                let pos = -1;
                for (let i = 0; i < satellites.length; i++) {
                    if (satellites[i].id === id) {
                        pos = i;
                        break;
                    }
                }

                if (pos >= 0) {
                    satellites[pos] = sat;
                } else {
                    satellites.push(sat);
                }
            }
        }

        // Prevent unbounded growth
        if (satellites.length > 32) {
            satellites = satellites.slice(-28);
        }
    }

    // -------------------------------------------------------------------------
    // Status & basic getters (return string)
    // -------------------------------------------------------------------------

    /**
     * Current GNSS status: "outdoor" or "indoor"
     */
    //% block="GNSS status"
    //% group="GNSS" weight=70
    export function status(): string {
        let age = control.millis() - lastValidFixMs;
        if (age > 8000) return "indoor";

        let fixGGA = extractField(lastGGA, 6);
        if (fixGGA === "1" || fixGGA === "2") return "outdoor";

        let fixRMC = extractField(lastRMC, 2);
        if (fixRMC === "A") return "outdoor";

        let total = gpsSatellites.length + bdsSatellites.length;
        let good = 0;
        for (let s of gpsSatellites) if (s.snr >= 30) good++;
        for (let s of bdsSatellites) if (s.snr >= 30) good++;

        return (total >= 6 && good >= 4) ? "outdoor" : "indoor";
    }

    /**
     * UTC time in format HH:MM:SS (empty string if no fix)
     */
    //% block="UTC time"
    //% group="GNSS"
    export function utcTime(): string {
        let t = extractField(lastGGA, 1) || extractField(lastRMC, 1);
        if (!t || t.length < 6) return "";
        let hh = t.substr(0, 2);
        let mm = t.substr(2, 2);
        let ss = t.substr(4, 2);
        return hh + ":" + mm + ":" + ss;
    }

    /**
     * Latitude in decimal degrees with 6 decimal places (or "(no fix)")
     */
    //% block="latitude"
    //% group="GNSS"
    export function latitude(): string {
        if (status() !== "outdoor") return "(no fix)";

        let raw = extractField(lastGGA, 2) || extractField(lastRMC, 3);
        if (!raw || raw.length < 4) return "(no fix)";

        let deg = parseInt(raw.substr(0, 2));
        let min = parseFloat(raw.substr(2));
        let dec = deg + min / 60;

        let ns = extractField(lastGGA, 3) || extractField(lastRMC, 4);
        if (ns === "S") dec = -dec;

        // Use Math.round for 6 decimals to avoid .toFixed error
        return "" + (Math.round(dec * 1000000) / 1000000);
    }

    /**
     * Longitude in decimal degrees with 6 decimal places (or "(no fix)")
     */
    //% block="longitude"
    //% group="GNSS"
    export function longitude(): string {
        if (status() !== "outdoor") return "(no fix)";

        let raw = extractField(lastGGA, 4) || extractField(lastRMC, 5);
        if (!raw || raw.length < 5) return "(no fix)";

        let deg = parseInt(raw.substr(0, 3));
        let min = parseFloat(raw.substr(3));
        let dec = deg + min / 60;

        let ew = extractField(lastGGA, 5) || extractField(lastRMC, 6);
        if (ew === "W") dec = -dec;

        // Use Math.round for 6 decimals to avoid .toFixed error
        return "" + (Math.round(dec * 1000000) / 1000000);
    }

    /**
     * Ground speed in km/h with 1 decimal place (or "(no fix)")
     */
    //% block="speed (km/h)"
    //% group="GNSS"
    export function speedKmh(): string {
        if (status() !== "outdoor") return "(no fix)";

        let vtg = extractField(lastVTG, 7);     // km/h
        if (vtg && vtg !== "") {
            let v = parseFloat(vtg);
            // Use Math.round for 1 decimal to avoid .toFixed error
            return "" + (Math.round(v * 10) / 10);
        }

        let rmc = extractField(lastRMC, 7);     // knots
        if (rmc && rmc !== "") {
            let v = parseFloat(rmc) * 1.852;
            // Use Math.round for 1 decimal to avoid .toFixed error
            return "" + (Math.round(v * 10) / 10);
        }

        return "(no fix)";
    }

    // -------------------------------------------------------------------------
    // Satellite information
    // -------------------------------------------------------------------------

    //% block="number of GPS satellites"
    //% group="Satellites"
    export function gpsSatelliteCount(): number {
        return gpsSatellites.length;
    }

    //% block="GPS satellite at $index"
    //% group="Satellites"
    export function gpsSatelliteInfo(index: number): string {
        if (index < 0 || index >= gpsSatellites.length) return "—";
        let s = gpsSatellites[index];
        return "ID" + s.id + "  el:" + s.elevation + "°  az:" + s.azimuth + "°  " + s.snr + " dB";
    }

    //% block="number of BeiDou satellites"
    //% group="Satellites"
    export function bdsSatelliteCount(): number {
        return bdsSatellites.length;
    }

    //% block="BeiDou satellite at $index"
    //% group="Satellites"
    export function bdsSatelliteInfo(index: number): string {
        if (index < 0 || index >= bdsSatellites.length) return "—";
        let s = bdsSatellites[index];
        return "ID" + s.id + "  el:" + s.elevation + "°  az:" + s.azimuth + "°  " + s.snr + " dB";
    }

    //% block="clear satellite lists"
    //% group="GNSS" advanced=true
    export function clearSatellites(): void {
        gpsSatellites = [];
        bdsSatellites = [];
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    function extractField(sentence: string, idx: number): string {
        if (!sentence) return "";
        let p = sentence.split(",");
        return idx < p.length ? p[idx] : "";
    }
}