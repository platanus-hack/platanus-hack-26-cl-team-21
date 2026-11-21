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
import androidx.compose.runtime.collectAsState
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
import cl.observatorio.participante.pendant.DeviceStatus
import cl.observatorio.participante.pendant.FakePendant
import cl.observatorio.participante.ui.theme.Amber
import cl.observatorio.participante.ui.theme.Ink
import cl.observatorio.participante.ui.theme.ObservatorioTheme
import cl.observatorio.participante.ui.theme.TabularNumbers
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DeviceScreen() {
    val status by remember { FakePendant.status() }.collectAsState(initial = null)
    var serverOk by remember { mutableStateOf<Boolean?>(null) }
    LaunchedEffect(Unit) { serverOk = checkHealth() }

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
            status?.let { DeviceContent(it) }
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

@Composable
private fun DeviceContent(s: DeviceStatus) {
    // Header: the screen's one "anatomía" detail.
    Column(
        Modifier
            .padding(horizontal = 32.dp, vertical = 20.dp)
            .fillMaxWidth()
            .cornerTicks(MaterialTheme.colorScheme.outline)
            .padding(16.dp),
    ) {
        Text(s.deviceId, style = MaterialTheme.typography.headlineSmall)
        Text(
            if (s.connected) stringResource(R.string.device_connected, s.firmwareVersion)
            else stringResource(R.string.device_disconnected),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(12.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier
                    .size(10.dp)
                    .background(
                        if (s.recording && !s.privacySwitchOn) MaterialTheme.colorScheme.tertiary
                        else MaterialTheme.colorScheme.outline,
                        CircleShape,
                    ),
            )
            Spacer(Modifier.width(8.dp))
            Text(
                stringResource(if (s.privacySwitchOn) R.string.device_privacy else R.string.device_recording),
                style = MaterialTheme.typography.titleMedium,
            )
        }
    }

    SectionTitle(stringResource(R.string.device_status))
    MeterItem(
        label = stringResource(R.string.device_battery),
        value = stringResource(if (s.charging) R.string.device_charging else R.string.device_percent, s.batteryPct),
        fraction = s.batteryPct / 100f,
        warning = if (s.batteryPct < 20 && !s.charging) stringResource(R.string.device_battery_low) else null,
    )
    MeterItem(
        label = stringResource(R.string.device_storage),
        value = stringResource(R.string.device_storage_used, s.storageUsedPct),
        fraction = s.storageUsedPct / 100f,
    )

    SectionTitle(stringResource(R.string.device_sensors))
    val raw = stringResource(R.string.sensor_raw_unit)
    val readings = listOf(
        Triple(stringResource(R.string.sensor_temperature), "%.1f".format(Locale("es", "CL"), s.temperatureC), "°C"),
        Triple(stringResource(R.string.sensor_humidity), "${s.humidityPct}", "%"),
        Triple(stringResource(R.string.sensor_sound), "${s.soundRaw}", raw),
        Triple(stringResource(R.string.sensor_co), "${s.coRaw}", raw),
        Triple(stringResource(R.string.sensor_gas), "${s.gasRaw}", raw),
    )
    Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        // One column when the user has a large font size, so labels and values never collide.
        val columns = if (LocalDensity.current.fontScale > 1.3f) 1 else 2
        readings.chunked(columns).forEach { row ->
            Row {
                row.forEach { (label, value, unit) -> Specimen(label, value, unit, Modifier.weight(1f)) }
                if (row.size < columns) Spacer(Modifier.weight(1f))
            }
        }
        Text(
            stringResource(R.string.sensor_relative_note),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            stringResource(R.string.device_updated, timeFormat.format(s.updatedAt)),
            style = MaterialTheme.typography.bodyMedium.merge(TabularNumbers),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
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

private val timeFormat = DateTimeFormatter.ofPattern("HH:mm:ss").withZone(ZoneId.systemDefault())

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
                DeviceStatus(
                    "pendant-01", "0.1.0", connected = true, recording = true, privacySwitchOn = false,
                    batteryPct = 14, charging = false, storageUsedPct = 34, temperatureC = 23.4, humidityPct = 47,
                    soundRaw = 512, coRaw = 212, gasRaw = 305, updatedAt = Instant.now(),
                ),
            )
        }
    }
}
