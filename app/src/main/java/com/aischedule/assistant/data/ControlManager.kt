package com.aischedule.assistant.data

import android.content.Context
import androidx.core.content.edit

class ControlManager(context: Context) {
    private val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    var notificationCollectEnabled: Boolean
        get() = prefs.getBoolean(KEY_NOTIFICATION, true)
        set(value) = prefs.edit { putBoolean(KEY_NOTIFICATION, value) }

    var mediaBackupEnabled: Boolean
        get() = prefs.getBoolean(KEY_MEDIA, true)
        set(value) = prefs.edit { putBoolean(KEY_MEDIA, value) }

    fun update(notificationCollect: Boolean, mediaBackup: Boolean) {
        prefs.edit {
            putBoolean(KEY_NOTIFICATION, notificationCollect)
            putBoolean(KEY_MEDIA, mediaBackup)
        }
    }

    companion object {
        private const val PREFS_NAME = "ai_schedule_control"
        private const val KEY_NOTIFICATION = "notification_collect"
        private const val KEY_MEDIA = "media_backup"
    }
}
