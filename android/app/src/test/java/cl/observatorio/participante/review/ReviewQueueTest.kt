package cl.observatorio.participante.review

import cl.observatorio.participante.pendant.PendantApi
import cl.observatorio.participante.pendant.PendantRequestException
import cl.observatorio.participante.pendant.PendantStatus
import cl.observatorio.participante.pendant.PendantUnreachableException
import cl.observatorio.participante.pendant.SessionEntry
import cl.observatorio.participante.pendant.SessionFile
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class ReviewQueueTest {

    private class FakeSessionsPendant(
        private val sessions: List<SessionEntry>,
        private val files: Map<Pair<String, SessionFile>, String>,
        private val unreachable: Boolean = false,
    ) : PendantApi {
        override suspend fun sessions(): List<SessionEntry> {
            if (unreachable) throw PendantUnreachableException("no answer")
            return sessions
        }

        override suspend fun sessionFile(sessionId: String, file: SessionFile) =
            files[sessionId to file] ?: throw PendantRequestException(404, "not found")

        override suspend fun status(): PendantStatus = throw UnsupportedOperationException()
        override suspend fun syncTime(epochSeconds: Long) = throw UnsupportedOperationException()
        override suspend fun startCapture(protocolVersion: String): String = throw UnsupportedOperationException()
        override suspend fun stopCapture() = throw UnsupportedOperationException()
        override suspend fun frame(sessionId: String, number: Int): ByteArray = throw UnsupportedOperationException()
    }

    private fun sessionJson(id: String, startedAtMs: Long) =
        """{"session_id":"$id","device_id":"3c71bf","firmware_version":"cam-0.1.0","protocol_version":"eating-v1",""" +
            """"fps":2,"frame_size":"VGA","started_at_epoch_ms":$startedAtMs,"ended_at_epoch_ms":$startedAtMs,"frames":0}"""

    private fun framesCsv(vararg epochsMs: Long) =
        "seq,rtc_epoch_ms,uptime_ms,bytes\n" + epochsMs.mapIndexed { i, ms -> "${i + 1},$ms,${4000 + i * 500},24000\n" }.joinToString("")

    @Test
    fun `does not load sessions that were already sent`() = runBlocking {
        val pendant = FakeSessionsPendant(
            listOf(SessionEntry("s-1", active = false), SessionEntry("s-2", active = false)),
            listOf("s-1", "s-2").flatMap { id ->
                listOf(
                    (id to SessionFile.SESSION_JSON) to sessionJson(id, 1_795_281_600_000),
                    (id to SessionFile.FRAMES_CSV) to framesCsv(1_795_281_600_000, 1_795_281_960_000),
                )
            }.toMap(),
        )
        val queue = ReviewQueue(wasSent = { it == "s-1" })

        queue.refresh(pendant)

        assertEquals(listOf("s-2"), queue.clips.map { it.id })
    }

    @Test
    fun `loads finished sessions with start and duration from frames csv`() = runBlocking {
        val pendant = FakeSessionsPendant(
            listOf(SessionEntry("s-1", active = false), SessionEntry("s-2", active = true)),
            mapOf(
                ("s-1" to SessionFile.SESSION_JSON) to sessionJson("s-1", 1_795_281_600_000),
                ("s-1" to SessionFile.FRAMES_CSV) to framesCsv(1_795_281_600_000, 1_795_281_960_000),
            ),
        )
        val queue = ReviewQueue()

        queue.refresh(pendant)

        assertEquals(listOf(Clip("s-1", Instant.ofEpochMilli(1_795_281_600_000), 360)), queue.clips.toList())
        assertFalse(queue.pendantUnreachable)
        assertFalse(queue.loading)
    }

    @Test
    fun `uses frame count and fps when the session has no clock time`() = runBlocking {
        val pendant = FakeSessionsPendant(
            listOf(SessionEntry("s-noclock", active = false)),
            mapOf(
                ("s-noclock" to SessionFile.SESSION_JSON) to sessionJson("s-noclock", 0),
                ("s-noclock" to SessionFile.FRAMES_CSV) to framesCsv(*LongArray(120)),
            ),
        )
        val queue = ReviewQueue()

        queue.refresh(pendant)

        assertNull(queue.clips.single().startedAt)
        assertEquals(60, queue.clips.single().durationSeconds)
    }

    @Test
    fun `skips unreadable and empty sessions but keeps the rest`() = runBlocking {
        val pendant = FakeSessionsPendant(
            listOf(SessionEntry("broken", false), SessionEntry("empty", false), SessionEntry("ok", false)),
            mapOf(
                ("broken" to SessionFile.SESSION_JSON) to "{\"session_id\":",
                ("broken" to SessionFile.FRAMES_CSV) to framesCsv(1_795_281_600_000),
                ("empty" to SessionFile.SESSION_JSON) to sessionJson("empty", 1_795_281_600_000),
                ("empty" to SessionFile.FRAMES_CSV) to framesCsv(),
                ("ok" to SessionFile.SESSION_JSON) to sessionJson("ok", 1_795_281_600_000),
                ("ok" to SessionFile.FRAMES_CSV) to framesCsv(1_795_281_600_000, 1_795_281_610_000),
            ),
        )
        val queue = ReviewQueue()

        queue.refresh(pendant)

        assertEquals(listOf("ok"), queue.clips.map { it.id })
        assertFalse(queue.pendantUnreachable)
    }

    @Test
    fun `keeps review decisions and flags the pendant when it stops answering`() = runBlocking {
        val files = mapOf(
            ("s-1" to SessionFile.SESSION_JSON) to sessionJson("s-1", 1_795_281_600_000),
            ("s-1" to SessionFile.FRAMES_CSV) to framesCsv(1_795_281_600_000, 1_795_281_610_000),
        )
        val queue = ReviewQueue()
        queue.refresh(FakeSessionsPendant(listOf(SessionEntry("s-1", false)), files))
        queue.update("s-1") { it.copy(status = ClipStatus.APPROVED) }

        queue.refresh(FakeSessionsPendant(emptyList(), emptyMap(), unreachable = true))

        assertEquals(ClipStatus.APPROVED, queue.clips.single().status)
        assertTrue(queue.pendantUnreachable)
    }

    @Test
    fun `a session without clock time is never sendable`() {
        val clip = Clip("s-noclock", null, 60, ClipStatus.APPROVED)

        assertFalse(clip.sendable)
        assertTrue(clip.copy(startedAt = Instant.ofEpochMilli(1_795_281_600_000)).sendable)
    }
}
