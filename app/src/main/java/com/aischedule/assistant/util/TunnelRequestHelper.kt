package com.aischedule.assistant.util

import okhttp3.Request

object TunnelRequestHelper {
    private val NGROK_HOST_PATTERN = Regex("""ngrok(-free)?\.(app|dev)""", RegexOption.IGNORE_CASE)

    fun needsNgrokBypass(baseUrl: String): Boolean =
        baseUrl.contains("ngrok", ignoreCase = true) ||
            NGROK_HOST_PATTERN.containsMatchIn(baseUrl)

    fun needsLocalTunnelBypass(baseUrl: String): Boolean {
        val lower = baseUrl.lowercase()
        return lower.contains("loca.lt") || lower.contains("localtunnel")
    }

    fun isPrivateLanUrl(url: String): Boolean {
        val lower = url.lowercase()
        if (lower.contains("localhost") || lower.contains("127.0.0.1")) return true
        if (lower.contains("10.0.2.2")) return false
        val host = runCatching {
            val withoutScheme = lower.removePrefix("https://").removePrefix("http://")
            withoutScheme.substringBefore('/').substringBefore(':')
        }.getOrDefault("")
        return host.startsWith("192.168.") ||
            host.startsWith("10.") ||
            host.matches(Regex("""172\.(1[6-9]|2\d|3[01])\..+"""))
    }

    fun applyTunnelHeaders(builder: Request.Builder, baseUrl: String) {
        if (needsLocalTunnelBypass(baseUrl)) {
            builder.header("Bypass-Tunnel-Reminder", "true")
        }
        if (needsNgrokBypass(baseUrl)) {
            builder.header("ngrok-skip-browser-warning", "true")
        }
    }

    /** ngrok HTML 경고 페이지의 "ngrok" 문자열 때문에 contains("ok")가 오탐하지 않도록 JSON만 인정 */
    fun isHealthOk(body: String): Boolean {
        val trimmed = body.trim()
        if (!trimmed.startsWith("{")) return false
        return Regex(""""status"\s*:\s*"ok"""").containsMatchIn(trimmed)
    }
}
