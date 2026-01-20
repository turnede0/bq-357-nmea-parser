//% color="#006400" weight=85 icon="\uf124"
//% groups='["GNSS", "Output", "Satellites", "Raw NMEA"]'
namespace bq357 {

    let isGnssSerial = false;
    let lastGGA: string = "";
    let lastRMC: string = "";
    let lastVTG: string = "";
    let lastGSA: string = "";      // last GSA (GP or BD)
    let lastGSV: string = "";      // last GSV line (any talker)
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
    // Serial control (unchanged)
    // -------------------------------------------------------------------------

    //% block="use GNSS serial pins P0 RX P1 TX baud $baud"
    //% group="GNSS" weight=100
    export function useGnssSerial(baud: number = 9600): void {
        serial.redirect(SerialPin.P0, SerialPin.P1, baud);
        isGnssSerial = true;
        basic.pause(50);
    }

    //% block="use USB serial for console output"
    //% group="Output" weight=90
    export function useUsbSerial(): void {
        serial.redirectToUSB();
        isGnssSerial = false;
        basic.pause(50);
    }

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
        else if (sentence === "GSA") lastGSA = line;
        else if (sentence === "GSV") {
            lastGSV = line;
            parseGSV(line);
        }

        if (sentence === "GGA" || sentence === "RMC") {
            if ((parts.length > 6 && parts[6] === "1") || (parts.length > 2 && parts[2] === "A")) {
                lastValidFixMs = control.millis();
            }
        }
    }

    function parseGSV(line: string): void {
        // (unchanged from previous version – manual loop for compatibility)
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

        if (satellites.length > 32) {
            satellites = satellites.slice(-28);
        }
    }

    // -------------------------------------------------------------------------
    // Existing getters (status, utcTime, latitude, longitude, speedKmh) unchanged
    // -------------------------------------------------------------------------
    // ... (keep your current implementations for status(), utcTime(), latitude(), longitude(), speedKmh(), satellite functions)

    // -------------------------------------------------------------------------
    // New Raw NMEA getters – group "Raw NMEA"
    // -------------------------------------------------------------------------

    /**
     * Returns the most recent $..GGA sentence (or empty string)
     */
    //% block="raw GGA sentence"
    //% group="Raw NMEA" weight=60
    export function rawGGA(): string {
        return lastGGA;
    }

    /**
     * Returns the most recent $..RMC sentence (or empty string)
     */
    //% block="raw RMC sentence"
    //% group="Raw NMEA" weight=59
    export function rawRMC(): string {
        return lastRMC;
    }

    /**
     * Returns the most recent $..VTG sentence (or empty string)
     */
    //% block="raw VTG sentence"
    //% group="Raw NMEA" weight=58
    export function rawVTG(): string {
        return lastVTG;
    }

    /**
     * Returns the most recent $..GSA sentence (GP or BD) (or empty string)
     */
    //% block="raw GSA sentence"
    //% group="Raw NMEA" weight=57
    export function rawGSA(): string {
        return lastGSA;
    }

    /**
     * Returns the most recent $..GSV sentence (any talker) (or empty string)
     * Note: GSV usually comes in multiple lines; this returns the last received one.
     */
    //% block="raw GSV sentence (last received)"
    //% group="Raw NMEA" weight=56
    export function rawGSV(): string {
        return lastGSV;
    }

    // -------------------------------------------------------------------------
    // Helpers (unchanged)
    // -------------------------------------------------------------------------
    function extractField(sentence: string, idx: number): string {
        if (!sentence) return "";
        let p = sentence.split(",");
        return idx < p.length ? p[idx] : "";
    }

    //% block="clear satellite lists"
    //% group="GNSS" advanced=true
    export function clearSatellites(): void {
        gpsSatellites = [];
        bdsSatellites = [];
    }
}