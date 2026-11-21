package cl.observatorio.participante.ui

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import cl.observatorio.participante.R

// Screen-level actions. M3's default 40 dp button is meant for inline actions; the main action of a screen
// is full width and 56 dp tall (min height, so it grows with the user's font size). See GUIDELINES.md, Accessibility.

@Composable
fun MainActionButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    Button(onClick, modifier.fillMaxWidth().heightIn(min = 56.dp), enabled) {
        Text(text, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
    }
}

@Composable
fun SecondaryActionButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    destructive: Boolean = false,
) {
    OutlinedButton(onClick, modifier.fillMaxWidth().heightIn(min = 56.dp), enabled, colors = outlinedColors(destructive)) {
        Text(text, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
    }
}

/** Inline action next to content (e.g. "Conectar"): 48 dp, the minimum comfortable touch target. */
@Composable
fun InlineButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    destructive: Boolean = false,
) {
    OutlinedButton(onClick, modifier.heightIn(min = 48.dp), enabled, colors = outlinedColors(destructive)) { Text(text) }
}

/** Warning before a destructive action: red confirm, Cancel as the safe way out. */
@Composable
fun ConfirmDestructiveDialog(title: String, body: String, confirm: String, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Text(body) },
        confirmButton = {
            TextButton(onConfirm, colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error)) {
                Text(confirm)
            }
        },
        dismissButton = { TextButton(onDismiss) { Text(stringResource(R.string.cancel)) } },
    )
}

/** Destructive actions (exclude, leave) use the error color for their label. */
@Composable
private fun outlinedColors(destructive: Boolean) =
    if (destructive) ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error)
    else ButtonDefaults.outlinedButtonColors()
