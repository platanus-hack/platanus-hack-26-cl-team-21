package cl.observatorio.participante.pendant

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test
import java.io.ByteArrayInputStream
import java.net.HttpURLConnection
import java.net.URL

class HttpPendantTest {
    @Test
    fun readsStatusSessionsSensorsAndFrames() = runBlocking {
        val pendant = client()
        val status = pendant.status()

        assertEquals("bcc373", status.deviceId)
        assertEquals(24.8, parseSensorLine(status.lastSensorLine)!!.temperatureC)
        assertEquals(listOf(SessionEntry("rigo-1", false)), pendant.sessions())
        assertEquals("rtc_epoch,uptime_ms,temp_c\n1795292320,1000,24.8\n", pendant.sessionFile("rigo-1", SessionFile.SENSORS_CSV))
        assertArrayEquals("jpeg bytes".toByteArray(), pendant.frame("rigo-1", 1))
    }

    @Test
    fun sendsTimeAndCaptureCommands() = runBlocking {
        val pendant = client()

        pendant.syncTime(1795292320)
        assertEquals("rigo-1", pendant.startCapture("eating & drinking"))
        pendant.stopCapture()
    }

    @Test
    fun returnsHttpErrorsAndDoesNotFollowRedirects() {
        val unauthorized = assertThrows(PendantRequestException::class.java) {
            runBlocking { client("wrong-token").status() }
        }
        val redirect = assertThrows(PendantRequestException::class.java) {
            runBlocking { client().sessionFile("redirect", SessionFile.EVENTS_CSV) }
        }

        assertEquals(401, unauthorized.httpStatus)
        assertEquals(302, redirect.httpStatus)
    }

    @Test
    fun failsRatherThanUsingAnotherNetworkWhenWifiIsUnavailable() {
        val pendant = HttpPendant(requireNotNull(parsePendantAddress("192.168.4.1")), "test-token") { null }

        assertThrows(PendantUnreachableException::class.java) {
            runBlocking { pendant.status() }
        }
    }

    @Test
    fun acceptsOnlyLocalOriginAddresses() {
        assertEquals("http://192.168.4.1", parsePendantAddress("192.168.4.1").toString())
        assertEquals("http://olm-bcc373.local/", parsePendantAddress("http://olm-bcc373.local/").toString())
        assertNull(parsePendantAddress("http://192.168.4.1/status"))
        assertNull(parsePendantAddress("http://user@192.168.4.1"))
        assertEquals("http://172.20.10.4", parsePendantAddress("172.20.10.4").toString())
        assertEquals("http://10.0.2.2:43117", parsePendantAddress("10.0.2.2:43117").toString())
        assertNull(parsePendantAddress("ftp://192.168.4.1"))
        assertNull(parsePendantAddress("http://8.8.8.8"))
        assertNull(parsePendantAddress("http://010.0.0.1"))
        assertNull(parsePendantAddress("http://172.32.10.4"))
        assertNull(parsePendantAddress("http://olm.local.example.com"))
    }

    private fun client(token: String = "test-token") =
        HttpPendant(requireNotNull(parsePendantAddress("192.168.4.1")), token, ::FirmwareConnection)

    private class FirmwareConnection(url: URL) : HttpURLConnection(url) {
        private val response by lazy {
            check(!instanceFollowRedirects)
            if (getRequestProperty("Authorization") != "Bearer test-token") {
                401 to "unauthorized"
            } else {
                when ("$requestMethod ${url.file}") {
                    "GET /status" -> 200 to STATUS
                    "GET /sessions" -> 200 to """[{"session_id":"Backup_2026","active":false},{"session_id":"rigo-1","active":false}]"""
                    "GET /sessions/rigo-1/sensors.csv" -> 200 to "rtc_epoch,uptime_ms,temp_c\n1795292320,1000,24.8\n"
                    "GET /sessions/rigo-1/frames/000001.jpg" -> 200 to "jpeg bytes"
                    "POST /time?epoch=1795292320" -> 202 to "{}"
                    "POST /capture/start?protocol=eating+%26+drinking" -> 200 to """{"session_id":"rigo-1"}"""
                    "POST /capture/stop" -> 200 to "{}"
                    "GET /sessions/redirect/events.csv" -> 302 to ""
                    else -> 404 to "not found"
                }
            }
        }

        override fun getResponseCode() = response.first
        override fun getResponseMessage() = response.second
        override fun getInputStream() = ByteArrayInputStream(response.second.toByteArray())
        override fun getHeaderField(name: String?) = if (responseCode == 302 && name == "Location") "/status" else null
        override fun connect() = Unit
        override fun disconnect() = Unit
        override fun usingProxy() = false
    }

    private companion object {
        val STATUS = """
            {
                "device_id":"bcc373", "firmware_version":"cam-0.1.0", "camera_ok":true, "sd_ok":true,
                "sd_free_mb":63992, "capturing":false, "session_id":null, "frames":0, "clock_ok":true,
                "epoch_ms":1795292320000, "battery_mv":-1, "ip":"192.168.4.1", "pending_commands":0,
                "dropped_commands":0, "last_ack":"A,TIME,OK", "last_sensor_line":"S,1795292320,1000,24.8,47,640,8,",
                "link_bad_checksums":0
            }
        """.trimIndent()
    }
}
