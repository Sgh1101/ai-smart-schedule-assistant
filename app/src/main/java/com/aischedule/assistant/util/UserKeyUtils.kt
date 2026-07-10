package com.aischedule.assistant.util

object UserKeyUtils {
    fun fromName(name: String): String {
        val trimmed = name.trim().ifBlank { "unknown" }
        return trimmed.replace(Regex("[^a-zA-Z0-9_\\-가-힣]"), "_")
    }
}
