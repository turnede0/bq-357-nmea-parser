let start = 0
let nGps = 0
let nBds = 0
basic.forever(function () {
    bq357.useGnssSerial(9600)
    serial.setRxBufferSize(128)
    start = control.millis()
    while (control.millis() - start < 4000) {
        bq357.readAndParseLine()
        basic.pause(25)
    }
    bq357.useUsbSerial()
    serial.writeLine("──────────────────────────────")
    serial.writeLine("BQ-357 GNSS  @ " + (control.millis() / 1000 | 0) + " s")
    serial.writeLine("Status       : " + bq357.status())
    serial.writeLine("UTC time     : " + (bq357.utcTime() || "(no fix)"))
    serial.writeLine("Latitude     : " + bq357.latitude())
    serial.writeLine("Longitude    : " + bq357.longitude())
    serial.writeLine("Speed        : " + bq357.speedKmh() + " km/h")
    // Raw NMEA sentences (useful for debugging / verification)
    // serial.writeLine("")
    // serial.writeLine("Raw GGA: " + (bq357.rawGGA() || "(none)"))
    // serial.writeLine("Raw RMC: " + (bq357.rawRMC() || "(none)"))
    // serial.writeLine("Raw VTG: " + (bq357.rawVTG() || "(none)"))
    // serial.writeLine("Raw GSA: " + (bq357.rawGSA() || "(none)"))
    // serial.writeLine("Raw GSV (last): " + (bq357.rawGSV() || "(none)"))
    nGps = bq357.satelliteCount(false)
    serial.writeLine("GPS satellites : " + nGps)
    if (nGps > 0) {
        for (let i = 0; i <= Math.min(6, nGps) - 1; i++) {
            serial.writeLine("  " + bq357.satelliteInfo(i, false))
        }
    }
    nBds = bq357.satelliteCount(true)
    serial.writeLine("BeiDou satellites : " + nBds)
    if (nBds > 0) {
        for (let j = 0; j <= Math.min(6, nBds) - 1; j++) {
            serial.writeLine("  " + bq357.satelliteInfo(j, true))
        }
    }
    serial.writeLine("")
    basic.pause(800)
})
