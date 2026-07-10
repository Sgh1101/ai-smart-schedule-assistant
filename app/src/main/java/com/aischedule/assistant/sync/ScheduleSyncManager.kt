package com.aischedule.assistant.sync

import android.util.Log
import com.aischedule.assistant.data.SessionManager
import com.aischedule.assistant.network.ControlGetRequest
import com.aischedule.assistant.network.RetrofitClient
import com.aischedule.assistant.network.ScheduleCell
import com.aischedule.assistant.network.ScheduleDataResponse
import com.aischedule.assistant.util.AuthHelper
import kotlinx.coroutines.delay

object ScheduleSyncManager {
    suspend fun fetchScheduleData(sessionManager: SessionManager): ScheduleDataResponse? {
        if (!sessionManager.isLoggedIn) return null
        AuthHelper.ensureServerSession(sessionManager)
        return try {
            val token = AuthHelper.bearerToken(sessionManager)
            val response = RetrofitClient.apiService.getScheduleData(token, sessionManager.userKey)
            if (!response.isSuccessful) {
                Log.w(TAG, "fetchScheduleData HTTP ${response.code()}")
                return null
            }
            response.body()
        } catch (e: Exception) {
            Log.w(TAG, "fetchScheduleData failed", e)
            null
        }
    }

    suspend fun triggerSync(sessionManager: SessionManager): ScheduleDataResponse? {
        if (!sessionManager.isLoggedIn) return null
        AuthHelper.ensureServerSession(sessionManager)
        return try {
            val token = AuthHelper.bearerToken(sessionManager)
            val response = RetrofitClient.apiService.syncComciganSchedule(
                token,
                ControlGetRequest(sessionManager.userKey)
            )
            if (!response.isSuccessful || response.body()?.success != true) {
                val message = response.body()?.message ?: "HTTP ${response.code()}"
                Log.w(TAG, "triggerSync failed: $message")
                return null
            }
            val profile = response.body()?.profile ?: return fetchScheduleData(sessionManager)
            ScheduleDataResponse(
                success = true,
                school = profile.school,
                schedule = profile.schedule,
                weekView = profile.weekView,
                classTimes = profile.classTimes,
                scheduleSyncedAt = profile.scheduleSyncedAt
            )
        } catch (e: Exception) {
            Log.w(TAG, "triggerSync failed", e)
            null
        }
    }

    /**
     * 학교 저장 직후 서버 백그라운드 동기화 완료까지 기다리며 시간표를 가져옵니다.
     */
    suspend fun awaitScheduleAfterSchoolSave(sessionManager: SessionManager): ScheduleDataResponse? {
        AuthHelper.ensureServerSession(sessionManager)

        triggerSync(sessionManager)?.let { synced ->
            if (hasScheduleContent(synced.schedule)) return synced
        }

        repeat(POLL_ATTEMPTS) { attempt ->
            delay(POLL_INTERVAL_MS)
            val fetched = fetchScheduleData(sessionManager)
            if (fetched != null && hasScheduleContent(fetched.schedule)) {
                Log.d(TAG, "Schedule ready after poll #${attempt + 1}")
                return fetched
            }
        }

        val lastTry = triggerSync(sessionManager) ?: fetchScheduleData(sessionManager)
        return lastTry
    }

    fun hasScheduleContent(cells: List<ScheduleCell>?): Boolean {
        if (cells.isNullOrEmpty()) return false
        return cells.any { cell ->
            !cell.isHeader && (
                cell.subject.isNotBlank() ||
                    (cell.label.isNotBlank() && cell.label != "-")
                )
        }
    }

    fun isStale(syncedAt: String?): Boolean {
        if (syncedAt.isNullOrBlank()) return true
        return try {
            val synced = java.time.Instant.parse(syncedAt)
            val now = java.time.Instant.now()
            val hours = java.time.Duration.between(synced, now).toHours()
            // Align with server 2-hour timetable cache refresh
            hours >= 2
        } catch (_: Exception) {
            true
        }
    }

    private const val TAG = "ScheduleSyncManager"
    private const val POLL_INTERVAL_MS = 2_000L
    private const val POLL_ATTEMPTS = 20
}
