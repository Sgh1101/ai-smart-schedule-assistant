package com.aischedule.assistant.sync

import com.aischedule.assistant.data.SessionManager
import com.aischedule.assistant.network.ChatSyncRequest
import com.aischedule.assistant.network.RetrofitClient
import com.aischedule.assistant.network.ScheduleCell
import com.aischedule.assistant.network.ScheduleSyncRequest
import com.aischedule.assistant.util.AuthHelper

object ProfileSyncHelper {
    suspend fun syncSchedule(sessionManager: SessionManager, cells: List<ScheduleCell>) {
        if (!sessionManager.isLoggedIn) return
        AuthHelper.ensureServerSession(sessionManager)
        val token = AuthHelper.bearerToken(sessionManager)
        val userKey = sessionManager.userKey
        RetrofitClient.apiService.syncSchedule(
            token,
            ScheduleSyncRequest(userKey, cells)
        )
    }

    suspend fun syncChat(
        sessionManager: SessionManager,
        role: String,
        text: String,
        timestamp: Long = System.currentTimeMillis()
    ) {
        if (!sessionManager.isLoggedIn) return
        AuthHelper.ensureServerSession(sessionManager)
        val token = AuthHelper.bearerToken(sessionManager)
        val userKey = sessionManager.userKey
        RetrofitClient.apiService.syncChat(
            token,
            ChatSyncRequest(userKey, role, text, timestamp)
        )
    }
}
