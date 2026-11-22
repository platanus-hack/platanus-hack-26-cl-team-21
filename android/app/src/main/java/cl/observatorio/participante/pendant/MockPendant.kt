package cl.observatorio.participante.pendant

import android.graphics.Bitmap
import android.graphics.Color
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.Locale
import kotlin.math.sin

class MockPendant(@Volatile var reachable: Boolean = true) : PendantApi {

    private class MockSession(
        val id: String,
        val startedAtMs: Long,
        var endedAtMs: Long?,
        val clockKnown: Boolean = true,
        val protocolVersion: String = "eating-v1",
    )

    private val deviceId = "3c71bf"
    private val firmwareVersion = "cam-0.1.0"
    private val fps = 2
    private val hubBootMs = System.currentTimeMillis() - 200 * MINUTE_MS
    private val mutex = Mutex()

    private var clockOk = true
    private var lastAck = "A,HELLO,OK"
    private val sessions = mutableListOf<MockSession>().apply {
        val now = System.currentTimeMillis()
        // The finished sessions are anchored to the UTC day: reopening the demo must give the same session ids,
        // or a session already sent would look like a new one.
        val anchor = now - now % DAY_MS
        add(MockSession("$deviceId-0-noclock-8000", anchor - 230 * MINUTE_MS, anchor - 227 * MINUTE_MS, clockKnown = false))
        add(MockSession(sessionIdAt(anchor - 190 * MINUTE_MS), anchor - 190 * MINUTE_MS, anchor - 184 * MINUTE_MS))
        add(MockSession(sessionIdAt(anchor - 95 * MINUTE_MS), anchor - 95 * MINUTE_MS, anchor - 91 * MINUTE_MS))
        add(MockSession(sessionIdAt(now - 20 * MINUTE_MS), now - 20 * MINUTE_MS, null))
    }

    override suspend fun status(): PendantStatus = respond {
        val now = System.currentTimeMillis()
        val active = activeSession()
        val sensorLine = sensorLine(now)
        val json = JSONObject()
            .put("device_id", deviceId)
            .put("firmware_version", firmwareVersion)
            .put("camera_ok", true)
            .put("sd_ok", true)
            .put("sd_free_mb", 14_820 - sessions.sumOf { framesOf(it, now).toLong() } * FRAME_BYTES / 1_048_576)
            .put("capturing", active != null)
            .put("session_id", active?.id ?: JSONObject.NULL)
            .put("frames", active?.let { framesOf(it, now) } ?: sessions.lastOrNull()?.let { framesOf(it, now) } ?: 0)
            .put("clock_ok", clockOk)
            .put("epoch_ms", now)
            .put("battery_mv", parseSensorLine(sensorLine)?.batteryMv ?: EXTERNAL_POWER_MV)
            .put("ip", "192.168.1.47")
            .put("pending_commands", 0)
            .put("dropped_commands", 0)
            .put("last_ack", lastAck)
            .put("last_sensor_line", sensorLine)
            .put("link_bad_checksums", 0)
        parseStatus(json.toString())
    }

    override suspend fun syncTime(epochSeconds: Long) = respond {
        if (epochSeconds.toString().length != 10) throw PendantRequestException(400, "epoch must be 10 digits (unix seconds)")
        clockOk = true
        lastAck = "A,TIME,OK"
    }

    override suspend fun startCapture(protocolVersion: String): String = respond {
        activeSession()?.id ?: run {
            val now = System.currentTimeMillis()
            MockSession(sessionIdAt(now), now, null, protocolVersion = protocolVersion.ifEmpty { "unknown" })
                .also { sessions += it }
                .id
        }
    }

    override suspend fun stopCapture() = respond {
        activeSession()?.endedAtMs = System.currentTimeMillis()
    }

    override suspend fun sessions(): List<SessionEntry> = respond {
        val json = JSONArray()
        sessions.forEach { json.put(JSONObject().put("session_id", it.id).put("active", it.endedAtMs == null)) }
        parseSessions(json.toString())
    }

    override suspend fun sessionFile(sessionId: String, file: SessionFile): String = respond {
        val session = findSession(sessionId)
        when (file) {
            SessionFile.SESSION_JSON -> sessionJson(session)
            SessionFile.FRAMES_CSV -> framesCsv(session)
            SessionFile.SENSORS_CSV -> sensorsCsv(session)
            SessionFile.EVENTS_CSV -> eventsCsv(session)
        }
    }

    override suspend fun frame(sessionId: String, number: Int): ByteArray = respond {
        val session = findSession(sessionId)
        if (number !in 1..framesOf(session, System.currentTimeMillis())) throw PendantRequestException(404, "not found")
        val bitmap = Bitmap.createBitmap(160, 120, Bitmap.Config.RGB_565)
        bitmap.eraseColor(Color.HSVToColor(floatArrayOf((number * 7 % 360).toFloat(), 0.25f, 0.8f)))
        ByteArrayOutputStream().also { bitmap.compress(Bitmap.CompressFormat.JPEG, 70, it) }.toByteArray()
    }

    private suspend fun <T> respond(handle: () -> T): T = withContext(Dispatchers.IO) {
        delay(RESPONSE_DELAY_MS)
        if (!reachable) throw PendantUnreachableException("olm-$deviceId.local did not respond")
        mutex.withLock { handle() }
    }

    private fun activeSession() = sessions.firstOrNull { it.endedAtMs == null }

    private fun findSession(sessionId: String) =
        sessions.firstOrNull { it.id == sessionId } ?: throw PendantRequestException(404, "not found")

    private fun sessionIdAt(epochMs: Long) = "$deviceId-${epochMs / 1000}"

    private fun framesOf(session: MockSession, now: Long) =
        (((session.endedAtMs ?: now) - session.startedAtMs) * fps / 1000).toInt()

    private fun epochOrZero(session: MockSession, epochMs: Long) = if (session.clockKnown) epochMs else 0

    private fun frameEpochMs(session: MockSession, number: Int) = session.startedAtMs + (number - 1) * 1000L / fps

    private fun sensorLine(epochMs: Long): String {
        val seconds = epochMs / 1000
        val temperature = String.format(Locale.ROOT, "%.1f", 23.4 + sin(seconds / 60.0) * 0.4)
        val noise = (seconds * 7919 % 41).toInt()
        val batteryMv = 7920 - ((epochMs - hubBootMs) / 30_000).toInt()
        return "S,$seconds,${epochMs - hubBootMs},$temperature,47,${640 + noise * 3},${noise % 30},$batteryMv"
    }

    private fun sessionJson(session: MockSession) = JSONObject()
        .put("session_id", session.id)
        .put("device_id", deviceId)
        .put("firmware_version", firmwareVersion)
        .put("protocol_version", session.protocolVersion)
        .put("fps", fps)
        .put("frame_size", "VGA")
        .put("started_at_epoch_ms", epochOrZero(session, session.startedAtMs))
        .put("ended_at_epoch_ms", session.endedAtMs?.let { epochOrZero(session, it) } ?: JSONObject.NULL)
        .put("frames", framesOf(session, System.currentTimeMillis()))
        .toString()

    private fun framesCsv(session: MockSession) = buildString {
        appendLine("seq,rtc_epoch_ms,uptime_ms,bytes")
        for (n in 1..framesOf(session, System.currentTimeMillis())) {
            val epochMs = frameEpochMs(session, n)
            appendLine("$n,${epochOrZero(session, epochMs)},${epochMs - session.startedAtMs + 4_000},$FRAME_BYTES")
        }
    }

    private fun sensorsCsv(session: MockSession) = buildString {
        appendLine("rtc_epoch,uptime_ms,temp_c,rh_pct,co2_ppm,sound_active_pct,batt_mv")
        val end = session.endedAtMs ?: System.currentTimeMillis()
        for (epochMs in session.startedAtMs until end step 1000) {
            val row = sensorLine(epochMs).removePrefix("S,")
            appendLine("${epochOrZero(session, epochMs) / 1000},${row.substringAfter(',')}")
        }
    }

    private fun eventsCsv(session: MockSession) = buildString {
        appendLine("rtc_epoch,uptime_ms,type,value")
        val buttonAtMs = session.startedAtMs + 30_000
        if (buttonAtMs < (session.endedAtMs ?: System.currentTimeMillis())) {
            appendLine("${epochOrZero(session, buttonAtMs) / 1000},${buttonAtMs - hubBootMs},BUTTON,")
        }
    }

    private companion object {
        const val MINUTE_MS = 60_000L
        const val DAY_MS = 24 * 60 * MINUTE_MS
        const val FRAME_BYTES = 24_000
        const val RESPONSE_DELAY_MS = 150L
    }
}
