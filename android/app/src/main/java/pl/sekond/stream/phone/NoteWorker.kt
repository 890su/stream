package pl.sekond.stream.phone

import android.content.Context
import androidx.work.Data
import androidx.work.Worker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import java.io.IOException

/**
 * Sends the owner's answer to "what was the call about?". It may run before its call reached the server
 * (written offline): the server answers 404 and the note waits for the call.
 */
class NoteWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        val settings = Settings(applicationContext)
        val callId = inputData.getString(CALL_ID) ?: return Result.failure()
        val body = Payloads.note(inputData.getString(NOTE_ID)!!, inputData.getString(TEXT)!!, inputData.getLong(WRITTEN_AT, System.currentTimeMillis()))
        return try {
            val response = Api(settings).postNote(callId, body)
            when {
                response.ok -> { settings.lastSentAt = System.currentTimeMillis(); Result.success() }
                response.retryable -> Result.retry()
                else -> { settings.lastError = "Описание не принято (${response.status})"; Result.failure() }
            }
        } catch (error: IOException) {
            Result.retry()
        }
    }

    companion object {
        private const val CALL_ID = "call_id"
        private const val NOTE_ID = "note_id"
        private const val TEXT = "text"
        private const val WRITTEN_AT = "written_at"

        fun input(callId: String, noteId: String, text: String, writtenAt: Long): Data =
            workDataOf(CALL_ID to callId, NOTE_ID to noteId, TEXT to text, WRITTEN_AT to writtenAt)
    }
}
