namespace bq357 {
    export enum Status {
        //% block="Indoor (not fixed)"
        Indoor,
        //% block="Outdoor (position fixed)"
        Outdoor
    }

    export class Satellite {
        constructor(
            public type: string,
            public prn: number,
            public elevation: number,
            public azimuth: number,
            public snr: number
        ) { }

        //% blockCombine
        get PRN(): number { return this.prn; }

        //% blockCombine
        get Elevation(): number { return this.elevation; }

        //% blockCombine
        get Azimuth(): number { return this.azimuth; }

        //% blockCombine
        get SNR(): number { return this.snr; }

        //% blockCombine
        get Type(): string { return this.type; }
    }

    // ────────────────────────────────────────────────
    // State
    // ────────────────────────────────────────────────
    let _fixed = false
    let _utc = ""
    let _lat = 0
    let _ns = ""
    let _lon = 0
    let _ew = ""
    let _speedKmh = 0

    let _gpsSatellites: Satellite[] = []
    let _beidouSatellites: Satellite[] = []

    let _lastRawCycle: string = ""

    let _moduleTxPin: SerialPin = null
    let _moduleRxPin: SerialPin = null

    // ────────────────────────────────────────────────
    // Public API
    // ────────────────────────────────────────────────

    //% block="initialize BQ-357 pins|TX %txPin|RX %rxPin"
    //% group="BQ-357 GPS/Beidou"
    export function initializePins(txPin: SerialPin, rxPin: SerialPin) {
        _moduleTxPin = txPin
        _moduleRxPin = rxPin
        serial.setRxBufferSize(512)
        serial.redirectToUSB()
    }

    //% block="log latest NMEA cycle from module"
    //% group="BQ-357 GPS/Beidou"
    export function log() {
        if (!_moduleTxPin || !_moduleRxPin) {
            serial.writeLine("Error: Call initializePins first")
            return
        }

        // Important: increase buffer size to avoid data loss
        serial.setRxBufferSize(512)

        // Flush any old data before capture
        serial.redirect(_moduleTxPin, _moduleRxPin, BaudRate.BaudRate9600)
        serial.readUntil("\n")  // discard junk
        basic.pause(100)        // give module time to settle

        let lines: string[] = []
        let maxLines = 30       // increased to safely capture 1+ second burst

        // Clear satellite lists at the start of a new capture
        _gpsSatellites = []
        _beidouSatellites = []

        for (let i = 0; i < maxLines; i++) {
            let raw = serial.readUntil("\n")
            let line = raw.trim()
            // Accept only valid-looking NMEA sentences
            if (line.length >= 10 && line.substr(0, 1) === "$") {
                lines.push(line)
            }
            basic.pause(100)  // critical: give time for next sentence to arrive
        }

        _lastRawCycle = lines.join("\n")
        serial.redirectToUSB()

        // Parse all captured lines
        for (let line of lines) {
            parseSingleLine(line)
        }
    }

    //% block="last raw NMEA cycle (multi-line)"
    //% group="BQ-357 Debug"
    export function lastRawCycle(): string {
        return _lastRawCycle || "(no cycle captured yet)"
    }

    //% block="BQ-357 module status"
    //% group="BQ-357 GPS/Beidou"
    export function status(): Status {
        return _fixed ? Status.Outdoor : Status.Indoor
    }

    //% block="UTC time (undefined when indoor)"
    //% group="BQ-357 GPS/Beidou"
    export function utcTime(): string {
        return _fixed && _utc.length >= 6 ? _utc : "undefined"
    }

    //% block="latitude (undefined when indoor)"
    //% group="BQ-357 GPS/Beidou"
    export function latitude(): string {
        if (!_fixed || _lat <= 0) return "undefined"
        let deg = Math.idiv(_lat | 0, 100)
        let min = _lat - deg * 100
        let minScaled = Math.round(min * 10000)
        let minStr = (minScaled / 10000).toString()
        return deg + "° " + minStr + "' " + _ns
    }

    //% block="longitude (undefined when indoor)"
    //% group="BQ-357 GPS/Beidou"
    export function longitude(): string {
        if (!_fixed || _lon <= 0) return "undefined"
        let deg = Math.idiv(_lon | 0, 100)
        let min = _lon - deg * 100
        let minScaled = Math.round(min * 10000)
        let minStr = (minScaled / 10000).toString()
        return deg + "° " + minStr + "' " + _ew
    }

    //% block="speed km/h (undefined when indoor)"
    //% group="BQ-357 GPS/Beidou"
    export function speed(): string {
        return _fixed ? _speedKmh.toString() : "undefined"
    }

    //% block="list of visible GPS satellites"
    //% group="BQ-357 GPS/Beidou"
    export function gpsSatellites(): Satellite[] {
        return _gpsSatellites
    }

    //% block="list of visible Beidou satellites"
    //% group="BQ-357 GPS/Beidou"
    export function beidouSatellites(): Satellite[] {
        return _beidouSatellites
    }

    // ────────────────────────────────────────────────
    // Parsing logic
    // ────────────────────────────────────────────────
    function parseSingleLine(line: string) {
        let fields = line.split(",")
        if (fields.length < 4) return

        let sentenceId = fields[0].substr(fields[0].length - 5)

        // RMC – primary fix status & position
        if (sentenceId.substr(sentenceId.length - 3) === "RMC" && fields.length >= 10) {
            let status = fields[2] || "V"
            _fixed = (status === "A")

            if (_fixed) {
                // UTC time hhmmss
                if (fields[1] && fields[1].length >= 6) _utc = fields[1].substr(0, 6)

                // Latitude
                let latStr = fields[3] || ""
                if (latStr !== "") _lat = parseFloat(latStr)
                _ns = fields[4] || ""

                // Longitude
                let lonStr = fields[5] || ""
                if (lonStr !== "") _lon = parseFloat(lonStr)
                _ew = fields[6] || ""

                // Speed over ground
                let knots = parseFloat(fields[7] || "0")
                _speedKmh = Math.round(knots * 1.852)
            } else {
                // Clear position data when no fix
                _utc = ""
                _lat = 0
                _lon = 0
                _ns = ""
                _ew = ""
                _speedKmh = 0
            }
        }

        // GSV – satellites in view (accumulate all)
        if (sentenceId.substr(sentenceId.length - 3) === "GSV" && fields.length >= 8) {
            let system: string = null
            if (fields[0].includes("GP")) system = "GPS"
            else if (fields[0].includes("BD") || fields[0].includes("GB")) system = "Beidou"

            if (system) {
                let target = system === "GPS" ? _gpsSatellites : _beidouSatellites

                let i = 4
                while (i + 3 < fields.length) {
                    let prnStr = fields[i] || ""
                    let elevStr = fields[i + 1] || ""
                    let azStr = fields[i + 2] || ""
                    let snrStr = fields[i + 3] || ""

                    if (prnStr !== "") {
                        let prn = parseInt(prnStr)
                        let elev = elevStr !== "" ? parseInt(elevStr) : 0
                        let az = azStr !== "" ? parseInt(azStr) : 0
                        let snr = snrStr !== "" ? parseInt(snrStr) : 0

                        if (prn > 0) {
                            target.push(new Satellite(system, prn, elev, az, snr))
                        }
                    }
                    i += 4
                }
            }
        }
    }
}