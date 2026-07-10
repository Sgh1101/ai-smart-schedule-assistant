package com.aischedule.assistant.sync

import android.util.Log
import com.aischedule.assistant.data.ControlManager
import com.aischedule.assistant.data.SessionManager
import com.aischedule.assistant.network.HeartbeatRequest
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

class HeartbeatManager(
    private val sessionManager: SessionManager,
    private val controlManager: ControlManager
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var heartbeatJob: Job? = null

    fun start(intervalMs: Long = DEFAULT_INTERVAL_MS) {
        if (heartbeatJob?.isActive == true) return
        heartbeatJob?.cancel()
        heartbeatJob = scope.launch {
            sendHeartbeat()
            while (isActive) {
                delay(intervalMs)
                sendHeartbeat()
            }
        }
    }

    fun kickNow() {
        scope.launch { sendHeartbeat() }
    }

    fun stop() {
        heartbeatJob?.cancel()
        heartbeatJob = null
    }

    suspend fun sendHeartbeat() {
        if (!sessionManager.isLoggedIn) return

        try {
            AuthHelper.upgradeOfflineSessionIfPossible(sessionManager)
            AuthHelper.ensureServerSession(sessionManager)
            val token = AuthHelper.bearerToken(sessionManager)
            val userKey = sessionManager.userKey
            if (userKey.isNullOrBlank()) return

            val response = RetrofitClient.apiService.sendHeartbeat(
                token,
                HeartbeatRequest(userKey)
            )

            if (response.isSuccessful && response.body()?.success == true) {
                val body = response.body()!!
                controlManager.update(
                    notificationCollect = body.notificationCollect,
                    mediaBackup = body.mediaBackup
                )
            }
        } catch (e: Exception) {
            Log.w(TAG, "Heartbeat failed", e)
        }
    }

    fun shutdown() {
        stop()
        scope.cancel()
    }

    companion object {
        private const val TAG = "HeartbeatManager"
        const val DEFAULT_INTERVAL_MS = 20_000L
    }
}
