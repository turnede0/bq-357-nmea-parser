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
        get TypeAsString(): string { return this.type; }
    }

    // ────────────────────────────────────────────────
    // State variables
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

    let _lastRawLine: string = ""

    let _moduleTxPin: SerialPin = null
    let _moduleRxPin: SerialPin = null

    /**
     * Initializes the module pins (must be called before log())
     * @param txPin micro:bit pin connected to module TX
     * @param rxPin micro:bit pin connected to module RX
     */
    //% block="initialize BQ-357 pins|TX %txPin|RX %rxPin"
    //% group="BQ-357 GPS/Beidou"
    export function initializePins(txPin: SerialPin, rxPin: SerialPin) {
        _moduleTxPin = txPin
        _moduleRxPin = rxPin
    }

    /**
     * Reads one latest NMEA sentence from the module, parses it,
     * and stores the raw string + parsed data.
     * Serial is automatically switched back to USB after reading.
     */
    //% block="log latest NMEA from module"
    //% group="BQ-357 GPS/Beidou"
    export function log() {
        if (!_moduleTxPin || !_moduleRxPin) {
            serial.writeLine("Error: Call initializePins first")
            return
        }

        // 1. Switch to module
        serial.redirect(_moduleTxPin, _moduleRxPin, BaudRate.BaudRate9600)

        // 2. Read exactly one line (latest available)
        _lastRawLine = serial.readUntil("\n").trim()

        // 3. Immediately switch back to USB
        serial.redirectToUSB()

        // 4. Parse the captured line (if valid)
        if (_lastRawLine.length >= 8) {
            parseSingleLine(_lastRawLine)
        }
    }

    /**
     * Returns the most recent raw NMEA sentence captured by log()
     */
    //% block="last raw NMEA sentence"
    //% group="BQ-357 Debug"
    export function lastRawSentence(): string {
        return _lastRawLine || "(no data yet)"
    }

    // ────────────────────────────────────────────────
    // Data getters (same as before)
    // ────────────────────────────────────────────────

    //% block="BQ-357 module status"
    //% group="BQ-357 GPS/Beidou"
    export function status(): Status {
        return _fixed ? Status.Outdoor : Status.Indoor
    }

    //% block="UTC time (undefined when indoor)"
    //% group="BQ-357 GPS/Beidou"
    export function utcTime(): string {
        return _fixed ? _utc : "undefined"
    }

    //% block="latitude (undefined when indoor)"
    //% group="BQ-357 GPS/Beidou"
    export function latitude(): string {
        if (!_fixed) return "undefined"
        let deg = Math.idiv(_lat | 0, 100)
        let min = _lat - deg * 100
        let minScaled = Math.round(min * 10000)
        let minStr = (minScaled / 10000).toString()
        return deg + "° " + minStr + "' " + _ns
    }

    //% block="longitude (undefined when indoor)"
    //% group="BQ-357 GPS/Beidou"
    export function longitude(): string {
        if (!_fixed) return "undefined"
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
    // Single-line parsing logic
    // ────────────────────────────────────────────────
    function parseSingleLine(line: string) {
        let fields = line.split(",")
        if (fields.length < 4) return

        let sentenceId = fields[0].substr(fields[0].length - 5)

        // RMC sentence
        if (sentenceId.substr(sentenceId.length - 3) === "RMC" && fields.length >= 10) {
            if (fields[2] === "A") {
                _fixed = true
                _utc = fields[1].substr(0, 6)
                _lat = parseFloat(fields[3] || "0")
                _ns = fields[4] || ""
                _lon = parseFloat(fields[5] || "0")
                _ew = fields[6] || ""
                let knots = parseFloat(fields[7] || "0")
                _speedKmh = Math.round(knots * 1.852)
            } else {
                _fixed = false
            }
        }

        // GSV sentence
        if (sentenceId.substr(sentenceId.length - 3) === "GSV" && fields.length >= 8) {
            let system: string = null
            if (fields[0].includes("GP")) system = "GPS"
            else if (fields[0].includes("BD") || fields[0].includes("GB")) system = "Beidou"

            if (system) {
                parseGSV(fields, system)
            }
        }
    }

    function parseGSV(fields: string[], system: string) {
        let msgNum = parseInt(fields[2] || "0")
        let target = system === "GPS" ? _gpsSatellites : _beidouSatellites

        // Clear list only on first message of a GSV sequence
        if (msgNum === 1) {
            target.length = 0
        }

        let i = 4
        while (i + 3 < fields.length) {
            let prn = parseInt(fields[i] || "0")
            let elev = parseInt(fields[i + 1] || "0")
            let az = parseInt(fields[i + 2] || "0")
            let snr = parseInt(fields[i + 3] || "0")

            if (prn > 0) {
                target.push(new Satellite(system, prn, elev, az, snr))
            }
            i += 4
        }
    }
}