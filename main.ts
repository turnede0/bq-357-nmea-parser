namespace bq357 {
    export enum Status {
        //% block="Indoor (not fixed)"
        Indoor,
        //% block="Outdoor (position fixed)"
        Outdoor
    }

    export class Satellite {
        constructor(
            public type: string,       // "GPS" or "Beidou"
            public prn: number,        // Satellite PRN / ID
            public elevation: number,  // Elevation in degrees
            public azimuth: number,    // Azimuth in degrees
            public snr: number         // Signal-to-noise ratio in dBHz
        ) { }

        //% blockCombine
        get PRN(): number {
            return this.prn;
        }

        //% blockCombine
        get elevation(): number {
            return this.elevation;
        }

        //% blockCombine
        get azimuth(): number {
            return this.azimuth;
        }

        //% blockCombine
        get SNR(): number {
            return this.snr;
        }

        // Optional: also expose type as a property block (useful for debugging)
        //% blockCombine
        get type(): string {
            return this.type;
        }
    }

    let _fixed = false
    let _utc = ""
    let _lat = 0
    let _ns = ""
    let _lon = 0
    let _ew = ""
    let _speedKmh = 0

    let _gpsSatellites: Satellite[] = []
    let _beidouSatellites: Satellite[] = []

    /**
     * Returns whether the module has a valid 3D fix (outdoor/position available)
     */
    //% block="BQ-357 module status"
    //% group="BQ-357 GPS/Beidou"
    export function status(): Status {
        return _fixed ? Status.Outdoor : Status.Indoor
    }

    /**
     * Returns the UTC time string in hhmmss format  
     * Returns "undefined" when no valid fix is available
     */
    //% block="UTC time (undefined when indoor)"
    //% group="BQ-357 GPS/Beidou"
    export function utcTime(): string {
        return _fixed ? _utc : "undefined"
    }

    /**
     * Returns formatted latitude string (dd° mm.mmmm' N/S)  
     * Returns "undefined" when no valid fix is available
     */
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

    /**
     * Returns formatted longitude string (ddd° mm.mmmm' E/W)  
     * Returns "undefined" when no valid fix is available
     */
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

    /**
     * Returns ground speed in km/h (rounded)  
     * Returns "undefined" when no valid fix is available
     */
    //% block="speed km/h (undefined when indoor)"
    //% group="BQ-357 GPS/Beidou"
    export function speed(): string {
        return _fixed ? _speedKmh.toString() : "undefined"
    }

    /**
     * Returns the current list of visible **GPS** satellites  
     * Each item contains: PRN, elevation, azimuth, SNR
     */
    //% block="list of visible GPS satellites"
    //% group="BQ-357 GPS/Beidou"
    export function gpsSatellites(): Satellite[] {
        return _gpsSatellites
    }

    /**
     * Returns the current list of visible **Beidou** satellites  
     * Each item contains: PRN, elevation, azimuth, SNR
     */
    //% block="list of visible Beidou satellites"
    //% group="BQ-357 GPS/Beidou"
    export function beidouSatellites(): Satellite[] {
        return _beidouSatellites
    }

    /**
     * Starts receiving and parsing NMEA sentences from the BQ-357 module  
     * @param txPin the pin connected to the module's TX pin
     * @param rxPin the pin connected to the module's RX pin
     */
    //% block="start BQ-357 module|TX pin %txPin|RX pin %rxPin"
    //% group="BQ-357 GPS/Beidou"
    //% txPin.fieldEditor="gridpicker"
    //% txPin.fieldOptions.columns=4
    //% txPin.fieldOptions.toString="%d"
    //% rxPin.fieldEditor="gridpicker"
    //% rxPin.fieldOptions.columns=4
    //% rxPin.fieldOptions.toString="%d"
    export function start(txPin: SerialPin, rxPin: SerialPin) {
        serial.redirect(
            txPin,          // micro:bit pin → module TX
            rxPin,          // micro:bit pin → module RX
            BaudRate.BaudRate9600
        )

        serial.setRxBufferSize(200)
        serial.readUntil("\n")  // clear buffer

        serial.onDataReceived("\n", function () {
            let line = serial.readUntil("\n").trim()
            if (line.length < 10) return

            let fields: string[] = line.split(",")
            if (fields.length < 4) return

            let talkerAndType = fields[0].substr(fields[0].length - 5)

            // ────────────────────────────────────────────────
            // Parse RMC for position, time, speed, fix status
            // ────────────────────────────────────────────────
            if (talkerAndType.substr(talkerAndType.length - 3) === "RMC" && fields.length >= 10) {
                if (fields[2] === "A") {
                    _fixed = true
                    _utc = fields[1].substr(0, 6)           // hhmmss
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

            // ────────────────────────────────────────────────
            // Parse GSV sentences
            // ────────────────────────────────────────────────
            if (talkerAndType.substr(talkerAndType.length - 3) === "GSV" && fields.length >= 8) {
                let system: string = null

                if (fields[0].includes("GP")) {
                    system = "GPS"
                } else if (fields[0].includes("BD") || fields[0].includes("GB")) {
                    system = "Beidou"
                }

                if (system) {
                    parseGSV(fields, system)
                }
            }
        })
    }

    // Internal helper - parses one GSV sentence and stores in the correct array
    function parseGSV(fields: string[], system: string) {
        let msgNum = parseInt(fields[2])
        let targetArray = system === "GPS" ? _gpsSatellites : _beidouSatellites

        // Clear old satellites of this system only on the first message
        if (msgNum === 1) {
            targetArray.length = 0
        }

        let i = 4
        while (i + 3 < fields.length) {
            let prnStr = fields[i]
            let elevStr = fields[i + 1]
            let azimStr = fields[i + 2]
            let snrStr = fields[i + 3]

            if (prnStr && prnStr !== "") {
                let prn = parseInt(prnStr)
                let elev = parseInt(elevStr || "0")
                let azim = parseInt(azimStr || "0")
                let snr = parseInt(snrStr || "0")

                if (prn > 0) {
                    targetArray.push(new Satellite(system, prn, elev, azim, snr))
                }
            }
            i += 4
        }
    }
}