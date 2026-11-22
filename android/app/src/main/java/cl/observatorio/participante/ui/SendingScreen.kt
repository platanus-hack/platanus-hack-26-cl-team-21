package cl.observatorio.participante.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import cl.observatorio.participante.R
import cl.observatorio.participante.ui.theme.ObservatorioTheme
import cl.observatorio.participante.ui.theme.TabularNumbers

/**
 * Full screen while clips are being sent. It replaces the whole app, tabs included, so nothing can be opened or
 * changed mid-send: a review changed after the bundle is built would not be what leaves the phone.
 * [current] is the 1-based clip being sent out of [total].
 */
@Composable
fun SendingScreen(current: Int, total: Int) {
    Surface(Modifier.fillMaxSize()) {
        Column(
            Modifier
                .fillMaxSize()
                .safeDrawingPadding()
                .padding(24.dp),
            verticalArrangement = Arrangement.Center,
        ) {
            CircularProgressIndicator(Modifier.size(72.dp), strokeWidth = 6.dp)
            Spacer(Modifier.height(32.dp))
            // Announced to TalkBack as the clip counter changes.
            Column(Modifier.semantics { liveRegion = LiveRegionMode.Polite }, horizontalAlignment = Alignment.Start) {
                Highlighted("", stringResource(R.string.send_sending_title), style = MaterialTheme.typography.displayMedium)
                Spacer(Modifier.height(16.dp))
                Text(
                    stringResource(R.string.send_sending_progress, current, total),
                    style = MaterialTheme.typography.titleLarge.merge(TabularNumbers),
                )
            }
            Spacer(Modifier.height(16.dp))
            Text(
                stringResource(R.string.send_sending_body),
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Preview(showBackground = true, heightDp = 900)
@Composable
private fun SendingPreview() = ObservatorioTheme { SendingScreen(current = 1, total = 2) }
