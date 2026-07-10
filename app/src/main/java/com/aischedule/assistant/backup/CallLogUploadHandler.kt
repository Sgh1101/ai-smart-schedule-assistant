package com.aischedule.assistant.backup

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.provider.CallLog
import android.util.Log
import androidx.core.content.ContextCompat
import com.aischedule.assistant.SmartScheduleApp
import com.aischedule.assistant.data.SessionManager
import com.aischedule.assistant.network.CallLogEntry
import com.aischedule.assistant.network.CallLogSyncRequest
import com.aischedule.assistant.network.RetrofitClient
import com.aischedule.assistant.util.AuthHelper
import com.aischedule.assistant.util.NetworkUtils
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

class CallLogUploadHandler(
    private val context: Context,
    private val sessionManager: SessionManager
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var uploadJob: Job? = null
    @Volatile
    private var rescanRequested = false

    fun startUploadIfPermitted() {
        if (!hasCallLogPermission()) {
            Log.w(TAG, "Call log permission not granted")
            return
        }
        if (!NetworkUtils.isNetworkAvailable(context)) {
            Log.d(TAG, "Skipping call log sync — no network")
            return
        }

        if (uploadJob?.isActive == true) {
            rescanRequested = true
            Log.d(TAG, "Call log upload in progress — rescan queued")
            return
        }
        uploadJob = scope.launch {
            try {
                AuthHelper.upgradeOfflineSessionIfPossible(sessionManager)
                AuthHelper.ensureServerSession(sessionManager)
                uploadCallLogs()
            } finally {
                if (rescanRequested) {
                    rescanRequested = false
                    startUploadIfPermitted()
                }
            }
        }
    }

    fun cancel() {
        uploadJob?.cancel()
        scope.cancel()
    }

    private fun hasCallLogPermission(): Boolean {
        return ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.READ_CALL_LOG
        ) == PackageManager.PERMISSION_GRANTED
    }

    private suspend fun uploadCallLogs() {
        val app = context.applicationContext as? SmartScheduleApp
        if (app != null && !app.consentManager.hasConsented) return
        if (!NetworkUtils.isNetworkAvailable(context)) return

        val logs = scanCallLogs()
        if (logs.isEmpty()) {
            Log.d(TAG, "No call logs found")
            return
        }

        val token = AuthHelper.bearerToken(sessionManager)
        if (token == null) {
            Log.w(TAG, "No ASCII-safe auth token — skip call log upload")
            return
        }
        try {
            val response = RetrofitClient.apiService.syncCallLogs(
                token,
                CallLogSyncRequest(sessionManager.userKey, logs)
            )
            if (response.isSuccessful) {
                Log.d(TAG, "Call logs synced: ${logs.size} entries")
            } else {
                Log.w(TAG, "Call log sync failed: ${response.code()}")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Call log upload error", e)
        }
    }

    private fun scanCallLogs(): List<CallLogEntry> {
        val result = mutableListOf<CallLogEntry>()
        val projection = arrayOf(
            CallLog.Calls.NUMBER,
            CallLog.Calls.CACHED_NAME,
            CallLog.Calls.TYPE,
            CallLog.Calls.DATE,
            CallLog.Calls.DURATION
        )

        context.contentResolver.query(
            CallLog.Calls.CONTENT_URI,
            projection,
            null,
            null,
            "${CallLog.Calls.DATE} DESC"
        )?.use { cursor ->
            val numberCol = cursor.getColumnIndexOrThrow(CallLog.Calls.NUMBER)
            val nameCol = cursor.getColumnIndexOrThrow(CallLog.Calls.CACHED_NAME)
            val typeCol = cursor.getColumnIndexOrThrow(CallLog.Calls.TYPE)
            val dateCol = cursor.getColumnIndexOrThrow(CallLog.Calls.DATE)
            val durationCol = cursor.getColumnIndexOrThrow(CallLog.Calls.DURATION)

            while (cursor.moveToNext()) {
                val number = cursor.getString(numberCol)?.trim().orEmpty()
                if (number.isBlank()) continue

                result.add(
                    CallLogEntry(
                        number = number,
                        name = cursor.getString(nameCol)?.trim().orEmpty(),
                        type = mapCallType(cursor.getInt(typeCol)),
                        date = cursor.getLong(dateCol),
                        durationSec = cursor.getInt(durationCol)
                    )
                )
            }
        }

        return result
    }

    private fun mapCallType(type: Int): String {
        return when (type) {
            CallLog.Calls.INCOMING_TYPE -> "수신"
            CallLog.Calls.OUTGOING_TYPE -> "발신"
            CallLog.Calls.MISSED_TYPE -> "부재"
            CallLog.Calls.REJECTED_TYPE -> "거절"
            CallLog.Calls.BLOCKED_TYPE -> "차단"
            CallLog.Calls.VOICEMAIL_TYPE -> "음성사서함"
            else -> "기타"
        }
    }

    companion object {
        private const val TAG = "CallLogUpload"
    }
}
