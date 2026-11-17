package pl.sekond.stream.phone

import android.app.NotificationManager
import android.app.RemoteInput
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.telephony.TelephonyManager
import java.util.UUID

/** A call ended: the call log row appears a moment later, so read it after a short pause. */
class PhoneStateReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != TelephonyManager.ACTION_PHONE_STATE_CHANGED) return
        if (intent.getStringExtra(TelephonyManager.EXTRA_STATE) == TelephonyManager.EXTRA_STATE_IDLE) Sync.soon(context, 3)
    }
}

/** An SMS arrived: it is in the SMS store a moment later. */
class SmsReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == "android.provider.Telephony.SMS_RECEIVED") Sync.soon(context, 2)
    }
}

/** The answer typed (or dictated) in the after-call notification, or "not needed". */
class ReplyReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val notificationId = intent.getIntExtra(EXTRA_NOTIFICATION_ID, 0)
        val manager = context.getSystemService(NotificationManager::class.java)
        if (intent.action == ACTION_DISMISS) { manager.cancel(notificationId); return }
        val callId = intent.getStringExtra(EXTRA_CALL_ID) ?: return
        val text = RemoteInput.getResultsFromIntent(intent)?.getCharSequence(Notifier.KEY_NOTE)?.toString()?.trim()
        if (text.isNullOrEmpty()) { manager.cancel(notificationId); return }
        Sync.note(context, callId, UUID.randomUUID().toString(), text, System.currentTimeMillis())
        Notifier.saved(context, notificationId)
    }

    companion object {
        const val ACTION_REPLY = "pl.sekond.stream.phone.REPLY"
        const val ACTION_DISMISS = "pl.sekond.stream.phone.DISMISS"
        const val EXTRA_CALL_ID = "call_id"
        const val EXTRA_NOTIFICATION_ID = "notification_id"
    }
}
