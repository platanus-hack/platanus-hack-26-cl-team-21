package cl.observatorio.participante.video

/** One row of the device frames.csv (`seq,rtc_epoch_ms,uptime_ms,bytes`). [rtcEpochMs] is null when the field is empty. */
data class FrameRow(val seq: Int, val rtcEpochMs: Long?, val uptimeMs: Long, val bytes: Long)

/** Parses frames.csv, skipping the header and rows without a numeric `seq`. */
fun parseFramesCsv(csv: String): List<FrameRow> = csv.lineSequence()
    .drop(1)
    .mapNotNull { line ->
        val fields = line.trim().split(',')
        if (fields.size < 4) return@mapNotNull null
        FrameRow(
            seq = fields[0].toIntOrNull() ?: return@mapNotNull null,
            rtcEpochMs = fields[1].toLongOrNull(),
            uptimeMs = fields[2].toLongOrNull() ?: 0,
            bytes = fields[3].toLongOrNull() ?: 0,
        )
    }
    .toList()

/** [kept] are the frames that go into the video, in order; [dropped] are the rows left out because of their timestamp. */
data class FrameSelection(val kept: List<FrameRow>, val dropped: List<FrameRow>)

/**
 * Keeps the frames whose `rtc_epoch_ms` can be a presentation timestamp: rows with an empty or 0 epoch,
 * or one that is not greater than the last kept frame (RTC lost or reset), are dropped and become a gap in the video.
 */
fun selectEncodableFrames(rows: List<FrameRow>): FrameSelection {
    val kept = mutableListOf<FrameRow>()
    val dropped = mutableListOf<FrameRow>()
    var lastEpochMs = 0L
    for (row in rows) {
        val epochMs = row.rtcEpochMs
        if (epochMs == null || epochMs <= 0 || epochMs <= lastEpochMs) {
            dropped += row
        } else {
            kept += row
            lastEpochMs = epochMs
        }
    }
    return FrameSelection(kept, dropped)
}

/** `pts = (rtc_epoch_ms − first_frame_epoch_ms)`, in microseconds as MediaCodec expects. */
fun presentationTimeUs(epochMs: Long, firstEpochMs: Long): Long = (epochMs - firstEpochMs) * 1000

/**
 * Decides which frames are encoded as keyframes, so the worker can cut clips at keyframes without re-encoding:
 * the first frame, the first frame after a gap, and enough others that keyframes are never more than
 * [maxIntervalMs] apart. Frames must be offered in order, once each, with strictly increasing timestamps.
 */
class KeyframeScheduler(
    private val maxIntervalMs: Long = MAX_KEYFRAME_INTERVAL_MS,
    private val gapMs: Long = GAP_MS,
) {
    private var lastFrameMs: Long? = null
    private var lastKeyframeMs: Long? = null
    private var forceNext = false

    /** Makes the next frame a keyframe, e.g. after a frame could not be decoded and was left out of the video. */
    fun markGap() {
        forceNext = true
    }

    /**
     * Whether the frame at [frameMs] must be a keyframe. [nextFrameMs] is the timestamp of the frame that will follow
     * it, or null for the last one: when that frame would be too far from the last keyframe, this one becomes the keyframe.
     */
    fun isKeyframe(frameMs: Long, nextFrameMs: Long?): Boolean {
        val previous = lastFrameMs
        val lastKey = lastKeyframeMs
        val keyframe = forceNext ||
            previous == null ||
            lastKey == null ||
            frameMs - previous > gapMs ||
            frameMs - lastKey >= maxIntervalMs ||
            (nextFrameMs != null && nextFrameMs - frameMs <= gapMs && nextFrameMs - lastKey > maxIntervalMs)
        lastFrameMs = frameMs
        if (keyframe) lastKeyframeMs = frameMs
        forceNext = false
        return keyframe
    }

    companion object {
        const val MAX_KEYFRAME_INTERVAL_MS = 2_000L

        /**
         * Twice the device's 2 fps frame period: a longer step between frames is a gap, not capture jitter. Deliberately
         * stricter than the coverage threshold: an extra keyframe costs little, a missing one breaks a cut.
         */
        const val GAP_MS = 1_000L
    }
}
