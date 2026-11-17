package pl.sekond.stream.phone

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings as SystemSettings
import android.text.format.DateUtils
import android.widget.Button
import android.widget.EditText
import android.widget.Switch
import android.widget.TextView
import androidx.core.net.toUri
import java.io.IOException

/** The only screen: server, phone token, permissions, battery, SMS exclusions and what happened last. */
class SettingsActivity : Activity() {
    private lateinit var settings: Settings
    // Notifications need a runtime permission only from Android 13.
    private val permissions = listOfNotNull(
        Manifest.permission.READ_CALL_LOG, Manifest.permission.READ_PHONE_STATE,
        Manifest.permission.READ_SMS, Manifest.permission.RECEIVE_SMS,
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) Manifest.permission.POST_NOTIFICATIONS else null,
    ).toTypedArray()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)
        settings = Settings(this)
        find<EditText>(R.id.server).setText(settings.server)
        find<EditText>(R.id.token).setText(settings.token)
        find<Switch>(R.id.calls).isChecked = settings.callsOn
        find<Switch>(R.id.sms).isChecked = settings.smsOn
        find<EditText>(R.id.exclusions).setText(settings.exclusionsText)
        find<Button>(R.id.save).setOnClickListener { save(); check() }
        find<Button>(R.id.permissions).setOnClickListener { requestPermissions(permissions, 1) }
        find<Button>(R.id.battery).setOnClickListener {
            startActivity(Intent(SystemSettings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, "package:$packageName".toUri()))
        }
        find<Button>(R.id.app_info).setOnClickListener {
            startActivity(Intent(SystemSettings.ACTION_APPLICATION_DETAILS_SETTINGS, "package:$packageName".toUri()))
        }
    }

    override fun onResume() {
        super.onResume()
        showState()
    }

    override fun onPause() {
        super.onPause()
        save()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        showState()
        Sync.soon(this) // sets the starting point in the call log and SMS store
    }

    private fun <T : android.view.View> find(id: Int): T = findViewById(id)

    private fun save() {
        settings.server = find<EditText>(R.id.server).text.toString()
        settings.token = find<EditText>(R.id.token).text.toString()
        settings.callsOn = find<Switch>(R.id.calls).isChecked
        settings.smsOn = find<Switch>(R.id.sms).isChecked
        settings.exclusionsText = find<EditText>(R.id.exclusions).text.toString()
    }

    /** "Проверить связь": the phone token against /api/phone/ping, off the main thread. */
    private fun check() {
        val result = find<TextView>(R.id.check_result)
        result.text = getString(R.string.checking)
        Thread {
            val text = try {
                val response = Api(settings).ping()
                when {
                    response.ok -> getString(R.string.check_ok)
                    response.status == 401 -> getString(R.string.check_token)
                    else -> getString(R.string.check_server, response.status)
                }
            } catch (error: IOException) {
                getString(R.string.check_offline)
            }
            runOnUiThread { result.text = text; if (text == getString(R.string.check_ok)) Sync.soon(this) }
        }.start()
    }

    private fun showState() {
        val missing = permissions.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        find<TextView>(R.id.permissions_state).text =
            if (missing.isEmpty()) getString(R.string.permissions_ok) else getString(R.string.permissions_missing, missing.size)
        val power = getSystemService(PowerManager::class.java)
        find<TextView>(R.id.battery_state).text = getString(
            if (power.isIgnoringBatteryOptimizations(packageName)) R.string.battery_ok else R.string.battery_saving,
        )
        val last = settings.lastSentAt
        val sent = if (last == 0L) getString(R.string.never) else DateUtils.getRelativeTimeSpanString(last).toString()
        val error = settings.lastError
        find<TextView>(R.id.status).text = getString(R.string.status, sent) + if (error.isNotEmpty()) "\n$error" else ""
    }
}
