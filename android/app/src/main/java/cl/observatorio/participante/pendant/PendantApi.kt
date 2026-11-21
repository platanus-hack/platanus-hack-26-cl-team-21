package cl.observatorio.participante.pendant

import java.io.IOException

/**
 * The pendant's HTTP API (hardware/README.md §7.3). Calls throw [PendantUnreachableException] when the device can't be
 * reached, and [PendantRequestException] when it answers with an error status (400, 401, 404, 409, 503).
 */
interface PendantApi {
    /** GET /status */
    suspend fun status(): PendantStatus

    /** POST /time?epoch=<s>. Queued on the device; confirmed later by `last_ack` and `clock_ok` in [status]. */
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

/** One parsed `S,<epoch>,<uptime_ms>,<temp_c>,<rh_pct>,<mq7>,<mq2>,<sound_p2p>,<batt_mv>` line. */
data class SensorReading(
    val rtcEpoch: Long,
    val uptimeMs: Long,
    /** Null when the DHT11 read failed. */
    val temperatureC: Double?,
    val humidityPct: Double?,
    /** Raw ADC values (0–1023): relative readings, not ppm or dB. */
    val mq7Raw: Int,
    val mq2Raw: Int,
    val soundP2pRaw: Int,
    /** Null on external power. */
    val batteryMv: Int?,
)
