package com.aischedule.assistant.ui

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.AutoCompleteTextView
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.aischedule.assistant.R
import com.aischedule.assistant.SmartScheduleApp
import com.aischedule.assistant.network.GradeCalculateRequest
import com.aischedule.assistant.network.GradeEntry
import com.aischedule.assistant.network.GradeReadySchool
import com.aischedule.assistant.network.RetrofitClient
import com.aischedule.assistant.network.SchoolSearchItem
import com.google.android.material.button.MaterialButton
import com.google.android.material.textfield.TextInputEditText
import com.google.android.material.textfield.TextInputLayout
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.io.FileOutputStream

class GradePercentFragment : Fragment() {

    private val sessionManager by lazy {
        (requireActivity().application as SmartScheduleApp).sessionManager
    }

    private lateinit var schoolSelectLayout: TextInputLayout
    private lateinit var schoolSelect: AutoCompleteTextView
    private lateinit var schoolResults: RecyclerView
    private lateinit var selectedSchoolText: TextView
    private lateinit var gradeLevelInput: TextInputEditText
    private lateinit var checkButton: Button
    private lateinit var statusText: TextView
    private lateinit var requestPanel: LinearLayout
    private lateinit var requestButton: Button
    private lateinit var requestStatusText: TextView
    private lateinit var calculatorPanel: LinearLayout
    private lateinit var subjectInputs: LinearLayout
    private lateinit var addSubjectButton: Button
    private lateinit var calculateButton: Button
    private lateinit var resultText: TextView

    private var selectedSchool: SchoolSearchItem? = null
    private var selectedGrade: Int = 1
    private var isReady: Boolean = false
    private var readyGrades: List<Int> = emptyList()

    private val pickImageLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            result.data?.data?.let { uploadRequestPhoto(it) }
        }
    }

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View? {
        return inflater.inflate(R.layout.fragment_grade_percent, container, false)
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        schoolSelectLayout = view.findViewById(R.id.tilGradeSchoolSelect)
        schoolSelect = view.findViewById(R.id.gradeSchoolSelect)
        schoolResults = view.findViewById(R.id.gradeSchoolResults)
        selectedSchoolText = view.findViewById(R.id.gradeSelectedSchoolText)
        gradeLevelInput = view.findViewById(R.id.gradeLevelInput)
        checkButton = view.findViewById(R.id.gradeCheckButton)
        statusText = view.findViewById(R.id.gradeStatusText)
        requestPanel = view.findViewById(R.id.gradeRequestPanel)
        requestButton = view.findViewById(R.id.gradeRequestButton)
        requestStatusText = view.findViewById(R.id.gradeRequestStatusText)
        calculatorPanel = view.findViewById(R.id.gradeCalculatorPanel)
        subjectInputs = view.findViewById(R.id.gradeSubjectInputs)
        addSubjectButton = view.findViewById(R.id.gradeAddSubjectButton)
        calculateButton = view.findViewById(R.id.gradeCalculateButton)
        resultText = view.findViewById(R.id.gradeResultText)

        schoolResults.layoutManager = LinearLayoutManager(requireContext())
        schoolResults.adapter = SchoolResultAdapter { school ->
            onSchoolSelected(school)
        }

        SchoolDropdownHelper.setup(
            dropdownLayout = schoolSelectLayout,
            autoComplete = schoolSelect
        ) { entry ->
            onSchoolSelected(entry.toSchoolItem())
            schoolSelect.setText(entry.shortName, false)
        }

        checkButton.setOnClickListener { checkGradeReady() }
        requestButton.setOnClickListener { pickRequestPhoto() }
        addSubjectButton.setOnClickListener { addSubjectRow() }
        calculateButton.setOnClickListener { calculatePercent() }

        addSubjectRow()
        addSubjectRow()
        addSubjectRow()
    }

    private fun onSchoolSelected(school: SchoolSearchItem) {
        selectedSchool = school
        isReady = false
        readyGrades = emptyList()
        schoolResults.visibility = View.GONE
        requestPanel.visibility = View.GONE
        calculatorPanel.visibility = View.GONE
        resultText.visibility = View.GONE
        requestStatusText.visibility = View.GONE

        selectedSchoolText.text = "선택된 학교: ${school.name} (${school.code})"
        statusText.text = "학년을 입력하고 '학년 확인'을 눌러 주세요."
    }

    private fun parseGrade(): Int? {
        val g = gradeLevelInput.text?.toString()?.trim()?.toIntOrNull()
        return if (g != null && g in 1..3) g else null
    }

    private fun checkGradeReady() {
        val school = selectedSchool
        val grade = parseGrade()

        if (school == null) {
            Toast.makeText(requireContext(), "먼저 학교를 선택해 주세요.", Toast.LENGTH_SHORT).show()
            return
        }
        if (grade == null) {
            Toast.makeText(requireContext(), "학년은 1~3만 입력 가능합니다.", Toast.LENGTH_SHORT).show()
            return
        }

        selectedGrade = grade
        lifecycleScope.launch {
            try {
                statusText.text = "${grade}학년 확인 중..."
                val resp = withContext(Dispatchers.IO) {
                    RetrofitClient.apiService.getGradePercentTable(school.code, grade)
                }
                val body = resp.body()

                if (!resp.isSuccessful || body == null) {
                    statusText.text = "확인 실패: ${resp.message()}"
                    showRequestPanel()
                    return@launch
                }

                isReady = body.ready
                readyGrades = body.readyGrades ?: emptyList()

                if (isReady) {
                    val readyHint = if (readyGrades.isNotEmpty()) {
                        " (등록 학년: ${readyGrades.joinToString(", ")}학년)"
                    } else ""
                    statusText.text = "${school.name} ${grade}학년 — 퍼센트 표 사용 가능$readyHint"
                    showCalculatorPanel()
                } else {
                    val pending = body.pendingCount
                    val pendingHint = if (pending > 0) " (대기 중 요청 ${pending}건)" else ""
                    statusText.text = "${school.name} ${grade}학년 — 아직 등록되지 않음$pendingHint"
                    showRequestPanel()
                }
            } catch (e: Exception) {
                statusText.text = "확인 실패: ${e.message}"
                showRequestPanel()
            }
        }
    }

    private fun showRequestPanel() {
        requestPanel.visibility = View.VISIBLE
        calculatorPanel.visibility = View.GONE
        resultText.visibility = View.GONE
    }

    private fun showCalculatorPanel() {
        requestPanel.visibility = View.GONE
        calculatorPanel.visibility = View.VISIBLE
        requestStatusText.visibility = View.GONE
    }

    private fun pickRequestPhoto() {
        val school = selectedSchool
        val grade = parseGrade()
        if (school == null || grade == null) {
            Toast.makeText(requireContext(), "학교와 학년을 먼저 확인해 주세요.", Toast.LENGTH_SHORT).show()
            return
        }

        val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
            type = "image/*"
        }
        pickImageLauncher.launch(Intent.createChooser(intent, "퍼센트 표 사진 선택"))
    }

    private fun uploadRequestPhoto(uri: Uri) {
        val school = selectedSchool ?: return
        val grade = parseGrade() ?: return
        val userKey = sessionManager.userKey ?: "unknown"
        val token = sessionManager.authToken

        lifecycleScope.launch {
            try {
                requestButton.isEnabled = false
                requestStatusText.visibility = View.VISIBLE
                requestStatusText.text = "요청 업로드 중..."

                val tempFile = copyUriToTempFile(uri)
                val part = MultipartBody.Part.createFormData(
                    "file",
                    tempFile.name,
                    tempFile.asRequestBody("image/*".toMediaTypeOrNull())
                )

                val resp = withContext(Dispatchers.IO) {
                    RetrofitClient.apiService.uploadGradePercentTable(
                        token = token,
                        file = part,
                        schoolCode = school.code.toString().toRequestBody("text/plain".toMediaTypeOrNull()),
                        schoolName = school.name.toRequestBody("text/plain".toMediaTypeOrNull()),
                        grade = grade.toString().toRequestBody("text/plain".toMediaTypeOrNull()),
                        userKey = userKey.toRequestBody("text/plain".toMediaTypeOrNull())
                    )
                }

                tempFile.delete()

                if (resp.isSuccessful && resp.body()?.success == true) {
                    val msg = resp.body()?.message ?: "요청이 접수되었습니다."
                    requestStatusText.text = msg
                    Toast.makeText(requireContext(), msg, Toast.LENGTH_LONG).show()
                } else {
                    val msg = resp.body()?.message ?: resp.message()
                    requestStatusText.text = "요청 실패: $msg"
                }
            } catch (e: Exception) {
                requestStatusText.text = "요청 실패: ${e.message}"
            } finally {
                requestButton.isEnabled = true
            }
        }
    }

    private suspend fun copyUriToTempFile(uri: Uri): File = withContext(Dispatchers.IO) {
        val temp = File.createTempFile("grade_request_", ".jpg", requireContext().cacheDir)
        requireContext().contentResolver.openInputStream(uri)?.use { input ->
            FileOutputStream(temp).use { output -> input.copyTo(output) }
        }
        temp
    }

    private fun addSubjectRow() {
        val row = layoutInflater.inflate(R.layout.item_grade_row, subjectInputs, false)
        row.findViewById<MaterialButton>(R.id.btnRemoveRow).setOnClickListener {
            if (subjectInputs.childCount > 1) {
                subjectInputs.removeView(row)
            }
        }
        subjectInputs.addView(row)
    }

    private fun collectGradeEntries(): List<GradeEntry> {
        val entries = mutableListOf<GradeEntry>()
        for (i in 0 until subjectInputs.childCount) {
            val row = subjectInputs.getChildAt(i)
            val subject = row.findViewById<TextInputEditText>(R.id.etSubject).text?.toString()?.trim().orEmpty()
            val scoreStr = row.findViewById<TextInputEditText>(R.id.etScore).text?.toString()?.trim().orEmpty()
            val maxStr = row.findViewById<TextInputEditText>(R.id.etMaxScore).text?.toString()?.trim().orEmpty()
            if (subject.isEmpty() && scoreStr.isEmpty()) continue
            val score = scoreStr.toDoubleOrNull() ?: continue
            val maxScore = maxStr.toDoubleOrNull()?.takeIf { it > 0 } ?: 100.0
            entries.add(GradeEntry(subject = subject.ifEmpty { "과목${i + 1}" }, score = score, maxScore = maxScore))
        }
        return entries
    }

    private fun calculatePercent() {
        val school = selectedSchool
        val grade = parseGrade()

        if (school == null || grade == null) {
            Toast.makeText(requireContext(), "학교와 학년을 확인해 주세요.", Toast.LENGTH_SHORT).show()
            return
        }
        if (!isReady) {
            Toast.makeText(requireContext(), "등록된 퍼센트 표가 없습니다. 요청하기를 이용해 주세요.", Toast.LENGTH_LONG).show()
            return
        }

        val entries = collectGradeEntries()
        if (entries.isEmpty()) {
            Toast.makeText(requireContext(), "과목 점수를 입력해 주세요.", Toast.LENGTH_SHORT).show()
            return
        }

        lifecycleScope.launch {
            try {
                calculateButton.isEnabled = false
                resultText.visibility = View.VISIBLE
                resultText.text = "계산 중..."

                val resp = withContext(Dispatchers.IO) {
                    RetrofitClient.apiService.calculateGradePercent(
                        GradeCalculateRequest(
                            schoolCode = school.code,
                            grade = grade,
                            grades = entries
                        )
                    )
                }

                val body = resp.body()
                if (!resp.isSuccessful || body == null || !body.success) {
                    resultText.text = body?.message ?: "계산 실패: ${resp.message()}"
                    return@launch
                }

                val lines = buildString {
                    appendLine("${body.schoolName} ${body.grade}학년 (${body.mode})")
                    body.subjects?.forEach { s ->
                        appendLine("• ${s.subject}: ${s.score}/${s.maxScore} → ${"%.2f".format(s.percent)}%")
                    }
                    appendLine("")
                    append("평균 퍼센트: ${"%.2f".format(body.averagePercent)}%")
                }
                resultText.text = lines
            } catch (e: Exception) {
                resultText.text = "계산 실패: ${e.message}"
            } finally {
                calculateButton.isEnabled = true
            }
        }
    }

    private class SchoolResultAdapter(
        private val onSelect: (SchoolSearchItem) -> Unit
    ) : RecyclerView.Adapter<SchoolResultAdapter.VH>() {

        private var items: List<SchoolSearchItem> = emptyList()
        private var readyMap: Map<Int, GradeReadySchool> = emptyMap()

        fun submit(list: List<SchoolSearchItem>, ready: Map<Int, GradeReadySchool>) {
            items = list
            readyMap = ready
            notifyDataSetChanged()
        }

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH {
            val tv = TextView(parent.context).apply {
                setPadding(24, 24, 24, 24)
                textSize = 14f
            }
            return VH(tv)
        }

        override fun onBindViewHolder(holder: VH, position: Int) {
            val item = items[position]
            val readyInfo = readyMap[item.code]
            val badge = if (readyInfo?.ready == true) {
                " ✓ ${readyInfo.readyGrades.joinToString(",")}학년"
            } else ""
            holder.text.text = "${item.name} (${item.region}) — ${item.code}$badge"
            holder.text.setOnClickListener { onSelect(item) }
        }

        override fun getItemCount() = items.size

        class VH(val text: TextView) : RecyclerView.ViewHolder(text)
    }
}
