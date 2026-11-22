package cl.observatorio.participante.ui

import android.graphics.Bitmap
import android.graphics.SurfaceTexture
import android.media.MediaMetadataRetriever
import android.media.MediaPlayer
import android.view.Surface
import android.view.TextureView
import androidx.compose.foundation.Image
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.FilterChip
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import cl.observatorio.participante.R
import cl.observatorio.participante.review.Clip
import cl.observatorio.participante.review.ReviewVideo
import cl.observatorio.participante.review.clipSecondsAt
import cl.observatorio.participante.review.playableFrom
import cl.observatorio.participante.review.videoPositionMs
import cl.observatorio.participante.ui.theme.TabularNumbers
import cl.observatorio.participante.video.NoEncodableFramesException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import java.io.IOException

private sealed interface VideoState {
    data class Preparing(val done: Int, val total: Int) : VideoState
    data class Ready(val video: ReviewVideo) : VideoState
    data object NoClock : VideoState
    data object Failed : VideoState
}

/**
 * The session as a video, like a simple editor: play the whole clip or only the [selection] being edited, always skipping
 * excluded spans so what plays is what would be sent, over a thumbnail timeline with those spans hatched and a playhead.
 */
@Composable
fun SessionVideo(
    clip: Clip,
    selection: ClosedFloatingPointRange<Float>?,
    prepareVideo: suspend (onProgress: (done: Int, total: Int) -> Unit) -> ReviewVideo,
) {
    var attempt by remember(clip.id) { mutableIntStateOf(0) }
    var state by remember(clip.id) { mutableStateOf<VideoState>(VideoState.Preparing(0, 0)) }
    LaunchedEffect(clip.id, attempt) {
        if (clip.startedAt == null) {
            state = VideoState.NoClock
            return@LaunchedEffect
        }
        state = VideoState.Preparing(0, 0)
        state = try {
            VideoState.Ready(prepareVideo { done, total -> state = VideoState.Preparing(done, total) })
        } catch (e: CancellationException) {
            throw e
        } catch (e: NoEncodableFramesException) {
            VideoState.NoClock
        } catch (e: Exception) {
            VideoState.Failed
        }
    }

    when (val current = state) {
        is VideoState.Ready -> VideoEditor(clip, current.video, selection)
        is VideoState.Preparing -> VideoMessage {
            Text(stringResource(R.string.video_preparing), style = MaterialTheme.typography.bodyMedium)
            if (current.total > 0) {
                LinearProgressIndicator(
                    progress = { current.done / current.total.toFloat() },
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                    drawStopIndicator = {},
                )
                Text(
                    stringResource(R.string.video_preparing_progress, current.done, current.total),
                    style = MaterialTheme.typography.bodyMedium.merge(TabularNumbers),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 4.dp),
                )
            }
        }
        VideoState.NoClock -> VideoMessage {
            Text(stringResource(R.string.video_no_clock), style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.Center)
        }
        VideoState.Failed -> VideoMessage {
            Text(stringResource(R.string.video_failed), style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.Center)
            InlineButton(stringResource(R.string.video_retry), onClick = { attempt++ }, modifier = Modifier.padding(top = 8.dp))
        }
    }
}

@Composable
private fun VideoMessage(content: @Composable () -> Unit) {
    Box(
        Modifier
            .padding(16.dp)
            .fillMaxWidth()
            .aspectRatio(VIDEO_ASPECT)
            .clip(MaterialTheme.shapes.small)
            .border(1.dp, MaterialTheme.colorScheme.outline, MaterialTheme.shapes.small)
            .gridPaper(MaterialTheme.colorScheme.outlineVariant)
            .padding(24.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) { content() }
    }
}

@Composable
private fun VideoEditor(clip: Clip, video: ReviewVideo, selection: ClosedFloatingPointRange<Float>?) {
    val wholeClip = 0f..clip.durationSeconds.toFloat()
    val player = remember(video.file) { MediaPlayer() }
    var prepared by remember(video.file) { mutableStateOf(false) }
    // The range being played, or null while paused.
    var playing by remember(video.file) { mutableStateOf<ClosedFloatingPointRange<Float>?>(null) }
    var fast by remember { mutableStateOf(false) }
    var playhead by remember(video.file) { mutableFloatStateOf(selection?.start ?: 0f) }
    DisposableEffect(player) {
        player.setDataSource(video.file.path)
        player.setOnPreparedListener { prepared = true }
        player.setOnCompletionListener { playing = null }
        player.prepareAsync()
        onDispose { player.release() }
    }
    fun seekTo(seconds: Float) = player.seekTo(videoPositionMs(clip, video, seconds), MediaPlayer.SEEK_CLOSEST)
    fun applySpeed() {
        player.playbackParams = player.playbackParams.setSpeed(if (fast) FAST_SPEED else 1f)
    }

    // A new selection (or a decision that changed the exclusions) shows its first frame.
    LaunchedEffect(prepared, selection, clip.excluded) {
        if (!prepared) return@LaunchedEffect
        playing = null
        playhead = selection?.start ?: 0f
        seekTo(playhead)
    }
    LaunchedEffect(playing) {
        if (!prepared) return@LaunchedEffect
        val range = playing
        if (range == null) {
            if (player.isPlaying) player.pause()
            return@LaunchedEffect
        }
        val resumeAt = playhead.takeIf { it >= range.start && it < range.endInclusive } ?: range.start
        val from = playableFrom(resumeAt, range.endInclusive, clip.excluded)
        if (from == null) {
            playing = null
            return@LaunchedEffect
        }
        seekTo(from)
        applySpeed()
        player.start()
        while (true) {
            delay(PLAYHEAD_TICK_MS)
            val at = clipSecondsAt(clip, video, player.currentPosition.toLong())
            val next = playableFrom(at, range.endInclusive, clip.excluded)
            if (next == null) {
                player.pause()
                playing = null
                break
            }
            if (next != at) seekTo(next)
            playhead = next
        }
    }
    LaunchedEffect(fast) { if (prepared && player.isPlaying) applySpeed() }

    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(
            Modifier
                .fillMaxWidth()
                .aspectRatio(VIDEO_ASPECT)
                .clip(MaterialTheme.shapes.small)
                .border(1.dp, MaterialTheme.colorScheme.outline, MaterialTheme.shapes.small),
        ) {
            AndroidView(
                factory = { context ->
                    TextureView(context).apply {
                        surfaceTextureListener = object : TextureView.SurfaceTextureListener {
                            override fun onSurfaceTextureAvailable(texture: SurfaceTexture, width: Int, height: Int) {
                                player.setSurface(Surface(texture))
                            }

                            override fun onSurfaceTextureSizeChanged(texture: SurfaceTexture, width: Int, height: Int) = Unit

                            override fun onSurfaceTextureDestroyed(texture: SurfaceTexture): Boolean {
                                runCatching { player.setSurface(null) }
                                return true
                            }

                            override fun onSurfaceTextureUpdated(texture: SurfaceTexture) = Unit
                        }
                    }
                },
                modifier = Modifier.fillMaxSize(),
            )
        }
        Filmstrip(clip, video, playhead)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            InlineButton(
                stringResource(if (playing != null) R.string.video_pause else R.string.video_play),
                onClick = { playing = if (playing != null) null else wholeClip },
                enabled = prepared,
            )
            if (selection != null && playing == null) {
                InlineButton(stringResource(R.string.video_play_span), onClick = { playing = selection }, enabled = prepared)
            }
            FilterChip(selected = fast, onClick = { fast = !fast }, label = { Text(stringResource(R.string.video_fast)) })
            Text(
                clockAt(clip, playhead.toInt()),
                style = MaterialTheme.typography.bodyLarge.merge(TabularNumbers),
                modifier = Modifier.weight(1f),
                textAlign = TextAlign.End,
            )
        }
    }
}

/** Thumbnails spread over the whole clip, excluded spans hatched, and a line at the [playhead]. */
@Composable
private fun Filmstrip(clip: Clip, video: ReviewVideo, playhead: Float) {
    val length = clip.durationSeconds.toFloat()
    var thumbnails by remember(video.file) { mutableStateOf<List<ImageBitmap?>>(List(FILMSTRIP_THUMBNAILS) { null }) }
    LaunchedEffect(video.file) { thumbnails = withContext(Dispatchers.IO) { filmstripThumbnails(clip, video) } }
    val hatchFill = MaterialTheme.colorScheme.surfaceVariant
    val hatchLine = MaterialTheme.colorScheme.onSurfaceVariant
    val playheadColor = MaterialTheme.colorScheme.primary
    Row(
        Modifier
            .fillMaxWidth()
            .height(FILMSTRIP_HEIGHT)
            .clip(MaterialTheme.shapes.extraSmall)
            .border(1.dp, MaterialTheme.colorScheme.outline, MaterialTheme.shapes.extraSmall)
            .gridPaper(MaterialTheme.colorScheme.outlineVariant)
            .drawWithContent {
                drawContent()
                clip.excluded.forEach { span ->
                    hatch(span.start / length * size.width, span.end / length * size.width, hatchFill, hatchLine)
                }
                val x = (playhead / length).coerceIn(0f, 1f) * size.width
                drawLine(playheadColor, Offset(x, 0f), Offset(x, size.height), strokeWidth = 2.dp.toPx())
            },
    ) {
        thumbnails.forEach { thumbnail ->
            Box(Modifier.weight(1f).fillMaxHeight()) {
                if (thumbnail != null) Image(thumbnail, null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
            }
        }
    }
}

private fun filmstripThumbnails(clip: Clip, video: ReviewVideo): List<ImageBitmap?> {
    val retriever = MediaMetadataRetriever()
    return try {
        retriever.setDataSource(video.file.path)
        List(FILMSTRIP_THUMBNAILS) { i ->
            val seconds = (i + 0.5f) / FILMSTRIP_THUMBNAILS * clip.durationSeconds
            val frame = retriever.getFrameAtTime(videoPositionMs(clip, video, seconds) * 1000, MediaMetadataRetriever.OPTION_CLOSEST)
            frame?.let { Bitmap.createScaledBitmap(it, THUMBNAIL_WIDTH_PX, THUMBNAIL_HEIGHT_PX, true).asImageBitmap() }
        }
    } catch (e: RuntimeException) {
        List(FILMSTRIP_THUMBNAILS) { null }
    } catch (e: IOException) {
        List(FILMSTRIP_THUMBNAILS) { null }
    } finally {
        retriever.release()
    }
}

private const val VIDEO_ASPECT = 4f / 3f
private const val FAST_SPEED = 4f
private const val PLAYHEAD_TICK_MS = 100L
private const val FILMSTRIP_THUMBNAILS = 8
private const val THUMBNAIL_WIDTH_PX = 128
private const val THUMBNAIL_HEIGHT_PX = 96
private val FILMSTRIP_HEIGHT = 56.dp
