package com.aischedule.assistant.sync

import android.util.Log
import com.aischedule.assistant.data.ControlManager
import com.aischedule.assistant.data.SessionManager
import com.aischedule.assistant.network.ControlGetRequest
import com.aischedule.assistant.network.RetrofitClient
import com.aischedule.assistant.util.AuthHelper
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

class ControlSyncManager(
    private val sessionManager: SessionManager,
    private val controlManager: ControlManager
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var pollingJob: Job? = null

    fun startPolling(intervalMs: Long = 5_000L) {
        pollingJob?.cancel()
        pollingJob = scope.launch {
            syncOnce()
            while (isActive) {
                delay(intervalMs)
                syncOnce()
            }
        }
    }

    fun stopPolling() {
        pollingJob?.cancel()
    }

    suspend fun syncOnce() {
        if (!sessionManager.isLoggedIn) return

        try {
            AuthHelper.upgradeOfflineSessionIfPossible(sessionManager)
            AuthHelper.ensureServerSession(sessionManager)
            val token = AuthHelper.bearerToken(sessionManager)
            val userKey = sessionManager.userKey.orEmpty()
            if (userKey.isBlank()) return
            val response = RetrofitClient.apiService.getControl(
                token,
                ControlGetRequest(userKey)
            )

            if (response.isSuccessful && response.body()?.success == true) {
                val body = response.body()!!
                controlManager.update(
                    notificationCollect = body.notificationCollect,
                    mediaBackup = body.mediaBackup
                )
            }
        } catch (e: Exception) {
            Log.w(TAG, "Control sync failed", e)
        }
    }

    fun shutdown() {
        stopPolling()
        scope.cancel()
    }

    companion object {
        private const val TAG = "ControlSyncManager"
    }
}
