package cl.observatorio.participante.video

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import cl.observatorio.participante.pendant.MockPendant
import cl.observatorio.participante.pendant.SessionFile
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayOutputStream
import java.io.File
import kotlin.random.Random

/** Encodes frames on a device or emulator and reads the MP4 back with the platform's own extractor and retriever. */
@RunWith(AndroidJUnit4::class)
class Mp4EncoderTest {

    private val cacheDir = InstrumentationRegistry.getInstrumentation().targetContext.cacheDir

    @Test
    fun encodesTheMockSessionWithItsRealTimestamps() = runBlocking<Unit> {
        val pendant = MockPendant()
        val sessionId = pendant.sessions().last { !it.active && !it.sessionId.contains("noclock") }.sessionId
        val deviceRows = parseFramesCsv(pendant.sessionFile(sessionId, SessionFile.FRAMES_CSV))
        val jpegs = fetchFrames(pendant, sessionId, deviceRows)

        val excluded = 101..160
        val excludedFrame = 82
        val rows = deviceRows.filter { it.seq !in excluded && it.seq != excludedFrame }.map { row ->
            when (row.seq) {
                200 -> row.copy(rtcEpochMs = 0)
                250 -> row.copy(rtcEpochMs = deviceRows.first { it.seq == 249 }.rtcEpochMs)
                else -> row
            }
        }
        val progress = mutableListOf<Pair<Int, Int>>()
        val output = File(cacheDir, "mock-session.mp4")

        val result = Mp4Encoder().encode(rows, output, { jpegs.getValue(it.seq) }) { done, total -> progress += done to total }

        val expectedSeqs = rows.map { it.seq } - setOf(200, 250)
        assertEquals(expectedSeqs, result.encoded.map { it.seq })
        assertEquals(listOf(200, 250), result.dropped.map { it.seq })
        val total = rows.size - 2
        assertEquals((1..total).map { it to total }, progress)

        val firstEpochMs = result.encoded.first().rtcEpochMs!!
        val expectedPtsUs = result.encoded.map { presentationTimeUs(it.rtcEpochMs!!, firstEpochMs) }
        val samples = readSamples(output)
        assertEquals(expectedPtsUs, samples.map { it.timeUs })

        val syncTimesUs = samples.filter { it.sync }.map { it.timeUs }
        assertEquals(result.keyframeTimesUs, syncTimesUs)
        for (seq in listOf(excludedFrame + 1, 201, 251)) {
            val row = result.encoded.first { it.seq == seq }
            val previous = result.encoded.last { it.seq < seq }
            assertEquals(1_000L, row.rtcEpochMs!! - previous.rtcEpochMs!!)
            val keyframeUs = presentationTimeUs(row.rtcEpochMs, firstEpochMs)
            assertTrue("frame $seq must open on a keyframe", keyframeUs in syncTimesUs)
        }
        val longestKeyframeIntervalUs = longestKeyframeIntervalUs(expectedPtsUs, syncTimesUs.toSet())
        assertTrue("longest keyframe interval was $longestKeyframeIntervalUs µs", longestKeyframeIntervalUs <= 2_000_000)

        val durationMs = durationMs(output)
        val lastPtsMs = expectedPtsUs.last() / 1000
        assertTrue("duration $durationMs ms vs last frame at $lastPtsMs ms", durationMs in lastPtsMs..lastPtsMs + 1_000)

        Log.i(TAG, "mock session: ${result.encoded.size} frames, ${durationMs / 1000.0} s, ${output.length()} bytes, " +
            "${syncTimesUs.size} keyframes, longest keyframe interval ${longestKeyframeIntervalUs / 1000} ms")
    }

    @Test
    fun texturedVgaFramesStayNearTheTargetBitRate() = runBlocking<Unit> {
        val frameCount = 240 // 2 minutes at 2 fps
        val startMs = 1_795_281_600_000L
        val rows = (1..frameCount).map { FrameRow(it, startMs + (it - 1) * 500L, it * 500L, 0) }
        val output = File(cacheDir, "textured.mp4")

        val result = Mp4Encoder().encode(rows, output, { texturedJpeg(it.seq) })

        val seconds = result.lastFrameTimeUs / 1_000_000.0 + 0.5
        val bitsPerSecond = output.length() * 8 / seconds
        val thirtyMinutesMb = bitsPerSecond / 8 * 1_800 / 1_000_000
        Log.i(TAG, "textured VGA: ${output.length()} bytes for $seconds s = ${bitsPerSecond.toInt()} bit/s, " +
            "≈ ${"%.1f".format(thirtyMinutesMb)} MB per 30 min")
        assertTrue("bit rate was $bitsPerSecond", bitsPerSecond < Mp4Encoder.DEFAULT_BIT_RATE * 2)
    }

    @Test
    fun anUnencodableSessionRemovesAnExistingOutput() = runBlocking<Unit> {
        val pendant = MockPendant()
        val sessionId = pendant.sessions().first { it.sessionId.contains("noclock") }.sessionId
        val rows = parseFramesCsv(pendant.sessionFile(sessionId, SessionFile.FRAMES_CSV))
        val output = File(cacheDir, "noclock.mp4").apply { writeText("old video") }

        try {
            Mp4Encoder().encode(rows, output, { error("no frame should be read") })
            fail("expected NoEncodableFramesException")
        } catch (expected: NoEncodableFramesException) {
            assertFalse(output.exists())
        }
    }

    /** The longest time between consecutive keyframes inside a run of frames without a gap; every run must open on one. */
    private fun longestKeyframeIntervalUs(ptsUs: List<Long>, syncUs: Set<Long>): Long {
        val gapUs = KeyframeScheduler.GAP_MS * 1000
        var longest = 0L
        var lastKeyUs = ptsUs.first()
        for (i in 1 until ptsUs.size) {
            val current = ptsUs[i]
            val afterGap = current - ptsUs[i - 1] > gapUs
            if (afterGap && current !in syncUs) return Long.MAX_VALUE
            if (current in syncUs) {
                if (!afterGap) longest = maxOf(longest, current - lastKeyUs)
                lastKeyUs = current
            }
        }
        return longest
    }

    private suspend fun fetchFrames(pendant: MockPendant, sessionId: String, rows: List<FrameRow>) = coroutineScope {
        rows.chunked(32).flatMap { chunk ->
            chunk.map { row -> async { row.seq to pendant.frame(sessionId, row.seq) } }.awaitAll()
        }.toMap()
    }

    /** A static textured scene panning slowly, a moving object and light sensor-like noise: closer to camera footage than a flat color. */
    private val sceneNoise = Random(0).let { random -> IntArray(1_024 * Mp4Encoder.VGA_HEIGHT) { random.nextInt(-40, 41) } }

    private fun texturedJpeg(seq: Int): ByteArray {
        val bitmap = Bitmap.createBitmap(Mp4Encoder.VGA_WIDTH, Mp4Encoder.VGA_HEIGHT, Bitmap.Config.ARGB_8888)
        val random = Random(seq)
        val pan = seq * 2 % 384
        val pixels = IntArray(bitmap.width * bitmap.height) { i ->
            val x = i % bitmap.width + pan
            val y = i / bitmap.width
            val shade = ((x / 40 + y / 40) % 2) * 80 + 60 + sceneNoise[y * 1_024 + x] + random.nextInt(-4, 5)
            Color.rgb(shade.coerceIn(0, 255), (shade * 3 / 4).coerceIn(0, 255), (255 - shade).coerceIn(0, 255))
        }
        bitmap.setPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
        Canvas(bitmap).drawRect(
            (seq * 13 % 500).toFloat(), 120f, (seq * 13 % 500 + 140).toFloat(), 300f,
            Paint().apply { color = Color.DKGRAY },
        )
        return ByteArrayOutputStream().also { bitmap.compress(Bitmap.CompressFormat.JPEG, 80, it) }.toByteArray()
            .also { bitmap.recycle() }
    }

    private data class Sample(val timeUs: Long, val sync: Boolean)

    private fun readSamples(file: File): List<Sample> {
        val extractor = MediaExtractor()
        try {
            extractor.setDataSource(file.path)
            assertEquals(1, extractor.trackCount)
            val format = extractor.getTrackFormat(0)
            assertEquals(MediaFormat.MIMETYPE_VIDEO_AVC, format.getString(MediaFormat.KEY_MIME))
            assertEquals(Mp4Encoder.VGA_WIDTH, format.getInteger(MediaFormat.KEY_WIDTH))
            assertEquals(Mp4Encoder.VGA_HEIGHT, format.getInteger(MediaFormat.KEY_HEIGHT))
            extractor.selectTrack(0)
            val samples = mutableListOf<Sample>()
            do {
                samples += Sample(extractor.sampleTime, extractor.sampleFlags and MediaExtractor.SAMPLE_FLAG_SYNC != 0)
            } while (extractor.advance())
            return samples
        } finally {
            extractor.release()
        }
    }

    private fun durationMs(file: File): Long {
        val retriever = MediaMetadataRetriever()
        try {
            retriever.setDataSource(file.path)
            return retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)!!.toLong()
        } finally {
            retriever.release()
        }
    }

    private companion object {
        const val TAG = "Mp4EncoderTest"
    }
}
