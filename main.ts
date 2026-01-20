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
    }

    let _fixed = false
    let _utc = ""
    let _lat = 0
    let _ns = ""
    let _lon = 0
    let _ew = ""
    let _speedKmh = 0
    let _satellites: Satellite[] = []

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

        // Avoid toFixed() - use manual formatting for MakeCode compatibility
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
     * Returns the current list of visible satellites (GPS + Beidou)  
     * Each item contains: type, PRN, elevation, azimuth, SNR  
     * The returned array can be used in loops and other blocks
     */
    //% block="list of visible satellites"
    //% group="BQ-357 GPS/Beidou"
    export function satellites(): Satellite[] {
        return _satellites
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
        // Clear any old data
        serial.readUntil("\n")
        serial.onDataReceived("\n", function () {
            let line = serial.readUntil("\n").trim()
            if (line.length < 10) return

            let fields: string[] = line.split(",")

            // Parse RMC sentence for fix status, position, time & speed
            if (fields.length >= 10 && fields[0].substr(fields[0].length - 3) === "RMC") {
                if (fields[2] === "A") {
                    _fixed = true
                    _utc = fields[1].substr(0, 6)           // hhmmss
                    _lat = parseFloat(fields[3] || "0")
                    _ns = fields[4] || ""
                    _lon = parseFloat(fields[5] || "0")
                    _ew = fields[6] || ""
                    let knots = parseFloat(fields[7] || "0")
                    _speedKmh = Math.round(knots * 1.852)   // knots → km/h
                } else {
                    _fixed = false
                }
            }

            // Parse GPS satellites (GPGSV)
            if (fields.length >= 8 && fields[0].substr(fields[0].length - 3) === "GSV" && fields[0].includes("GP")) {
                parseGSV(fields, "GPS")
            }

            // Parse Beidou satellites (BDGSV or sometimes GBGSV)
            if (fields.length >= 8 && fields[0].substr(fields[0].length - 3) === "GSV" &&
                (fields[0].includes("BD") || fields[0].includes("GB"))) {
                parseGSV(fields, "Beidou")
            }
        })
 
    }

    // Internal helper - parses one GSV sentence (GPGSV or BDGSV)
    function parseGSV(fields: string[], system: string) {
        if (fields.length < 8) return

        let msgNum = parseInt(fields[2])
        let totalMsgs = parseInt(fields[1])

        // Only keep satellites from the current system (clear old ones on first message)
        if (msgNum === 1) {
            _satellites = _satellites.filter(s => s.type !== system)
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
                    _satellites.push(new Satellite(system, prn, elev, azim, snr))
                }
            }
            i += 4
        }
    }
}