package pl.sekond.stream.phone

import android.content.Context
import androidx.work.Data
import androidx.work.Worker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import org.json.JSONObject
import java.io.IOException

/**
 * Tells the server how an SMS it asked for went: done or failed with the reason (CONCEPT.md §8.1). Kept until the
 * server has it; an action the server no longer knows (404) is dropped.
 */
class ReportWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        val id = inputData.getString(ID) ?: return Result.failure()
        val body = JSONObject().put("status", inputData.getString(STATUS) ?: "failed")
        inputData.getString(ERROR)?.let { body.put("error", it) }
        return try {
            val response = Api(Settings(applicationContext)).reportAction(id, body)
            when {
                response.ok || response.status == 404 -> Result.success()
                response.status == 401 || response.retryable -> Result.retry()
                else -> Result.failure()
            }
        } catch (error: IOException) {
            Result.retry()
        }
    }

    companion object {
        private const val ID = "id"
        private const val STATUS = "status"
        private const val ERROR = "error"

        fun input(id: String, status: String, error: String?): Data = workDataOf(ID to id, STATUS to status, ERROR to error)
    }
}
