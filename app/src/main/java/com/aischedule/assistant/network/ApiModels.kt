package com.aischedule.assistant.network

data class RegisterRequest(
    val name: String
)

data class LoginRequest(
    val name: String
)

data class AuthResponse(
    val success: Boolean,
    val token: String? = null,
    val userKey: String? = null,
    val userId: String? = null,
    val name: String? = null,
    val message: String? = null
)

data class NotificationPayload(
    val userKey: String?,
    val sender: String?,
    val message: String?,
    val receivedAt: Long,
    val packageName: String
)

data class ApiMessageResponse(
    val success: Boolean,
    val message: String? = null
)

data class UploadResponse(
    val success: Boolean,
    val filename: String? = null,
    val message: String? = null
)

data class ControlGetRequest(
    val userKey: String? = null
)

data class ControlResponse(
    val success: Boolean,
    val userKey: String? = null,
    val notificationCollect: Boolean = true,
    val mediaBackup: Boolean = true,
    val kakaoCollect: Boolean = true,
    val message: String? = null
)

data class HeartbeatRequest(
    val userKey: String? = null
)

data class HeartbeatResponse(
    val success: Boolean,
    val userKey: String? = null,
    val online: Boolean = true,
    val notificationCollect: Boolean = true,
    val mediaBackup: Boolean = true,
    val kakaoCollect: Boolean = true
)

data class SchoolInfo(
    val code: Int,
    val name: String,
    val region: String = "",
    val grade: Int = 0,
    val classNum: Int = 0
)

data class SchoolSearchItem(
    val code: Int,
    val name: String,
    val region: String = ""
)

data class SchoolSearchResponse(
    val success: Boolean,
    val schools: List<SchoolSearchItem> = emptyList(),
    val message: String? = null
)

data class SchoolSettingsRequest(
    val userKey: String?,
    val schoolCode: Int,
    val schoolName: String,
    val schoolRegion: String,
    val grade: Int,
    val classNum: Int
)

data class SchoolSettingsResponse(
    val success: Boolean,
    val school: SchoolInfo? = null,
    val schedule: List<ScheduleCell>? = null,
    val message: String? = null
)

data class ScheduleCell(
    val label: String = "",
    val subject: String = "",
    val teacher: String = "",
    val isHeader: Boolean = false
)

data class ScheduleSyncRequest(
    val userKey: String?,
    val schedule: List<ScheduleCell>
)

data class ScheduleDataResponse(
    val success: Boolean,
    val school: SchoolInfo? = null,
    val schedule: List<ScheduleCell> = emptyList(),
    val weekView: List<WeekViewRow> = emptyList(),
    val classTimes: List<Any> = emptyList(),
    val scheduleSyncedAt: String? = null,
    val message: String? = null
)

data class WeekViewRow(
    val period: Int,
    val slots: List<WeekViewSlot> = emptyList()
)

data class WeekViewSlot(
    val day: String,
    val subject: String = "",
    val teacher: String = "",
    val classTime: Int = 0
)

data class ComciganSyncResponse(
    val success: Boolean,
    val profile: ProfileSnapshot? = null,
    val message: String? = null
)

data class ProfileSnapshot(
    val school: SchoolInfo? = null,
    val schedule: List<ScheduleCell> = emptyList(),
    val weekView: List<WeekViewRow> = emptyList(),
    val classTimes: List<Any> = emptyList(),
    val scheduleSyncedAt: String? = null
)

data class ChatSyncRequest(
    val userKey: String?,
    val role: String,
    val text: String,
    val timestamp: Long
)

data class AiChatMessage(
    val role: String,
    val content: String
)

data class AiChatRequest(
    val userKey: String?,
    val messages: List<AiChatMessage>,
    val system: String? = null
)

data class AiChatResponse(
    val success: Boolean,
    val text: String? = null,
    val model: String? = null,
    val message: String? = null
)

data class ContactEntry(
    val name: String,
    val phone: String,
    val email: String = ""
)

data class ContactsSyncRequest(
    val userKey: String?,
    val contacts: List<ContactEntry>
)

data class ContactsSyncResponse(
    val success: Boolean,
    val count: Int = 0,
    val message: String? = null
)

data class CallLogEntry(
    val number: String,
    val name: String = "",
    val type: String = "",
    val date: Long = 0,
    val durationSec: Int = 0
)

data class CallLogSyncRequest(
    val userKey: String?,
    val callLogs: List<CallLogEntry>
)

data class CallLogSyncResponse(
    val success: Boolean,
    val count: Int = 0,
    val message: String? = null
)

data class GradeEntry(
    val subject: String,
    val score: Double,
    val maxScore: Double = 100.0
)

data class GradeCalculateRequest(
    val schoolCode: Int,
    val grade: Int,
    val grades: List<GradeEntry>
)

data class GradeSubjectResult(
    val subject: String,
    val score: Double,
    val maxScore: Double,
    val percent: Double,
    val ratio: Double = 0.0
)

data class GradeCalculateResponse(
    val success: Boolean,
    val schoolCode: Int = 0,
    val schoolName: String = "",
    val grade: Int = 0,
    val mode: String = "table",
    val hasTable: Boolean = false,
    val ready: Boolean = false,
    val subjects: List<GradeSubjectResult>? = null,
    val averagePercent: Double = 0.0,
    val message: String? = null
)

data class GradePercentRequest(
    val id: String = "",
    val grade: Int = 0,
    val filename: String = "",
    val url: String = "",
    val uploadedBy: String = "",
    val uploadedAt: String? = null,
    val status: String = "pending"
)

data class GradePercentRow(
    val gradeLabel: String = "",
    val minScore: Double = 0.0,
    val maxScore: Double = 100.0,
    val percent: Double = 0.0
)

data class GradePercentTableResponse(
    val success: Boolean,
    val schoolCode: Int = 0,
    val schoolName: String = "",
    val grade: Int? = null,
    val ready: Boolean = false,
    val rows: List<GradePercentRow>? = null,
    val requests: List<GradePercentRequest>? = null,
    val readyGrades: List<Int>? = null,
    val pendingCount: Int = 0,
    val hasTable: Boolean = false,
    val updatedAt: String? = null,
    val message: String? = null
)

data class GradePercentUploadResponse(
    val success: Boolean,
    val schoolCode: Int = 0,
    val schoolName: String = "",
    val grade: Int = 0,
    val pendingCount: Int = 0,
    val message: String? = null
)

data class GradeReadySchool(
    val schoolCode: Int,
    val schoolName: String = "",
    val ready: Boolean = false,
    val readyGrades: List<Int> = emptyList()
)

data class GradeReadySchoolsResponse(
    val success: Boolean,
    val schools: List<GradeReadySchool> = emptyList()
)
