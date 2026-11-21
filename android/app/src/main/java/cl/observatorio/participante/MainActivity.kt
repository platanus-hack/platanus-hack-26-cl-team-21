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
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import cl.observatorio.participante.pendant.FakePendant
import cl.observatorio.participante.ui.ClipDetailScreen
import cl.observatorio.participante.ui.ConsentScreen
import cl.observatorio.participante.ui.DeviceScreen
import cl.observatorio.participante.ui.JoinStudyScreen
import cl.observatorio.participante.ui.PairScreen
import cl.observatorio.participante.ui.ReviewScreen
import cl.observatorio.participante.ui.WelcomeScreen
import cl.observatorio.participante.ui.theme.ObservatorioTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val prefs = getSharedPreferences("participant", MODE_PRIVATE)
        setContent { ObservatorioTheme { App(prefs) } }
    }
}

// shortcut: a linear onboarding, two tabs and one detail screen, so plain state instead of navigation-compose.
// Add it when screens need deep links or branch out of this flow.
@Composable
private fun App(prefs: SharedPreferences) {
    var onboarded by rememberSaveable { mutableStateOf(prefs.getBoolean("onboarded", false)) }
    var step by rememberSaveable { mutableIntStateOf(0) }
    var tab by rememberSaveable { mutableIntStateOf(0) }
    var openClipId by rememberSaveable { mutableStateOf<String?>(null) }

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

    val openClip = FakePendant.clips.firstOrNull { it.id == openClipId }
    if (openClip != null) {
        BackHandler { openClipId = null }
        ClipDetailScreen(openClip, onBack = { openClipId = null })
        return
    }

    Scaffold(
        bottomBar = {
            NavigationBar {
                NavigationBarItem(
                    selected = tab == 0,
                    onClick = { tab = 0 },
                    icon = { Icon(Icons.Outlined.Info, null) },
                    label = { Text(stringResource(R.string.tab_device)) },
                )
                NavigationBarItem(
                    selected = tab == 1,
                    onClick = { tab = 1 },
                    icon = { Icon(Icons.AutoMirrored.Outlined.List, null) },
                    label = { Text(stringResource(R.string.tab_review)) },
                )
            }
        },
        contentWindowInsets = WindowInsets(0),
    ) { padding ->
        Box(Modifier.padding(padding)) {
            if (tab == 0) DeviceScreen() else ReviewScreen(FakePendant.clips, onOpen = { openClipId = it.id })
        }
    }
}
