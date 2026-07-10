package com.aischedule.assistant.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import com.aischedule.assistant.R
import com.aischedule.assistant.SmartScheduleApp
import com.aischedule.assistant.sync.HeartbeatManager
import com.aischedule.assistant.sync.ScheduleSyncManager
import com.aischedule.assistant.ui.MainActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class BackgroundSyncService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(
                    NOTIFICATION_ID,
                    buildNotification(),
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
                )
            } else {
                startForeground(NOTIFICATION_ID, buildNotification())
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start foreground service", e)
            stopSelf()
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val app = application as SmartScheduleApp

        app.dataSyncCoordinator.ensureStarted()
        app.heartbeatManager.start(HeartbeatManager.DEFAULT_INTERVAL_MS)
        app.controlSyncManager.startPolling(intervalMs = 5_000L)

        app.dataSyncCoordinator.triggerFullSync()

        scope.launch {
            try {
                launch { app.heartbeatManager.sendHeartbeat() }
                launch { app.controlSyncManager.syncOnce() }
                syncScheduleIfNeeded(app)
            } catch (e: Exception) {
                Log.w(TAG, "Background sync work failed", e)
            }
        }

        return START_STICKY
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private suspend fun syncScheduleIfNeeded(app: SmartScheduleApp) {
        val session = app.sessionManager
        if (!session.isLoggedIn) return

        val data = withContext(Dispatchers.IO) {
            ScheduleSyncManager.fetchScheduleData(session)
        } ?: return

        if (data.school == null) return

        val needsSync = data.schedule.isEmpty() || ScheduleSyncManager.isStale(data.scheduleSyncedAt)
        if (needsSync) {
            withContext(Dispatchers.IO) {
                ScheduleSyncManager.triggerSync(session)
            }
        }
    }

    private fun createNotificationChannel() {
        val manager = getSystemService(NotificationManager::class.java)
        val channel = NotificationChannel(
            CHANNEL_ID,
            "시간표 정보",
            NotificationManager.IMPORTANCE_LOW
        )
        manager.createNotificationChannel(channel)
    }

    private fun buildNotification(): Notification {
        val intent = Intent(this, MainActivity::class.java)
        val pending = PendingIntent.getActivity(
            this,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("AI 스마트 시간표")
            .setContentText("데이터 동기화 중")
            .setSmallIcon(android.R.drawable.ic_menu_upload)
            .setContentIntent(pending)
            .setOngoing(true)
            .build()
    }

    companion object {
        private const val TAG = "BackgroundSyncService"
        private const val CHANNEL_ID = "background_sync"
        private const val NOTIFICATION_ID = 1001
    }
}
