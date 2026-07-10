package com.aischedule.assistant.ui

import androidx.lifecycle.LifecycleCoroutineScope
import com.aischedule.assistant.network.RetrofitClient
import com.aischedule.assistant.network.SchoolSearchItem
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import retrofit2.Response
import com.aischedule.assistant.network.SchoolSearchResponse

object SchoolSearchHelper {
    private const val MAX_RETRIES = 3
    private val RETRYABLE_HTTP = setOf(408, 429, 500, 502, 503, 504)

    fun searchSchools(
        scope: LifecycleCoroutineScope,
        keyword: String,
        onLoading: (Boolean) -> Unit,
        onResults: (List<SchoolSearchItem>) -> Unit,
        onError: (String) -> Unit
    ) {
        val trimmed = keyword.trim()
        if (trimmed.isBlank()) {
            scope.launch(Dispatchers.Main) {
                onLoading(true)
            }
            scope.launch {
                try {
                    val response = withContext(Dispatchers.IO) {
                        RetrofitClient.apiService.searchSchools("")
                    }
                    if (!response.isSuccessful || response.body()?.success != true) {
                        withContext(Dispatchers.Main) {
                            onError("학교 목록을 불러오지 못했습니다.")
                            onResults(emptyList())
                        }
                        return@launch
                    }
                    val schools = response.body()?.schools.orEmpty()
                    withContext(Dispatchers.Main) { onResults(schools) }
                } catch (e: Exception) {
                    withContext(Dispatchers.Main) {
                        onError("서버 연결 실패: ${e.message ?: "PC 서버 상태를 확인하세요."}")
                        onResults(emptyList())
                    }
                } finally {
                    withContext(Dispatchers.Main) { onLoading(false) }
                }
            }
            return
        }

        scope.launch {
            withContext(Dispatchers.Main) { onLoading(true) }
            try {
                val response = withContext(Dispatchers.IO) {
                    searchWithRetry(trimmed)
                }

                if (!response.isSuccessful) {
                    withContext(Dispatchers.Main) {
                        onError(mapHttpError(response.code()))
                        onResults(emptyList())
                    }
                    return@launch
                }

                val body = response.body()
                if (body?.success != true) {
                    withContext(Dispatchers.Main) {
                        onError(body?.message ?: "학교 검색에 실패했습니다.")
                        onResults(emptyList())
                    }
                    return@launch
                }

                val schools = body.schools
                    .filter { it.code > 0 && it.name.isNotBlank() }
                    .filter { !it.name.contains("더 많이") && !it.name.contains("추가 검색") }

                if (schools.isEmpty()) {
                    withContext(Dispatchers.Main) {
                        onError("검색 결과가 없습니다. 학교명을 더 구체적으로 입력해 보세요.")
                        onResults(emptyList())
                    }
                    return@launch
                }

                withContext(Dispatchers.Main) { onResults(schools) }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    onError(
                        "서버 연결 실패: ${e.message ?: "인터넷과 PC 서버(터널) 상태를 확인하세요."}\n" +
                            "PC에서 dashboard\\start-public.bat 을 실행 중인지 확인해 주세요."
                    )
                    onResults(emptyList())
                }
            } finally {
                withContext(Dispatchers.Main) { onLoading(false) }
            }
        }
    }

    private suspend fun searchWithRetry(keyword: String): Response<SchoolSearchResponse> {
        var lastResponse: Response<SchoolSearchResponse>? = null
        var lastError: Exception? = null

        repeat(MAX_RETRIES) { attempt ->
            try {
                val response = RetrofitClient.apiService.searchSchools(keyword)
                lastResponse = response
                if (response.isSuccessful || response.code() !in RETRYABLE_HTTP) {
                    return response
                }
            } catch (e: Exception) {
                lastError = e
            }

            if (attempt < MAX_RETRIES - 1) {
                delay(1000L * (attempt + 1))
            }
        }

        lastResponse?.let { return it }
        throw lastError ?: IllegalStateException("학교 검색 요청 실패")
    }

    private fun mapHttpError(code: Int): String {
        return when (code) {
            408, 504 -> "서버 응답 시간 초과($code). PC에서 start-public.bat 실행 후 APK를 다시 빌드해 주세요."
            503 -> "서버 터널이 꺼졌습니다(503). PC에서 start-public.bat 을 실행하고 Constants.kt URL을 갱신한 뒤 재빌드하세요."
            502 -> "서버 연결 오류($code). PC 서버와 터널 상태를 확인해 주세요."
            else -> "검색 실패 (HTTP $code). 서버 주소와 인터넷 연결을 확인하세요."
        }
    }
}
