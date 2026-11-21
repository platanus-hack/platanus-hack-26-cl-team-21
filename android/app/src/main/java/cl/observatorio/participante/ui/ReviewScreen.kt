package cl.observatorio.participante.ui

import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LargeTopAppBar
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RangeSlider
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import cl.observatorio.participante.R
import cl.observatorio.participante.review.Clip
import cl.observatorio.participante.review.ClipStatus
import cl.observatorio.participante.review.Interval
import cl.observatorio.participante.review.addExcluded
import cl.observatorio.participante.review.constrain
import cl.observatorio.participante.review.defaultSelection
import cl.observatorio.participante.review.freeGaps
import cl.observatorio.participante.review.sharedSeconds
import cl.observatorio.participante.ui.theme.Amber
import cl.observatorio.participante.ui.theme.Ink
import cl.observatorio.participante.ui.theme.ObservatorioTheme
import cl.observatorio.participante.ui.theme.TabularNumbers
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlin.math.roundToInt

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReviewScreen(clips: List<Clip>, loading: Boolean, pendantUnreachable: Boolean, onOpen: (Clip) -> Unit) {
    val scroll = TopAppBarDefaults.exitUntilCollapsedScrollBehavior()
    Scaffold(
        modifier = Modifier.nestedScroll(scroll.nestedScrollConnection),
        topBar = { LargeTopAppBar(title = { Text(stringResource(R.string.tab_review)) }, scrollBehavior = scroll) },
        contentWindowInsets = WindowInsets(0),
    ) { padding ->
        LazyColumn(contentPadding = padding) {
            item {
                Column(Modifier.padding(16.dp)) {
                    // One headline: the app bar already says "Revisar", so this only states what's left.
                    val pending = clips.count { it.status == ClipStatus.PENDING }
                    if (clips.isNotEmpty()) {
                        Highlighted(
                            "",
                            if (pending == 0) stringResource(R.string.review_all_done)
                            else pluralStringResource(R.plurals.review_pending, pending, pending),
                            style = MaterialTheme.typography.headlineMedium,
                        )
                    }
                    Text(
                        stringResource(R.string.review_privacy_note),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 12.dp),
                    )
                    if (loading && clips.isEmpty()) {
                        Text(
                            stringResource(R.string.review_loading),
                            style = MaterialTheme.typography.bodyMedium,
                            modifier = Modifier.padding(top = 12.dp),
                        )
                    }
                    if (pendantUnreachable) {
                        Text(
                            stringResource(R.string.review_pendant_unreachable),
                            style = MaterialTheme.typography.bodyMedium,
                            modifier = Modifier.padding(top = 12.dp),
                        )
                    }
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            }
            items(clips, key = { it.id }) { clip ->
                ListItem(
                    headlineContent = { Text(clipRange(clip), style = MaterialTheme.typography.bodyLarge.merge(TabularNumbers)) },
                    supportingContent = {
                        val meta = stringResource(R.string.review_clip_meta, duration(clip.durationSeconds), clip.id)
                        val spans = clip.excluded.size
                        // A fully excluded clip already says "Excluido"; only partial exclusions need the count.
                        Text(
                            if (spans > 0 && clip.status != ClipStatus.EXCLUDED) {
                                meta + " · " + pluralStringResource(R.plurals.review_clip_excluded, spans, spans)
                            } else meta,
                        )
                    },
                    trailingContent = { ClipStatusLabel(clip.status) },
                    colors = ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.surface),
                    modifier = Modifier.clickable { onOpen(clip) },
                )
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ClipDetailScreen(
    clip: Clip,
    onChange: ((Clip) -> Clip) -> Unit,
    onBack: () -> Unit,
    onDecided: (before: Clip, message: String) -> Unit,
) {
    val approvedMsg = stringResource(R.string.clip_approved_msg)
    val excludedMsg = stringResource(R.string.clip_excluded_msg)
    val restoredMsg = stringResource(R.string.clip_range_restored_msg)
    val undoLabel = stringResource(R.string.undo)
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    var confirmExcludeAll by remember { mutableStateOf(false) }

    val length = clip.durationSeconds
    val gaps = freeGaps(length, clip.excluded)
    val shared = sharedSeconds(length, clip.excluded)
    var picked by remember(clip.id) { mutableStateOf<ClosedFloatingPointRange<Float>?>(null) }
    // Falls back to a fresh selection when the current one is gone (first open, after excluding, after an undo).
    val selection = picked?.takeIf { sel -> gaps.any { sel.start >= it.start && sel.endInclusive <= it.end } }
        ?: defaultSelection(length, gaps)

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(clipRange(clip), style = MaterialTheme.typography.titleLarge.merge(TabularNumbers)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back))
                    }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
        bottomBar = {
            Column(
                Modifier
                    .navigationBarsPadding()
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                // Actions follow the clip's state: say where it stands, offer only the way to change it.
                val note = MaterialTheme.typography.bodyMedium
                val noteColor = MaterialTheme.colorScheme.onSurfaceVariant
                val summary = stringResource(R.string.clip_shared_summary, duration(shared), duration(length))
                when (clip.status) {
                    ClipStatus.PENDING -> {
                        if (clip.excluded.isNotEmpty()) Text(summary, style = note, color = noteColor)
                        MainActionButton(
                            stringResource(R.string.clip_approve),
                            onClick = {
                                onChange { it.copy(status = ClipStatus.APPROVED) }
                                onDecided(clip, approvedMsg)
                            },
                            enabled = shared > 0,
                        )
                        SecondaryActionButton(stringResource(R.string.clip_exclude_all), onClick = { confirmExcludeAll = true })
                    }
                    ClipStatus.APPROVED -> {
                        Text(
                            stringResource(R.string.clip_state_approved) + " " +
                                if (clip.excluded.isNotEmpty()) summary else stringResource(R.string.clip_shared_whole),
                            style = note,
                            color = noteColor,
                        )
                        SecondaryActionButton(stringResource(R.string.clip_back_to_pending), onClick = {
                            onChange { it.copy(status = ClipStatus.PENDING) }
                        })
                    }
                    ClipStatus.EXCLUDED -> {
                        Text(stringResource(R.string.clip_state_excluded), style = note, color = noteColor)
                        MainActionButton(stringResource(R.string.clip_include_again), onClick = {
                            onChange { it.copy(status = ClipStatus.PENDING, excluded = emptyList()) }
                        })
                    }
                }
            }
        },
    ) { padding ->
        Column(
            Modifier
                .padding(padding)
                .verticalScroll(rememberScrollState()),
        ) {
            // shortcut: no playback yet (milestone 3). Swap for a player over the session frames from PendantApi.frame.
            Box(
                Modifier
                    .padding(16.dp)
                    .fillMaxWidth()
                    .aspectRatio(16f / 9f)
                    .clip(MaterialTheme.shapes.small)
                    .border(1.dp, MaterialTheme.colorScheme.outline, MaterialTheme.shapes.small)
                    .gridPaper(MaterialTheme.colorScheme.outlineVariant),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    stringResource(R.string.clip_preview_unavailable),
                    style = MaterialTheme.typography.bodyMedium,
                    textAlign = TextAlign.Center,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            // Only a pending clip is editable: an approved one goes back to pending first, so nothing
            // gets shared that the participant didn't approve in its final form.
            if (clip.status == ClipStatus.PENDING) {
                SectionTitle(stringResource(R.string.clip_exclude_range_title))
                Column(Modifier.padding(horizontal = 16.dp)) {
                    if (selection == null) {
                        Text(stringResource(R.string.clip_all_excluded), style = MaterialTheme.typography.bodyMedium)
                    } else {
                        Text(stringResource(R.string.clip_exclude_range_hint), style = MaterialTheme.typography.bodyMedium)
                        if (clip.excluded.isNotEmpty()) {
                            Text(
                                stringResource(R.string.clip_excluded_hatch_hint),
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        val hatchFill = MaterialTheme.colorScheme.surfaceVariant
                        val hatchLine = MaterialTheme.colorScheme.onSurfaceVariant
                        // key: RangeSlider keeps its own idea of where the thumbs are, so after a programmatic jump
                        // it would grab the wrong thumb. A fresh slider per set of exclusions starts from the real selection.
                        key(clip.excluded) {
                            RangeSlider(
                                value = selection,
                                onValueChange = { picked = constrain(selection, it, gaps) },
                                valueRange = 0f..length.toFloat(),
                                track = { state ->
                                    SliderDefaults.Track(
                                        rangeSliderState = state,
                                        // Excluded spans are hatched on the track: a pattern, not only a color.
                                        modifier = Modifier.drawWithContent {
                                            drawContent()
                                            clip.excluded.forEach { span ->
                                                hatch(span.start / length.toFloat() * size.width, span.end / length.toFloat() * size.width, hatchFill, hatchLine)
                                            }
                                        },
                                    )
                                },
                            )
                        }
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            val edge = MaterialTheme.typography.bodyMedium.merge(TabularNumbers)
                            Text(clockAt(clip, 0), style = edge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text(clockAt(clip, length), style = edge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Column(Modifier.padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(
                                "${clockAt(clip, selection.start.roundToInt())} – ${clockAt(clip, selection.endInclusive.roundToInt())}",
                                style = MaterialTheme.typography.titleLarge.merge(TabularNumbers),
                            )
                            InlineButton(
                                stringResource(R.string.clip_exclude_range),
                                onClick = {
                                    val span = Interval(selection.start.roundToInt(), selection.endInclusive.roundToInt())
                                    onChange { it.copy(excluded = addExcluded(it.excluded, span)) }
                                    picked = null
                                },
                                enabled = selection.endInclusive.roundToInt() > selection.start.roundToInt(),
                                destructive = true,
                            )
                        }
                    }
                }
            }

            if (clip.status != ClipStatus.EXCLUDED && clip.excluded.isNotEmpty()) {
                SectionTitle(stringResource(R.string.clip_excluded_ranges))
                clip.excluded.forEach { span ->
                    val label = "${clockAt(clip, span.start)} – ${clockAt(clip, span.end)}"
                    ListItem(
                        headlineContent = { Text(label, style = MaterialTheme.typography.bodyLarge.merge(TabularNumbers)) },
                        trailingContent = {
                            if (clip.status == ClipStatus.PENDING) {
                                IconButton(onClick = {
                                    onChange { it.copy(excluded = it.excluded - span) }
                                    scope.launch {
                                        val result = snackbar.showSnackbar(restoredMsg, undoLabel, duration = SnackbarDuration.Short)
                                        // Re-add only this span, so anything excluded meanwhile survives the undo.
                                        if (result == SnackbarResult.ActionPerformed) onChange { it.copy(excluded = addExcluded(it.excluded, span)) }
                                    }
                                }) {
                                    Icon(Icons.Outlined.Delete, stringResource(R.string.clip_remove_range, label))
                                }
                            }
                        },
                        colors = ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.surface),
                    )
                }
            }
        }
    }

    if (confirmExcludeAll) {
        ConfirmDestructiveDialog(
            title = stringResource(R.string.clip_exclude_all_title),
            body = stringResource(R.string.clip_exclude_all_body),
            confirm = stringResource(R.string.clip_exclude_all_confirm),
            onConfirm = {
                confirmExcludeAll = false
                onChange { it.copy(status = ClipStatus.EXCLUDED, excluded = listOf(Interval(0, it.durationSeconds))) }
                onDecided(clip, excludedMsg)
            },
            onDismiss = { confirmExcludeAll = false },
        )
    }
}

/** Diagonal stripes between two x positions, over a flat fill. */
private fun DrawScope.hatch(left: Float, right: Float, fill: Color, line: Color) = clipRect(left, 0f, right, size.height) {
    drawRect(fill)
    val step = 5.dp.toPx()
    var x = left - size.height
    while (x < right) {
        drawLine(line, Offset(x, size.height), Offset(x + size.height, 0f), 1.5.dp.toPx())
        x += step
    }
}

@Composable
private fun ClipStatusLabel(status: ClipStatus) = when (status) {
    ClipStatus.PENDING -> StatusLabel(stringResource(R.string.status_pending), Amber, Ink)
    ClipStatus.APPROVED -> StatusLabel(
        stringResource(R.string.status_approved),
        MaterialTheme.colorScheme.secondaryContainer,
        MaterialTheme.colorScheme.onSecondaryContainer,
    )
    ClipStatus.EXCLUDED -> StatusLabel(
        stringResource(R.string.status_excluded),
        MaterialTheme.colorScheme.surface,
        MaterialTheme.colorScheme.onSurfaceVariant,
        outlined = true,
    )
}

/** Small non-interactive status tag. */
@Composable
fun StatusLabel(text: String, container: Color, content: Color, outlined: Boolean = false) {
    Surface(
        color = container,
        contentColor = content,
        shape = MaterialTheme.shapes.extraSmall,
        border = if (outlined) androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outline) else null,
    ) {
        Text(text, style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp))
    }
}

private val hourFormat = DateTimeFormatter.ofPattern("HH:mm").withZone(ZoneId.systemDefault())
private val clockFormat = DateTimeFormatter.ofPattern("HH:mm:ss").withZone(ZoneId.systemDefault())

@Composable
private fun clipRange(clip: Clip): String {
    val start = clip.startedAt ?: return stringResource(R.string.review_clip_no_clock)
    return "${hourFormat.format(start)} – ${hourFormat.format(start.plusSeconds(clip.durationSeconds.toLong()))}"
}

/** Clock time of a point in the clip, the way participants remember moments; time into the clip when its clock is unknown. */
private fun clockAt(clip: Clip, seconds: Int): String =
    clip.startedAt?.let { clockFormat.format(it.plusSeconds(seconds.toLong())) } ?: mmss(seconds)

internal fun mmss(seconds: Int) = "%02d:%02d".format(seconds / 60, seconds % 60)

/** Clip length in words ("5 min", "1 min 15 s"), so it can't be mistaken for a time of day. */
internal fun duration(seconds: Int): String {
    val m = seconds / 60
    val s = seconds % 60
    return when {
        m == 0 -> "$s s"
        s == 0 -> "$m min"
        else -> "$m min $s s"
    }
}

@Preview(showBackground = true)
@Composable
private fun ReviewScreenPreview() {
    val now = Instant.parse("2026-11-21T17:05:00Z")
    ObservatorioTheme {
        ReviewScreen(
            listOf(
                Clip("clip-071", now, 300),
                Clip("clip-072", now.plusSeconds(900), 540, ClipStatus.APPROVED),
                Clip("clip-073", now.plusSeconds(2400), 180, ClipStatus.EXCLUDED),
            ),
            loading = false,
            pendantUnreachable = false,
            onOpen = {},
        )
    }
}
