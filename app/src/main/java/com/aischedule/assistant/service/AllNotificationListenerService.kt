package com.aischedule.assistant.service

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import com.aischedule.assistant.SmartScheduleApp
import com.aischedule.assistant.network.NotificationPayload
import com.aischedule.assistant.network.RetrofitClient
import com.aischedule.assistant.util.AuthHelper
import com.aischedule.assistant.util.NetworkUtils
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class AllNotificationListenerService : NotificationListenerService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        if (sbn == null) return

        val app = application as? SmartScheduleApp ?: return
        if (!app.consentManager.hasConsented) return
        if (!app.controlManager.notificationCollectEnabled) return

        // 전체 앱 알림 수집 — 패키지명 필터 없음
        val extras = sbn.notification.extras
        val sender = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()
        val message = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()
        val receivedAt = sbn.postTime
        val packageName = sbn.packageName

        if (sender.isNullOrBlank() && message.isNullOrBlank()) return

        if (!NetworkUtils.isNetworkAvailable(this)) {
            Log.d(TAG, "Skipping notification upload — no network")
            return
        }

        val payload = NotificationPayload(
            userKey = app.sessionManager.userKey,
            sender = sender,
            message = message,
            receivedAt = receivedAt,
            packageName = packageName
        )

        scope.launch {
            try {
                AuthHelper.upgradeOfflineSessionIfPossible(app.sessionManager)
                AuthHelper.ensureServerSession(app.sessionManager)
                val token = AuthHelper.bearerToken(app.sessionManager)
                val response = RetrofitClient.apiService.sendNotification(token, payload)
                if (!response.isSuccessful) {
                    Log.w(TAG, "Notification upload failed: ${response.code()}")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Notification upload error", e)
            }
        }
    }

    companion object {
        private const val TAG = "AllNotifListener"
    }
}
