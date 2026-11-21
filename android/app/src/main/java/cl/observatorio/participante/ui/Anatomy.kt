package cl.observatorio.participante.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import cl.observatorio.participante.ui.theme.TabularNumbers

// "Anatomía de un sistema" details from android/design/GUIDELINES.md. Use at most one per screen.

/** Corner ticks around a block, like registration marks on a technical plate. */
fun Modifier.cornerTicks(color: Color) = drawBehind {
    val gap = 6.dp.toPx()
    val len = 10.dp.toPx()
    val stroke = 1.dp.toPx()
    for ((x, y, dx, dy) in listOf(
        listOf(0f, 0f, -1f, -1f), listOf(size.width, 0f, 1f, -1f),
        listOf(0f, size.height, -1f, 1f), listOf(size.width, size.height, 1f, 1f),
    )) {
        // horizontal tick beside the corner, vertical tick above/below it
        drawLine(color, Offset(x + dx * gap, y), Offset(x + dx * (gap + len), y), stroke)
        drawLine(color, Offset(x, y + dy * gap), Offset(x, y + dy * (gap + len)), stroke)
    }
}

/** Faint grid paper. Only behind the device illustration or a media placeholder. */
fun Modifier.gridPaper(color: Color) = drawBehind {
    val step = 16.dp.toPx()
    val stroke = 0.5.dp.toPx()
    var x = 0f
    while (x <= size.width) { drawLine(color, Offset(x, 0f), Offset(x, size.height), stroke); x += step }
    var y = 0f
    while (y <= size.height) { drawLine(color, Offset(0f, y), Offset(size.width, y), stroke); y += step }
}

/** A labeled reading: small uppercase label, large tabular value and its unit. */
@Composable
fun Specimen(label: String, value: String, unit: String, modifier: Modifier = Modifier, note: String? = null) {
    Column(modifier.semantics(mergeDescendants = true) {}) {
        Text(
            label.uppercase(),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Row(verticalAlignment = Alignment.Bottom) {
            Text(value, style = MaterialTheme.typography.headlineMedium.merge(TabularNumbers))
            Spacer(Modifier.width(4.dp))
            Text(unit, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(bottom = 6.dp))
        }
        if (note != null) {
            Text(note, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/** Headline with one phrase marked like a highlighter, e.g. Highlighted("Nada sale sin ", "tu revisión"). */
@Composable
fun Highlighted(
    before: String,
    highlight: String,
    after: String = "",
    style: TextStyle = MaterialTheme.typography.displaySmall,
) {
    val marker = MaterialTheme.colorScheme.tertiary
    val onMarker = MaterialTheme.colorScheme.onTertiary
    Text(
        buildAnnotatedString {
            append(before)
            // Non-breaking spaces keep the phrase on one line; only a leading pad, since a trailing one can wrap alone.
            withStyle(SpanStyle(background = marker, color = onMarker)) { append("\u00A0" + highlight.replace(' ', '\u00A0')) }
            append(after)
        },
        style = style,
    )
}
