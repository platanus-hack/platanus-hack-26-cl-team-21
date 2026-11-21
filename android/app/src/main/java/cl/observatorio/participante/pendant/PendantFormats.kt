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

/** Parses a hub sensor line, with or without its `*XX` checksum. Returns null when it isn't a well-formed `S` line. */
fun parseSensorLine(line: String): SensorReading? {
    val fields = line.substringBefore('*').trim().split(',')
    if (fields.size != 9 || fields[0] != "S") return null
    return SensorReading(
        rtcEpoch = fields[1].toLongOrNull() ?: return null,
        uptimeMs = fields[2].toLongOrNull() ?: return null,
        temperatureC = fields[3].toDoubleOrNull(),
        humidityPct = fields[4].toDoubleOrNull(),
        mq7Raw = fields[5].toIntOrNull() ?: return null,
        mq2Raw = fields[6].toIntOrNull() ?: return null,
        soundP2pRaw = fields[7].toIntOrNull() ?: return null,
        batteryMv = fields[8].toIntOrNull(),
    )
}

data class FramesSummary(val count: Int, val lastEpochMs: Long?)

/** Counts the rows of frames.csv (`seq,rtc_epoch_ms,uptime_ms,bytes`) and keeps the last `rtc_epoch_ms`, or null when it is 0 (clock not synced). */
fun summarizeFrames(framesCsv: String): FramesSummary {
    val epochs = framesCsv.lineSequence()
        .drop(1)
        .mapNotNull { it.split(',').getOrNull(1)?.toLongOrNull() }
        .toList()
    return FramesSummary(epochs.size, epochs.lastOrNull()?.takeIf { it > 0 })
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
