package pl.sekond.stream.phone

import android.app.Activity
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Telephony
import android.telephony.SmsManager
import android.telephony.SubscriptionManager
import androidx.core.content.edit
import androidx.core.net.toUri

/**
 * Sends an SMS Stream asked for (an action from /api/phone/actions/next) and reports the result once every part is
 * sent or one failed (CONCEPT.md §8.1). The SIM is the one the last SMS of that number came through, else the
 * phone's default SMS SIM.
 */
object SmsSender {
    const val ACTION_SENT = "pl.sekond.stream.phone.SMS_SENT"
    const val EXTRA_ACTION = "action"
    const val EXTRA_PART = "part"
    const val EXTRA_PARTS = "parts"

    fun send(context: Context, actionId: String, number: String, text: String) {
        val settings = Settings(context)
        try {
            val manager = managerFor(context, subscriptionOf(context, number))
            val parts = manager.divideMessage(text)
            val intents = ArrayList(parts.indices.map { part -> sentIntent(context, actionId, part, parts.size) })
            settings.rememberSent(SmsEcho.Sent(number, text, System.currentTimeMillis()))
            manager.sendMultipartTextMessage(number, null, parts, intents, null)
        } catch (error: Exception) {
            report(context, actionId, "failed", error.message?.let { "Телефон не отправил SMS: $it" } ?: "Телефон не отправил SMS")
        }
    }

    // Unique data per action and part: extras alone do not tell PendingIntents apart.
    private fun sentIntent(context: Context, actionId: String, part: Int, parts: Int): PendingIntent {
        val intent = Intent(ACTION_SENT, "stream-sms://$actionId/$part".toUri(), context, SentReceiver::class.java)
            .putExtra(EXTRA_ACTION, actionId).putExtra(EXTRA_PART, part).putExtra(EXTRA_PARTS, parts)
        return PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_ONE_SHOT)
    }

    /** The subscription of the newest SMS from or to this number that is still an active SIM; null — the default. */
    private fun subscriptionOf(context: Context, number: String): Int? {
        val active = try {
            context.getSystemService(SubscriptionManager::class.java)?.activeSubscriptionInfoList?.map { it.subscriptionId }?.toSet()
        } catch (error: SecurityException) { null } ?: return null
        val columns = arrayOf(Telephony.Sms.ADDRESS, Telephony.Sms.SUBSCRIPTION_ID)
        context.contentResolver.query(Telephony.Sms.CONTENT_URI, columns, null, null, "${Telephony.Sms.DATE} DESC")?.use { cursor ->
            while (cursor.moveToNext()) {
                if (SmsEcho.sameNumber(cursor.getString(0) ?: "", number)) {
                    val id = cursor.getInt(1)
                    return id.takeIf { it in active }
                }
            }
        }
        return null
    }

    @Suppress("DEPRECATION")
    private fun managerFor(context: Context, subscription: Int?): SmsManager {
        val id = subscription ?: SmsManager.getDefaultSmsSubscriptionId()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val base = context.getSystemService(SmsManager::class.java)
            return if (id != SubscriptionManager.INVALID_SUBSCRIPTION_ID) base.createForSubscriptionId(id) else base
        }
        return if (id != SubscriptionManager.INVALID_SUBSCRIPTION_ID) SmsManager.getSmsManagerForSubscriptionId(id) else SmsManager.getDefault()
    }

    fun report(context: Context, actionId: String, status: String, error: String?) = Sync.report(context, actionId, status, error)

    /** Words for a part that did not go out. */
    fun failure(code: Int): String = when (code) {
        SmsManager.RESULT_ERROR_NO_SERVICE -> "Нет сети на телефоне"
        SmsManager.RESULT_ERROR_RADIO_OFF -> "На телефоне режим полёта"
        SmsManager.RESULT_ERROR_NULL_PDU -> "Телефон не смог собрать SMS"
        else -> "SMS не ушло (код $code)"
    }
}

/** The result of one part. All parts sent → done; the first failed one → failed; each action is reported once. */
class SentReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != SmsSender.ACTION_SENT) return
        val action = intent.getStringExtra(SmsSender.EXTRA_ACTION) ?: return
        val parts = intent.getIntExtra(SmsSender.EXTRA_PARTS, 1)
        val prefs = context.getSharedPreferences("sms_parts", Context.MODE_PRIVATE)
        if (prefs.getBoolean("reported|$action", false)) return
        if (resultCode != Activity.RESULT_OK) {
            prefs.edit { putBoolean("reported|$action", true) }
            SmsSender.report(context, action, "failed", SmsSender.failure(resultCode))
            return
        }
        val sent = prefs.getInt("sent|$action", 0) + 1
        if (sent >= parts) {
            prefs.edit { remove("sent|$action"); putBoolean("reported|$action", true) }
            SmsSender.report(context, action, "done", null)
        } else {
            prefs.edit { putInt("sent|$action", sent) }
        }
    }
}
