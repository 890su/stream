package pl.sekond.stream.phone

import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/** The /api/phone endpoints of the Stream server. Network failures surface as IOException (callers retry). */
class Api(private val settings: Settings) {
    class Response(val status: Int, val body: String) {
        val ok get() = status in 200..299
        /** Worth trying again later: no answer yet, server trouble or a call the server has not received yet. */
        val retryable get() = status == 404 || status == 408 || status == 429 || status >= 500
    }

    @Throws(IOException::class)
    fun ping(): Response = request("GET", "/api/phone/ping", null)

    @Throws(IOException::class)
    fun postCall(body: JSONObject): Response = request("POST", "/api/phone/calls", body)

    @Throws(IOException::class)
    fun postSms(body: JSONObject): Response = request("POST", "/api/phone/sms", body)

    /** The next SMS to send, the server holding the request up to [waitS] seconds; 204 — none (CONCEPT.md §8.1). */
    @Throws(IOException::class)
    fun nextAction(waitS: Int): Response = request("GET", "/api/phone/actions/next?wait=$waitS", null, readTimeoutMs = (waitS + 20) * 1000)

    @Throws(IOException::class)
    fun reportAction(id: String, body: JSONObject): Response = request("POST", "/api/phone/actions/$id", body)

    @Throws(IOException::class)
    fun postNote(callId: String, body: JSONObject): Response = request("POST", "/api/phone/calls/$callId/note", body)

    private fun request(method: String, path: String, body: JSONObject?, readTimeoutMs: Int = 30_000): Response {
        val connection = URL(settings.server + path).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = method
            connection.connectTimeout = 15_000
            connection.readTimeout = readTimeoutMs
            connection.setRequestProperty("Authorization", "Bearer ${settings.token}")
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            val status = connection.responseCode
            val stream = if (status >= 400) connection.errorStream else connection.inputStream
            return Response(status, stream?.bufferedReader()?.use { it.readText() } ?: "")
        } finally {
            connection.disconnect()
        }
    }
}
