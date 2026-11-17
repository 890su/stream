package pl.sekond.stream.phone

import org.json.JSONObject
import java.time.Instant

/** Request bodies for the /api/phone endpoints (docs/plans/2026-11-17-p10-calls.md). Empty optional fields are left out. */
object Payloads {
    private fun iso(ms: Long) = Instant.ofEpochMilli(ms).toString()

    fun call(direction: String, number: String, name: String?, startedMs: Long, durationS: Long, sim: String?): JSONObject =
        JSONObject().apply {
            put("direction", direction)
            put("number", number.trim())
            if (!name.isNullOrBlank()) put("name", name.trim())
            put("started_at", iso(startedMs))
            put("duration_s", durationS.coerceAtLeast(0))
            if (!sim.isNullOrBlank()) put("sim", sim)
        }

    fun sms(direction: String, number: String, sentMs: Long, text: String, sim: String?): JSONObject =
        JSONObject().apply {
            put("direction", direction)
            put("number", number.trim())
            put("sent_at", iso(sentMs))
            put("text", text)
            if (!sim.isNullOrBlank()) put("sim", sim)
        }

    fun note(noteId: String, text: String, writtenMs: Long): JSONObject =
        JSONObject().apply {
            put("note_id", noteId)
            put("text", text)
            put("written_at", writtenMs)
        }
}
