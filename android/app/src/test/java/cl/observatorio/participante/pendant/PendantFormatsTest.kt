package cl.observatorio.participante.pendant

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PendantFormatsTest {

    @Test
    fun `parses a full sensor line as stored in last_sensor_line`() {
        val reading = parseSensorLine("S,1795281600,12000345,23.4,47,640,12,7840")

        assertEquals(
            SensorReading(
                rtcEpoch = 1795281600,
                uptimeMs = 12000345,
                temperatureC = 23.4,
                humidityPct = 47.0,
                co2Ppm = 640,
                soundActivePct = 12,
                batteryMv = 7840,
            ),
            reading,
        )
    }

    @Test
    fun `ignores the checksum suffix of a raw link line`() {
        assertEquals(7840, parseSensorLine("S,1795281600,12000345,23.4,47,640,12,7840*5A")?.batteryMv)
    }

    @Test
    fun `keeps empty DHT, CO2 and battery fields as missing values`() {
        val reading = parseSensorLine("S,1795281600,12000345,,,,12,")

        assertNull(reading?.temperatureC)
        assertNull(reading?.humidityPct)
        assertNull(reading?.co2Ppm)
        assertNull(reading?.batteryMv)
        assertEquals(12, reading?.soundActivePct)
    }

    @Test
    fun `keeps an empty epoch as unknown until the camera clock is synced`() {
        assertNull(parseSensorLine("S,,4000,23.4,47,640,12,")?.rtcEpoch)
        assertEquals(4000L, parseSensorLine("S,,4000,23.4,47,640,12,")?.uptimeMs)
    }

    @Test
    fun `rejects lines that are not well-formed sensor lines`() {
        assertNull(parseSensorLine(""))
        assertNull(parseSensorLine("E,1795281600,12000345,BUTTON"))
        assertNull(parseSensorLine("S,1795281600,12000345,23.4,47,640"))
        assertNull(parseSensorLine("S,1795281600,12000345,23.4,47,212,305,512,7840"))
        assertNull(parseSensorLine("S,1795281600,12000345,23.4,47,abc,12,7840"))
        assertNull(parseSensorLine("S,abc,12000345,23.4,47,640,12,7840"))
    }

    @Test
    fun `maps 2S pack voltage linearly between 6,6 V and 8,4 V`() {
        assertEquals(0, batteryPercentEstimate(6600))
        assertEquals(50, batteryPercentEstimate(7500))
        assertEquals(100, batteryPercentEstimate(8400))
    }

    @Test
    fun `clamps voltages outside the pack range`() {
        assertEquals(0, batteryPercentEstimate(6000))
        assertEquals(100, batteryPercentEstimate(8600))
    }

    @Test
    fun `reports external power as no estimate`() {
        assertNull(batteryPercentEstimate(EXTERNAL_POWER_MV))
    }

    @Test
    fun `summarizes frames csv with its count and last epoch`() {
        val csv = "seq,rtc_epoch_ms,uptime_ms,bytes\n1,1795281600000,4000,24000\n2,1795281600500,4500,24000\n"

        assertEquals(FramesSummary(count = 2, lastEpochMs = 1795281600500), summarizeFrames(csv))
    }

    @Test
    fun `has no last epoch when frames were stamped before the clock was synced`() {
        val csv = "seq,rtc_epoch_ms,uptime_ms,bytes\n1,0,4000,24000\n2,0,4500,24000\n"

        assertEquals(FramesSummary(count = 2, lastEpochMs = null), summarizeFrames(csv))
    }

    @Test
    fun `counts no frames when frames csv has only its header`() {
        assertEquals(FramesSummary(count = 0, lastEpochMs = null), summarizeFrames("seq,rtc_epoch_ms,uptime_ms,bytes\n"))
    }
}
