package com.aischedule.assistant.data

import android.content.Context
import android.util.Log
import androidx.core.content.edit
import com.aischedule.assistant.Constants

object ServerUrlManager {
    private const val PREFS_NAME = "ai_schedule_server"
    private const val KEY_BASE_URL = "base_url"
    private const val TAG = "ServerUrlManager"

    @Volatile
    private var appContext: Context? = null

    fun init(context: Context): Boolean {
        appContext = context.applicationContext
        return migrateStaleTunnelUrls()
    }

    /**
     * loca.lt / ngrok 등 만료·한도 초과 터널 URL은 Render 기본 주소로 되돌립니다.
     */
    fun migrateStaleTunnelUrls(): Boolean {
        val context = appContext ?: return false
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val stored = prefs.getString(KEY_BASE_URL, null) ?: return false
        if (!isStaleTunnelUrl(stored)) return false

        Log.i(TAG, "Migrating stale tunnel URL: $stored -> ${Constants.DEFAULT_CLOUD_SYNC_BASE_URL}")
        prefs.edit { remove(KEY_BASE_URL) }
        return true
    }

    fun isStaleTunnelUrl(url: String): Boolean {
        val lower = url.lowercase()
        return lower.contains("loca.lt") ||
            lower.contains("localtunnel") ||
            lower.contains("ngrok")
    }

    fun getBaseUrl(): String {
        val context = appContext ?: return normalize(Constants.DEFAULT_CLOUD_SYNC_BASE_URL)
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val stored = prefs.getString(KEY_BASE_URL, null)
        if (stored != null && isStaleTunnelUrl(stored)) {
            Log.i(TAG, "Clearing stale tunnel URL on read: $stored")
            prefs.edit { remove(KEY_BASE_URL) }
            return normalize(Constants.DEFAULT_CLOUD_SYNC_BASE_URL)
        }
        return normalize(stored ?: Constants.DEFAULT_CLOUD_SYNC_BASE_URL)
    }

    fun resetToDefault() {
        clearOverride()
    }

    fun setBaseUrl(rawUrl: String) {
        val context = appContext
            ?: throw IllegalStateException("ServerUrlManager.init() required")
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit {
            putString(KEY_BASE_URL, normalize(rawUrl))
        }
    }

    fun clearOverride() {
        appContext?.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)?.edit {
            remove(KEY_BASE_URL)
        }
    }

    fun hasCustomUrl(): Boolean {
        val context = appContext ?: return false
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .contains(KEY_BASE_URL)
    }

    fun normalize(raw: String): String {
        val trimmed = raw.trim()
        if (trimmed.isEmpty()) return normalize(Constants.DEFAULT_CLOUD_SYNC_BASE_URL)
        val withScheme = if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
            trimmed
        } else {
            "https://$trimmed"
        }
        return if (withScheme.endsWith("/")) withScheme else "$withScheme/"
    }
}
