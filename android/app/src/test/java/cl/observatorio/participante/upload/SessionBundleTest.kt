package cl.observatorio.participante.upload

import cl.observatorio.participante.review.Interval
import cl.observatorio.participante.video.FrameRow
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import java.io.File
import java.time.ZoneId

class SessionBundleTest {
    private val start = 1_795_280_400_000L // clip start, epoch ms
    private val utc = ZoneId.of("UTC")

    @Test
    fun excludedSecondsBecomeEpochRangesAndTheEdgesAreOpenEnded() {
        val ranges = excludedRanges(start, durationSeconds = 100, excluded = listOf(Interval(0, 10), Interval(40, 50), Interval(90, 100)))

        assertEquals(
            listOf(
                ExcludedRange(Long.MIN_VALUE, start + 10_000),
                ExcludedRange(start + 40_000, start + 50_000),
                ExcludedRange(start + 90_000, Long.MAX_VALUE),
            ),
            ranges,
        )
        // A frame just past the whole-second duration is still inside the last excluded interval.
        assertFalse(keepFrames(listOf(frame(1, start + 100_400)), ranges).isNotEmpty())
    }

    @Test
    fun keepsOnlyFramesOutsideTheExcludedRanges() {
        val ranges = excludedRanges(start, 100, listOf(Interval(40, 50)))
        val rows = listOf(39_500L, 40_000L, 49_500L, 50_000L).mapIndexed { i, offset -> frame(i + 1, start + offset) }

        assertEquals(listOf(1, 4), keepFrames(rows, ranges).map { it.seq })
    }

    @Test
    fun dropsSensorRowsAndEventsInsideExcludedRangesButKeepsPrivacyEvents() {
        val ranges = excludedRanges(start, 100, listOf(Interval(40, 50)))
        val second = start / 1000
        val sensors = "rtc_epoch,uptime_ms,temp_c\n${second + 39},1,24.0\n${second + 40},2,24.1\n${second + 49},3,24.2\n${second + 50},4,24.3\n"
        val events = "rtc_epoch,uptime_ms,type,value\n" +
            "${second + 45},1,BUTTON,\n${second + 46},2,PRIVACY_ON,${second + 46}\n${second + 47},3,PRIVACY_OFF,${second + 47}\n${second + 60},4,BUTTON,\n"

        assertEquals(
            "rtc_epoch,uptime_ms,temp_c\n${second + 39},1,24.0\n${second + 50},4,24.3\n",
            filterCsvRows(sensors, ranges),
        )
        assertEquals(
            "rtc_epoch,uptime_ms,type,value\n${second + 46},2,PRIVACY_ON,${second + 46}\n${second + 47},3,PRIVACY_OFF,${second + 47}\n${second + 60},4,BUTTON,\n",
            filterCsvRows(events, ranges, ::isPrivacyEvent),
        )
    }

    @Test
    fun dropsARowWhoseSecondOverlapsAnExcludedRangeStartingMidSecond() {
        // The clip starts 500 ms into a second, so the exclusion [40.5 s, 50.5 s) cuts through the seconds 40 and 50.
        val ranges = excludedRanges(start + 500, 100, listOf(Interval(40, 50)))
        val second = start / 1000
        val sensors = "rtc_epoch,uptime_ms,temp_c\n${second + 39},1,24.0\n${second + 40},2,24.1\n${second + 50},3,24.2\n${second + 51},4,24.3\n"

        assertEquals("rtc_epoch,uptime_ms,temp_c\n${second + 39},1,24.0\n${second + 51},4,24.3\n", filterCsvRows(sensors, ranges))
    }

    @Test
    fun dropsRowsWithoutAUsableTimestampOnlyWhenThereAreExclusions() {
        val csv = "rtc_epoch,uptime_ms,temp_c\n,1,24.0\n0,2,24.1\n${start / 1000},3,24.2\n"

        assertEquals("rtc_epoch,uptime_ms,temp_c\n${start / 1000},3,24.2\n", filterCsvRows(csv, excludedRanges(start, 100, listOf(Interval(40, 50)))))
        assertEquals(csv, filterCsvRows(csv, emptyList()))
    }

    @Test
    fun clipsExcludedIntervalsToTheRecordedSession() {
        val ranges = excludedRanges(start, 100, listOf(Interval(0, 10), Interval(90, 100)))

        assertEquals(
            listOf((start + 500) to (start + 10_000), (start + 90_000) to (start + 99_500)),
            clipToRecorded(ranges, fromMs = start + 500, toMs = start + 99_500),
        )
    }

    @Test
    fun framesCsvListsTheEncodedFramesInOrder() {
        assertEquals("seq,rtc_epoch_ms,uptime_ms,bytes\n1,100,7,24000\n3,200,9,24000\n", framesCsv(listOf(frame(1, 100, 7), frame(3, 200, 9))))
    }

    @Test
    fun manifestHoldsTheSessionTheExcludedIntervalsAndTheFileHashes() {
        val video = File.createTempFile("video", ".mp4").apply { writeText("abc"); deleteOnExit() }
        val manifest = JSONObject(
            manifestJson(
                uploadId = "6f1c2a9e-4b7d-4e2a-9c51-0d3e8f7a1b24",
                deviceSessionJson = """{"session_id":"a1b2c3-1795280400","device_id":"a1b2c3"}""",
                phone = JSONObject().put("model", "Pixel 8"),
                recordedFromMs = start,
                recordedToMs = start + 60_000,
                excluded = listOf((start + 10_000) to (start + 20_000)),
                files = listOf(BundleFile("video", "video.mp4", "video/mp4", video)),
                zone = utc,
            ),
        )

        assertEquals("a1b2c3-1795280400", manifest.getString("device_session_id"))
        assertEquals("2026-11-21T17:00:00.000+00:00", manifest.getString("recorded_from"))
        assertEquals("2026-11-21T17:00:10.000+00:00", manifest.getJSONArray("excluded_intervals").getJSONObject(0).getString("start"))
        val file = manifest.getJSONArray("files").getJSONObject(0)
        // sha256("abc")
        assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", file.getString("sha256"))
        assertEquals(3, file.getInt("bytes"))
    }

    private fun frame(seq: Int, epochMs: Long, uptimeMs: Long = 0) = FrameRow(seq, epochMs, uptimeMs, 24_000)
}
