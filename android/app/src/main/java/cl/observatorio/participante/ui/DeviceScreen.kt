package cl.observatorio.participante.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LargeTopAppBar
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import cl.observatorio.participante.BuildConfig
import cl.observatorio.participante.R
import cl.observatorio.participante.pendant.BATTERY_LOW_MV
import cl.observatorio.participante.pendant.PendantApi
import cl.observatorio.participante.pendant.PendantStatus
import cl.observatorio.participante.pendant.SensorReading
import cl.observatorio.participante.pendant.batteryPercentEstimate
import cl.observatorio.participante.pendant.parseSensorLine
import cl.observatorio.participante.ui.theme.Amber
import cl.observatorio.participante.ui.theme.Ink
import cl.observatorio.participante.ui.theme.ObservatorioTheme
import cl.observatorio.participante.ui.theme.TabularNumbers
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import org.json.JSONException
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.util.Locale

private sealed interface PendantState {
    data object Searching : PendantState
    data object NotFound : PendantState
    data class Found(val status: PendantStatus, val receivedAt: Instant) : PendantState
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DeviceScreen(
    pendant: PendantApi,
    demoMode: Boolean,
    onChangePendant: () -> Unit,
    studyCode: String,
    participantId: String,
    onLeaveStudy: () -> Unit,
) {
    var confirmLeave by remember { mutableStateOf(false) }
    var state by remember(pendant) { mutableStateOf<PendantState>(PendantState.Searching) }
    LaunchedEffect(pendant) {
        while (true) {
            state = try {
                PendantState.Found(pendant.status(), Instant.now())
            } catch (e: IOException) {
                PendantState.NotFound
            } catch (e: JSONException) {
                PendantState.NotFound
            }
            delay(STATUS_POLL_MS)
        }
    }
    var serverOk by remember { mutableStateOf<Boolean?>(null) }
    if (BuildConfig.DEBUG) LaunchedEffect(Unit) { serverOk = checkHealth() }

    val scroll = TopAppBarDefaults.exitUntilCollapsedScrollBehavior()
    Scaffold(
        modifier = Modifier.nestedScroll(scroll.nestedScrollConnection),
        topBar = { LargeTopAppBar(title = { Text(stringResource(R.string.tab_device)) }, scrollBehavior = scroll) },
        contentWindowInsets = WindowInsets(0),
    ) { padding ->
        Column(
            Modifier
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(bottom = 24.dp),
        ) {
            ListItem(
                headlineContent = { Text(stringResource(if (demoMode) R.string.pair_mode_demo else R.string.pair_mode_real)) },
                trailingContent = { InlineButton(stringResource(R.string.pair_change), onClick = onChangePendant) },
                colors = ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.surface),
            )
            when (val current = state) {
                PendantState.Searching -> PendantMessage(stringResource(R.string.device_searching), null)
                PendantState.NotFound -> PendantMessage(
                    stringResource(R.string.device_not_found),
                    stringResource(R.string.device_not_found_body),
                )
                is PendantState.Found -> DeviceContent(current.status, current.receivedAt)
            }
            SectionTitle(stringResource(R.string.study_section))
            ListItem(
                headlineContent = { Text(studyCode) },
                supportingContent = { Text(stringResource(R.string.study_participant, participantId)) },
                colors = ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.surface),
            )
            SecondaryActionButton(
                stringResource(R.string.leave_study),
                onClick = { confirmLeave = true },
                destructive = true,
                modifier = Modifier.padding(horizontal = 16.dp),
            )
            // Developer diagnostics: a backend URL means nothing to a participant, so debug builds only.
            if (BuildConfig.DEBUG) {
                SectionTitle(stringResource(R.string.device_server))
                ListItem(
                    headlineContent = {
                        Text(
                            stringResource(
                                when (serverOk) {
                                    null -> R.string.device_server_checking
                                    true -> R.string.device_server_ok
                                    false -> R.string.device_server_error
                                },
                            ),
                        )
                    },
                    supportingContent = { Text(BuildConfig.API_BASE_URL) },
                    colors = ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.surface),
                )
            }
        }
    }
    if (confirmLeave) {
        ConfirmDestructiveDialog(
            title = stringResource(R.string.leave_study_title),
            body = stringResource(R.string.leave_study_body),
            confirm = stringResource(R.string.leave_study_confirm),
            onConfirm = { confirmLeave = false; onLeaveStudy() },
            onDismiss = { confirmLeave = false },
        )
    }
}

@Composable
private fun PendantFrame(content: @Composable () -> Unit) {
    Column(
        Modifier
            .padding(horizontal = 32.dp, vertical = 20.dp)
            .fillMaxWidth()
            .cornerTicks(MaterialTheme.colorScheme.outline)
            .padding(16.dp),
    ) { content() }
}

@Composable
private fun PendantMessage(title: String, body: String?) {
    PendantFrame {
        Text(title, style = MaterialTheme.typography.headlineSmall)
        if (body != null) {
            Text(
                body,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 8.dp),
            )
        }
    }
}

@Composable
private fun DeviceContent(s: PendantStatus, receivedAt: Instant) {
    PendantFrame {
        Text(stringResource(R.string.device_name, s.deviceId), style = MaterialTheme.typography.headlineSmall)
        Text(
            stringResource(R.string.device_connected, s.firmwareVersion),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(12.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier
                    .size(10.dp)
                    .background(
                        if (s.capturing) MaterialTheme.colorScheme.tertiary else MaterialTheme.colorScheme.outline,
                        CircleShape,
                    ),
            )
            Spacer(Modifier.width(8.dp))
            Text(
                stringResource(if (s.capturing) R.string.device_recording else R.string.device_not_recording),
                style = MaterialTheme.typography.titleMedium,
            )
        }
    }

    val reading = parseSensorLine(s.lastSensorLine)
    SectionTitle(stringResource(R.string.device_status))
    BatteryItem(if (reading == null) null else s.batteryMv)
    StatusItem(
        label = stringResource(R.string.device_storage),
        value = stringResource(R.string.device_storage_free, numberFormat.format(s.sdFreeMb)),
    )
    StatusItem(
        label = stringResource(R.string.device_clock),
        value = stringResource(if (s.clockOk) R.string.device_clock_synced else R.string.device_clock_not_synced),
    )

    SectionTitle(stringResource(R.string.device_sensors))
    Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        if (reading == null) {
            Text(stringResource(R.string.sensor_no_reading_yet), style = MaterialTheme.typography.bodyLarge)
        } else {
            SensorReadings(reading)
        }
        Text(
            stringResource(R.string.device_updated, timeFormat.format(receivedAt)),
            style = MaterialTheme.typography.bodyMedium.merge(TabularNumbers),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun BatteryItem(batteryMv: Int?) {
    val label = stringResource(R.string.device_battery)
    val percent = batteryMv?.let { batteryPercentEstimate(it) }
    when {
        batteryMv == null -> StatusItem(label, stringResource(R.string.device_no_reading_yet))
        percent == null -> StatusItem(label, stringResource(R.string.device_external_power))
        else -> MeterItem(
            label = label,
            value = stringResource(R.string.device_battery_estimate, percent, voltsFormat.format(batteryMv / 1000.0)),
            fraction = percent / 100f,
            warning = if (batteryMv < BATTERY_LOW_MV) stringResource(R.string.device_battery_low) else null,
        )
    }
}

@Composable
private fun SensorReadings(reading: SensorReading) {
    val raw = stringResource(R.string.sensor_raw_unit)
    val missing = stringResource(R.string.sensor_missing)
    val readings = listOf(
        Triple(stringResource(R.string.sensor_temperature), reading.temperatureC?.let { decimalFormat.format(it) }, "°C"),
        Triple(stringResource(R.string.sensor_humidity), reading.humidityPct?.let { numberFormat.format(it) }, "%"),
        Triple(stringResource(R.string.sensor_sound), "${reading.soundP2pRaw}", raw),
        Triple(stringResource(R.string.sensor_co), "${reading.mq7Raw}", raw),
        Triple(stringResource(R.string.sensor_gas), "${reading.mq2Raw}", raw),
    )
    // One column when the user has a large font size, so labels and values never collide.
    val columns = if (LocalDensity.current.fontScale > 1.3f) 1 else 2
    readings.chunked(columns).forEach { row ->
        Row {
            row.forEach { (label, value, unit) ->
                Specimen(label, value ?: "—", unit, Modifier.weight(1f), note = if (value == null) missing else null)
            }
            if (row.size < columns) Spacer(Modifier.weight(1f))
        }
    }
    Text(
        stringResource(R.string.sensor_relative_note),
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

@Composable
private fun StatusItem(label: String, value: String) {
    ListItem(
        headlineContent = { Text(label) },
        supportingContent = { Text(value, style = MaterialTheme.typography.bodyLarge.merge(TabularNumbers)) },
        colors = ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.surface),
    )
}

@Composable
private fun MeterItem(label: String, value: String, fraction: Float, warning: String? = null) {
    ListItem(
        headlineContent = { Text(label) },
        // Value under the label, not beside it, so neither gets squeezed at large font sizes.
        supportingContent = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(value, style = MaterialTheme.typography.bodyLarge.merge(TabularNumbers))
                if (warning != null) StatusLabel(warning, Amber, Ink)
                LinearProgressIndicator(
                    progress = { fraction },
                    modifier = Modifier.fillMaxWidth(),
                    color = if (warning != null) Amber else MaterialTheme.colorScheme.secondary,
                    drawStopIndicator = {},
                )
            }
        },
        colors = ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.surface),
    )
}

@Composable
fun SectionTitle(text: String, inset: Dp = 16.dp) {
    HorizontalDivider(Modifier.padding(top = 16.dp), color = MaterialTheme.colorScheme.outlineVariant)
    Text(
        text.uppercase(),
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.secondary,
        modifier = Modifier
            .padding(start = inset, top = 16.dp, bottom = 8.dp)
            .semantics { heading() },
    )
}

private const val STATUS_POLL_MS = 2_000L
private val chileanSpanish = Locale("es", "CL")
private val timeFormat = DateTimeFormatter.ofPattern("HH:mm:ss").withZone(ZoneId.systemDefault())
private val numberFormat = DecimalFormat("#,##0", DecimalFormatSymbols(chileanSpanish))
private val decimalFormat = DecimalFormat("0.0", DecimalFormatSymbols(chileanSpanish))
private val voltsFormat = DecimalFormat("0.00", DecimalFormatSymbols(chileanSpanish))

private suspend fun checkHealth(): Boolean = withContext(Dispatchers.IO) {
    try {
        val conn = URL("${BuildConfig.API_BASE_URL}/api/health").openConnection() as HttpURLConnection
        conn.connectTimeout = 10_000
        conn.readTimeout = 60_000 // Render free plan cold start takes 30–60 s
        try {
            conn.responseCode < 400
        } finally {
            conn.disconnect()
        }
    } catch (e: Exception) {
        false
    }
}

@Preview(showBackground = true, heightDp = 900)
@Composable
private fun DeviceContentPreview() {
    ObservatorioTheme {
        Column {
            DeviceContent(
                PendantStatus(
                    deviceId = "3c71bf", firmwareVersion = "cam-0.1.0", cameraOk = true, sdOk = true, sdFreeMb = 14_820,
                    capturing = true, sessionId = "3c71bf-1795280400", frames = 2400, clockOk = true,
                    epochMs = 1_795_281_600_000, batteryMv = 6950, ip = "192.168.1.47", pendingCommands = 0,
                    droppedCommands = 0, lastAck = "A,HELLO,OK", lastSensorLine = "S,1795281600,12000000,,,212,305,512,6950",
                    linkBadChecksums = 0,
                ),
                Instant.now(),
            )
        }
    }
}

@Preview(showBackground = true)
@Composable
private fun PendantNotFoundPreview() {
    ObservatorioTheme {
        PendantMessage(stringResource(R.string.device_not_found), stringResource(R.string.device_not_found_body))
    }
}
