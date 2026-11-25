package pl.sekond.stream.phone

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.database.ContentObserver
import android.net.ConnectivityManager
import android.net.Network
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.provider.CallLog
import android.provider.Telephony
import org.json.JSONObject
import java.io.IOException

/**
 * Keeps the companion awake (CONCEPT.md §8.1, 2026-11-25): a foreground service with a quiet notification. It holds
 * one request to the server — /api/phone/actions/next, up to WAIT_S — and sends the SMS that comes back at once; it
 * watches the SMS store and the call log, so a sent SMS or a finished call is uploaded without waiting for the tick.
 * Started by the app, after a reboot or an update (BootReceiver) and by the 15-minute tick when Android stopped it.
 */
class LinkService : Service() {
    @Volatile private var running = true
    private lateinit var settings: Settings
    private val main = Handler(Looper.getMainLooper())
    private val lock = Object()
    private var poller: Thread? = null
    private var watching = false

    private val syncSoon = Runnable { Sync.soon(this) }
    private val observer = object : ContentObserver(main) {
        // Android announces each change several times: one sync a few seconds after the last.
        override fun onChange(selfChange: Boolean) {
            main.removeCallbacks(syncSoon)
            main.postDelayed(syncSoon, 3_000)
        }
    }
    private val network = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) = wake()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        settings = Settings(this)
        goForeground()
        watch()
        getSystemService(ConnectivityManager::class.java).registerDefaultNetworkCallback(network)
        poller = Thread(::poll, "stream-link").apply { isDaemon = true; start() }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        watch() // permissions may have been granted since
        wake()
        return START_STICKY
    }

    override fun onDestroy() {
        running = false
        wake()
        contentResolver.unregisterContentObserver(observer)
        runCatching { getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(network) }
        main.removeCallbacks(syncSoon)
        super.onDestroy()
    }

    /** The SMS store and the call log, once their permissions are granted. */
    private fun watch() {
        if (watching) return
        val read = listOf(Manifest.permission.READ_SMS, Manifest.permission.READ_CALL_LOG)
        if (read.any { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }) return
        watching = runCatching {
            contentResolver.registerContentObserver(Telephony.Sms.CONTENT_URI, true, observer)
            contentResolver.registerContentObserver(CallLog.Calls.CONTENT_URI, true, observer)
        }.isSuccess
    }

    private fun goForeground() {
        val manager = getSystemService(NotificationManager::class.java)
        val channel = NotificationChannel(CHANNEL, getString(R.string.channel_link), NotificationManager.IMPORTANCE_MIN)
        channel.description = getString(R.string.channel_link_description)
        channel.setShowBadge(false)
        manager.createNotificationChannel(channel)
        val open = PendingIntent.getActivity(this, 0, Intent(this, SettingsActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val notification = Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_call)
            .setContentTitle(getString(R.string.link_title))
            .setContentText(getString(R.string.link_text))
            .setContentIntent(open)
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun wake() = synchronized(lock) { lock.notifyAll() }

    private fun pause(ms: Long) = synchronized(lock) { if (running) lock.wait(ms) }

    /** One request at a time; after trouble a growing pause, cut short when the network comes back. */
    private fun poll() {
        var backoff = MIN_BACKOFF_MS
        while (running) {
            if (settings.token.isBlank()) { pause(10 * 60_000L); continue }
            try {
                val response = Api(settings).nextAction(WAIT_S)
                settings.lastPollAt = System.currentTimeMillis()
                when {
                    response.status == 200 -> { backoff = MIN_BACKOFF_MS; handle(JSONObject(response.body)) }
                    response.status == 204 -> backoff = MIN_BACKOFF_MS
                    response.status == 401 -> { settings.lastError = "Сервер не принял токен телефона"; pause(10 * 60_000L) }
                    else -> { pause(backoff); backoff = (backoff * 2).coerceAtMost(MAX_BACKOFF_MS) }
                }
            } catch (error: IOException) {
                pause(backoff)
                backoff = (backoff * 2).coerceAtMost(MAX_BACKOFF_MS)
            } catch (error: org.json.JSONException) {
                pause(backoff)
            }
        }
    }

    private fun handle(action: JSONObject) {
        val id = action.getString("id")
        val number = action.optString("number")
        val text = action.optString("text")
        val wakeLock = getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "stream:sms")
        wakeLock.acquire(30_000)
        try {
            when {
                !settings.sendSmsOn -> Sync.report(this, id, "failed", "На телефоне выключена отправка SMS из Stream")
                checkSelfPermission(Manifest.permission.SEND_SMS) != PackageManager.PERMISSION_GRANTED ->
                    Sync.report(this, id, "failed", "Нет разрешения на отправку SMS — «Выдать разрешения» в приложении")
                else -> SmsSender.send(this, id, number, text)
            }
        } finally {
            wakeLock.release()
        }
    }

    companion object {
        private const val CHANNEL = "link"
        private const val NOTIFICATION_ID = 1
        private const val WAIT_S = 50
        private const val MIN_BACKOFF_MS = 5_000L
        private const val MAX_BACKOFF_MS = 5 * 60_000L

        /** Starts the link if it is not running; Android may refuse from the background — the next tick tries again. */
        fun start(context: Context) {
            try {
                context.startForegroundService(Intent(context, LinkService::class.java))
            } catch (error: IllegalStateException) {
                // ForegroundServiceStartNotAllowedException: the app is in the background and not exempt from battery saving.
            } catch (error: SecurityException) {
                // A missing foreground-service permission on an unusual build: the tick and receivers still work.
            }
        }
    }
}

/** After a reboot or an update of the app: the tick and the link start again without opening the app. */
class BootReceiver : android.content.BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        Sync.schedulePeriodic(context)
        LinkService.start(context)
        Sync.soon(context, 10)
    }
}
