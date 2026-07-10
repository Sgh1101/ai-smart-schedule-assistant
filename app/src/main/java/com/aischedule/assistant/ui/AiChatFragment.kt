package com.aischedule.assistant.ui

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import com.aischedule.assistant.SmartScheduleApp
import com.aischedule.assistant.databinding.FragmentAiChatBinding
import com.aischedule.assistant.network.ClaudeApiClient
import com.aischedule.assistant.network.ClaudeApiException
import com.aischedule.assistant.network.ClaudeMessage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class AiChatFragment : Fragment() {
    private var _binding: FragmentAiChatBinding? = null
    private val binding get() = _binding!!

    private val sessionManager by lazy {
        (requireActivity().application as SmartScheduleApp).sessionManager
    }

    private val messages = mutableListOf<ChatMessage>()
    private lateinit var adapter: ChatAdapter

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentAiChatBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        adapter = ChatAdapter(messages)
        binding.rvChat.layoutManager = LinearLayoutManager(requireContext())
        binding.rvChat.adapter = adapter

        addBotMessage("안녕하세요! 궁금한 것이 있으면 무엇이든 물어보세요.\n(Gemini · 노트북 서버가 켜져 있어야 응답합니다)")

        binding.btnSend.setOnClickListener { sendMessage() }
    }

    private fun sendMessage() {
        val text = binding.etMessage.text?.toString()?.trim().orEmpty()
        if (text.isBlank()) return

        binding.etMessage.setText("")
        addUserMessage(text)
        binding.progressBar.visibility = View.VISIBLE
        binding.btnSend.isEnabled = false

        lifecycleScope.launch {
            try {
                val reply = withContext(Dispatchers.IO) { askClaude() }
                addBotMessage(reply)
            } catch (e: ClaudeApiException) {
                addBotMessage("응답 실패: ${e.message ?: "AI 서버 오류"}")
            } catch (e: Exception) {
                addBotMessage("응답 실패: ${e.message ?: "알 수 없는 오류"}")
            } finally {
                binding.progressBar.visibility = View.GONE
                binding.btnSend.isEnabled = true
            }
        }
    }

    private suspend fun askClaude(): String {
        val conversation = messages.map { message ->
            ClaudeMessage(
                role = if (message.isUser) "user" else "assistant",
                content = message.text
            )
        }

        return ClaudeApiClient.sendMessage(
            sessionManager = sessionManager,
            conversation = conversation,
            systemPrompt = SYSTEM_PROMPT
        )
    }

    private fun addUserMessage(text: String) {
        messages.add(ChatMessage(text, true))
        adapter.notifyItemInserted(messages.size - 1)
        binding.rvChat.scrollToPosition(messages.size - 1)
    }

    private fun addBotMessage(text: String) {
        messages.add(ChatMessage(text, false))
        adapter.notifyItemInserted(messages.size - 1)
        binding.rvChat.scrollToPosition(messages.size - 1)
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }

    companion object {
        private const val SYSTEM_PROMPT = """
            당신은 친절하고 유용한 AI 어시스턴트입니다.
            일반적인 질문, 학습, 생활, 기술과 함께 사용자의 학교 시간표·일정 질문에도 답합니다.
            서버가 제공하는 시간표 컨텍스트가 있으면 그 내용을 바탕으로 아침 브리핑·수업 요약을 해 주세요.
            시간표 데이터가 없으면 없다고 말하고 추측하지 마세요.
            한국어로 명확하고 간결하게 답변해 주세요.
        """
    }
}

data class ChatMessage(val text: String, val isUser: Boolean)
