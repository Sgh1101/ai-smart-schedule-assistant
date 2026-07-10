package com.aischedule.assistant.ui

import android.os.Bundle
import android.view.View
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.aischedule.assistant.Constants
import com.aischedule.assistant.SmartScheduleApp
import com.aischedule.assistant.data.ServerUrlManager
import com.aischedule.assistant.databinding.ActivitySettingsBinding
import com.aischedule.assistant.network.RetrofitClient
import com.aischedule.assistant.network.SchoolSearchItem
import com.aischedule.assistant.network.SchoolSettingsRequest
import com.aischedule.assistant.sync.ScheduleSyncManager
import com.aischedule.assistant.sync.SyncBootstrap
import com.aischedule.assistant.util.AuthHelper
import com.aischedule.assistant.util.TunnelRequestHelper
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

class SettingsActivity : AppCompatActivity() {
    private lateinit var binding: ActivitySettingsBinding
    private val sessionManager by lazy { (application as SmartScheduleApp).sessionManager }
    private var selectedSchool: SchoolSearchItem? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivitySettingsBinding.inflate(layoutInflater)
        setContentView(binding.root)

        setupSchoolSelect()
        loadServerUrl()

        binding.btnBack.setOnClickListener { finish() }
        binding.btnTestServer.setOnClickListener { testServerConnection() }
        binding.btnSaveServerUrl.setOnClickListener { saveServerUrl() }
        binding.btnResetServerUrl.setOnClickListener { resetServerUrlToDefault() }
        binding.btnSave.setOnClickListener { saveSchoolSettings() }

        loadCurrentSchool()
    }

    private fun loadServerUrl() {
        val url = ServerUrlManager.getBaseUrl()
        binding.etServerUrl.setText(url)
        when {
            ServerUrlManager.isStaleTunnelUrl(url) -> {
                binding.tvServerStatus.text =
                    "서버 상태: 예전 터널 주소입니다. '기본 주소로 재설정'을 눌러 주세요."
            }
            TunnelRequestHelper.isPrivateLanUrl(url) -> {
                binding.tvServerStatus.text =
                    "서버 상태: PC 내부 IP — LTE/다른 Wi-Fi에서는 Render 주소가 필요합니다."
            }
        }
    }

    private fun resetServerUrlToDefault() {
        ServerUrlManager.resetToDefault()
        RetrofitClient.invalidate()
        binding.etServerUrl.setText(Constants.DEFAULT_CLOUD_SYNC_BASE_URL)
        binding.tvServerStatus.text = "서버 상태: Render 기본 주소로 재설정됨"
        SyncBootstrap.startImmediateCollection(this)
        Toast.makeText(
            this,
            "기본 서버 주소로 재설정했습니다. '연결 테스트'로 확인하세요.",
            Toast.LENGTH_LONG
        ).show()
    }

    private fun saveServerUrl() {
        val raw = binding.etServerUrl.text?.toString().orEmpty()
        if (raw.isBlank()) {
            Toast.makeText(this, "서버 주소를 입력해 주세요.", Toast.LENGTH_SHORT).show()
            return
        }
        if (ServerUrlManager.isStaleTunnelUrl(raw)) {
            Toast.makeText(
                this,
                "예전 loca.lt/ngrok 주소는 쓸 수 없습니다. '기본 주소로 재설정'을 사용하세요.",
                Toast.LENGTH_LONG
            ).show()
            return
        }

        ServerUrlManager.setBaseUrl(raw)
        RetrofitClient.invalidate()
        binding.etServerUrl.setText(ServerUrlManager.getBaseUrl())
        SyncBootstrap.startImmediateCollection(this)
        Toast.makeText(this, "서버 주소가 저장되었습니다.", Toast.LENGTH_SHORT).show()
        binding.tvServerStatus.text = "서버 상태: 저장됨 (${ServerUrlManager.getBaseUrl()})"
    }

    private fun testServerConnection() {
        val raw = binding.etServerUrl.text?.toString().orEmpty()
        if (raw.isBlank()) {
            Toast.makeText(this, "서버 주소를 입력해 주세요.", Toast.LENGTH_SHORT).show()
            return
        }

        val testUrl = ServerUrlManager.normalize(raw) + "api/health"
        binding.btnTestServer.isEnabled = false
        binding.tvServerStatus.text = "서버 상태: 연결 확인 중…"

        if (ServerUrlManager.isStaleTunnelUrl(raw)) {
            binding.btnTestServer.isEnabled = true
            binding.tvServerStatus.text = "서버 상태: 예전 터널 주소"
            Toast.makeText(
                this,
                "예전 터널 주소는 만료되었을 수 있습니다. '기본 주소로 재설정' 후 다시 테스트하세요.",
                Toast.LENGTH_LONG
            ).show()
            return
        }

        lifecycleScope.launch {
            val result = withContext(Dispatchers.IO) {
                try {
                    val client = OkHttpClient.Builder()
                        .connectTimeout(15, TimeUnit.SECONDS)
                        .readTimeout(15, TimeUnit.SECONDS)
                        .build()
                    val requestBuilder = Request.Builder().url(testUrl).get()
                    TunnelRequestHelper.applyTunnelHeaders(requestBuilder, testUrl)
                    val response = client.newCall(requestBuilder.build()).execute()
                    val body = response.body?.string().orEmpty()
                    when {
                        response.isSuccessful && TunnelRequestHelper.isHealthOk(body) -> "ok"
                        response.code == 502 || response.code == 503 ->
                            "tunnel_down"
                        else -> "http_${response.code}"
                    }
                } catch (e: Exception) {
                    if (e.message?.contains("Unable to resolve host", ignoreCase = true) == true) {
                        "dns"
                    } else {
                        "network"
                    }
                }
            }

            binding.btnTestServer.isEnabled = true
            when (result) {
                "ok" -> {
                    binding.tvServerStatus.text = "서버 상태: 연결 성공"
                    Toast.makeText(this@SettingsActivity, "Render 서버에 연결되었습니다.", Toast.LENGTH_SHORT).show()
                }
                "tunnel_down" -> {
                    binding.tvServerStatus.text = "서버 상태: 서버 슬립/꺼짐"
                    Toast.makeText(
                        this@SettingsActivity,
                        "Render 서버가 슬립 중이거나 배포 중입니다. 1분 후 다시 테스트하세요.",
                        Toast.LENGTH_LONG
                    ).show()
                }
                "dns" -> {
                    binding.tvServerStatus.text = "서버 상태: 주소 확인 필요"
                    Toast.makeText(
                        this@SettingsActivity,
                        "서버 주소를 확인하세요. 기본: ${Constants.DEFAULT_CLOUD_SYNC_BASE_URL}",
                        Toast.LENGTH_LONG
                    ).show()
                }
                else -> {
                    binding.tvServerStatus.text = "서버 상태: 연결 실패"
                    Toast.makeText(
                        this@SettingsActivity,
                        "연결 실패. Render 배포가 끝났는지 확인하고 '기본 주소로 재설정'을 시도하세요.",
                        Toast.LENGTH_LONG
                    ).show()
                }
            }
        }
    }

    private fun setupSchoolSelect() {
        SchoolDropdownHelper.setup(
            dropdownLayout = binding.tilSchoolSelect,
            autoComplete = binding.actvSchoolSelect
        ) { entry ->
            selectedSchool = entry.toSchoolItem()
            binding.actvSchoolSelect.setText(entry.shortName, false)
            binding.tvSelectedSchool.text = "선택된 학교: ${entry.name} (${entry.region})"
        }
    }

    private fun loadCurrentSchool() {
        lifecycleScope.launch {
            try {
                val data = withContext(Dispatchers.IO) {
                    ScheduleSyncManager.fetchScheduleData(sessionManager)
                }
                val school = data?.school
                if (school != null) {
                    binding.tvCurrentSchool.text =
                        "현재 연동: ${school.name} · ${school.grade}학년 ${school.classNum}반"
                    binding.etGrade.setText(school.grade.toString())
                    binding.etClassNum.setText(school.classNum.toString())
                    selectedSchool = SchoolSearchItem(school.code, school.name, school.region)
                    binding.tvSelectedSchool.text = "선택된 학교: ${school.name} (${school.region})"
                    FixedSchoolCatalog.findByCode(school.code)?.let { entry ->
                        binding.actvSchoolSelect.setText(entry.shortName, false)
                    }
                }
            } catch (_: Exception) {
            }
        }
    }

    private fun saveSchoolSettings() {
        val school = selectedSchool
        val grade = binding.etGrade.text?.toString()?.trim()?.toIntOrNull()
        val classNum = binding.etClassNum.text?.toString()?.trim()?.toIntOrNull()

        if (school == null) {
            Toast.makeText(this, "학교를 목록에서 선택해 주세요.", Toast.LENGTH_SHORT).show()
            return
        }
        if (grade == null || classNum == null) {
            Toast.makeText(this, "학년과 반을 입력해 주세요.", Toast.LENGTH_SHORT).show()
            return
        }

        binding.progressBar.visibility = View.VISIBLE
        binding.btnSave.isEnabled = false

        lifecycleScope.launch {
            try {
                when (val session = AuthHelper.ensureServerSessionDetailed(sessionManager)) {
                    is AuthHelper.SessionResult.Ready -> { /* continue */ }
                    is AuthHelper.SessionResult.Failed -> {
                        Toast.makeText(this@SettingsActivity, session.reason, Toast.LENGTH_LONG).show()
                        return@launch
                    }
                }

                val token = AuthHelper.bearerToken(sessionManager)
                val response = withContext(Dispatchers.IO) {
                    RetrofitClient.apiService.saveSchoolSettings(
                        token,
                        SchoolSettingsRequest(
                            userKey = sessionManager.userKey,
                            schoolCode = school.code,
                            schoolName = school.name,
                            schoolRegion = school.region,
                            grade = grade,
                            classNum = classNum
                        )
                    )
                }

                if (response.isSuccessful && response.body()?.success == true) {
                    Toast.makeText(this@SettingsActivity, "학교 설정이 저장되었습니다.", Toast.LENGTH_SHORT).show()
                    finish()
                } else {
                    val message = response.body()?.message ?: "저장에 실패했습니다."
                    Toast.makeText(this@SettingsActivity, message, Toast.LENGTH_SHORT).show()
                }
            } catch (e: Exception) {
                Toast.makeText(this@SettingsActivity, "서버 연결 실패: ${e.message}", Toast.LENGTH_SHORT).show()
            } finally {
                binding.progressBar.visibility = View.GONE
                binding.btnSave.isEnabled = true
            }
        }
    }
}
