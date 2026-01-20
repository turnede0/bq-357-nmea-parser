namespace bq357 {
    export enum Status {
        //% block="室內 (未定位)"
        Indoor,
        //% block="室外 (已定位)"
        Outdoor
    }

    export class Satellite {
        constructor(
            public type: string,     // "GPS" or "Beidou"
            public prn: number,      // 衛星編號
            public elevation: number,
            public azimuth: number,
            public snr: number       // 訊噪比 dBHz
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

    //% block="BQ-357 模組狀態"
    //% group="BQ-357 北斗模組"
    export function status(): Status {
        return _fixed ? Status.Outdoor : Status.Indoor
    }

    //% block="UTC 時間 (未定位時顯示 undefined)"
    //% group="BQ-357 北斗模組"
    export function utcTime(): string {
        return _fixed ? _utc : "undefined"
    }

    //% block="緯度 (未定位時顯示 undefined)"
    //% group="BQ-357 北斗模組"
    export function latitude(): string {
        if (!_fixed) return "undefined"
        let deg = Math.floor(_lat / 100)
        let min = _lat - deg * 100
        return deg + "° " + (Math.floor(min * 10000) / 10000) + "' " + _ns
    }

    //% block="經度 (未定位時顯示 undefined)"
    //% group="BQ-357 北斗模組"
    export function longitude(): string {
        if (!_fixed) return "undefined"
        let deg = Math.floor(_lon / 100)
        let min = _lon - deg * 100
        return deg + "° " + (Math.floor(min * 10000) / 10000) + "' " + _ew
    }

    //% block="速度 km/h (未定位時顯示 undefined)"
    //% group="BQ-357 北斗模組"
    export function speed(): string {
        return _fixed ? _speedKmh.toString() : "undefined"
    }

    //% block="可見衛星清單 (包含 GPS 與北斗)"
    //% group="BQ-357 北斗模組"
    export function satellites(): Satellite[] {
        return _satellites
    }

    //% block="啟動 BQ-357 模組 (TX 接 P1, RX 接 P2)"
    //% group="BQ-357 北斗模組"
    export function start() {
        serial.redirect(
            SerialPin.P1,    // TX of BQ-357 → P1
            SerialPin.P2,    // RX of BQ-357 → P2
            BaudRate.BaudRate9600
        )
        serial.setRxBufferSize(128)
        serial.readUntil("\n")  // clear buffer

        serial.onDataReceived("\n", () => {
            let line = serial.readUntil("\n").trim()
            if (line.length < 10) return

            let fields = line.split(",")

            // $GNRMC or $GPRMC
            if (fields[0].includes("RMC") && fields.length >= 10) {
                if (fields[2] == "A") {
                    _fixed = true
                    _utc = fields[1].substr(0, 6)
                    _lat = parseFloat(fields[3])
                    _ns = fields[4]
                    _lon = parseFloat(fields[5])
                    _ew = fields[6]
                    let knots = parseFloat(fields[7] || "0")
                    _speedKmh = Math.round(knots * 1.852)  // knot → km/h
                } else {
                    _fixed = false
                }
            }

            // GPGSV – GPS satellites
            if (fields[0].includes("GPGSV") && fields.length >= 7) {
                parseGSV(fields, "GPS")
            }

            // BDGSV or GBGSV – Beidou satellites
            if (fields[0].includes("BDGSV") || fields[0].includes("GBGSV")) {
                parseGSV(fields, "Beidou")
            }
        })
    }

    function parseGSV(fields: string[], type: string) {
        let totalMessages = parseInt(fields[1])
        let msgNumber = parseInt(fields[2])
        let totalSats = parseInt(fields[3])

        let idx = 4
        _satellites = _satellites.filter(s => s.type !== type)  // clear old of same type

        while (idx + 3 < fields.length) {
            let prn = parseInt(fields[idx])
            let elev = parseInt(fields[idx + 1])
            let azim = parseInt(fields[idx + 2])
            let snr = parseInt(fields[idx + 3] || "0")

            if (prn > 0) {
                _satellites.push(new Satellite(type, prn, elev, azim, snr))
            }
            idx += 4
        }
    }
}