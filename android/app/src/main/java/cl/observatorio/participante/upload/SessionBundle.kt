package cl.observatorio.participante.upload

import cl.observatorio.participante.review.Interval
import cl.observatorio.participante.video.FrameRow
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

// Pure parts of the session bundle of ADR 0002 §1: what gets dropped, and the manifest.

/** Epoch-ms range `[startMs, endMs)` the participant excluded. */
data class ExcludedRange(val startMs: Long, val endMs: Long) {
    operator fun contains(epochMs: Long) = epochMs >= startMs && epochMs < endMs
}

/**
 * Maps the review's excluded seconds (from the clip start) to epoch ranges. An interval touching either end of the clip
 * is open-ended: the last frames can fall a fraction of a second after the whole-second duration and must not leak.
 */
fun excludedRanges(clipStartMs: Long, durationSeconds: Int, excluded: List<Interval>): List<ExcludedRange> =
    excluded.map {
        ExcludedRange(
            if (it.start <= 0) Long.MIN_VALUE else clipStartMs + it.start * 1000L,
            if (it.end >= durationSeconds) Long.MAX_VALUE else clipStartMs + it.end * 1000L,
        )
    }

private fun List<ExcludedRange>.hit(epochMs: Long) = any { epochMs in it }

/** Sensor and event rows are stamped in whole seconds: a row is excluded when any part of its second overlaps a range. */
private fun List<ExcludedRange>.hitSecond(second: Long) = any { second * 1000 < it.endMs && second * 1000 + 1000 > it.startMs }

/** The frames outside every excluded range. Rows without a timestamp stay: the encoder drops them anyway. */
fun keepFrames(rows: List<FrameRow>, ranges: List<ExcludedRange>): List<FrameRow> =
    rows.filter { row -> row.rtcEpochMs?.let { !ranges.hit(it) } ?: true }

/** frames.csv of the bundle: the rows of the frames that are in the video, in order. */
fun framesCsv(encoded: List<FrameRow>): String = buildString {
    appendLine("seq,rtc_epoch_ms,uptime_ms,bytes")
    encoded.forEach { appendLine("${it.seq},${it.rtcEpochMs},${it.uptimeMs},${it.bytes}") }
}

/**
 * Keeps the header and every row whose first column (`rtc_epoch`, in seconds) is outside the excluded ranges,
 * plus the rows [alwaysKeep] accepts. A row without a usable `rtc_epoch` can't be checked against the ranges, so it is
 * dropped whenever there are exclusions (fail closed).
 */
fun filterCsvRows(csv: String, ranges: List<ExcludedRange>, alwaysKeep: (fields: List<String>) -> Boolean = { false }): String =
    csv.lines().filter { it.isNotBlank() }.filterIndexed { i, line ->
        val fields = line.trim().split(',')
        val second = fields[0].toLongOrNull()?.takeIf { it > 0 }
        i == 0 || alwaysKeep(fields) || (if (second == null) ranges.isEmpty() else !ranges.hitSecond(second))
    }.joinToString("") { it + "\n" }

/** Privacy switch events carry no content and coverage needs them, so they survive exclusions. */
fun isPrivacyEvent(eventsCsvFields: List<String>) = eventsCsvFields.getOrNull(2).let { it == "PRIVACY_ON" || it == "PRIVACY_OFF" }

/** Ranges as `[start, end)` inside the recorded session; the open ends become its first and last frame. */
fun clipToRecorded(ranges: List<ExcludedRange>, fromMs: Long, toMs: Long): List<Pair<Long, Long>> =
    ranges.map { maxOf(it.startMs, fromMs) to minOf(it.endMs, toMs) }.filter { it.first < it.second }

private val ISO_WITH_OFFSET = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSSxxx")

fun isoWithOffset(epochMs: Long, zone: ZoneId = ZoneId.systemDefault()): String =
    ISO_WITH_OFFSET.format(Instant.ofEpochMilli(epochMs).atZone(zone))

class BundleFile(val kind: String, val name: String, val contentType: String, val file: File) {
    val sha256: String = file.sha256Hex()
    val bytes: Long = file.length()
}

fun File.sha256Hex(): String {
    val digest = MessageDigest.getInstance("SHA-256")
    inputStream().use { input ->
        val buffer = ByteArray(64 * 1024)
        while (true) {
            val read = input.read(buffer)
            if (read < 0) break
            digest.update(buffer, 0, read)
        }
    }
    return digest.digest().joinToString("") { "%02x".format(it) }
}

fun excludedIntervalsJson(intervals: List<Pair<Long, Long>>, zone: ZoneId = ZoneId.systemDefault()): JSONArray =
    JSONArray().apply {
        intervals.forEach { (start, end) ->
            put(JSONObject().put("start", isoWithOffset(start, zone)).put("end", isoWithOffset(end, zone)))
        }
    }

/** manifest.json: the device session.json verbatim, phone info, excluded intervals and the hash of every other file. */
fun manifestJson(
    uploadId: String,
    deviceSessionJson: String,
    phone: JSONObject,
    recordedFromMs: Long,
    recordedToMs: Long,
    excluded: List<Pair<Long, Long>>,
    files: List<BundleFile>,
    zone: ZoneId = ZoneId.systemDefault(),
): String {
    val session = JSONObject(deviceSessionJson)
    return JSONObject()
        .put("manifest_version", "0")
        .put("upload_id", uploadId)
        .put("device_session_id", session.getString("session_id"))
        .put("device_session", session)
        .put("phone", phone)
        .put("recorded_from", isoWithOffset(recordedFromMs, zone))
        .put("recorded_to", isoWithOffset(recordedToMs, zone))
        .put("excluded_intervals", excludedIntervalsJson(excluded, zone))
        .put(
            "files",
            JSONArray().apply {
                files.forEach { put(JSONObject().put("kind", it.kind).put("name", it.name).put("sha256", it.sha256).put("bytes", it.bytes)) }
            },
        )
        .toString()
}
