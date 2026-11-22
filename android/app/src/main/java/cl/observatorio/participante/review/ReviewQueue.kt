package cl.observatorio.participante.review

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import cl.observatorio.participante.pendant.PendantApi
import cl.observatorio.participante.pendant.SessionFile
import cl.observatorio.participante.pendant.PendantUnreachableException
import cl.observatorio.participante.pendant.summarizeFrames
import cl.observatorio.participante.pendant.parseSessionInfo
import org.json.JSONException
import java.io.IOException
import java.time.Instant

enum class ClipStatus { PENDING, APPROVED, EXCLUDED }

/** Seconds from the start of the clip. */
data class Interval(val start: Int, val end: Int)

/** One finished pendant session waiting for the participant's review. [startedAt] is null when the pendant's clock wasn't synced. */
data class Clip(
    val id: String,
    val startedAt: Instant?,
    val durationSeconds: Int,
    val status: ClipStatus = ClipStatus.PENDING,
    val excluded: List<Interval> = emptyList(),
    /** Uploaded in this run: counted in the "all sent" summary, never listed. Later runs skip it through [ReviewQueue.wasSent]. */
    val sent: Boolean = false,
    /** `rtc_epoch_ms` of each pendant frame, in order (frame number = index + 1); empty when unknown, and then there is no preview. */
    val frameEpochsMs: List<Long> = emptyList(),
)

val Clip.needsReview get() = status == ClipStatus.PENDING && !sent

/**
 * The pendant frame number (from 1) shown for [seconds] into the clip: the last frame taken at or before that clock
 * time, so gaps in the capture never shift the picture away from its time. Without clock times the frames are spread
 * evenly over the clip. Null when the clip has no known frames.
 */
fun frameAt(clip: Clip, seconds: Int): Int? {
    val epochs = clip.frameEpochsMs
    if (epochs.isEmpty()) return null
    val second = seconds.coerceIn(0, clip.durationSeconds)
    val startMs = clip.startedAt?.toEpochMilli()
    if (startMs != null && epochs.first() > 0) {
        val targetMs = startMs + second * 1000L
        return epochs.indexOfLast { it <= targetMs }.coerceAtLeast(0) + 1
    }
    return 1 + (second.toDouble() / clip.durationSeconds * (epochs.size - 1)).toInt()
}

/** Decided, not yet sent and with a known start time: a session recorded before the first clock sync is not uploadable in v0. */
val Clip.sendable get() = !sent && status != ClipStatus.PENDING && startedAt != null

/**
 * Finished sessions pulled from the pendant and the participant's decisions on them, kept for the life of the process.
 * Sessions for which [wasSent] is true (saved by an earlier run) are not loaded again.
 */
class ReviewQueue(private val wasSent: (sessionId: String) -> Boolean = { false }) {
    val clips = mutableStateListOf<Clip>()
    var pendantUnreachable by mutableStateOf(false)
        private set
    var loading by mutableStateOf(false)
        private set

    suspend fun refresh(pendant: PendantApi) {
        loading = true
        try {
            loadNewSessions(pendant)
        } finally {
            loading = false
        }
    }

    private suspend fun loadNewSessions(pendant: PendantApi) {
        val entries = try {
            pendant.sessions()
        } catch (e: IOException) {
            pendantUnreachable = true
            return
        } catch (e: JSONException) {
            pendantUnreachable = true
            return
        }
        pendantUnreachable = false
        for (entry in entries) {
            if (entry.active || wasSent(entry.sessionId) || clips.any { it.id == entry.sessionId }) continue
            val clip = try {
                loadClip(pendant, entry.sessionId)
            } catch (e: PendantUnreachableException) {
                pendantUnreachable = true
                break
            } catch (e: IOException) {
                null
            } catch (e: JSONException) {
                null
            }
            if (clip != null && clips.none { it.id == clip.id }) clips += clip
        }
        clips.sortBy { it.startedAt }
    }

    fun update(id: String, change: (Clip) -> Clip) {
        val i = clips.indexOfFirst { it.id == id }
        if (i >= 0) clips[i] = change(clips[i])
    }

    /** Null for a session without frames, which has nothing to review. */
    private suspend fun loadClip(pendant: PendantApi, sessionId: String): Clip? {
        val info = parseSessionInfo(pendant.sessionFile(sessionId, SessionFile.SESSION_JSON))
        val frames = summarizeFrames(pendant.sessionFile(sessionId, SessionFile.FRAMES_CSV))
        if (frames.count == 0) return null
        val startedAtMs = info.startedAtEpochMs.takeIf { it > 0 }
        val durationSeconds = if (startedAtMs != null && frames.lastEpochMs != null) {
            ((frames.lastEpochMs - startedAtMs) / 1000).toInt()
        } else {
            frames.count / info.fps.coerceAtLeast(1)
        }
        return Clip(
            sessionId,
            startedAtMs?.let(Instant::ofEpochMilli),
            durationSeconds.coerceAtLeast(1),
            frameEpochsMs = frames.epochsMs,
        )
    }
}
