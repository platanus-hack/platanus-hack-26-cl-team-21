package cl.observatorio.participante.pendant

import androidx.annotation.StringRes
import cl.observatorio.participante.R
import org.json.JSONException
import java.io.IOException

/**
 * Starts a session, setting the pendant clock first when it isn't synced: a session started without a clock has no
 * start time and can't be uploaded. Reads the clock state right before starting, since the pendant may have rebooted
 * since the last status the screen showed. Returns the session id.
 */
suspend fun startRecording(pendant: PendantApi, protocolVersion: String, nowEpochSeconds: () -> Long): String {
    if (!pendant.status().clockOk) pendant.syncTime(nowEpochSeconds())
    return pendant.startCapture(protocolVersion)
}

/**
 * Sets the pendant clock when it lost it (first connection, reboot). Never while recording: moving the clock would shift
 * the timestamps of the session in progress. Returns true when it synced.
 */
suspend fun syncClockIfNeeded(pendant: PendantApi, status: PendantStatus, nowEpochSeconds: Long): Boolean {
    if (status.clockOk || status.capturing) return false
    pendant.syncTime(nowEpochSeconds)
    return true
}

@StringRes
fun recordingErrorMessage(error: Exception): Int = when (error) {
    is PendantUnreachableException -> R.string.recording_unreachable
    is PendantRequestException -> if (error.httpStatus == 503) R.string.recording_unavailable else R.string.recording_failed
    is IOException, is JSONException -> R.string.recording_failed
    else -> throw error
}
