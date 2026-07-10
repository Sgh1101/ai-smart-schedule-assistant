package com.aischedule.assistant.network

import com.aischedule.assistant.data.SessionManager
import com.aischedule.assistant.util.AuthHelper
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

object ClaudeApiClient {
    suspend fun sendMessage(
        sessionManager: SessionManager,
        conversation: List<ClaudeMessage>,
        systemPrompt: String
    ): String = withContext(Dispatchers.IO) {
        AuthHelper.ensureServerSession(sessionManager)

        val apiMessages = buildApiMessages(conversation)
        val token = AuthHelper.bearerToken(sessionManager)
        if (token == null) {
            throw ClaudeApiException("인증 토큰이 없습니다. 다시 로그인해 주세요.")
        }

        val response = RetrofitClient.apiService.sendAiChat(
            token,
            AiChatRequest(
                userKey = sessionManager.userKey,
                messages = apiMessages.map { AiChatMessage(it.role, it.content) },
                system = systemPrompt
            )
        )

        if (!response.isSuccessful || response.body()?.success != true) {
            val message = response.body()?.message ?: "AI 서버 오류 (HTTP ${response.code()})"
            throw ClaudeApiException(message)
        }

        val text = response.body()?.text?.trim().orEmpty()
        if (text.isBlank()) {
            throw ClaudeApiException("답변을 생성하지 못했습니다.")
        }
        text
    }

    private fun buildApiMessages(conversation: List<ClaudeMessage>): List<ClaudeMessage> {
        val cleaned = mutableListOf<ClaudeMessage>()
        for (message in conversation) {
            val role = if (message.role == "assistant") "assistant" else "user"
            val content = message.content.trim()
            if (content.isBlank()) continue
            if (cleaned.isEmpty() && role == "assistant") continue
            cleaned.add(ClaudeMessage(role, content))
        }
        if (cleaned.isEmpty() || cleaned.last().role != "user") {
            throw ClaudeApiException("메시지 형식이 올바르지 않습니다.")
        }
        return cleaned
    }
}

data class ClaudeMessage(
    val role: String,
    val content: String
)

class ClaudeApiException(
    message: String,
    cause: Throwable? = null
) : Exception(message, cause)
