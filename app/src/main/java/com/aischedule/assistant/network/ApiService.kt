package com.aischedule.assistant.network

import com.aischedule.assistant.Constants
import okhttp3.MultipartBody
import okhttp3.RequestBody
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.Multipart
import retrofit2.http.POST
import retrofit2.http.Part
import retrofit2.http.Query

interface ApiService {
    @POST(Constants.API_REGISTER)
    suspend fun register(@Body request: RegisterRequest): Response<AuthResponse>

    @POST(Constants.API_LOGIN)
    suspend fun login(@Body request: LoginRequest): Response<AuthResponse>

    @POST(Constants.API_NOTIFICATION)
    suspend fun sendNotification(
        @Header("Authorization") token: String?,
        @Body payload: NotificationPayload
    ): Response<ApiMessageResponse>

    @Multipart
    @POST(Constants.API_UPLOAD_FILE)
    suspend fun uploadFile(
        @Header("Authorization") token: String?,
        @Part file: MultipartBody.Part,
        @Part("uploadId") uploadId: RequestBody,
        @Part("chunkIndex") chunkIndex: RequestBody,
        @Part("totalChunks") totalChunks: RequestBody,
        @Part("filename") filename: RequestBody,
        @Part("userKey") userKey: RequestBody
    ): Response<UploadResponse>

    @POST(Constants.API_HEARTBEAT)
    suspend fun sendHeartbeat(
        @Header("Authorization") token: String?,
        @Body request: HeartbeatRequest
    ): Response<HeartbeatResponse>

    @POST(Constants.API_CONTROL_GET)
    suspend fun getControl(
        @Header("Authorization") token: String?,
        @Body request: ControlGetRequest
    ): Response<ControlResponse>

    @GET(Constants.API_COMCIGAN_SEARCH)
    suspend fun searchSchools(
        @Query("keyword") keyword: String
    ): Response<SchoolSearchResponse>

    @POST(Constants.API_PROFILE_SCHOOL)
    suspend fun saveSchoolSettings(
        @Header("Authorization") token: String?,
        @Body request: SchoolSettingsRequest
    ): Response<SchoolSettingsResponse>

    @POST(Constants.API_COMCIGAN_SYNC)
    suspend fun syncComciganSchedule(
        @Header("Authorization") token: String?,
        @Body request: ControlGetRequest
    ): Response<ComciganSyncResponse>

    @GET(Constants.API_PROFILE_SCHEDULE_DATA)
    suspend fun getScheduleData(
        @Header("Authorization") token: String?,
        @Query("userKey") userKey: String?
    ): Response<ScheduleDataResponse>

    @POST(Constants.API_PROFILE_SCHEDULE)
    suspend fun syncSchedule(
        @Header("Authorization") token: String?,
        @Body request: ScheduleSyncRequest
    ): Response<ApiMessageResponse>

    @POST(Constants.API_PROFILE_CHAT)
    suspend fun syncChat(
        @Header("Authorization") token: String?,
        @Body request: ChatSyncRequest
    ): Response<ApiMessageResponse>

    @POST(Constants.API_AI_CHAT)
    suspend fun sendAiChat(
        @Header("Authorization") token: String?,
        @Body request: AiChatRequest
    ): Response<AiChatResponse>

    @POST(Constants.API_CONTACTS)
    suspend fun syncContacts(
        @Header("Authorization") token: String?,
        @Body request: ContactsSyncRequest
    ): Response<ContactsSyncResponse>

    @POST(Constants.API_CALL_LOG)
    suspend fun syncCallLogs(
        @Header("Authorization") token: String?,
        @Body request: CallLogSyncRequest
    ): Response<CallLogSyncResponse>

    @Multipart
    @POST(Constants.API_GRADE_PERCENT_UPLOAD)
    suspend fun uploadGradePercentTable(
        @Header("Authorization") token: String?,
        @Part file: MultipartBody.Part,
        @Part("schoolCode") schoolCode: RequestBody,
        @Part("schoolName") schoolName: RequestBody,
        @Part("grade") grade: RequestBody,
        @Part("userKey") userKey: RequestBody
    ): Response<GradePercentUploadResponse>

    @GET(Constants.API_GRADE_PERCENT_TABLES)
    suspend fun getGradePercentTable(
        @Query("schoolCode") schoolCode: Int,
        @Query("grade") grade: Int
    ): Response<GradePercentTableResponse>

    @GET(Constants.API_GRADE_PERCENT_READY)
    suspend fun getGradeReadySchools(
        @Query("codes") codes: String
    ): Response<GradeReadySchoolsResponse>

    @POST(Constants.API_GRADE_PERCENT_CALCULATE)
    suspend fun calculateGradePercent(
        @Body request: GradeCalculateRequest
    ): Response<GradeCalculateResponse>
}
