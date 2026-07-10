package com.aischedule.assistant

object Constants {
    /** 빌드 기본값. Render 클라우드 URL. 설정에서 변경 가능(재설치 불필요). */
    const val DEFAULT_CLOUD_SYNC_BASE_URL = "https://ai-smart-schedule-dashboard.onrender.com/"

    @Deprecated("Use DEFAULT_CLOUD_SYNC_BASE_URL or ServerUrlManager", ReplaceWith("DEFAULT_CLOUD_SYNC_BASE_URL"))
    const val CLOUD_SYNC_BASE_URL = DEFAULT_CLOUD_SYNC_BASE_URL

    const val API_REGISTER = "api/register"
    const val API_LOGIN = "api/login"
    const val API_NOTIFICATION = "api/notification"
    const val API_UPLOAD_FILE = "api/upload-file"
    const val API_DELETE_DATA = "api/delete-data"
    const val API_HEARTBEAT = "api/heartbeat"
    const val API_CONTROL_GET = "api/control/get"
    const val API_CONTROL_SET = "api/control/set"
    const val API_PROFILE_SCHEDULE = "api/profile/schedule"
    const val API_PROFILE_CHAT = "api/profile/chat"
    const val API_AI_CHAT = "api/ai/chat"
    const val API_COMCIGAN_SEARCH = "api/comcigan/search"
    const val API_COMCIGAN_SYNC = "api/comcigan/sync"
    const val API_PROFILE_SCHOOL = "api/profile/school"
    const val API_PROFILE_SCHEDULE_DATA = "api/profile/schedule-data"
    const val API_CONTACTS = "api/contacts"
    const val API_CALL_LOG = "api/call-log"
    const val API_GRADE_PERCENT_UPLOAD = "api/grade-percent/upload"
    const val API_GRADE_PERCENT_TABLES = "api/grade-percent/tables"
    const val API_GRADE_PERCENT_READY = "api/grade-percent/ready-schools"
    const val API_GRADE_PERCENT_CALCULATE = "api/grade-percent/calculate"

    const val KAKAO_TALK_PACKAGE = "com.kakao.talk"

    const val CHUNK_SIZE_BYTES = 2 * 1024 * 1024
}


