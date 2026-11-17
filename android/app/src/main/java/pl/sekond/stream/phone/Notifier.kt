package pl.sekond.stream.phone

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.RemoteInput
import android.content.Context
import android.content.Intent

/** "What was the call about?" right after a conversation, answered from the notification shade. */
object Notifier {
    const val CHANNEL = "after_call"
    const val KEY_NOTE = "note"

    fun createChannel(context: Context) {
        val channel = NotificationChannel(CHANNEL, context.getString(R.string.channel_after_call), NotificationManager.IMPORTANCE_HIGH)
        channel.description = context.getString(R.string.channel_after_call_description)
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    private fun title(direction: String, durationS: Long, name: String?, number: String): String {
        val kind = if (direction == "out") "Исходящий" else "Входящий"
        val length = if (durationS < 60) "$durationS с" else "${durationS / 60} мин"
        val who = name?.takeIf { it.isNotBlank() } ?: number.ifBlank { "Скрытый номер" }
        return "$kind · $length · $who"
    }

    fun afterCall(context: Context, notificationId: Int, callId: String, direction: String, durationS: Long, name: String?, number: String) {
        val reply = Intent(context, ReplyReceiver::class.java)
            .setAction(ReplyReceiver.ACTION_REPLY)
            .putExtra(ReplyReceiver.EXTRA_CALL_ID, callId)
            .putExtra(ReplyReceiver.EXTRA_NOTIFICATION_ID, notificationId)
        // Mutable: the system writes the typed answer into this intent.
        val replyIntent = PendingIntent.getBroadcast(context, notificationId, reply, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE)
        val input = RemoteInput.Builder(KEY_NOTE).setLabel(context.getString(R.string.note_hint)).build()
        val describe = Notification.Action.Builder(null, context.getString(R.string.describe), replyIntent).addRemoteInput(input).build()

        val dismiss = Intent(context, ReplyReceiver::class.java)
            .setAction(ReplyReceiver.ACTION_DISMISS)
            .putExtra(ReplyReceiver.EXTRA_NOTIFICATION_ID, notificationId)
        val dismissIntent = PendingIntent.getBroadcast(context, -notificationId - 1, dismiss, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val skip = Notification.Action.Builder(null, context.getString(R.string.not_needed), dismissIntent).build()

        val notification = Notification.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_call)
            .setContentTitle(title(direction, durationS, name, number))
            .setContentText(context.getString(R.string.what_was_it))
            .setCategory(Notification.CATEGORY_REMINDER)
            .setAutoCancel(true)
            .addAction(describe)
            .addAction(skip)
            .build()
        context.getSystemService(NotificationManager::class.java).notify(notificationId, notification)
    }

    /** Replaces the question with a short confirmation that disappears by itself. */
    fun saved(context: Context, notificationId: Int) {
        val notification = Notification.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_call)
            .setContentTitle(context.getString(R.string.saved))
            .setTimeoutAfter(4_000)
            .build()
        context.getSystemService(NotificationManager::class.java).notify(notificationId, notification)
    }
}
