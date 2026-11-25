package pl.sekond.stream.phone

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/**
 * All sending goes through one unique work chain ("sync"), so two syncs never read the same rows at once.
 * Triggers: the end of a call, an incoming SMS, a change in the SMS store or call log (LinkService), the 15-minute
 * tick, the settings screen.
 */
object Sync {
    private val online = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

    fun soon(context: Context, delaySeconds: Long = 0) {
        val request = OneTimeWorkRequestBuilder<SyncWorker>()
            .setInitialDelay(delaySeconds, TimeUnit.SECONDS)
            .setConstraints(online)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork("sync", ExistingWorkPolicy.APPEND_OR_REPLACE, request)
    }

    /** Catches what the receivers missed (app asleep, reboot) and sent SMS, which Android does not announce. */
    fun schedulePeriodic(context: Context) {
        val tick = PeriodicWorkRequestBuilder<TickWorker>(15, TimeUnit.MINUTES).build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork("tick", ExistingPeriodicWorkPolicy.KEEP, tick)
    }

    /** The result of an SMS Stream asked for, one report per action (ReportWorker). */
    fun report(context: Context, actionId: String, status: String, error: String?) {
        val request = OneTimeWorkRequestBuilder<ReportWorker>()
            .setInputData(ReportWorker.input(actionId, status, error))
            .setConstraints(online)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork("report|$actionId", ExistingWorkPolicy.KEEP, request)
    }

    fun note(context: Context, callId: String, noteId: String, text: String, writtenAt: Long) {
        val request = OneTimeWorkRequestBuilder<NoteWorker>()
            .setInputData(NoteWorker.input(callId, noteId, text, writtenAt))
            .setConstraints(online)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context).enqueue(request)
    }
}

/** Every 15 minutes: send what was missed and bring the link back if Android stopped it. */
class TickWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        LinkService.start(applicationContext)
        Sync.soon(applicationContext)
        return Result.success()
    }
}
