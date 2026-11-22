package cl.observatorio.participante.api

import cl.observatorio.participante.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

data class Enrollment(
    val participantId: String,
    val studyId: String,
    val protocolVersion: String,
    val participantToken: String,
)

/** The backend answered with an error; [code] is the API v0 error code, e.g. `enrollment_code_used`. */
class EnrollmentException(val httpStatus: Int, val code: String?) : Exception("Enrollment failed: $httpStatus $code")

/** `POST /api/v1/enrollments` (ADR 0002). Throws [java.io.IOException] when the backend can't be reached. */
suspend fun enroll(code: String, baseUrl: String = BuildConfig.API_BASE_URL): Enrollment = withContext(Dispatchers.IO) {
    val conn = URL("$baseUrl/api/v1/enrollments").openConnection() as HttpURLConnection
    try {
        conn.connectTimeout = 10_000
        conn.readTimeout = 60_000 // Render free plan cold start takes 30–60 s
        conn.requestMethod = "POST"
        conn.doOutput = true
        conn.setRequestProperty("Content-Type", "application/json")
        conn.outputStream.use { it.write(JSONObject().put("code", code).toString().toByteArray()) }
        val status = conn.responseCode
        if (status != 201) {
            throw EnrollmentException(status, apiErrorCode(conn.errorStream?.bufferedReader()?.use { it.readText() }))
        }
        parseEnrollment(conn.inputStream.bufferedReader().use { it.readText() })
    } finally {
        conn.disconnect()
    }
}

/** `error.code` of an API v0 error body `{ "error": { "code", "message" } }`, or null when the body isn't one. */
fun apiErrorCode(body: String?): String? =
    runCatching { JSONObject(body!!).getJSONObject("error").getString("code") }.getOrNull()

internal fun parseEnrollment(body: String): Enrollment = JSONObject(body).run {
    Enrollment(
        participantId = getString("participant_id"),
        studyId = getString("study_id"),
        protocolVersion = getString("protocol_version"),
        participantToken = getString("participant_token"),
    )
}
