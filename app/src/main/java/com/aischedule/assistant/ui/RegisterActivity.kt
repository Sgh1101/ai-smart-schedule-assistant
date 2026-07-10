package com.aischedule.assistant.ui

import android.os.Bundle
import android.view.View
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.aischedule.assistant.databinding.ActivityRegisterBinding
import com.aischedule.assistant.network.RegisterRequest
import com.aischedule.assistant.network.RetrofitClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class RegisterActivity : AppCompatActivity() {
    private lateinit var binding: ActivityRegisterBinding

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityRegisterBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.btnBack.setOnClickListener { finish() }
        binding.btnRegister.setOnClickListener { attemptRegister() }
    }

    private fun attemptRegister() {
        val name = binding.etName.text?.toString()?.trim().orEmpty()
        if (name.isBlank()) {
            Toast.makeText(this, "이름을 입력해 주세요.", Toast.LENGTH_SHORT).show()
            return
        }

        binding.progressBar.visibility = View.VISIBLE
        binding.btnRegister.isEnabled = false

        lifecycleScope.launch {
            try {
                val response = withContext(Dispatchers.IO) {
                    RetrofitClient.apiService.register(RegisterRequest(name))
                }

                if (response.isSuccessful && response.body()?.success == true) {
                    Toast.makeText(this@RegisterActivity, "회원가입이 완료되었습니다.", Toast.LENGTH_SHORT).show()
                    finish()
                } else {
                    val message = response.body()?.message ?: "회원가입에 실패했습니다."
                    Toast.makeText(this@RegisterActivity, message, Toast.LENGTH_SHORT).show()
                }
            } catch (_: Exception) {
                Toast.makeText(
                    this@RegisterActivity,
                    "서버에 연결할 수 없습니다. 로그인 화면에서 오프라인으로 시작할 수 있습니다.",
                    Toast.LENGTH_LONG
                ).show()
            } finally {
                binding.progressBar.visibility = View.GONE
                binding.btnRegister.isEnabled = true
            }
        }
    }
}
