package pl.sekond.stream.phone

import java.security.MessageDigest

/**
 * Event ids derived from the call or SMS itself, exactly as src/server/phone.ts derives them, so the phone
 * knows a call's id before the server has seen it and a retry or reinstall never writes a call twice.
 */
object PhoneIds {
    fun fromKey(key: String): String {
        val bytes = MessageDigest.getInstance("SHA-256").digest(key.toByteArray(Charsets.UTF_8)).copyOf(16)
        bytes[6] = ((bytes[6].toInt() and 0x0f) or 0x50).toByte()
        bytes[8] = ((bytes[8].toInt() and 0x3f) or 0x80).toByte()
        val hex = bytes.joinToString("") { "%02x".format(it) }
        return "${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}"
    }

    fun callKey(number: String, startedMs: Long) = "call|${number.trim()}|$startedMs"

    fun smsKey(direction: String, number: String, sentMs: Long, text: String) = "sms|$direction|${number.trim()}|$sentMs|$text"
}
