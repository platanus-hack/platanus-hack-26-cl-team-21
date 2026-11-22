package cl.observatorio.participante.pendant

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.net.URLEncoder

internal class HttpPendant(
    private val address: URI,
    private val token: String,
    private val openWifiConnection: (URL) -> HttpURLConnection?,
) : PendantApi {
    override suspend fun status() = parseStatus(text("/status"))

    override suspend fun syncTime(epochSeconds: Long) {
        request("/time?epoch=$epochSeconds", "POST")
    }

    override suspend fun startCapture(protocolVersion: String): String {
        val protocol = URLEncoder.encode(protocolVersion, Charsets.UTF_8.name())
        return JSONObject(text("/capture/start?protocol=$protocol", "POST")).getString("session_id")
    }

    override suspend fun stopCapture() {
        request("/capture/stop", "POST")
    }

    override suspend fun sessions() = parseSessions(text("/sessions")).filter { SESSION_ID.matches(it.sessionId) }

    override suspend fun sessionFile(sessionId: String, file: SessionFile) =
        text("${sessionPath(sessionId)}/${file.fileName}")

    override suspend fun frame(sessionId: String, number: Int): ByteArray {
        require(number in 1..999999)
        return request("${sessionPath(sessionId)}/frames/${number.toString().padStart(6, '0')}.jpg")
    }

    private fun sessionPath(sessionId: String): String {
        require(SESSION_ID.matches(sessionId))
        return "/sessions/$sessionId"
    }

    private suspend fun text(path: String, method: String = "GET") = request(path, method).toString(Charsets.UTF_8)

    private suspend fun request(path: String, method: String = "GET"): ByteArray = withContext(Dispatchers.IO) {
        try {
            val connection = openWifiConnection(address.resolve(path).toURL())
                ?: throw IOException("Wi-Fi is not connected")
            try {
                connection.requestMethod = method
                connection.connectTimeout = 3000
                connection.readTimeout = 5000
                connection.instanceFollowRedirects = false
                connection.setRequestProperty("Authorization", "Bearer $token")
                val status = connection.responseCode
                if (status !in 200..299) {
                    throw PendantRequestException(status, connection.responseMessage.orEmpty())
                }
                connection.inputStream.use { it.readBytes() }
            } finally {
                connection.disconnect()
            }
        } catch (error: PendantRequestException) {
            throw error
        } catch (error: IOException) {
            throw PendantUnreachableException("Pendant did not respond").apply { initCause(error) }
        }
    }

    private companion object {
        val SESSION_ID = Regex("[a-z0-9-]{1,48}")
    }
}

internal fun parsePendantAddress(input: String): URI? {
    val address = input.trim()
    val uri = runCatching { URI(if ("://" in address) address else "http://$address") }.getOrNull() ?: return null
    return uri.takeIf {
        it.scheme in listOf("http", "https") && it.host?.let(::isLocalPendantHost) == true && it.userInfo == null &&
            (it.port == -1 || it.port in 1..65535) && (it.path.isEmpty() || it.path == "/") &&
            it.query == null && it.fragment == null
    }
}

private fun isLocalPendantHost(host: String): Boolean {
    if (host.endsWith(".local", ignoreCase = true)) return true
    val octets = host.split('.').map { octet ->
        val number = octet.toIntOrNull() ?: return false
        if (octet != number.toString()) return false
        number
    }
    if (octets.size != 4 || octets.any { it !in 0..255 }) return false
    return when (octets[0]) {
        10 -> true
        172 -> octets[1] in 16..31
        192 -> octets[1] == 168
        else -> false
    }
}
