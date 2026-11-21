package cl.observatorio.participante.video

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.Image
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import android.os.Bundle
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import java.io.File
import kotlin.coroutines.coroutineContext

/** Thrown when no frame has a usable timestamp or decodes, e.g. a session recorded before the first clock sync. */
class NoEncodableFramesException(message: String) : IllegalArgumentException(message)

/** Thrown when the encoder did not put a keyframe where [KeyframeScheduler] asked, so the worker could not cut there. */
class MissingKeyframesException(message: String) : IllegalStateException(message)

/**
 * [encoded] are the frames in the video, in order (row i of the uploaded frames.csv = video frame i). [dropped] were
 * left out: unusable timestamp or an incomplete or undecodable JPEG. [keyframeTimesUs] are the sync samples the encoder produced.
 */
data class EncodeResult(
    val output: File,
    val encoded: List<FrameRow>,
    val dropped: List<FrameRow>,
    val keyframeTimesUs: List<Long>,
    val lastFrameTimeUs: Long,
)

/**
 * Encodes device JPEG frames into `video.mp4` as H.264 in MP4 with MediaCodec and MediaMuxer,
 * variable frame rate (each frame keeps its `rtc_epoch_ms` as presentation time), keyframes per [KeyframeScheduler]
 * and no audio. Frames from excluded intervals are simply not passed in.
 */
class Mp4Encoder(
    private val width: Int = VGA_WIDTH,
    private val height: Int = VGA_HEIGHT,
    private val bitRate: Int = DEFAULT_BIT_RATE,
    /** The device's capture rate. Only a rate-control hint: presentation times come from the frames. */
    private val nominalFps: Int = DEVICE_FPS,
) {

    /**
     * Encodes [frames] (the device frames.csv rows, in order) into [output], reading each JPEG with [readJpeg].
     * Runs on [Dispatchers.IO] and can be cancelled between frames; a failed or cancelled run deletes [output].
     * [onProgress] gets (frames processed, frames to process) on the encoding thread after each frame.
     */
    suspend fun encode(
        frames: List<FrameRow>,
        output: File,
        readJpeg: (FrameRow) -> ByteArray,
        onProgress: (done: Int, total: Int) -> Unit = { _, _ -> },
    ): EncodeResult = try {
        withContext(Dispatchers.IO) {
            val selection = selectEncodableFrames(frames)
            if (selection.kept.isEmpty()) throw NoEncodableFramesException("no frame has a usable rtc_epoch_ms")
            val session = EncodingSession(output)
            try {
                session.run(selection, readJpeg, onProgress)
            } catch (failure: Throwable) {
                runCatching { session.release() }
                throw failure
            }
        }
    } catch (failure: Throwable) {
        withContext(NonCancellable + Dispatchers.IO) { output.delete() }
        throw failure
    }

    private inner class EncodingSession(private val output: File) {
        private val codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
        private var muxer: MediaMuxer? = null
        private var track = -1
        private var muxerStarted = false
        private val bufferInfo = MediaCodec.BufferInfo()
        private val keyframeTimesUs = mutableListOf<Long>()
        private val scheduledKeyframesUs = mutableListOf<Long>()
        private var framesQueued = 0
        private var samplesWritten = 0
        private var released = false

        suspend fun run(
            selection: FrameSelection,
            readJpeg: (FrameRow) -> ByteArray,
            onProgress: (Int, Int) -> Unit,
        ): EncodeResult {
            codec.configure(outputFormat(), null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            codec.start()
            muxer = MediaMuxer(output.path, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)

            val frames = selection.kept
            val encoded = mutableListOf<FrameRow>()
            val dropped = selection.dropped.toMutableList()
            val scheduler = KeyframeScheduler()
            val pixels = IntArray(width * height)
            var firstEpochMs: Long? = null
            var lastPtsUs = 0L

            frames.forEachIndexed { i, row ->
                coroutineContext.ensureActive()
                val epochMs = row.rtcEpochMs!!
                val bitmap = readJpeg(row).takeIf(::isCompleteJpeg)?.let(::decodeScaled)
                if (bitmap == null) {
                    dropped += row
                    scheduler.markGap()
                } else {
                    bitmap.getPixels(pixels, 0, width, 0, 0, width, height)
                    bitmap.recycle()
                    val first = firstEpochMs ?: epochMs.also { firstEpochMs = it }
                    lastPtsUs = presentationTimeUs(epochMs, first)
                    val previousFrame = encoded.lastOrNull()
                    if (previousFrame != null && row.seq.toLong() - previousFrame.seq != 1L) scheduler.markGap()
                    val keyframe = scheduler.isKeyframe(epochMs, frames.getOrNull(i + 1)?.rtcEpochMs)
                    queueFrame(pixels, lastPtsUs, keyframe)
                    encoded += row
                }
                onProgress(i + 1, frames.size)
            }
            if (encoded.isEmpty()) throw NoEncodableFramesException("no frame could be decoded")

            val index = dequeueInput()
            codec.queueInputBuffer(index, 0, 0, lastPtsUs, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
            drain(endOfStream = true)
            val missing = scheduledKeyframesUs - keyframeTimesUs.toSet()
            if (missing.isNotEmpty()) throw MissingKeyframesException("no keyframe at ${missing.take(5)} µs")
            checkNotNull(muxer).stop()
            muxerStarted = false
            release()
            return EncodeResult(output, encoded, dropped.sortedBy { it.seq }, keyframeTimesUs.toList(), lastPtsUs)
        }

        fun release() {
            if (released) return
            released = true
            runCatching { codec.stop() }
            codec.release()
            muxer?.let { m ->
                if (muxerStarted) runCatching { m.stop() }
                m.release()
            }
        }

        private fun outputFormat() = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, width, height).apply {
            setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible)
            setInteger(MediaFormat.KEY_BIT_RATE, bitRate)
            // The emulator's software encoder overshoots the target ~4x in the default VBR mode.
            if (supportsCbr()) setInteger(MediaFormat.KEY_BITRATE_MODE, MediaCodecInfo.EncoderCapabilities.BITRATE_MODE_CBR)
            setInteger(MediaFormat.KEY_FRAME_RATE, nominalFps)
            // The scheduler's sync requests place the keyframes. The encoder's own period counts frames at
            // KEY_FRAME_RATE, not real time, so it is only a sparse fallback that would add off-beat keyframes if shorter.
            setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, FALLBACK_I_FRAME_INTERVAL_S)
            // Baseline has no B-frames: decode order = presentation order, so every sync sample is a clean cut point.
            setInteger(MediaFormat.KEY_PROFILE, MediaCodecInfo.CodecProfileLevel.AVCProfileBaseline)
            setInteger(MediaFormat.KEY_LEVEL, MediaCodecInfo.CodecProfileLevel.AVCLevel31)
        }

        private fun supportsCbr() = codec.codecInfo.getCapabilitiesForType(MediaFormat.MIMETYPE_VIDEO_AVC)
            .encoderCapabilities.isBitrateModeSupported(MediaCodecInfo.EncoderCapabilities.BITRATE_MODE_CBR)

        private fun decodeScaled(jpeg: ByteArray): Bitmap? {
            val decoded = BitmapFactory.decodeByteArray(jpeg, 0, jpeg.size) ?: return null
            if (decoded.width == width && decoded.height == height) return decoded
            // Scaling keeps the evidence undistorted only at the same aspect ratio (the mock's 160 × 120 thumbnails).
            require(decoded.width * height == decoded.height * width) {
                "frame is ${decoded.width}×${decoded.height}, not the ${width}×${height} aspect ratio"
            }
            return Bitmap.createScaledBitmap(decoded, width, height, true).also { decoded.recycle() }
        }

        private fun queueFrame(pixels: IntArray, ptsUs: Long, keyframe: Boolean) {
            val index = dequeueInput()
            val image = checkNotNull(codec.getInputImage(index)) { "encoder gave no input image" }
            writeYuv420(image, argbToYuv420(pixels, width, height))
            if (keyframe) {
                // A sync request applies "soon": with no earlier frame still inside the encoder, soon is this frame.
                drainQueuedFrames()
                codec.setParameters(Bundle().apply { putInt(MediaCodec.PARAMETER_KEY_REQUEST_SYNC_FRAME, 0) })
                scheduledKeyframesUs += ptsUs
            }
            codec.queueInputBuffer(index, 0, width * height * 3 / 2, ptsUs, 0)
            framesQueued++
            drain(endOfStream = false)
        }

        private fun dequeueInput(): Int {
            repeat(STALL_POLLS) {
                val index = codec.dequeueInputBuffer(TIMEOUT_US)
                if (index >= 0) return index
                drain(endOfStream = false)
            }
            throw IllegalStateException("encoder stalled: no input buffer")
        }

        /** Waits, bounded, until every queued frame came out: some encoders hold frames until more input arrives. */
        private fun drainQueuedFrames() {
            repeat(HOLD_POLLS) {
                if (samplesWritten >= framesQueued) return
                drain(endOfStream = false, timeoutUs = TIMEOUT_US)
            }
        }

        private fun writeYuv420(image: Image, yuv: Yuv420) {
            val planes = image.planes
            writePlane(planes[0], yuv.y, width, height)
            writePlane(planes[1], yuv.u, width / 2, height / 2)
            writePlane(planes[2], yuv.v, width / 2, height / 2)
        }

        private fun writePlane(plane: Image.Plane, data: ByteArray, planeWidth: Int, planeHeight: Int) {
            val buffer = plane.buffer
            val rowStride = plane.rowStride
            val pixelStride = plane.pixelStride
            if (pixelStride == 1 && rowStride == planeWidth) {
                buffer.put(data, 0, planeWidth * planeHeight)
                return
            }
            for (row in 0 until planeHeight) {
                for (col in 0 until planeWidth) {
                    buffer.put(row * rowStride + col * pixelStride, data[row * planeWidth + col])
                }
            }
        }

        private fun drain(endOfStream: Boolean, timeoutUs: Long = if (endOfStream) TIMEOUT_US else 0) {
            var idlePolls = 0
            while (true) {
                val index = codec.dequeueOutputBuffer(bufferInfo, timeoutUs)
                when {
                    index == MediaCodec.INFO_TRY_AGAIN_LATER -> {
                        if (!endOfStream) return
                        if (++idlePolls >= STALL_POLLS) throw IllegalStateException("encoder stalled before end of stream")
                    }
                    index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                        val m = checkNotNull(muxer)
                        check(track < 0) { "encoder output format changed twice" }
                        track = m.addTrack(codec.outputFormat)
                        m.start()
                        muxerStarted = true
                    }
                    index >= 0 -> {
                        val buffer = checkNotNull(codec.getOutputBuffer(index))
                        val isConfig = bufferInfo.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0
                        if (!isConfig && bufferInfo.size > 0) {
                            check(track >= 0) { "encoder produced data before its output format" }
                            buffer.position(bufferInfo.offset).limit(bufferInfo.offset + bufferInfo.size)
                            checkNotNull(muxer).writeSampleData(track, buffer, bufferInfo)
                            samplesWritten++
                            if (bufferInfo.flags and MediaCodec.BUFFER_FLAG_KEY_FRAME != 0) {
                                keyframeTimesUs += bufferInfo.presentationTimeUs
                            }
                        }
                        codec.releaseOutputBuffer(index, false)
                        if (bufferInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) return
                    }
                }
            }
        }
    }

    companion object {
        const val VGA_WIDTH = 640
        const val VGA_HEIGHT = 480
        const val DEVICE_FPS = 2

        /** ~250 kbit/s: about 56 MB for a 30-minute session. */
        const val DEFAULT_BIT_RATE = 250_000
        private const val FALLBACK_I_FRAME_INTERVAL_S = 10
        private const val TIMEOUT_US = 10_000L

        /** 5 s without progress: a stalled encoder fails the run instead of hanging the thread. */
        private const val STALL_POLLS = 500
        private const val HOLD_POLLS = 20
    }
}

/**
 * Whether [jpeg] starts with a JPEG start-of-image marker and ends with an end-of-image marker (trailing zero padding
 * allowed). A frame cut short on the SD card would otherwise decode with a gray fill, content the camera never saw.
 */
fun isCompleteJpeg(jpeg: ByteArray): Boolean {
    var end = jpeg.size
    while (end > 0 && jpeg[end - 1] == 0.toByte()) end--
    return end >= 4 &&
        jpeg[0] == 0xFF.toByte() && jpeg[1] == 0xD8.toByte() &&
        jpeg[end - 2] == 0xFF.toByte() && jpeg[end - 1] == 0xD9.toByte()
}

/** Planar 4:2:0 image: [y] is width × height, [u] (Cb) and [v] (Cr) are (width / 2) × (height / 2). */
class Yuv420(val y: ByteArray, val u: ByteArray, val v: ByteArray)

/**
 * Converts ARGB pixels to BT.601 limited-range YUV 4:2:0, the encoder's default color space. Chroma is the average of
 * each 2 × 2 block. [width] and [height] must be even.
 */
fun argbToYuv420(pixels: IntArray, width: Int, height: Int): Yuv420 {
    require(width % 2 == 0 && height % 2 == 0) { "width and height must be even" }
    val y = ByteArray(width * height)
    val u = ByteArray(width * height / 4)
    val v = ByteArray(width * height / 4)
    for (i in pixels.indices) {
        val p = pixels[i]
        y[i] = (((66 * p.red + 129 * p.green + 25 * p.blue + 128) shr 8) + 16).toByte()
    }
    val chromaWidth = width / 2
    for (row in 0 until height / 2) {
        for (col in 0 until chromaWidth) {
            val topLeft = 2 * row * width + 2 * col
            val p0 = pixels[topLeft]
            val p1 = pixels[topLeft + 1]
            val p2 = pixels[topLeft + width]
            val p3 = pixels[topLeft + width + 1]
            val r = (p0.red + p1.red + p2.red + p3.red) / 4
            val g = (p0.green + p1.green + p2.green + p3.green) / 4
            val b = (p0.blue + p1.blue + p2.blue + p3.blue) / 4
            u[row * chromaWidth + col] = (((-38 * r - 74 * g + 112 * b + 128) shr 8) + 128).toByte()
            v[row * chromaWidth + col] = (((112 * r - 94 * g - 18 * b + 128) shr 8) + 128).toByte()
        }
    }
    return Yuv420(y, u, v)
}

private val Int.red get() = (this shr 16) and 0xFF
private val Int.green get() = (this shr 8) and 0xFF
private val Int.blue get() = this and 0xFF
