package cl.observatorio.participante.api

import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.io.IOException
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import kotlin.concurrent.thread

class EnrollmentTest {
    // One-shot HTTP server answering with the same codes and responses as tools/mock-api.
    private val server = ServerSocket(0, 0, InetAddress.getLoopbackAddress())
    private val baseUrl = "http://127.0.0.1:${server.localPort}"

    init {
        thread(isDaemon = true) {
            while (!server.isClosed) {
                val socket = runCatching { server.accept() }.getOrNull() ?: break
                socket.use { respond(it) }
            }
        }
    }

    private fun respond(socket: Socket) {
        val input = socket.getInputStream().bufferedReader()
        // toList() consumes every header line, so the body read below starts right after the blank line.
        val length = generateSequence { input.readLine() }.takeWhile { it.isNotEmpty() }.toList()
            .first { it.startsWith("Content-Length:", ignoreCase = true) }.substringAfter(":").trim().toInt()
        val code = JSONObject(String(CharArray(length).also { input.read(it) })).getString("code")
        val (status, body) = when (code) {
            "EAT-001-P01" -> 201 to """{"participant_id":"p-01","study_id":"study-eating-001","protocol_version":"eating-v1","participant_token":"t0k"}"""
            "EAT-001-P00" -> 409 to """{"error":{"code":"enrollment_code_used","message":"Enrollment code was already used"}}"""
            else -> 404 to """{"error":{"code":"enrollment_code_not_found","message":"Unknown enrollment code"}}"""
        }
        socket.getOutputStream().write(
            "HTTP/1.1 $status X\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n$body".toByteArray(),
        )
    }

    @After
    fun stop() = server.close()

    @Test
    fun returnsTheEnrollment() = runBlocking {
        assertEquals(Enrollment("p-01", "study-eating-001", "eating-v1", "t0k"), enroll("EAT-001-P01", baseUrl))
    }

    @Test
    fun reportsUsedAndUnknownCodes() {
        val used = assertThrows(EnrollmentException::class.java) { runBlocking { enroll("EAT-001-P00", baseUrl) } }
        val unknown = assertThrows(EnrollmentException::class.java) { runBlocking { enroll("NOPE", baseUrl) } }

        assertEquals(409 to "enrollment_code_used", used.httpStatus to used.code)
        assertEquals(404 to "enrollment_code_not_found", unknown.httpStatus to unknown.code)
    }

    @Test
    fun throwsIoExceptionWhenUnreachable() {
        server.close()
        assertThrows(IOException::class.java) { runBlocking { enroll("EAT-001-P01", baseUrl) } }
    }
}
