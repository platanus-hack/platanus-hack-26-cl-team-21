package cl.observatorio.participante.pendant

import java.io.IOException

/**
 * The pendant's HTTP API (hardware/README.md §7.3). Calls throw [PendantUnreachableException] when the device can't be
 * reached, and [PendantRequestException] when it answers with an error status (400, 401, 404, 409, 503).
 */
interface PendantApi {
    /** GET /status */
    suspend fun status(): PendantStatus

    /** POST /time?epoch=<s>. Sets the camera clock right away; `clock_ok` in [status] turns true. */
    suspend fun syncTime(epochSeconds: Long)

    /** POST /capture/start?protocol=<v>. Returns the session id. */
    suspend fun startCapture(protocolVersion: String): String

    /** POST /capture/stop */
    suspend fun stopCapture()

    /** GET /sessions */
    suspend fun sessions(): List<SessionEntry>

    /** GET /sessions/<id>/<file>, for the files in [SessionFile]. */
    suspend fun sessionFile(sessionId: String, file: SessionFile): String

    /** GET /sessions/<id>/frames/<NNNNNN>.jpg: [number] starts at 1 and the file name is zero-padded to 6 digits. */
    suspend fun frame(sessionId: String, number: Int): ByteArray
}

class PendantUnreachableException(message: String) : IOException(message)

class PendantRequestException(val httpStatus: Int, message: String) : IOException("$httpStatus $message")

enum class SessionFile(val fileName: String) {
    SESSION_JSON("session.json"),
    FRAMES_CSV("frames.csv"),
    SENSORS_CSV("sensors.csv"),
    EVENTS_CSV("events.csv"),
}

/** Body of GET /status, field for field. */
data class PendantStatus(
    val deviceId: String,
    val firmwareVersion: String,
    val cameraOk: Boolean,
    val sdOk: Boolean,
    val sdFreeMb: Long,
    val capturing: Boolean,
    val sessionId: String?,
    val frames: Int,
    val clockOk: Boolean,
    val epochMs: Long,
    /** -1 on external power, and also before the hub sent its first sensor line. */
    val batteryMv: Int,
    val ip: String,
    val pendingCommands: Int,
    val droppedCommands: Int,
    val lastAck: String,
    /** The hub's last `S,...` line without its checksum, or empty before the first one. */
    val lastSensorLine: String,
    val linkBadChecksums: Int,
)

data class SessionEntry(val sessionId: String, val active: Boolean)

/** session.json. Epochs are 0 when the session started before the pendant's clock was synced. */
data class SessionInfo(
    val sessionId: String,
    val deviceId: String,
    val firmwareVersion: String,
    val protocolVersion: String,
    val fps: Int,
    val frameSize: String,
    val startedAtEpochMs: Long,
    val endedAtEpochMs: Long?,
    val frames: Int,
)

/** One parsed `S,<epoch>,<uptime_ms>,<temp_c>,<rh_pct>,<co2_ppm>,<sound_active_pct>,<batt_mv>` line. */
data class SensorReading(
    /** Stamped by the camera; null until its clock is synced. */
    val rtcEpoch: Long?,
    /** The sensor hub's uptime. */
    val uptimeMs: Long,
    /** Null when the DHT11 read failed. */
    val temperatureC: Double?,
    val humidityPct: Double?,
    /** MH-Z19C reading; null while it warms up (first 3 minutes) or when it doesn't answer. */
    val co2Ppm: Int?,
    /** Share of the last second above the KY-037 threshold (0–100): sound activity, not dB. */
    val soundActivePct: Int,
    /** Null on external power. */
    val batteryMv: Int?,
)
