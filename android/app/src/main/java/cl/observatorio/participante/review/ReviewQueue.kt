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
)

/** Finished sessions pulled from the pendant and the participant's decisions on them, kept for the life of the process. */
class ReviewQueue {
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
            if (entry.active || clips.any { it.id == entry.sessionId }) continue
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
        return Clip(sessionId, startedAtMs?.let(Instant::ofEpochMilli), durationSeconds.coerceAtLeast(1))
    }
}
