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

    let _lastRawCycle: string = ""
    let _cycleLines: string[] = []

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
     * Captures one complete NMEA cycle (from one GGA to just before the next GGA)
     * and parses all sentences in it. Serial is returned to USB afterwards.
     */
    //% block="log latest complete NMEA cycle"
    //% group="BQ-357 GPS/Beidou"
    export function log() {
        if (!_moduleTxPin || !_moduleRxPin) {
            serial.writeLine("Error: Call initializePins first")
            return
        }

        serial.redirect(_moduleTxPin, _moduleRxPin, BaudRate.BaudRate9600)

        _cycleLines = []
        let maxLines = 25
        let lineCount = 0
        let seenGGA = false

        while (lineCount < maxLines) {
            let line = serial.readUntil("\n").trim()
            if (line.length < 6) continue

            _cycleLines.push(line)
            lineCount++

            if (line.includes("$GNGGA") || line.includes("$GPGGA")) {
                if (seenGGA) {
                    _cycleLines.pop()
                    break
                }
                seenGGA = true
            }
        }

        _lastRawCycle = _cycleLines.join("\n")
        serial.redirectToUSB()

        for (let line of _cycleLines) {
            if (line.length >= 8) {
                parseSingleLine(line)
            }
        }
    }

    /**
     * Returns the last complete raw NMEA cycle captured (multi-line string)
     */
    //% block="last raw NMEA cycle (multi-line)"
    //% group="BQ-357 Debug"
    export function lastRawCycle(): string {
        return _lastRawCycle || "(no cycle captured yet)"
    }

    // ────────────────────────────────────────────────
    // Data getters
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