package pl.sekond.stream.phone

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** An SMS sent for Stream is not uploaded again from the SMS store (CONCEPT.md §8.1, 2026-11-25). Made-up numbers. */
class SmsEchoTest {
    private val sent = SmsEcho.Sent("+48500000002", "Буду в 10", 1_000_000_000L)

    @Test
    fun theSameNumberInAnyForm() {
        assertTrue(SmsEcho.sameNumber("+48 500 000 002", "500000002"))
        assertTrue(SmsEcho.sameNumber("0048500000002", "+48500000002"))
        assertFalse(SmsEcho.sameNumber("+48500000003", "+48500000002"))
        assertFalse(SmsEcho.sameNumber("InPost", "InPost"))
    }

    @Test
    fun onlyTheSameTextToTheSameNumberSoonAfter() {
        val list = listOf(sent)
        assertTrue(SmsEcho.matches(list, "500 000 002", " Буду в 10 ", sent.at + 5_000))
        assertFalse(SmsEcho.matches(list, "500000002", "Буду в 11", sent.at))
        assertFalse(SmsEcho.matches(list, "500000003", "Буду в 10", sent.at))
        assertFalse(SmsEcho.matches(list, "500000002", "Буду в 10", sent.at + SmsEcho.WINDOW_MS + 1), "typed by hand later")
    }

    @Test
    fun theListKeepsTheLatestAndSurvivesBadJson() {
        var list = emptyList<SmsEcho.Sent>()
        repeat(40) { list = SmsEcho.add(list, sent.copy(at = it.toLong())) }
        assertEquals(30, list.size)
        assertEquals(39L, list.last().at)
        assertEquals(list, SmsEcho.parse(SmsEcho.format(list)))
        assertEquals(emptyList<SmsEcho.Sent>(), SmsEcho.parse("{oops"))
        assertEquals(emptyList<SmsEcho.Sent>(), SmsEcho.parse(""))
    }

    private fun assertFalse(value: Boolean, message: String) = org.junit.Assert.assertFalse(message, value)
}
