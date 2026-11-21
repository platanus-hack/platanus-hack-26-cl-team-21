package cl.observatorio.participante.video

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FrameTimelineTest {

    private fun row(seq: Int, epochMs: Long?) = FrameRow(seq, epochMs, uptimeMs = seq * 500L, bytes = 24_000)

    @Test
    fun `parses frames csv rows and keeps an empty epoch as null`() {
        val csv = "seq,rtc_epoch_ms,uptime_ms,bytes\n1,1795281600000,4000,24000\n2,,4500,23950\n\n"

        assertEquals(
            listOf(FrameRow(1, 1795281600000, 4000, 24000), FrameRow(2, null, 4500, 23950)),
            parseFramesCsv(csv),
        )
    }

    @Test
    fun `drops frames with an empty, zero or non-increasing timestamp`() {
        val rows = listOf(
            row(1, 0),
            row(2, 1_000),
            row(3, null),
            row(4, 1_500),
            row(5, 1_500),
            row(6, 900),
            row(7, 2_000),
        )

        val selection = selectEncodableFrames(rows)

        assertEquals(listOf(2, 4, 7), selection.kept.map { it.seq })
        assertEquals(listOf(1, 3, 5, 6), selection.dropped.map { it.seq })
    }

    @Test
    fun `an RTC reset drops frames until the clock passes the last kept frame`() {
        val rows = listOf(row(1, 10_000), row(2, 10_500), row(3, 2_000), row(4, 2_500), row(5, 11_000))

        assertEquals(listOf(1, 2, 5), selectEncodableFrames(rows).kept.map { it.seq })
    }

    @Test
    fun `presentation time is microseconds since the first frame`() {
        assertEquals(0L, presentationTimeUs(1795281600000, 1795281600000))
        assertEquals(1_500_000L, presentationTimeUs(1795281601500, 1795281600000))
    }

    private fun keyframesOf(timesMs: List<Long>, scheduler: KeyframeScheduler = KeyframeScheduler()) =
        timesMs.mapIndexedNotNull { i, t -> t.takeIf { scheduler.isKeyframe(t, timesMs.getOrNull(i + 1)) } }

    @Test
    fun `a steady 2 fps stream gets a keyframe every 2 seconds`() {
        val times = (0L..6_000L step 500).toList()

        assertEquals(listOf(0L, 2_000L, 4_000L, 6_000L), keyframesOf(times))
    }

    @Test
    fun `the first frame after a gap is a keyframe`() {
        val times = listOf(0L, 500, 1_000, 5_000, 5_500, 6_000)

        assertEquals(listOf(0L, 5_000L), keyframesOf(times))
    }

    @Test
    fun `a step of exactly the gap threshold is jitter, not a gap`() {
        assertEquals(listOf(0L), keyframesOf(listOf(0L, 500, 1_500)))
    }

    @Test
    fun `with jittery timestamps the keyframe comes early so the interval never exceeds 2 seconds`() {
        val times = listOf(0L, 600, 1_300, 1_900, 2_600, 3_100, 3_800, 4_400, 5_000)

        val keyframes = keyframesOf(times)

        assertEquals(listOf(0L, 1_900L, 3_800L), keyframes)
        assertTrue(keyframes.zipWithNext().all { (a, b) -> b - a <= 2_000 })
    }

    @Test
    fun `no keyframe interval exceeds 2 seconds on an irregular stream`() {
        var t = 0L
        val times = (0 until 500).map { i -> t.also { t += 300L + (i * 7919 % 700) } }

        val keyframes = keyframesOf(times)
        val longestInterval = (keyframes + times.last()).zipWithNext().maxOf { (a, b) -> b - a }

        assertEquals(0L, keyframes.first())
        assertTrue("longest keyframe interval was $longestInterval ms", longestInterval <= 2_000)
    }

    @Test
    fun `markGap forces the next frame to be a keyframe`() {
        val scheduler = KeyframeScheduler()
        scheduler.isKeyframe(0, 500)
        scheduler.markGap()

        assertTrue(scheduler.isKeyframe(500, 1_000))
    }

    @Test
    fun `converts primary colors to BT601 limited range`() {
        val white = 0xFFFFFFFF.toInt()
        val black = 0xFF000000.toInt()
        val red = 0xFFFF0000.toInt()

        fun yuvOf(color: Int) = argbToYuv420(IntArray(4) { color }, 2, 2).let {
            Triple(it.y[0].toInt() and 0xFF, it.u[0].toInt() and 0xFF, it.v[0].toInt() and 0xFF)
        }

        assertEquals(Triple(235, 128, 128), yuvOf(white))
        assertEquals(Triple(16, 128, 128), yuvOf(black))
        assertEquals(Triple(82, 90, 240), yuvOf(red))
    }

    @Test
    fun `a JPEG needs its start and end markers, allowing trailing zero padding`() {
        fun bytes(vararg values: Int) = ByteArray(values.size) { values[it].toByte() }

        assertTrue(isCompleteJpeg(bytes(0xFF, 0xD8, 0x01, 0xFF, 0xD9)))
        assertTrue(isCompleteJpeg(bytes(0xFF, 0xD8, 0x01, 0xFF, 0xD9, 0, 0)))
        assertFalse(isCompleteJpeg(bytes(0xFF, 0xD8, 0x01, 0x02, 0x03)))
        assertFalse(isCompleteJpeg(bytes(0x00, 0xD8, 0x01, 0xFF, 0xD9)))
        assertFalse(isCompleteJpeg(ByteArray(0)))
    }
}
