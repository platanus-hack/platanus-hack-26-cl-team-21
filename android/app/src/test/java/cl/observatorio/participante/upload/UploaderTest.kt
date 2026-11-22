package cl.observatorio.participante.upload

import cl.observatorio.participante.pendant.PendantApi
import cl.observatorio.participante.pendant.PendantStatus
import cl.observatorio.participante.pendant.SessionEntry
import cl.observatorio.participante.pendant.SessionFile
import cl.observatorio.participante.review.Clip
import cl.observatorio.participante.review.ClipStatus
import cl.observatorio.participante.review.Interval
import cl.observatorio.participante.video.FrameRow
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.nio.file.Files
import java.time.Instant
import kotlin.concurrent.thread

class UploaderTest {
    private val start = 1_795_280_400_000L // clip start, epoch ms
    private val second = start / 1000
    private val duration = 100 // seconds, 2 fps

    private val pendant = object : PendantApi {
        override suspend fun sessionFile(sessionId: String, file: SessionFile) = when (file) {
            SessionFile.SESSION_JSON -> """{"session_id":"s-1","device_id":"3c71bf","firmware_version":"cam-0.1.0","protocol_version":"eating-v1","fps":2,"frame_size":"VGA","started_at_epoch_ms":$start,"ended_at_epoch_ms":${start + duration * 1000},"frames":${duration * 2}}"""
            SessionFile.FRAMES_CSV -> "seq,rtc_epoch_ms,uptime_ms,bytes\n" + (1..duration * 2).joinToString("") { "$it,${start + (it - 1) * 500L},${4000 + it * 500},24000\n" }
            SessionFile.SENSORS_CSV -> "rtc_epoch,uptime_ms,temp_c\n" + (0 until duration).joinToString("") { "${second + it},${it * 1000},24.0\n" }
            SessionFile.EVENTS_CSV -> "rtc_epoch,uptime_ms,type,value\n${second + 45},1,BUTTON,\n${second + 46},2,PRIVACY_ON,${second + 46}\n${second + 70},3,BUTTON,\n"
        }

        override suspend fun frame(sessionId: String, number: Int) = "jpeg".toByteArray()
        override suspend fun sessions(): List<SessionEntry> = throw UnsupportedOperationException()
        override suspend fun status(): PendantStatus = throw UnsupportedOperationException()
        override suspend fun syncTime(epochSeconds: Long) = throw UnsupportedOperationException()
        override suspend fun startCapture(protocolVersion: String): String = throw UnsupportedOperationException()
        override suspend fun stopCapture() = throw UnsupportedOperationException()
    }

    // The fake encoder only records which frames it was asked to put in the video.
    private val encoded = mutableListOf<List<Int>>()
    private val workDir = Files.createTempDirectory("uploads").toFile()
    private val server = FakeBackend()
    private val uploader = Uploader("http://127.0.0.1:${server.port}", "token", workDir) { frames, output, _ ->
        encoded += frames.map { it.seq }
        output.writeText(frames.joinToString(",") { it.seq.toString() })
        frames
    }

    @After
    fun cleanUp() {
        server.close()
        workDir.deleteRecursively()
    }

    private fun clip(vararg excluded: Interval, status: ClipStatus = ClipStatus.APPROVED) =
        Clip("s-1", Instant.ofEpochMilli(start), duration, status, excluded.toList())

    private fun rows(csv: String) = csv.lines().drop(1).filter { it.isNotBlank() }.map { it.split(',') }

    @Test
    fun excludedFootageSensorsAndEventsNeverReachTheBackend() = runBlocking {
        var sent = 0
        uploader.send(pendant, clip(Interval(40, 50))) { sent++ }

        assertEquals(1, sent)
        assertEquals(listOf("create", "put", "put", "put", "put", "put", "complete"), server.calls)
        assertEquals(setOf("video", "frames", "sensors", "events", "manifest"), server.puts.keys)
        val excludedMs = (start + 40_000) until (start + 50_000)
        // No excluded frame was encoded, listed in frames.csv or part of the video bytes.
        assertTrue(encoded.single().none { start + (it - 1) * 500L in excludedMs })
        assertTrue(rows(server.puts.getValue("frames")).none { it[1].toLong() in excludedMs })
        assertEquals(encoded.single().joinToString(","), server.puts.getValue("video"))
        // Sensors: nothing from seconds 40..49. Events: the button press inside is gone, the privacy event stays.
        assertTrue(rows(server.puts.getValue("sensors")).none { it[0].toLong() - second in 40..49 })
        assertEquals(listOf("PRIVACY_ON", "BUTTON"), rows(server.puts.getValue("events")).map { it[2] })
        // The excluded interval goes to `complete` and the manifest, and nothing else about the excluded range does.
        val complete = JSONObject(server.completeBody).getJSONArray("excluded_intervals")
        assertEquals(1, complete.length())
        assertEquals(complete.toString(), JSONObject(server.puts.getValue("manifest")).getJSONArray("excluded_intervals").toString())
    }

    @Test
    fun aFullyExcludedClipSendsNoVideoAndNoFrames() = runBlocking {
        uploader.send(pendant, clip(status = ClipStatus.EXCLUDED))

        assertEquals(setOf("sensors", "events", "manifest"), server.puts.keys)
        assertTrue(encoded.isEmpty())
        assertTrue(rows(server.puts.getValue("sensors")).isEmpty())
        assertEquals(listOf("PRIVACY_ON"), rows(server.puts.getValue("events")).map { it[2] })
    }

    @Test
    fun aFailedSendResumesWithTheSameUploadAndRebuildsWhenTheReviewChanged() = runBlocking {
        server.failComplete = true
        var sent = 0
        assertThrows(UploadException::class.java) { runBlocking { uploader.send(pendant, clip(Interval(40, 50))) { sent++ } } }
        val firstId = server.createBodies.last().getString("upload_id")

        server.failComplete = false
        uploader.send(pendant, clip(Interval(40, 50))) { sent++ }
        assertEquals(firstId, server.createBodies.last().getString("upload_id"))
        assertEquals(1, encoded.size) // the bundle was reused, not encoded again
        assertEquals(1, sent) // only the successful send counts

        server.failComplete = true
        assertThrows(UploadException::class.java) { runBlocking { uploader.send(pendant, clip(Interval(40, 50))) } }
        server.failComplete = true
        assertThrows(UploadException::class.java) { runBlocking { uploader.send(pendant, clip(Interval(40, 60))) } }
        assertNotEquals(server.createBodies[server.createBodies.size - 2].getString("upload_id"), server.createBodies.last().getString("upload_id"))
        assertEquals(3, encoded.size) // the changed review was encoded again
    }

    /** Just enough of API v0 for the uploader: create (201), PUT to the URLs it hands out, complete (202 or 500). */
    private class FakeBackend {
        private val socket = ServerSocket(0, 0, InetAddress.getLoopbackAddress())
        val port = socket.localPort
        val calls = mutableListOf<String>()
        val puts = mutableMapOf<String, String>()
        val createBodies = mutableListOf<JSONObject>()
        var completeBody = ""
        @Volatile var failComplete = false

        init {
            thread(isDaemon = true) {
                while (!socket.isClosed) {
                    val client = runCatching { socket.accept() }.getOrNull() ?: break
                    client.use { handle(it) }
                }
            }
        }

        fun close() = socket.close()

        private fun handle(client: Socket) {
            val input = client.getInputStream().buffered()
            fun line(): String {
                val out = ByteArrayOutputStream()
                while (true) {
                    val b = input.read()
                    if (b < 0 || b == '\n'.code) break
                    if (b != '\r'.code) out.write(b)
                }
                return out.toString()
            }
            val (method, path) = line().split(' ')
            var length = 0
            while (true) {
                val header = line()
                if (header.isEmpty()) break
                if (header.startsWith("Content-Length:", ignoreCase = true)) length = header.substringAfter(':').trim().toInt()
            }
            val body = String(input.readNBytes(length))
            val (status, response) = when {
                method == "POST" && path == "/api/v1/uploads" -> {
                    calls += "create"
                    val create = JSONObject(body).also { createBodies += it }
                    val files = JSONArray()
                    for (i in 0 until create.getJSONArray("files").length()) {
                        val kind = create.getJSONArray("files").getJSONObject(i).getString("kind")
                        files.put(JSONObject().put("kind", kind).put("put_url", "http://127.0.0.1:$port/put/$kind").put("expires_at", "2030-01-01T00:00:00Z"))
                    }
                    201 to JSONObject().put("upload_id", create.getString("upload_id")).put("files", files).toString()
                }
                method == "PUT" -> {
                    calls += "put"
                    puts[path.substringAfterLast('/')] = body
                    200 to ""
                }
                method == "POST" && path.endsWith("/complete") -> {
                    calls += "complete"
                    completeBody = body
                    if (failComplete) 500 to """{"error":{"code":"internal_error","message":"boom"}}""" else 202 to """{"status":"processing"}"""
                }
                else -> 404 to ""
            }
            client.getOutputStream().write("HTTP/1.1 $status X\r\nContent-Length: ${response.length}\r\nConnection: close\r\n\r\n$response".toByteArray())
        }
    }
}
