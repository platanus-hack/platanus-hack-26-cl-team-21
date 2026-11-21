package cl.observatorio.participante

import android.content.SharedPreferences
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.List
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import cl.observatorio.participante.pendant.MockPendant
import cl.observatorio.participante.pendant.PendantApi
import cl.observatorio.participante.review.ReviewQueue
import cl.observatorio.participante.ui.ClipDetailScreen
import cl.observatorio.participante.ui.ConsentScreen
import cl.observatorio.participante.ui.DeviceScreen
import cl.observatorio.participante.ui.JoinStudyScreen
import cl.observatorio.participante.ui.PairScreen
import cl.observatorio.participante.ui.ReviewScreen
import cl.observatorio.participante.ui.WelcomeScreen
import cl.observatorio.participante.ui.theme.ObservatorioTheme
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val prefs = getSharedPreferences("participant", MODE_PRIVATE)
        // Surface provides the background and onSurface content color for screens without a Scaffold (welcome).
        setContent { ObservatorioTheme { Surface { App(prefs) } } }
    }
}

// shortcut: process-wide instances instead of DI. Milestone 2 swaps MockPendant for the HTTP client.
private val pendant: PendantApi = MockPendant()
private val reviewQueue = ReviewQueue()

// shortcut: a linear onboarding, two tabs and one detail screen, so plain state instead of navigation-compose.
// Add it when screens need deep links or branch out of this flow.
@Composable
private fun App(prefs: SharedPreferences) {
    var onboarded by rememberSaveable { mutableStateOf(prefs.getBoolean("onboarded", false)) }
    var step by rememberSaveable { mutableIntStateOf(0) }
    var tab by rememberSaveable { mutableIntStateOf(0) }
    var openClipId by rememberSaveable { mutableStateOf<String?>(null) }
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val undoLabel = stringResource(R.string.undo)

    if (!onboarded) {
        BackHandler(enabled = step > 0) { step-- }
        when (step) {
            0 -> WelcomeScreen(onStart = { step = 1 })
            1 -> JoinStudyScreen(onBack = { step = 0 }) { study, participant ->
                prefs.edit().putString("study_code", study).putString("participant_id", participant).apply()
                step = 2
            }
            2 -> ConsentScreen(onBack = { step = 1 }, onAccept = { step = 3 })
            else -> PairScreen(onBack = { step = 2 }) {
                prefs.edit().putBoolean("onboarded", true).apply()
                onboarded = true
            }
        }
        return
    }

    val openClip = reviewQueue.clips.firstOrNull { it.id == openClipId }
    if (openClip != null) {
        BackHandler { openClipId = null }
        ClipDetailScreen(
            openClip,
            onChange = { reviewQueue.update(openClip.id, it) },
            onBack = { openClipId = null },
            onDecided = { before, message ->
                openClipId = null
                scope.launch {
                    if (snackbar.showSnackbar(message, undoLabel, duration = SnackbarDuration.Short) == SnackbarResult.ActionPerformed) {
                        reviewQueue.update(before.id) { before }
                    }
                }
            },
        )
        return
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        bottomBar = {
            NavigationBar {
                // Review first: approving clips is the participant's main task; the device tab is for checking status.
                NavigationBarItem(
                    selected = tab == 0,
                    onClick = { tab = 0 },
                    icon = { Icon(Icons.AutoMirrored.Outlined.List, null) },
                    label = { Text(stringResource(R.string.tab_review)) },
                )
                NavigationBarItem(
                    selected = tab == 1,
                    onClick = { tab = 1 },
                    icon = { Icon(Icons.Outlined.Info, null) },
                    label = { Text(stringResource(R.string.tab_device)) },
                )
            }
        },
        contentWindowInsets = WindowInsets(0),
    ) { padding ->
        Box(Modifier.padding(padding)) {
            if (tab == 0) {
                LaunchedEffect(Unit) { reviewQueue.refresh(pendant) }
                ReviewScreen(reviewQueue.clips, reviewQueue.loading, reviewQueue.pendantUnreachable, onOpen = { openClipId = it.id })
            } else {
                DeviceScreen(
                    pendant,
                    studyCode = prefs.getString("study_code", "").orEmpty(),
                    participantId = prefs.getString("participant_id", "").orEmpty(),
                    onLeaveStudy = {
                        // shortcut: only forgets the study on this phone. Telling the backend and handling
                        // already-uploaded data needs the study's withdrawal policy.
                        prefs.edit().clear().apply()
                        reviewQueue.clips.clear()
                        tab = 0
                        step = 0
                        onboarded = false
                    },
                )
            }
        }
    }
}
