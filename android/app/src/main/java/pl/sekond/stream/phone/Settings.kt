package pl.sekond.stream.phone

import android.content.Context
import androidx.core.content.edit

/** Everything the companion remembers, app-private (allowBackup=false keeps the token off cloud backups). */
class Settings(context: Context) {
    private val prefs = context.getSharedPreferences("stream_phone", Context.MODE_PRIVATE)

    var server: String
        get() = prefs.getString("server", DEFAULT_SERVER)!!
        set(value) = prefs.edit { putString("server", value.trim().trimEnd('/').ifEmpty { DEFAULT_SERVER }) }
    var token: String
        get() = prefs.getString("token", "")!!
        set(value) = prefs.edit { putString("token", value.trim()) }
    var callsOn: Boolean
        get() = prefs.getBoolean("calls_on", true)
        set(value) = prefs.edit { putBoolean("calls_on", value) }
    var smsOn: Boolean
        get() = prefs.getBoolean("sms_on", true)
        set(value) = prefs.edit { putBoolean("sms_on", value) }
    var exclusionsText: String
        get() = prefs.getString("sms_exclusions", "")!!
        set(value) = prefs.edit { putString("sms_exclusions", value) }
    val exclusions: Set<String> get() = SmsFilter.parseExclusions(exclusionsText)

    /** Last call log / SMS row already in the journal; -1 until the first sync sets the starting point. */
    var lastCallRow: Long
        get() = prefs.getLong("last_call_row", -1)
        set(value) = prefs.edit { putLong("last_call_row", value) }
    var lastSmsRow: Long
        get() = prefs.getLong("last_sms_row", -1)
        set(value) = prefs.edit { putLong("last_sms_row", value) }

    var lastSentAt: Long
        get() = prefs.getLong("last_sent_at", 0)
        set(value) = prefs.edit { putLong("last_sent_at", value) }
    var lastError: String
        get() = prefs.getString("last_error", "")!!
        set(value) = prefs.edit { putString("last_error", value) }

    companion object {
        const val DEFAULT_SERVER = "https://stream.sekond.pl"
    }
}
