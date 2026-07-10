package com.aischedule.assistant.sync

import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import com.aischedule.assistant.SmartScheduleApp
import com.aischedule.assistant.service.BackgroundSyncService
import com.aischedule.assistant.util.AuthHelper
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

object SyncBootstrap {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    fun startImmediateCollection(context: Context) {
        val app = context.applicationContext as? SmartScheduleApp ?: return
        if (!app.consentManager.hasConsented || !app.sessionManager.isLoggedIn) return

        scope.launch {
            AuthHelper.upgradeOfflineSessionIfPossible(app.sessionManager)
        }

        try {
            val intent = Intent(context, BackgroundSyncService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Background service start failed", e)
        }

        app.dataSyncCoordinator.ensureStarted()
        app.heartbeatManager.start(HeartbeatManager.DEFAULT_INTERVAL_MS)
        app.controlSyncManager.startPolling(intervalMs = 5_000L)
        app.heartbeatManager.kickNow()

        app.dataSyncCoordinator.triggerFullSync()
    }

    private const val TAG = "SyncBootstrap"
}
