package cl.observatorio.participante.upload

import android.os.Build
import cl.observatorio.participante.BuildConfig
import cl.observatorio.participante.api.apiErrorCode
import cl.observatorio.participante.pendant.PendantApi
import cl.observatorio.participante.pendant.SessionFile
import cl.observatorio.participante.review.Clip
import cl.observatorio.participante.review.ClipStatus
import cl.observatorio.participante.review.Interval
import cl.observatorio.participante.video.FrameRow
import cl.observatorio.participante.video.Mp4Encoder
import cl.observatorio.participante.video.NoEncodableFramesException
import cl.observatorio.participante.video.parseFramesCsv
import cl.observatorio.participante.video.selectEncodableFrames
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID

/** The backend or object storage answered with an error; [code] is the API v0 error code, e.g. `upload_conflict`. */
class UploadException(val httpStatus: Int, val code: String?) : IOException("Upload failed: $httpStatus $code")

/** Encodes the given frames into the output file and returns the ones that made it into the video. */
typealias FrameEncoder = suspend (frames: List<FrameRow>, output: File, readJpeg: (FrameRow) -> ByteArray) -> List<FrameRow>

private val CONTENT_TYPES = mapOf("video" to "video/mp4", "frames" to "text/csv", "sensors" to "text/csv", "events" to "text/csv", "manifest" to "application/json")
private val FILE_NAMES = mapOf("video" to "video.mp4", "frames" to "frames.csv", "sensors" to "sensors.csv", "events" to "events.csv")

/**
 * Sends a reviewed clip to the backend as the session bundle of ADR 0002: builds it under [workDir]/<clip id>
 * (dropping everything inside excluded intervals before hashing), then create upload → PUT each file → complete.
 *
 * `manifest.json` is written last, so a bundle that has it is complete and a failed send resumes with the same
 * `upload_id` and files (the API is idempotent on them). A bundle built for another decision is discarded.
 */
class Uploader(
    private val baseUrl: String,
    private val token: String,
    private val workDir: File,
    private val encode: FrameEncoder = { frames, output, readJpeg -> Mp4Encoder().encode(frames, output, readJpeg).encoded },
) {

    /**
     * [onSent] runs once the backend accepted the upload, before the bundle is deleted, and is plain blocking code:
     * a cancellation (e.g. the screen rotating mid-send) can't skip it, so a finished upload is never forgotten.
     */
    suspend fun send(pendant: PendantApi, clip: Clip, onSent: () -> Unit = {}) = withContext(Dispatchers.IO) {
        val dir = File(workDir, clip.id)
        val decision = "${clip.status}:${clip.excluded}"
        val resumable = File(dir, "manifest.json").exists() && File(dir, "decision.txt").readText() == decision
        if (!resumable) buildBundle(pendant, clip, dir, decision)
        upload(dir)
        onSent()
        dir.deleteRecursively()
    }

    private suspend fun buildBundle(pendant: PendantApi, clip: Clip, dir: File, decision: String) {
        dir.deleteRecursively()
        dir.mkdirs()
        File(dir, "decision.txt").writeText(decision)

        val startMs = requireNotNull(clip.startedAt) { "a session without a synced clock is not uploadable in v0" }.toEpochMilli()
        val sessionJson = pendant.sessionFile(clip.id, SessionFile.SESSION_JSON)
        val usable = selectEncodableFrames(parseFramesCsv(pendant.sessionFile(clip.id, SessionFile.FRAMES_CSV))).kept
        if (usable.isEmpty()) throw NoEncodableFramesException("no frame has a usable rtc_epoch_ms")
        val excluded = if (clip.status == ClipStatus.EXCLUDED) listOf(Interval(0, clip.durationSeconds)) else clip.excluded
        val ranges = excludedRanges(startMs, clip.durationSeconds, excluded)

        val files = mutableListOf<BundleFile>()
        val toEncode = keepFrames(usable, ranges)
        if (toEncode.isNotEmpty()) {
            // The encoder reads frames on its own IO thread, so blocking here on the pendant request is fine.
            val encoded = encode(toEncode, File(dir, "video.mp4")) { runBlocking { pendant.frame(clip.id, it.seq) } }
            File(dir, "frames.csv").writeText(framesCsv(encoded))
            files += BundleFile("video", "video.mp4", CONTENT_TYPES.getValue("video"), File(dir, "video.mp4"))
            files += BundleFile("frames", "frames.csv", CONTENT_TYPES.getValue("frames"), File(dir, "frames.csv"))
        }
        File(dir, "sensors.csv").writeText(filterCsvRows(pendant.sessionFile(clip.id, SessionFile.SENSORS_CSV), ranges))
        File(dir, "events.csv").writeText(filterCsvRows(pendant.sessionFile(clip.id, SessionFile.EVENTS_CSV), ranges, ::isPrivacyEvent))
        files += BundleFile("sensors", "sensors.csv", CONTENT_TYPES.getValue("sensors"), File(dir, "sensors.csv"))
        files += BundleFile("events", "events.csv", CONTENT_TYPES.getValue("events"), File(dir, "events.csv"))

        val fromMs = usable.first().rtcEpochMs!!
        val toMs = usable.last().rtcEpochMs!!
        val phone = JSONObject().put("app_version", BuildConfig.VERSION_NAME).put("os", "Android ${Build.VERSION.RELEASE}").put("model", Build.MODEL)
        val manifest = manifestJson(UUID.randomUUID().toString(), sessionJson, phone, fromMs, toMs, clipToRecorded(ranges, fromMs, toMs), files)
        File(dir, "manifest.json").writeText(manifest)
    }

    private fun upload(dir: File) {
        val manifestFile = File(dir, "manifest.json")
        val manifest = JSONObject(manifestFile.readText())
        val listed = manifest.getJSONArray("files")
        val files = (0 until listed.length()).map { listed.getJSONObject(it).getString("kind") }
            .map { BundleFile(it, FILE_NAMES.getValue(it), CONTENT_TYPES.getValue(it), File(dir, FILE_NAMES.getValue(it))) } +
            BundleFile("manifest", "manifest.json", CONTENT_TYPES.getValue("manifest"), manifestFile)
        val device = manifest.getJSONObject("device_session")
        val uploadId = manifest.getString("upload_id")

        val create = JSONObject()
            .put("upload_id", uploadId)
            .put("device_id", device.getString("device_id"))
            .put("firmware_version", device.getString("firmware_version"))
            .put("device_session_id", manifest.getString("device_session_id"))
            .put("recorded_from", manifest.getString("recorded_from"))
            .put("recorded_to", manifest.getString("recorded_to"))
            .put(
                "files",
                JSONArray().apply {
                    files.forEach { put(JSONObject().put("kind", it.kind).put("sha256", it.sha256).put("bytes", it.bytes).put("content_type", it.contentType)) }
                },
            )
        val urls = JSONObject(postJson("/api/v1/uploads", create)).getJSONArray("files")
        for (i in 0 until urls.length()) {
            val target = urls.getJSONObject(i)
            val file = files.first { it.kind == target.getString("kind") }
            request(target.getString("put_url"), "PUT", authorized = false, file.contentType, file.bytes) { out -> file.file.inputStream().use { it.copyTo(out) } }
        }
        postJson("/api/v1/uploads/$uploadId/complete", JSONObject().put("excluded_intervals", manifest.getJSONArray("excluded_intervals")))
    }

    private fun postJson(path: String, body: JSONObject): String {
        val bytes = body.toString().toByteArray()
        return request(baseUrl + path, "POST", authorized = true, "application/json", bytes.size.toLong()) { it.write(bytes) }
    }

    private fun request(url: String, method: String, authorized: Boolean, contentType: String, length: Long, write: (OutputStream) -> Unit): String {
        val conn = URL(url).openConnection() as HttpURLConnection
        try {
            conn.connectTimeout = 10_000
            conn.readTimeout = 60_000 // Render free plan cold start takes 30–60 s
            conn.requestMethod = method
            if (authorized) conn.setRequestProperty("Authorization", "Bearer $token")
            conn.setRequestProperty("Content-Type", contentType)
            conn.doOutput = true
            conn.setFixedLengthStreamingMode(length) // streams the video instead of buffering it in memory
            conn.outputStream.use(write)
            val status = conn.responseCode
            if (status !in 200..299) throw UploadException(status, apiErrorCode(conn.errorStream?.bufferedReader()?.use { it.readText() }))
            return conn.inputStream.bufferedReader().use { it.readText() }
        } finally {
            conn.disconnect()
        }
    }
}
