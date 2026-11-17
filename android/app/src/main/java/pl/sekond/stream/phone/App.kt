package pl.sekond.stream.phone

import android.app.Application

class App : Application() {
    override fun onCreate() {
        super.onCreate()
        Notifier.createChannel(this)
        Sync.schedulePeriodic(this)
    }
}
