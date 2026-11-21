package cl.observatorio.participante.pendant

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class FirmwareJsonTest {

    @Test
    fun `parses a status body as handleStatus writes it`() {
        val body = """{"device_id":"3c71bf","firmware_version":"cam-0.1.0","camera_ok":true,"sd_ok":true,""" +
            """"sd_free_mb":14820,"capturing":false,"session_id":null,"frames":0,"clock_ok":false,"epoch_ms":0,""" +
            """"battery_mv":-1,"ip":"192.168.4.1","pending_commands":1,"dropped_commands":0,"last_ack":"",""" +
            """"last_sensor_line":"S,0,4000,,,212,305,512,","link_bad_checksums":2}"""

        val status = parseStatus(body)

        assertEquals("3c71bf", status.deviceId)
        assertNull(status.sessionId)
        assertEquals(EXTERNAL_POWER_MV, status.batteryMv)
        assertEquals(14820L, status.sdFreeMb)
        assertEquals(false, status.clockOk)
        assertEquals("S,0,4000,,,212,305,512,", status.lastSensorLine)
        assertEquals(2, status.linkBadChecksums)
    }

    @Test
    fun `parses a sessions body as handleSessions writes it`() {
        val body = """[{"session_id":"3c71bf-1795281600","active":false},{"session_id":"3c71bf-1795285200","active":true}]"""

        assertEquals(
            listOf(SessionEntry("3c71bf-1795281600", false), SessionEntry("3c71bf-1795285200", true)),
            parseSessions(body),
        )
    }

    @Test
    fun `parses session json as writeSessionJson writes it`() {
        val body = """{"session_id":"3c71bf-1795281600","device_id":"3c71bf","firmware_version":"cam-0.1.0",""" +
            """"protocol_version":"eating-v1","fps":2,"frame_size":"VGA","started_at_epoch_ms":1795281600123,""" +
            """"ended_at_epoch_ms":null,"frames":42}"""

        val info = parseSessionInfo(body)

        assertEquals(1795281600123L, info.startedAtEpochMs)
        assertNull(info.endedAtEpochMs)
        assertEquals(2, info.fps)
        assertEquals("eating-v1", info.protocolVersion)
    }
}
