package pl.sekond.stream.phone

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.provider.CallLog
import android.provider.Telephony
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.io.IOException

/**
 * Reads the call log and SMS rows newer than the last one sent and posts them in order. The row pointer moves
 * only after the server accepted a row (or the row is skipped on purpose), so nothing is lost when offline.
 * The first run only sets the pointer: history from before the companion is not uploaded.
 */
class SyncWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    private val settings = Settings(context)
    private val api = Api(settings)

    /** The server refused for good (wrong token): stop this run, keep the rows for later. */
    private class Refused(message: String) : Exception(message)
    /** Worth another try later: server trouble, or a row Android is still sending. */
    private class Later : Exception()

    override fun doWork(): Result {
        if (settings.token.isBlank()) return Result.success()
        return try {
            if (settings.callsOn && granted(Manifest.permission.READ_CALL_LOG)) syncCalls()
            if (settings.smsOn && granted(Manifest.permission.READ_SMS)) syncSms()
            settings.lastError = ""
            Result.success()
        } catch (error: IOException) {
            settings.lastError = "Нет связи с сервером"
            Result.retry()
        } catch (error: Later) {
            Result.retry()
        } catch (error: Refused) {
            settings.lastError = error.message ?: "Сервер отказал"
            Result.success()
        }
    }

    private fun granted(permission: String) =
        applicationContext.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED

    private fun latestRow(uri: android.net.Uri): Long =
        applicationContext.contentResolver.query(uri, arrayOf("_id"), null, null, "_id DESC")?.use { cursor ->
            if (cursor.moveToFirst()) cursor.getLong(0) else 0L
        } ?: 0L

    /** Posts a row; true = accepted, false = skipped for good (bad data). */
    private fun accept(response: Api.Response): Boolean {
        when {
            response.ok -> { settings.lastSentAt = System.currentTimeMillis(); return true }
            response.status == 401 -> throw Refused("Сервер не принял токен телефона")
            response.retryable -> throw Later()
            else -> { settings.lastError = "Сервер отклонил запись (${response.status})"; return false }
        }
    }

    private fun syncCalls() {
        if (settings.lastCallRow < 0) { settings.lastCallRow = latestRow(CallLog.Calls.CONTENT_URI); return }
        val columns = arrayOf(
            CallLog.Calls._ID, CallLog.Calls.TYPE, CallLog.Calls.NUMBER, CallLog.Calls.CACHED_NAME,
            CallLog.Calls.DATE, CallLog.Calls.DURATION, CallLog.Calls.PHONE_ACCOUNT_ID,
        )
        applicationContext.contentResolver.query(
            CallLog.Calls.CONTENT_URI, columns, "${CallLog.Calls._ID} > ?", arrayOf(settings.lastCallRow.toString()), "${CallLog.Calls._ID} ASC",
        )?.use { cursor ->
            while (cursor.moveToNext()) {
                val row = cursor.getLong(0)
                val direction = CallMapping.direction(cursor.getInt(1))
                val number = cursor.getString(2) ?: ""
                val name = cursor.getString(3)
                val started = cursor.getLong(4)
                val duration = cursor.getLong(5)
                accept(api.postCall(Payloads.call(direction, number, name, started, duration, cursor.getString(6))))
                settings.lastCallRow = row
                if (CallMapping.shouldNotify(direction, duration, started + duration * 1000, System.currentTimeMillis())) {
                    Notifier.afterCall(applicationContext, row.toInt(), PhoneIds.fromKey(PhoneIds.callKey(number, started)), direction, duration, name, number)
                }
            }
        }
    }

    private fun syncSms() {
        if (settings.lastSmsRow < 0) { settings.lastSmsRow = latestRow(Telephony.Sms.CONTENT_URI); return }
        val columns = arrayOf(Telephony.Sms._ID, Telephony.Sms.TYPE, Telephony.Sms.ADDRESS, Telephony.Sms.DATE, Telephony.Sms.BODY, Telephony.Sms.SUBSCRIPTION_ID)
        val exclusions = settings.exclusions
        val sentHere = settings.sentSms
        applicationContext.contentResolver.query(
            Telephony.Sms.CONTENT_URI, columns, "${Telephony.Sms._ID} > ?", arrayOf(settings.lastSmsRow.toString()), "${Telephony.Sms._ID} ASC",
        )?.use { cursor ->
            while (cursor.moveToNext()) {
                val row = cursor.getLong(0)
                val type = cursor.getInt(1)
                // Still being sent: stop here so the row is read again once Android marks it sent.
                if (type == Telephony.Sms.MESSAGE_TYPE_OUTBOX || type == Telephony.Sms.MESSAGE_TYPE_QUEUED) return
                val direction = when (type) {
                    Telephony.Sms.MESSAGE_TYPE_INBOX -> "in"
                    Telephony.Sms.MESSAGE_TYPE_SENT -> "out"
                    else -> null // drafts and failed messages never left the phone
                }
                val address = cursor.getString(2) ?: ""
                val text = cursor.getString(4) ?: ""
                // An SMS this companion sent for Stream is in the journal already, as the reply (SmsEcho).
                val echo = direction == "out" && SmsEcho.matches(sentHere, address, text, cursor.getLong(3))
                if (direction != null && !echo && text.isNotBlank() && SmsFilter.accept(address, exclusions)) {
                    accept(api.postSms(Payloads.sms(direction, address, cursor.getLong(3), text, cursor.getString(5))))
                }
                settings.lastSmsRow = row
            }
        }
    }
}
