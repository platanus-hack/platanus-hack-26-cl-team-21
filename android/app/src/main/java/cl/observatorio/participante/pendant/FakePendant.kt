package cl.observatorio.participante.pendant

import androidx.compose.runtime.mutableStateListOf
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import java.time.Instant
import java.time.temporal.ChronoUnit
import kotlin.math.sin
import kotlin.random.Random

data class DeviceStatus(
    val deviceId: String,
    val firmwareVersion: String,
    val connected: Boolean,
    val recording: Boolean,
    val privacySwitchOn: Boolean,
    val batteryPct: Int,
    val charging: Boolean,
    val storageUsedPct: Int,
    val temperatureC: Double,
    val humidityPct: Int,
    val soundRaw: Int, // KY-037 ADC value, not calibrated dB
    val coRaw: Int, // MQ-7 relative reading, not ppm
    val gasRaw: Int, // MQ-2 relative reading, not ppm
    val updatedAt: Instant,
)

enum class ClipStatus { PENDING, APPROVED, EXCLUDED }

/** Seconds from the start of the clip. */
data class Interval(val start: Int, val end: Int)

data class Clip(
    val id: String,
    val startedAt: Instant,
    val durationSeconds: Int,
    val status: ClipStatus = ClipStatus.PENDING,
    val excluded: List<Interval> = emptyList(),
)

// shortcut: simulated pendant with made-up data, replace with the BLE + Wi-Fi client once the firmware contract exists.
object FakePendant {

    fun status(): Flow<DeviceStatus> = flow {
        var t = 0.0
        while (true) {
            emit(
                DeviceStatus(
                    deviceId = "pendant-01",
                    firmwareVersion = "0.1.0",
                    connected = true,
                    recording = true,
                    privacySwitchOn = false,
                    batteryPct = 78,
                    charging = false,
                    storageUsedPct = 34,
                    temperatureC = 23.4 + sin(t / 7) * 0.3,
                    humidityPct = 47,
                    soundRaw = 480 + Random.nextInt(-40, 60),
                    coRaw = 212 + Random.nextInt(-4, 5),
                    gasRaw = 305 + Random.nextInt(-6, 7),
                    updatedAt = Instant.now(),
                ),
            )
            t++
            delay(1_000)
        }
    }

    private val sessionStart = Instant.now().truncatedTo(ChronoUnit.HOURS).minus(3, ChronoUnit.HOURS)

    /** Clips pulled from the pendant, kept for the life of the process. */
    val clips = mutableStateListOf(
        Clip("clip-071", sessionStart.plusSeconds(12 * 60), 300),
        Clip("clip-072", sessionStart.plusSeconds(47 * 60), 540),
        Clip("clip-073", sessionStart.plusSeconds(95 * 60), 180),
        Clip("clip-074", sessionStart.plusSeconds(131 * 60), 420),
        Clip("clip-075", sessionStart.plusSeconds(160 * 60), 240),
    )

    fun update(id: String, change: (Clip) -> Clip) {
        val i = clips.indexOfFirst { it.id == id }
        if (i >= 0) clips[i] = change(clips[i])
    }
}
