package cl.observatorio.participante.review

import cl.observatorio.participante.pendant.PendantApi
import cl.observatorio.participante.pendant.PendantStatus
import cl.observatorio.participante.pendant.SessionEntry
import cl.observatorio.participante.pendant.SessionFile
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.time.Instant

class ReviewVideoTest {

    @get:Rule
    val tmp = TemporaryFolder()

    private class FramesPendant(private val framesCsv: String) : PendantApi {
        val frameRequests = mutableListOf<Int>()

        override suspend fun sessionFile(sessionId: String, file: SessionFile): String {
            check(file == SessionFile.FRAMES_CSV)
            return framesCsv
        }

        override suspend fun frame(sessionId: String, number: Int): ByteArray {
            frameRequests += number
            return byteArrayOf(number.toByte())
        }

        override suspend fun status(): PendantStatus = throw UnsupportedOperationException()
        override suspend fun syncTime(epochSeconds: Long) = throw UnsupportedOperationException()
        override suspend fun startCapture(protocolVersion: String): String = throw UnsupportedOperationException()
        override suspend fun stopCapture() = throw UnsupportedOperationException()
        override suspend fun sessions(): List<SessionEntry> = throw UnsupportedOperationException()
    }

    private val startMs = 1_795_357_213_065
    private val csv = "seq,rtc_epoch_ms,uptime_ms,bytes\n" +
        (1..4).joinToString("") { "$it,${startMs + 400 + (it - 1) * 500},${it * 500},15000\n" }

    /** Reads every frame like the real encoder and keeps them all. */
    private var encodeCalls = 0
    private val fakeEncoder: ReviewEncoder = { frames, output, readJpeg, onProgress ->
        encodeCalls++
        frames.forEachIndexed { i, row -> readJpeg(row); onProgress(i + 1, frames.size) }
        output.writeText("mp4")
        frames
    }

    @Test
    fun `downloads the frames once and reuses the encoded video`() = runBlocking {
        val pendant = FramesPendant(csv)
        val progress = mutableListOf<Pair<Int, Int>>()

        val first = prepareReviewVideo(pendant, "bcc373-1795357213", tmp.root, { done, total -> progress += done to total }, fakeEncoder)
        val again = prepareReviewVideo(pendant, "bcc373-1795357213", tmp.root, encode = fakeEncoder)

        assertEquals(listOf(1, 2, 3, 4), pendant.frameRequests)
        assertEquals(4 to 4, progress.last())
        assertEquals(1, encodeCalls)
        assertEquals(startMs + 400, first.firstFrameEpochMs)
        assertEquals(first, again)
    }

    @Test
    fun `encodes again when an earlier encode was interrupted`() = runBlocking {
        val dir = tmp.newFolder("bcc373-1795357213")
        File(dir, "review.mp4").writeText("half")

        prepareReviewVideo(FramesPendant(csv), "bcc373-1795357213", tmp.root, encode = fakeEncoder)

        assertEquals(1, encodeCalls)
    }

    @Test
    fun `maps clip seconds to video positions from the first frame`() {
        val clip = Clip("s-1", Instant.ofEpochMilli(startMs), 60)
        val video = ReviewVideo(tmp.root, startMs + 400)

        assertEquals(0, videoPositionMs(clip, video, 0f))
        assertEquals(9_600, videoPositionMs(clip, video, 10f))
        assertEquals(10f, clipSecondsAt(clip, video, 9_600), 0.001f)
    }

    @Test
    fun `playback skips excluded spans and stops at the end`() {
        val excluded = listOf(Interval(10, 20), Interval(20, 25), Interval(50, 60))

        assertEquals(5f, playableFrom(5f, 60f, excluded))
        assertEquals(25f, playableFrom(12f, 60f, excluded))
        assertNull(playableFrom(50f, 60f, excluded))
        assertNull(playableFrom(40f, 40f, excluded))
    }
}
