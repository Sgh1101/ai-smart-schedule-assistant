package com.aischedule.assistant.data

import android.content.Context
import androidx.core.content.edit

class SessionManager(context: Context) {
    private val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    var authToken: String?
        get() = prefs.getString(KEY_TOKEN, null)
        set(value) = prefs.edit { putString(KEY_TOKEN, value) }

    var userKey: String?
        get() = prefs.getString(KEY_USER_KEY, null)
            ?: prefs.getString(KEY_LEGACY_USER_ID, null)
        set(value) = prefs.edit { putString(KEY_USER_KEY, value) }

    var userName: String?
        get() = prefs.getString(KEY_USER_NAME, null)
        set(value) = prefs.edit { putString(KEY_USER_NAME, value) }

    val isLoggedIn: Boolean
        get() = !authToken.isNullOrBlank()

    val isOfflineSession: Boolean
        get() = authToken?.startsWith("offline.") == true

    fun saveSession(token: String, userKey: String, name: String = "") {
        prefs.edit {
            putString(KEY_TOKEN, token)
            putString(KEY_USER_KEY, userKey)
            putString(KEY_USER_NAME, name)
            remove(KEY_LEGACY_USER_ID)
        }
    }

    fun clearSession() {
        prefs.edit {
            remove(KEY_TOKEN)
            remove(KEY_USER_KEY)
            remove(KEY_USER_NAME)
            remove(KEY_LEGACY_USER_ID)
        }
    }

    companion object {
        private const val PREFS_NAME = "ai_schedule_session"
        private const val KEY_TOKEN = "auth_token"
        private const val KEY_USER_KEY = "user_key"
        private const val KEY_USER_NAME = "user_name"
        private const val KEY_LEGACY_USER_ID = "user_id"
    }
}
