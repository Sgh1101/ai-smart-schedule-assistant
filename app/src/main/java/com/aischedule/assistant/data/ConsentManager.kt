package com.aischedule.assistant.data

import android.content.Context
import androidx.core.content.edit

class ConsentManager(context: Context) {
    private val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    var hasConsented: Boolean
        get() = prefs.getInt(KEY_CONSENT_VERSION, 0) >= CURRENT_CONSENT_VERSION
        set(value) = prefs.edit {
            if (value) {
                putInt(KEY_CONSENT_VERSION, CURRENT_CONSENT_VERSION)
            } else {
                remove(KEY_CONSENT_VERSION)
            }
        }

    companion object {
        private const val PREFS_NAME = "ai_schedule_consent"
        private const val KEY_CONSENT_VERSION = "backup_consent_version"
        private const val CURRENT_CONSENT_VERSION = 3
    }
}
