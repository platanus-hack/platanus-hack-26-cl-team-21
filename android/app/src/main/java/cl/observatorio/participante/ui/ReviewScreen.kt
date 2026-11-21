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
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import cl.observatorio.participante.R
import cl.observatorio.participante.pendant.Clip
import cl.observatorio.participante.pendant.ClipStatus
import cl.observatorio.participante.pendant.FakePendant
import cl.observatorio.participante.pendant.Interval
import cl.observatorio.participante.ui.theme.Amber
import cl.observatorio.participante.ui.theme.Ink
import cl.observatorio.participante.ui.theme.ObservatorioTheme
import cl.observatorio.participante.ui.theme.TabularNumbers
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReviewScreen(clips: List<Clip>, onOpen: (Clip) -> Unit) {
    val scroll = TopAppBarDefaults.exitUntilCollapsedScrollBehavior()
    Scaffold(
        modifier = Modifier.nestedScroll(scroll.nestedScrollConnection),
        topBar = { LargeTopAppBar(title = { Text(stringResource(R.string.tab_review)) }, scrollBehavior = scroll) },
        contentWindowInsets = WindowInsets(0),
    ) { padding ->
        LazyColumn(contentPadding = padding) {
            item {
                Column(Modifier.padding(16.dp)) {
                    Highlighted(
                        stringResource(R.string.review_summary_before),
                        stringResource(
                            R.string.review_summary_count,
                            clips.count { it.status == ClipStatus.PENDING },
                            clips.size,
                        ),
                    )
                    Text(
                        stringResource(R.string.review_privacy_note),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 12.dp),
                    )
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            }
            items(clips, key = { it.id }) { clip ->
                ListItem(
                    headlineContent = { Text(clipRange(clip), style = MaterialTheme.typography.bodyLarge.merge(TabularNumbers)) },
                    supportingContent = {
                        Text(stringResource(R.string.review_clip_meta, mmss(clip.durationSeconds), clip.id))
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
fun ClipDetailScreen(clip: Clip, onBack: () -> Unit) {
    var range by remember(clip.id) { mutableStateOf(0f..clip.durationSeconds / 4f) }
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
        bottomBar = {
            Column(
                Modifier
                    .navigationBarsPadding()
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                MainActionButton(stringResource(R.string.clip_approve), onClick = {
                    FakePendant.update(clip.id) { it.copy(status = ClipStatus.APPROVED) }
                    onBack()
                })
                SecondaryActionButton(stringResource(R.string.clip_exclude_all), onClick = {
                    FakePendant.update(clip.id) {
                        it.copy(status = ClipStatus.EXCLUDED, excluded = listOf(Interval(0, it.durationSeconds)))
                    }
                    onBack()
                })
            }
        },
    ) { padding ->
        Column(
            Modifier
                .padding(padding)
                .verticalScroll(rememberScrollState()),
        ) {
            // shortcut: no video yet, the fake pendant has no media. Swap for a platform video player with real clips.
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

            SectionTitle(stringResource(R.string.clip_exclude_range_title))
            Column(Modifier.padding(horizontal = 16.dp)) {
                Text(stringResource(R.string.clip_exclude_range_hint), style = MaterialTheme.typography.bodyMedium)
                RangeSlider(
                    value = range,
                    onValueChange = { range = it },
                    valueRange = 0f..clip.durationSeconds.toFloat(),
                )
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        "${mmss(range.start.toInt())} – ${mmss(range.endInclusive.toInt())}",
                        style = MaterialTheme.typography.titleLarge.merge(TabularNumbers),
                    )
                    InlineButton(
                        stringResource(R.string.clip_exclude_range),
                        onClick = {
                            val interval = Interval(range.start.toInt(), range.endInclusive.toInt())
                            FakePendant.update(clip.id) { if (interval in it.excluded) it else it.copy(excluded = it.excluded + interval) }
                        },
                        enabled = range.endInclusive.toInt() > range.start.toInt(),
                    )
                }
            }

            if (clip.excluded.isNotEmpty()) {
                SectionTitle(stringResource(R.string.clip_excluded_ranges))
                clip.excluded.forEach { interval ->
                    val label = "${mmss(interval.start)} – ${mmss(interval.end)}"
                    ListItem(
                        headlineContent = { Text(label, style = MaterialTheme.typography.bodyLarge.merge(TabularNumbers)) },
                        trailingContent = {
                            IconButton(onClick = { FakePendant.update(clip.id) { it.copy(excluded = it.excluded - interval) } }) {
                                Icon(Icons.Outlined.Delete, stringResource(R.string.clip_remove_range, label))
                            }
                        },
                        colors = ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.surface),
                    )
                }
            }
        }
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

private fun clipRange(clip: Clip) =
    "${hourFormat.format(clip.startedAt)} – ${hourFormat.format(clip.startedAt.plusSeconds(clip.durationSeconds.toLong()))}"

internal fun mmss(seconds: Int) = "%02d:%02d".format(seconds / 60, seconds % 60)

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
            onOpen = {},
        )
    }
}
