package pl.sekond.stream.phone

import org.json.JSONArray
import org.json.JSONObject

/**
 * SMS the companion sent for Stream (CONCEPT.md §8.1, 2026-11-25). Android also writes them to the SMS store; the
 * sync skips such a row there — the reply is already in the journal — when its number and text match one sent within
 * WINDOW_MS. Pure: the list is kept as JSON in Settings.
 */
object SmsEcho {
    data class Sent(val number: String, val text: String, val at: Long)

    private const val KEEP = 30
    const val WINDOW_MS = 30 * 60_000L

    /** "+48 500 000 001" and "500000001" are the same number: the last nine digits decide. */
    fun sameNumber(a: String, b: String): Boolean {
        val x = a.filter(Char::isDigit).takeLast(9)
        val y = b.filter(Char::isDigit).takeLast(9)
        return x.length >= 6 && x == y
    }

    fun matches(sent: List<Sent>, address: String, text: String, at: Long): Boolean =
        sent.any { sameNumber(it.number, address) && it.text.trim() == text.trim() && kotlin.math.abs(at - it.at) <= WINDOW_MS }

    /** The list with one more, the oldest beyond KEEP dropped. */
    fun add(sent: List<Sent>, item: Sent): List<Sent> = (sent + item).takeLast(KEEP)

    fun parse(json: String): List<Sent> = try {
        val array = JSONArray(json.ifBlank { "[]" })
        (0 until array.length()).map { array.getJSONObject(it) }.map { Sent(it.getString("n"), it.getString("t"), it.getLong("a")) }
    } catch (error: org.json.JSONException) {
        emptyList()
    }

    fun format(sent: List<Sent>): String =
        JSONArray(sent.map { JSONObject().put("n", it.number).put("t", it.text).put("a", it.at) }).toString()
}
