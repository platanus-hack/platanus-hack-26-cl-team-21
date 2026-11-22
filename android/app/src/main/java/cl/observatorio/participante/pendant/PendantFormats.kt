package cl.observatorio.participante.pendant

import org.json.JSONArray
import org.json.JSONObject

const val BATTERY_EMPTY_MV = 6600
const val BATTERY_FULL_MV = 8400
const val BATTERY_LOW_MV = 7000
const val EXTERNAL_POWER_MV = -1

/** Rough 2S Li-ion state of charge from a linear 6.6–8.4 V mapping. Null on external power. */
fun batteryPercentEstimate(batteryMv: Int): Int? {
    if (batteryMv == EXTERNAL_POWER_MV) return null
    val fraction = (batteryMv - BATTERY_EMPTY_MV).toDouble() / (BATTERY_FULL_MV - BATTERY_EMPTY_MV)
    return (fraction * 100).toInt().coerceIn(0, 100)
}

/**
 * Parses a hub sensor line, with or without its `*XX` checksum. Returns null when it isn't a well-formed `S` line.
 * Empty epoch (camera clock not synced), DHT11, CO2 (warming up) and battery fields are missing values.
 */
fun parseSensorLine(line: String): SensorReading? {
    val fields = line.substringBefore('*').trim().split(',')
    if (fields.size != 8 || fields[0] != "S") return null
    return SensorReading(
        rtcEpoch = fields[1].ifEmpty { null }?.let { it.toLongOrNull() ?: return null },
        uptimeMs = fields[2].toLongOrNull() ?: return null,
        temperatureC = fields[3].toDoubleOrNull(),
        humidityPct = fields[4].toDoubleOrNull(),
        co2Ppm = fields[5].ifEmpty { null }?.let { it.toIntOrNull() ?: return null },
        soundActivePct = fields[6].toIntOrNull() ?: return null,
        batteryMv = fields[7].toIntOrNull(),
    )
}

/** The `rtc_epoch_ms` of every row of frames.csv, in order: row i is frame file i + 1. */
data class FramesSummary(val epochsMs: List<Long>) {
    val count = epochsMs.size

    /** The last `rtc_epoch_ms`, or null when it is 0 (clock not synced). */
    val lastEpochMs = epochsMs.lastOrNull()?.takeIf { it > 0 }
}

/** Reads the `rtc_epoch_ms` column of frames.csv (`seq,rtc_epoch_ms,uptime_ms,bytes`). */
fun summarizeFrames(framesCsv: String): FramesSummary {
    val epochs = framesCsv.lineSequence()
        .drop(1)
        .mapNotNull { it.split(',').getOrNull(1)?.toLongOrNull() }
        .toList()
    return FramesSummary(epochs)
}

fun parseStatus(json: String): PendantStatus = JSONObject(json).run {
    PendantStatus(
        deviceId = getString("device_id"),
        firmwareVersion = getString("firmware_version"),
        cameraOk = getBoolean("camera_ok"),
        sdOk = getBoolean("sd_ok"),
        sdFreeMb = getLong("sd_free_mb"),
        capturing = getBoolean("capturing"),
        sessionId = if (isNull("session_id")) null else getString("session_id"),
        frames = getInt("frames"),
        clockOk = getBoolean("clock_ok"),
        epochMs = getLong("epoch_ms"),
        batteryMv = getInt("battery_mv"),
        ip = getString("ip"),
        pendingCommands = getInt("pending_commands"),
        droppedCommands = getInt("dropped_commands"),
        lastAck = getString("last_ack"),
        lastSensorLine = getString("last_sensor_line"),
        linkBadChecksums = getInt("link_bad_checksums"),
    )
}

fun parseSessions(json: String): List<SessionEntry> {
    val array = JSONArray(json)
    return (0 until array.length()).map { i ->
        array.getJSONObject(i).run { SessionEntry(getString("session_id"), getBoolean("active")) }
    }
}

fun parseSessionInfo(json: String): SessionInfo = JSONObject(json).run {
    SessionInfo(
        sessionId = getString("session_id"),
        deviceId = getString("device_id"),
        firmwareVersion = getString("firmware_version"),
        protocolVersion = getString("protocol_version"),
        fps = getInt("fps"),
        frameSize = getString("frame_size"),
        startedAtEpochMs = getLong("started_at_epoch_ms"),
        endedAtEpochMs = if (isNull("ended_at_epoch_ms")) null else getLong("ended_at_epoch_ms"),
        frames = getInt("frames"),
    )
}
