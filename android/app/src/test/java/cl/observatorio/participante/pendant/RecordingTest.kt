package cl.observatorio.participante.pendant

import cl.observatorio.participante.R
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

class RecordingTest {

    private class RecordingPendant(private val clockOk: Boolean = false) : PendantApi {
        val calls = mutableListOf<String>()

        override suspend fun status(): PendantStatus {
            calls += "status"
            return status(clockOk = clockOk, capturing = false)
        }

        override suspend fun syncTime(epochSeconds: Long) {
            calls += "time:$epochSeconds"
        }

        override suspend fun startCapture(protocolVersion: String): String {
            calls += "start:$protocolVersion"
            return "bcc373-1795357000"
        }

        override suspend fun stopCapture() = throw UnsupportedOperationException()
        override suspend fun sessions(): List<SessionEntry> = throw UnsupportedOperationException()
        override suspend fun sessionFile(sessionId: String, file: SessionFile): String = throw UnsupportedOperationException()
        override suspend fun frame(sessionId: String, number: Int): ByteArray = throw UnsupportedOperationException()
    }

    private companion object {
        fun status(clockOk: Boolean, capturing: Boolean) = PendantStatus(
            deviceId = "bcc373", firmwareVersion = "cam-0.2.0", cameraOk = true, sdOk = true, sdFreeMb = 63_981,
            capturing = capturing, sessionId = null, frames = 0, clockOk = clockOk, epochMs = 0, batteryMv = -1,
            ip = "172.20.10.4", pendingCommands = 0, droppedCommands = 0, lastAck = "", lastSensorLine = "",
            linkBadChecksums = 0,
        )
    }

    @Test
    fun `syncs the clock before starting when the pendant lost it`() = runBlocking {
        val pendant = RecordingPendant(clockOk = false)

        val sessionId = startRecording(pendant, "eating-v1") { 1_795_357_000 }

        assertEquals("bcc373-1795357000", sessionId)
        assertEquals(listOf("status", "time:1795357000", "start:eating-v1"), pendant.calls)
    }

    @Test
    fun `starts without touching a synced clock`() = runBlocking {
        val pendant = RecordingPendant(clockOk = true)

        startRecording(pendant, "eating-v1") { 1_795_357_000 }

        assertEquals(listOf("status", "start:eating-v1"), pendant.calls)
    }

    @Test
    fun `syncs a lost clock only while not recording`() = runBlocking {
        val pendant = RecordingPendant()

        assertTrue(syncClockIfNeeded(pendant, status(clockOk = false, capturing = false), 1_795_357_000))
        assertFalse(syncClockIfNeeded(pendant, status(clockOk = false, capturing = true), 1_795_357_001))
        assertFalse(syncClockIfNeeded(pendant, status(clockOk = true, capturing = false), 1_795_357_002))
        assertEquals(listOf("time:1795357000"), pendant.calls)
    }

    @Test
    fun `maps pendant errors to messages`() {
        assertEquals(R.string.recording_unreachable, recordingErrorMessage(PendantUnreachableException("no answer")))
        assertEquals(R.string.recording_unavailable, recordingErrorMessage(PendantRequestException(503, "no sd")))
        assertEquals(R.string.recording_failed, recordingErrorMessage(PendantRequestException(400, "bad")))
        assertEquals(R.string.recording_failed, recordingErrorMessage(IOException("reset")))
    }
}
