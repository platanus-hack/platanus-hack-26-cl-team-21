package cl.observatorio.participante

import android.content.SharedPreferences
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
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
import cl.observatorio.participante.pendant.HttpPendant
import cl.observatorio.participante.pendant.MockPendant
import cl.observatorio.participante.pendant.PendantApi
import cl.observatorio.participante.pendant.parsePendantAddress
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
import java.net.HttpURLConnection
import java.net.Proxy

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val prefs = getSharedPreferences("participant", MODE_PRIVATE)
        // Surface provides the background and onSurface content color for screens without a Scaffold (welcome).
        setContent { ObservatorioTheme { Surface { App(prefs, ::createPendant) } } }
    }

    @Suppress("DEPRECATION")
    private fun createPendant(address: String, token: String): PendantApi {
        val connectivity = getSystemService(ConnectivityManager::class.java)
        return HttpPendant(requireNotNull(parsePendantAddress(address)), token) { url ->
            val wifi = connectivity.allNetworks.firstOrNull { network ->
                connectivity.getNetworkCapabilities(network)?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true
            }
            wifi?.openConnection(url, Proxy.NO_PROXY) as HttpURLConnection?
        }
    }
}

// shortcut: a linear onboarding, two tabs and one detail screen, so plain state instead of navigation-compose.
// Add it when screens need deep links or branch out of this flow.
private val demoPendant = MockPendant()
private val demoQueue = ReviewQueue()

@Composable
private fun App(prefs: SharedPreferences, createPendant: (String, String) -> PendantApi) {
    var demoMode by remember { mutableStateOf(prefs.getBoolean("pendant_demo", true)) }
    var pendantAddress by remember { mutableStateOf(prefs.getString("pendant_address", null)) }
    var pendantToken by remember { mutableStateOf(prefs.getString("pendant_token", null)) }
    var editingPendant by rememberSaveable { mutableStateOf(false) }
    val pendant = remember(demoMode, pendantAddress, pendantToken) {
        if (demoMode) demoPendant else createPendant(requireNotNull(pendantAddress), requireNotNull(pendantToken))
    }
    val realQueue = remember(pendantAddress, pendantToken) { ReviewQueue() }
    val reviewQueue = if (demoMode) demoQueue else realQueue
    var onboarded by rememberSaveable { mutableStateOf(prefs.getBoolean("onboarded", false)) }
    var step by rememberSaveable { mutableIntStateOf(0) }
    var tab by rememberSaveable { mutableIntStateOf(0) }
    var openClipId by rememberSaveable { mutableStateOf<String?>(null) }
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val undoLabel = stringResource(R.string.undo)

    if (editingPendant || (!onboarded && step == 3)) {
        val goBack = { if (editingPendant) editingPendant = false else step = 2 }
        BackHandler(onBack = goBack)
        PairScreen(
            savedAddress = pendantAddress,
            savedToken = pendantToken,
            createPendant = createPendant,
            onBack = goBack,
            onConnect = { address, token ->
                prefs.edit()
                    .putString("pendant_address", address)
                    .putString("pendant_token", token)
                    .putBoolean("pendant_demo", false)
                    .putBoolean("onboarded", true)
                    .apply()
                pendantAddress = address
                pendantToken = token
                demoMode = false
                onboarded = true
                editingPendant = false
                openClipId = null
                tab = 1
            },
            onDemo = {
                prefs.edit().putBoolean("pendant_demo", true).putBoolean("onboarded", true).apply()
                if (!onboarded) tab = 0
                demoMode = true
                onboarded = true
                editingPendant = false
                openClipId = null
            },
        )
        return
    }

    if (!onboarded) {
        BackHandler(enabled = step > 0) { step-- }
        when (step) {
            0 -> WelcomeScreen(onStart = { step = 1 })
            1 -> JoinStudyScreen(onBack = { step = 0 }) { study, participant ->
                prefs.edit().putString("study_code", study).putString("participant_id", participant).apply()
                step = 2
            }
            2 -> ConsentScreen(onBack = { step = 1 }, onAccept = { step = 3 })
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
                LaunchedEffect(pendant) { reviewQueue.refresh(pendant) }
                ReviewScreen(
                    reviewQueue.clips,
                    reviewQueue.loading,
                    reviewQueue.pendantUnreachable,
                    onOpen = if (demoMode) { clip -> openClipId = clip.id } else null,
                )
            } else {
                DeviceScreen(
                    pendant,
                    demoMode = demoMode,
                    onChangePendant = { editingPendant = true },
                    studyCode = prefs.getString("study_code", "").orEmpty(),
                    participantId = prefs.getString("participant_id", "").orEmpty(),
                    onLeaveStudy = {
                        // shortcut: only forgets the study on this phone. Telling the backend and handling
                        // already-uploaded data needs the study's withdrawal policy, and before real hardware the
                        // pendant's sessions must be tied to (or wiped for) a participant, or the next one reviews them.
                        prefs.edit().clear().apply()
                        demoQueue.clips.clear()
                        realQueue.clips.clear()
                        demoMode = true
                        pendantAddress = null
                        pendantToken = null
                        tab = 0
                        step = 0
                        onboarded = false
                    },
                )
            }
        }
    }
}
