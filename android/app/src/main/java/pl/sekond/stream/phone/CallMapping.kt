package pl.sekond.stream.phone

import android.provider.CallLog

/** Call log rows to the server's call directions, and when a call deserves the "what was it about?" prompt. */
object CallMapping {
    const val NOTIFY_WINDOW_MS = 10 * 60_000L

    fun direction(type: Int): String = when (type) {
        CallLog.Calls.INCOMING_TYPE -> "in"
        CallLog.Calls.OUTGOING_TYPE -> "out"
        CallLog.Calls.MISSED_TYPE -> "missed"
        CallLog.Calls.REJECTED_TYPE, CallLog.Calls.BLOCKED_TYPE -> "rejected"
        else -> "unknown"
    }

    /** Only real conversations, and only right after them: calls found later by the periodic sync stay quiet. */
    fun shouldNotify(direction: String, durationS: Long, endedMs: Long, nowMs: Long): Boolean =
        (direction == "in" || direction == "out") && durationS > 0 && nowMs - endedMs in 0..NOTIFY_WINDOW_MS
}
