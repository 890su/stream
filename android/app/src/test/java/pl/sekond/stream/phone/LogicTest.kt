package pl.sekond.stream.phone

import android.provider.CallLog
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LogicTest {
    @Test
    fun idsMatchTheServer() {
        // Same reference value as test/phone.test.ts (PINNED_CALL_ID).
        assertEquals("05114e8c-8aed-5940-9d5c-12bf73695f7e", PhoneIds.fromKey("call|+48500000001|1794900000000"))
        assertEquals("call|+48500000001|1794900000000", PhoneIds.callKey(" +48500000001 ", 1794900000000))
        assertEquals("sms|in|+48500000002|1794900000000|Буду в 10", PhoneIds.smsKey("in", "+48500000002", 1794900000000, "Буду в 10"))
    }

    @Test
    fun callLogTypesBecomeDirections() {
        assertEquals("in", CallMapping.direction(CallLog.Calls.INCOMING_TYPE))
        assertEquals("out", CallMapping.direction(CallLog.Calls.OUTGOING_TYPE))
        assertEquals("missed", CallMapping.direction(CallLog.Calls.MISSED_TYPE))
        assertEquals("rejected", CallMapping.direction(CallLog.Calls.REJECTED_TYPE))
        assertEquals("rejected", CallMapping.direction(CallLog.Calls.BLOCKED_TYPE))
        assertEquals("unknown", CallMapping.direction(99))
    }

    @Test
    fun onlyFreshConversationsAreNotified() {
        val ended = 1_000_000_000L
        assertTrue(CallMapping.shouldNotify("in", 30, ended, ended + 5_000))
        assertTrue(CallMapping.shouldNotify("out", 30, ended, ended + 9 * 60_000))
        assertFalse(CallMapping.shouldNotify("missed", 0, ended, ended + 5_000))
        assertFalse(CallMapping.shouldNotify("in", 0, ended, ended + 5_000))
        assertFalse(CallMapping.shouldNotify("out", 30, ended, ended + 11 * 60_000))
    }

    @Test
    fun smsFromServicesAndShortCodesStayOnThePhone() {
        val none = emptySet<String>()
        assertTrue(SmsFilter.accept("+48 500 000 003", none))
        assertTrue(SmsFilter.accept("500000003", none))
        assertFalse(SmsFilter.accept("mBank", none))
        assertFalse(SmsFilter.accept("DHL", none))
        assertFalse(SmsFilter.accept("7911", none))
        assertFalse(SmsFilter.accept("", none))
        val excluded = SmsFilter.parseExclusions("+48 500 000 004, 123")
        assertEquals(setOf("48500000004"), excluded)
        assertFalse(SmsFilter.accept("500000004", excluded))
        assertTrue(SmsFilter.accept("500000005", excluded))
    }

    @Test
    fun bodiesLeaveOutEmptyFields() {
        val call = Payloads.call("missed", " ", null, 1794900000000, 0, "")
        assertEquals("", call.getString("number"))
        assertFalse(call.has("name"))
        assertFalse(call.has("sim"))
        assertEquals("2026-11-17T07:20:00Z", call.getString("started_at"))
        val note = Payloads.note("a417e1bb-4e69-41e0-9851-cd9ffd588c63", "Договорились", 1794900120000)
        assertEquals(1794900120000, note.getLong("written_at"))
    }
}
