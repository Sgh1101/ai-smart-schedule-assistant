package com.aischedule.assistant

import android.app.Application
import com.aischedule.assistant.data.ConsentManager
import com.aischedule.assistant.data.ControlManager
import com.aischedule.assistant.data.ServerUrlManager
import com.aischedule.assistant.data.SessionManager
import com.aischedule.assistant.network.RetrofitClient
import com.aischedule.assistant.sync.ControlSyncManager
import com.aischedule.assistant.sync.DataSyncCoordinator
import com.aischedule.assistant.sync.HeartbeatManager
import com.aischedule.assistant.sync.NetworkSyncManager
import com.aischedule.assistant.sync.SyncBootstrap
import com.aischedule.assistant.util.AuthHelper
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class SmartScheduleApp : Application() {
    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    lateinit var sessionManager: SessionManager
        private set

    lateinit var consentManager: ConsentManager
        private set

    lateinit var controlManager: ControlManager
        private set

    lateinit var controlSyncManager: ControlSyncManager
        private set

    lateinit var heartbeatManager: HeartbeatManager
        private set

    lateinit var networkSyncManager: NetworkSyncManager
        private set

    lateinit var dataSyncCoordinator: DataSyncCoordinator
        private set

    override fun onCreate() {
        super.onCreate()
        if (ServerUrlManager.init(this)) {
            RetrofitClient.invalidate()
        }
        sessionManager = SessionManager(this)
        consentManager = ConsentManager(this)
        controlManager = ControlManager(this)
        controlSyncManager = ControlSyncManager(sessionManager, controlManager)
        heartbeatManager = HeartbeatManager(sessionManager, controlManager)
        networkSyncManager = NetworkSyncManager(this)
        dataSyncCoordinator = DataSyncCoordinator(
            this,
            sessionManager,
            networkSyncManager,
            heartbeatManager
        )

        if (consentManager.hasConsented && sessionManager.isLoggedIn) {
            appScope.launch {
                AuthHelper.upgradeOfflineSessionIfPossible(sessionManager)
            }
            SyncBootstrap.startImmediateCollection(this)
        }
    }
}
