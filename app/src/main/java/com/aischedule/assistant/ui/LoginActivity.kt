package com.aischedule.assistant.ui

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.aischedule.assistant.SmartScheduleApp
import com.aischedule.assistant.databinding.ActivityLoginBinding
import com.aischedule.assistant.network.LoginRequest
import com.aischedule.assistant.network.RetrofitClient
import com.aischedule.assistant.sync.SyncBootstrap
import com.aischedule.assistant.util.AuthHelper
import com.aischedule.assistant.util.UserKeyUtils
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class LoginActivity : AppCompatActivity() {
    private lateinit var binding: ActivityLoginBinding
    private val sessionManager by lazy { (application as SmartScheduleApp).sessionManager }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        if (sessionManager.isLoggedIn) {
            navigateAfterLogin()
            return
        }

        binding = ActivityLoginBinding.inflate(layoutInflater)
        setContentView(binding.root)
        binding.btnLogin.setOnClickListener { attemptLogin() }
    }

    private fun attemptLogin() {
        val name = binding.etName.text?.toString()?.trim().orEmpty()
        if (name.isBlank()) {
            Toast.makeText(this, "이름을 입력해 주세요.", Toast.LENGTH_SHORT).show()
            return
        }

        binding.progressBar.visibility = View.VISIBLE
        binding.btnLogin.isEnabled = false

        lifecycleScope.launch {
            try {
                if (authenticateWithServer(name)) {
                    navigateAfterLogin()
                }
            } finally {
                binding.progressBar.visibility = View.GONE
                binding.btnLogin.isEnabled = true
            }
        }
    }

    private suspend fun authenticateWithServer(name: String): Boolean {
        return try {
            val loginResponse = withContext(Dispatchers.IO) {
                RetrofitClient.apiService.login(LoginRequest(name))
            }

            if (loginResponse.isSuccessful && loginResponse.body()?.success == true) {
                val body = loginResponse.body()!!
                val userKey = body.userKey ?: body.userId.orEmpty()
                val token = body.token.orEmpty()
                if (token.isBlank() || !AuthHelper.isAsciiSafeToken(token)) {
                    Toast.makeText(
                        this@LoginActivity,
                        "서버 토큰 오류입니다. Render 서버가 켜져 있는지 확인한 뒤 다시 로그인해 주세요.",
                        Toast.LENGTH_LONG
                    ).show()
                    return false
                }
                sessionManager.saveSession(token, userKey, body.name ?: name)
                return true
            }

            if (!loginResponse.isSuccessful) {
                return enterOfflineMode(
                    name,
                    "서버에 연결할 수 없습니다 (${loginResponse.code()}). Render 배포·슬립 여부를 확인하세요. 오프라인으로 입장합니다."
                )
            }

            val message = loginResponse.body()?.message ?: "로그인에 실패했습니다."
            Toast.makeText(this@LoginActivity, message, Toast.LENGTH_SHORT).show()
            false
        } catch (_: Exception) {
            enterOfflineMode(
                name,
                "서버 연결 없이 입장합니다. 인터넷 연결 후 시간표 탭에서 학교를 설정하세요."
            )
        }
    }

    private fun enterOfflineMode(name: String, toastMessage: String): Boolean {
        val userKey = UserKeyUtils.fromName(name)
        sessionManager.saveSession("offline.$userKey", userKey, name)
        Toast.makeText(this@LoginActivity, toastMessage, Toast.LENGTH_LONG).show()
        return true
    }

    private fun navigateAfterLogin() {
        val app = application as SmartScheduleApp
        if (app.consentManager.hasConsented) {
            SyncBootstrap.startImmediateCollection(this)
        }
        val target = if (app.consentManager.hasConsented) {
            MainActivity::class.java
        } else {
            ConsentActivity::class.java
        }
        startActivity(Intent(this, target))
        finish()
    }
}
