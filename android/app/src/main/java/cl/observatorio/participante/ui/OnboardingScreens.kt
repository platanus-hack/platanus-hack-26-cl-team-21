package cl.observatorio.participante.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.foundation.selection.toggleable
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import cl.observatorio.participante.R
import cl.observatorio.participante.ui.theme.ObservatorioTheme
import kotlinx.coroutines.delay

@Composable
fun WelcomeScreen(onStart: () -> Unit) {
    Column(
        Modifier
            .fillMaxSize()
            .safeDrawingPadding()
            .padding(24.dp),
    ) {
        Text(
            stringResource(R.string.app_name).uppercase(),
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.secondary,
        )
        // Centered when it fits, scrollable when it doesn't (large font sizes); the action stays pinned below.
        BoxWithConstraints(Modifier.weight(1f)) {
            Column(
                Modifier
                    .verticalScroll(rememberScrollState())
                    .heightIn(min = maxHeight)
                    .padding(vertical = 24.dp),
                verticalArrangement = Arrangement.Center,
            ) {
                Highlighted(
                    stringResource(R.string.welcome_title_before),
                    stringResource(R.string.welcome_title_highlight),
                    style = MaterialTheme.typography.displayMedium,
                )
                Spacer(Modifier.height(32.dp))
                // The screen's one "anatomía" detail: the intro block framed like a plate caption.
                Column(
                    Modifier
                        .padding(horizontal = 16.dp)
                        .cornerTicks(MaterialTheme.colorScheme.outline)
                        .padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text(stringResource(R.string.welcome_subtitle), style = MaterialTheme.typography.titleLarge)
                    Text(
                        stringResource(R.string.welcome_body),
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
        Spacer(Modifier.height(16.dp))
        MainActionButton(stringResource(R.string.welcome_start), onClick = onStart)
        Text(
            stringResource(R.string.welcome_voluntary),
            style = MaterialTheme.typography.bodyMedium,
            textAlign = TextAlign.Center,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 12.dp).align(Alignment.CenterHorizontally),
        )
    }
}

@Composable
fun JoinStudyScreen(onBack: () -> Unit, onJoin: (studyCode: String, participantId: String) -> Unit) {
    var study by rememberSaveable { mutableStateOf("") }
    var participant by rememberSaveable { mutableStateOf("") }
    val canJoin = study.isNotBlank() && participant.isNotBlank()
    StepScaffold(
        title = stringResource(R.string.join_title),
        onBack = onBack,
        action = {
            MainActionButton(stringResource(R.string.next), onClick = { onJoin(study.trim(), participant.trim()) }, enabled = canJoin)
        },
    ) {
        Text(stringResource(R.string.join_body), style = MaterialTheme.typography.bodyLarge)
        OutlinedTextField(
            value = study,
            onValueChange = { study = it },
            label = { Text(stringResource(R.string.join_study_code)) },
            placeholder = { Text("EAT-001") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, imeAction = ImeAction.Next),
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = participant,
            onValueChange = { participant = it },
            label = { Text(stringResource(R.string.join_participant_id)) },
            placeholder = { Text("p-019") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
            modifier = Modifier.fillMaxWidth(),
        )
        Text(
            stringResource(R.string.join_pseudonym_note),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
fun ConsentScreen(onBack: () -> Unit, onAccept: () -> Unit) {
    var accepted by rememberSaveable { mutableStateOf(false) }
    StepScaffold(
        title = stringResource(R.string.consent_title),
        onBack = onBack,
        action = {
            Column {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = 56.dp)
                        .toggleable(accepted, role = Role.Checkbox, onValueChange = { accepted = it }),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Checkbox(checked = accepted, onCheckedChange = null)
                    Spacer(Modifier.width(12.dp))
                    Text(stringResource(R.string.consent_checkbox), style = MaterialTheme.typography.bodyMedium)
                }
                MainActionButton(stringResource(R.string.consent_accept), onClick = onAccept, enabled = accepted)
            }
        },
    ) {
        Text(stringResource(R.string.consent_study), style = MaterialTheme.typography.titleLarge)
        Text(
            stringResource(R.string.consent_protocol),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        ConsentList(
            stringResource(R.string.consent_records),
            listOf(R.string.consent_records_video, R.string.consent_records_sensors, R.string.consent_records_events),
            included = true,
        )
        ConsentList(
            stringResource(R.string.consent_never),
            listOf(R.string.consent_never_upload, R.string.consent_never_calories, R.string.consent_never_emotions),
            included = false,
        )
        Text(
            stringResource(R.string.consent_control),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun ConsentList(title: String, items: List<Int>, included: Boolean) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        SectionTitle(title, inset = 0.dp)
        items.forEach { item ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    if (included) Icons.Outlined.CheckCircle else Icons.Outlined.Close,
                    contentDescription = null,
                    tint = if (included) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.width(16.dp))
                Text(stringResource(item), style = MaterialTheme.typography.bodyLarge)
            }
        }
    }
}

private enum class PairState { SEARCHING, FOUND, CONNECTING, CONNECTED }

// shortcut: simulated scan and connection, replace with a BLE scan (and its runtime permissions) once the firmware advertises.
@Composable
fun PairScreen(onBack: () -> Unit, onDone: () -> Unit) {
    var state by rememberSaveable { mutableStateOf(PairState.SEARCHING) }
    LaunchedEffect(state) {
        when (state) {
            PairState.SEARCHING -> { delay(1_500); state = PairState.FOUND }
            PairState.CONNECTING -> { delay(1_000); state = PairState.CONNECTED }
            else -> Unit
        }
    }
    StepScaffold(
        title = stringResource(R.string.pair_title),
        onBack = onBack,
        action = {
            MainActionButton(stringResource(R.string.pair_finish), onClick = onDone, enabled = state == PairState.CONNECTED)
        },
    ) {
        Text(stringResource(R.string.pair_body), style = MaterialTheme.typography.bodyLarge)
        SectionTitle(stringResource(R.string.pair_nearby), inset = 0.dp)
        if (state == PairState.SEARCHING) {
            LinearProgressIndicator(Modifier.fillMaxWidth())
            Text(
                stringResource(R.string.pair_searching),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("pendant-01", style = MaterialTheme.typography.bodyLarge)
                    Text(
                        stringResource(
                            when (state) {
                                PairState.FOUND -> R.string.pair_found
                                PairState.CONNECTING -> R.string.pair_connecting
                                else -> R.string.pair_connected
                            },
                        ),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                when (state) {
                    PairState.FOUND -> InlineButton(stringResource(R.string.pair_connect), onClick = { state = PairState.CONNECTING })
                    PairState.CONNECTED -> Icon(Icons.Outlined.CheckCircle, null, tint = MaterialTheme.colorScheme.secondary)
                    else -> Unit
                }
            }
            if (state == PairState.CONNECTED) {
                Text(
                    stringResource(R.string.pair_clock_synced, "0,4"),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

/** Shared layout for onboarding steps: back arrow, scrollable body, primary action pinned at the bottom. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun StepScaffold(
    title: String,
    onBack: () -> Unit,
    action: @Composable () -> Unit,
    content: @Composable () -> Unit,
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(title) },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
                },
            )
        },
        // imePadding keeps the primary action visible above the keyboard
        bottomBar = { Column(Modifier.imePadding().navigationBarsPadding().padding(16.dp)) { action() } },
    ) { padding ->
        Column(
            Modifier
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) { content() }
    }
}

@Preview(showBackground = true)
@Composable
private fun WelcomePreview() = ObservatorioTheme { WelcomeScreen(onStart = {}) }

@Preview(showBackground = true, heightDp = 900)
@Composable
private fun ConsentPreview() = ObservatorioTheme { ConsentScreen(onBack = {}, onAccept = {}) }
