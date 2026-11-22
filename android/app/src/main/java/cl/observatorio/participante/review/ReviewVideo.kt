package cl.observatorio.participante.review

import cl.observatorio.participante.pendant.PendantApi
import cl.observatorio.participante.pendant.SessionFile
import cl.observatorio.participante.video.FrameRow
import cl.observatorio.participante.video.Mp4Encoder
import cl.observatorio.participante.video.parseFramesCsv
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import java.io.File

/** A whole session encoded for review on the phone. Video position 0 is the clock time of its first frame. */
data class ReviewVideo(val file: File, val firstFrameEpochMs: Long)

/** Encodes frames into an MP4 and returns the ones that made it into the video, reporting (done, total). */
typealias ReviewEncoder = suspend (
    frames: List<FrameRow>,
    output: File,
    readJpeg: (FrameRow) -> ByteArray,
    onProgress: (done: Int, total: Int) -> Unit,
) -> List<FrameRow>

/**
 * Downloads a session's frames from the pendant once and encodes them into `<cacheDir>/<sessionId>/review.mp4`. Later
 * calls reuse it. Throws [cl.observatorio.participante.video.NoEncodableFramesException] for a session recorded
 * without a synced clock.
 */
suspend fun prepareReviewVideo(
    pendant: PendantApi,
    sessionId: String,
    cacheDir: File,
    onProgress: (done: Int, total: Int) -> Unit = { _, _ -> },
    encode: ReviewEncoder = { frames, output, readJpeg, progress -> Mp4Encoder().encode(frames, output, readJpeg, progress).encoded },
): ReviewVideo = withContext(Dispatchers.IO) {
    val dir = File(cacheDir, sessionId)
    val video = File(dir, "review.mp4")
    val firstEpoch = File(dir, "first-frame-epoch-ms.txt")
    if (video.exists() && firstEpoch.exists()) return@withContext ReviewVideo(video, firstEpoch.readText().toLong())

    dir.mkdirs()
    val frames = parseFramesCsv(pendant.sessionFile(sessionId, SessionFile.FRAMES_CSV))
    // The encoder reads frames on its own IO thread, so blocking here on the pendant request is fine.
    val encoded = encode(frames, video, { runBlocking { pendant.frame(sessionId, it.seq) } }, onProgress)
    val first = requireNotNull(encoded.first().rtcEpochMs)
    // Written last: a cached video without it is an interrupted encode and gets redone.
    firstEpoch.writeText(first.toString())
    ReviewVideo(video, first)
}

/** Video position for [seconds] into the clip. */
fun videoPositionMs(clip: Clip, video: ReviewVideo, seconds: Float): Long =
    (requireNotNull(clip.startedAt).toEpochMilli() + (seconds * 1000).toLong() - video.firstFrameEpochMs).coerceAtLeast(0)

/** Seconds into the clip for a video position. */
fun clipSecondsAt(clip: Clip, video: ReviewVideo, positionMs: Long): Float =
    (video.firstFrameEpochMs + positionMs - requireNotNull(clip.startedAt).toEpochMilli()) / 1000f

/**
 * Where playback continues from [seconds]: past the end of the excluded span it falls in, so what plays is what would
 * be sent. Null when nothing is left to play before [until].
 */
fun playableFrom(seconds: Float, until: Float, excluded: List<Interval>): Float? {
    var at = seconds
    while (true) {
        val span = excluded.firstOrNull { at >= it.start && at < it.end } ?: break
        at = span.end.toFloat()
    }
    return at.takeIf { it < until }
}
