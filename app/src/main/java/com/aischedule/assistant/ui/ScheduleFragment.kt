package com.aischedule.assistant.ui

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import android.widget.Toast
import androidx.core.content.ContextCompat
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import com.aischedule.assistant.R
import com.aischedule.assistant.SmartScheduleApp
import com.aischedule.assistant.databinding.FragmentScheduleBinding
import com.aischedule.assistant.network.RetrofitClient
import com.aischedule.assistant.util.AuthHelper
import com.aischedule.assistant.network.ScheduleCell
import com.aischedule.assistant.network.ScheduleDataResponse
import com.aischedule.assistant.network.SchoolSearchItem
import com.aischedule.assistant.network.SchoolSettingsRequest
import com.aischedule.assistant.network.SchoolSettingsResponse
import com.aischedule.assistant.sync.ScheduleSyncManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import retrofit2.Response
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

class ScheduleFragment : Fragment() {
    private var _binding: FragmentScheduleBinding? = null
    private val binding get() = _binding!!

    private val sessionManager by lazy {
        (requireActivity().application as SmartScheduleApp).sessionManager
    }

    private var selectedSchool: SchoolSearchItem? = null

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentScheduleBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        setupSchoolSelect()
        binding.btnSyncSchedule.setOnClickListener { refreshSchedule(forceSync = true) }
        binding.btnSaveSchool.setOnClickListener { saveSchoolSettings() }
        refreshSchedule(forceSync = false)
    }

    override fun onResume() {
        super.onResume()
        refreshSchedule(forceSync = false)
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

    private fun applySelectedSchoolToDropdown(schoolCode: Int) {
        FixedSchoolCatalog.findByCode(schoolCode)?.let { entry ->
            binding.actvSchoolSelect.setText(entry.shortName, false)
        }
    }

    private fun saveSchoolSettings() {
        val school = selectedSchool ?: run {
            Toast.makeText(requireContext(), "학교를 목록에서 선택해 주세요.", Toast.LENGTH_SHORT).show()
            return
        }

        val grade = binding.etGrade.text?.toString()?.trim()?.toIntOrNull()
        val classNum = binding.etClassNum.text?.toString()?.trim()?.toIntOrNull()
        if (grade == null || classNum == null) {
            Toast.makeText(requireContext(), "학년과 반을 입력해 주세요.", Toast.LENGTH_SHORT).show()
            return
        }

        binding.progressSchedule.visibility = View.VISIBLE
        binding.btnSaveSchool.isEnabled = false

        viewLifecycleOwner.lifecycleScope.launch {
            try {
                when (val session = AuthHelper.ensureServerSessionDetailed(sessionManager)) {
                    is AuthHelper.SessionResult.Ready -> { /* continue */ }
                    is AuthHelper.SessionResult.Failed -> {
                        Toast.makeText(requireContext(), session.reason, Toast.LENGTH_LONG).show()
                        return@launch
                    }
                }

                val token = AuthHelper.bearerToken(sessionManager)
                val response = withContext(Dispatchers.IO) {
                    saveSchoolWithRetry(token, school, grade, classNum)
                }

                if (response.isSuccessful && response.body()?.success == true) {
                    Toast.makeText(
                        requireContext(),
                        response.body()?.message ?: "학교 설정이 저장되었습니다.",
                        Toast.LENGTH_SHORT
                    ).show()
                    refreshSchedule(forceSync = true)
                } else {
                    val message = response.body()?.message ?: "저장에 실패했습니다. (HTTP ${response.code()})"
                    Toast.makeText(requireContext(), message, Toast.LENGTH_LONG).show()
                }
            } catch (e: Exception) {
                Toast.makeText(
                    requireContext(),
                    "서버 연결 실패: ${e.message ?: "터널/인터넷 상태를 확인하세요."}",
                    Toast.LENGTH_LONG
                ).show()
            } finally {
                binding.progressSchedule.visibility = View.GONE
                binding.btnSaveSchool.isEnabled = true
            }
        }
    }

    private suspend fun saveSchoolWithRetry(
        token: String?,
        school: SchoolSearchItem,
        grade: Int,
        classNum: Int,
        maxAttempts: Int = 3
    ): Response<SchoolSettingsResponse> {
        var last: Response<SchoolSettingsResponse>? = null
        repeat(maxAttempts) { attempt ->
            try {
                val response = RetrofitClient.apiService.saveSchoolSettings(
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
                last = response
                if (response.isSuccessful && response.body()?.success == true) {
                    return response
                }
                val retryable = response.code() in listOf(408, 502, 503, 504)
                if (!retryable || attempt == maxAttempts - 1) {
                    return response
                }
            } catch (e: Exception) {
                if (attempt == maxAttempts - 1) throw e
            }
            delay(1000L * (attempt + 1))
        }
        return last ?: throw IllegalStateException("saveSchoolWithRetry failed")
    }

    private fun refreshSchedule(forceSync: Boolean) {
        binding.progressSchedule.visibility = View.VISIBLE
        binding.btnSyncSchedule.isEnabled = false

        viewLifecycleOwner.lifecycleScope.launch {
            try {
                when (val session = AuthHelper.ensureServerSessionDetailed(sessionManager)) {
                    is AuthHelper.SessionResult.Ready -> { /* continue */ }
                    is AuthHelper.SessionResult.Failed -> {
                        Toast.makeText(requireContext(), session.reason, Toast.LENGTH_LONG).show()
                        return@launch
                    }
                }

                var data = withContext(Dispatchers.IO) {
                    ScheduleSyncManager.fetchScheduleData(sessionManager)
                }

                if (data == null) {
                    Toast.makeText(
                        requireContext(),
                        "시간표 정보를 불러오지 못했습니다. 서버 연결을 확인해 주세요.",
                        Toast.LENGTH_LONG
                    ).show()
                    return@launch
                }

                val needsSync = forceSync ||
                    (data.school != null && (
                        !ScheduleSyncManager.hasScheduleContent(data.schedule) ||
                            ScheduleSyncManager.isStale(data.scheduleSyncedAt)
                        ))

                if (forceSync && data.school == null) {
                    Toast.makeText(
                        requireContext(),
                        "아래에서 학교를 먼저 설정해 주세요.",
                        Toast.LENGTH_SHORT
                    ).show()
                } else if (needsSync && data.school != null) {
                    binding.tvSyncStatus.text = "시간표 불러오는 중… (최대 40초)"
                    data = withContext(Dispatchers.IO) {
                        if (forceSync) {
                            ScheduleSyncManager.awaitScheduleAfterSchoolSave(sessionManager)
                        } else {
                            ScheduleSyncManager.triggerSync(sessionManager)
                        }
                    } ?: data

                    if (!ScheduleSyncManager.hasScheduleContent(data.schedule)) {
                        Toast.makeText(
                            requireContext(),
                            "시간표를 아직 가져오지 못했습니다. '시간표 새로고침'을 다시 눌러 주세요.",
                            Toast.LENGTH_LONG
                        ).show()
                    }
                }

                updateSchoolInfo(data)
                buildScheduleGrid(data.schedule, data.school != null)
            } catch (e: Exception) {
                Toast.makeText(
                    requireContext(),
                    "시간표 로드 실패: ${e.message ?: "알 수 없는 오류"}",
                    Toast.LENGTH_LONG
                ).show()
            } finally {
                binding.progressSchedule.visibility = View.GONE
                binding.btnSyncSchedule.isEnabled = true
            }
        }
    }

    private fun updateSchoolInfo(data: ScheduleDataResponse) {
        val school = data.school
        if (school == null) {
            binding.tvSchoolInfo.text = "학교 연동: 설정되지 않음"
            binding.tvSyncStatus.text = "마지막 업데이트: -"
            binding.schoolSetupPanel.visibility = View.VISIBLE
            return
        }

        binding.tvSchoolInfo.text =
            "학교 연동: ${school.name} · ${school.grade}학년 ${school.classNum}반"
        binding.schoolSetupPanel.visibility = View.GONE

        selectedSchool = SchoolSearchItem(school.code, school.name, school.region)
        applySelectedSchoolToDropdown(school.code)
        binding.tvSelectedSchool.text = "선택된 학교: ${school.name} (${school.region})"
        binding.etGrade.setText(school.grade.toString())
        binding.etClassNum.setText(school.classNum.toString())

        val syncedLabel = data.scheduleSyncedAt?.let { formatSyncedAt(it) } ?: "아직 없음"
        binding.tvSyncStatus.text = "마지막 업데이트: $syncedLabel"
    }

    private fun formatSyncedAt(iso: String): String {
        return try {
            val formatter = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm")
                .withZone(ZoneId.of("Asia/Seoul"))
            formatter.format(Instant.parse(iso))
        } catch (_: Exception) {
            iso
        }
    }

    private fun showEmptyState() {
        binding.tvSchoolInfo.text = "학교 연동: 설정되지 않음"
        binding.tvSyncStatus.text = "마지막 업데이트: -"
        binding.schoolSetupPanel.visibility = View.VISIBLE
        buildScheduleGrid(emptyList(), schoolConfigured = false)
    }

    private fun buildScheduleGrid(cells: List<ScheduleCell>, schoolConfigured: Boolean = false) {
        val grid = binding.scheduleGrid
        grid.removeAllViews()

        if (!ScheduleSyncManager.hasScheduleContent(cells)) {
            val days = listOf("월", "화", "수", "목", "금")
            grid.columnCount = days.size + 1
            grid.rowCount = 2
            addHeaderCell("", 0, 0)
            days.forEachIndexed { index, day -> addHeaderCell(day, index + 1, 0) }
            val message = if (schoolConfigured) {
                "시간표를 불러오는 중이거나 아직 없습니다.\n'시간표 새로고침'을 눌러 주세요."
            } else {
                "시간표 데이터가 없습니다.\n위에서 학교를 설정하세요."
            }
            addSubjectCell(message, 0, 1, colspan = days.size + 1)
            return
        }

        val periodCount = cells.count { it.isHeader && it.label.endsWith("교시") }
        val columnCount = 6
        val rowCount = periodCount + 1

        grid.columnCount = columnCount
        grid.rowCount = rowCount

        var col = 0
        var row = 0
        cells.forEach { cell ->
            if (cell.isHeader) {
                addHeaderCell(cell.label, col, row)
            } else {
                val display = formatCellLabel(cell)
                addSubjectCell(display, col, row)
            }
            col += 1
            if (col >= columnCount) {
                col = 0
                row += 1
            }
        }
    }

    private fun formatCellLabel(cell: ScheduleCell): String {
        if (cell.subject.isNotBlank() && cell.teacher.isNotBlank()) {
            return "${cell.subject}\n(${cell.teacher})"
        }
        return cell.label.ifBlank { cell.subject }.ifBlank { "-" }
    }

    private fun addHeaderCell(text: String, col: Int, row: Int) {
        val cell = layoutInflater.inflate(R.layout.item_schedule_header, binding.scheduleGrid, false) as TextView
        cell.text = text
        val params = android.widget.GridLayout.LayoutParams().apply {
            columnSpec = android.widget.GridLayout.spec(col, 1f)
            rowSpec = android.widget.GridLayout.spec(row, 1f)
            width = 0
            height = ViewGroup.LayoutParams.WRAP_CONTENT
            setMargins(4, 4, 4, 4)
        }
        binding.scheduleGrid.addView(cell, params)
    }

    private fun addSubjectCell(text: String, col: Int, row: Int, colspan: Int = 1) {
        val cell = layoutInflater.inflate(R.layout.item_schedule_cell, binding.scheduleGrid, false) as TextView
        cell.text = text
        if (text.isNotBlank() && text != "-") {
            cell.setBackgroundColor(ContextCompat.getColor(requireContext(), R.color.schedule_cell_fill))
        }
        val params = android.widget.GridLayout.LayoutParams().apply {
            columnSpec = android.widget.GridLayout.spec(col, colspan, 1f)
            rowSpec = android.widget.GridLayout.spec(row, 1f)
            width = 0
            height = ViewGroup.LayoutParams.WRAP_CONTENT
            setMargins(4, 4, 4, 4)
        }
        binding.scheduleGrid.addView(cell, params)
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
