package com.aischedule.assistant.util

import com.aischedule.assistant.data.ServerUrlManager
import com.aischedule.assistant.data.SessionManager
import com.aischedule.assistant.network.LoginRequest
import com.aischedule.assistant.network.RetrofitClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

object AuthHelper {
    sealed class SessionResult {
        data object Ready : SessionResult()
        data class Failed(val reason: String) : SessionResult()
    }

    /** OkHttp rejects non-ASCII in Authorization (e.g. Hangul userKey → 0xc870). */
    fun isAsciiSafeToken(token: String): Boolean =
        token.all { it.code in 0x20..0x7E }

    /**
     * Returns `Bearer <token>` only when the token is ASCII-safe.
     * Legacy tokens that embed Hangul userKey return null so callers re-login.
     */
    fun bearerToken(sessionManager: SessionManager): String? {
        val token = sessionManager.authToken ?: return null
        if (token.startsWith("offline.")) return null
        if (!isAsciiSafeToken(token)) return null
        return "Bearer $token"
    }

    fun needsTokenRefresh(sessionManager: SessionManager): Boolean {
        val token = sessionManager.authToken ?: return true
        if (token.startsWith("offline.")) return true
        return !isAsciiSafeToken(token)
    }

    suspend fun pingServerHealth(): Boolean {
        return withContext(Dispatchers.IO) {
            try {
                val baseUrl = ServerUrlManager.getBaseUrl()
                val client = OkHttpClient.Builder()
                    .connectTimeout(15, TimeUnit.SECONDS)
                    .readTimeout(15, TimeUnit.SECONDS)
                    .build()
                val requestBuilder = Request.Builder()
                    .url(baseUrl + "api/health")
                    .get()
                TunnelRequestHelper.applyTunnelHeaders(requestBuilder, baseUrl)
                val response = client.newCall(requestBuilder.build()).execute()
                response.isSuccessful && TunnelRequestHelper.isHealthOk(response.body?.string().orEmpty())
            } catch (_: Exception) {
                false
            }
        }
    }

    suspend fun ensureServerSession(sessionManager: SessionManager): Boolean {
        return when (val result = ensureServerSessionDetailed(sessionManager)) {
            is SessionResult.Ready -> true
            is SessionResult.Failed -> false
        }
    }

    /** 오프라인 입장 후 서버가 다시 살아났을 때 세션을 자동으로 온라인으로 전환합니다. */
    suspend fun upgradeOfflineSessionIfPossible(sessionManager: SessionManager): Boolean {
        if (!sessionManager.isOfflineSession && !needsTokenRefresh(sessionManager)) return true
        return ensureServerSession(sessionManager)
    }

    suspend fun ensureServerSessionDetailed(sessionManager: SessionManager): SessionResult {
        if (!pingServerHealth()) {
            val url = ServerUrlManager.getBaseUrl()
            val staleHint = when {
                ServerUrlManager.isStaleTunnelUrl(url) ->
                    "\n예전 터널 주소입니다. 설정에서 '기본 주소로 재설정'을 눌러 주세요."
                TunnelRequestHelper.isPrivateLanUrl(url) ->
                    "\nPC 내부 IP는 같은 Wi-Fi에서만 됩니다. LTE에서는 Render 주소가 필요합니다."
                else -> ""
            }
            return SessionResult.Failed(
                "서버에 연결할 수 없습니다.\n현재 주소: $url\n" +
                    "Render 배포가 끝났는지 확인하고\n" +
                    "설정 > '기본 주소로 재설정' > 연결 테스트를 눌러 주세요.$staleHint"
            )
        }

        val token = sessionManager.authToken ?: return SessionResult.Failed("로그인이 필요합니다.")
        // Offline OR legacy Hangul-in-token → re-login for ASCII-safe Bearer
        if (!token.startsWith("offline.") && isAsciiSafeToken(token)) {
            return SessionResult.Ready
        }

        val name = sessionManager.userName?.trim().orEmpty()
        if (name.isBlank()) {
            return SessionResult.Failed("세션을 갱신하려면 이름으로 다시 로그인해 주세요.")
        }

        return withContext(Dispatchers.IO) {
            try {
                val loginResponse = RetrofitClient.apiService.login(LoginRequest(name))
                if (loginResponse.isSuccessful && loginResponse.body()?.success == true) {
                    val body = loginResponse.body()!!
                    val userKey = body.userKey ?: body.userId.orEmpty()
                    val newToken = body.token.orEmpty()
                    if (newToken.isBlank() || !isAsciiSafeToken(newToken)) {
                        return@withContext SessionResult.Failed("서버가 ASCII 안전 토큰을 발급하지 않았습니다. 서버를 재시작해 주세요.")
                    }
                    sessionManager.saveSession(newToken, userKey, body.name ?: name)
                    SessionResult.Ready
                } else {
                    SessionResult.Failed("서버 로그인 실패 (HTTP ${loginResponse.code()})")
                }
            } catch (e: Exception) {
                SessionResult.Failed("서버 로그인 오류: ${e.message ?: "알 수 없음"}")
            }
        }
    }

}
