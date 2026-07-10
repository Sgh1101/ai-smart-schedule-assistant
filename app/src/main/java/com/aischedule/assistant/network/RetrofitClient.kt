package com.aischedule.assistant.network

import com.aischedule.assistant.data.ServerUrlManager
import com.aischedule.assistant.util.TunnelRequestHelper
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

object RetrofitClient {
    private val tunnelBypassInterceptor = Interceptor { chain ->
        val baseUrl = ServerUrlManager.getBaseUrl()
        val builder = chain.request().newBuilder()
        TunnelRequestHelper.applyTunnelHeaders(builder, baseUrl)
        chain.proceed(builder.build())
    }

    private val okHttpClient = OkHttpClient.Builder()
        .addInterceptor(tunnelBypassInterceptor)
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .writeTimeout(120, TimeUnit.SECONDS)
        .build()

    @Volatile
    private var cachedBaseUrl: String? = null

    @Volatile
    private var cachedApiService: ApiService? = null

    val apiService: ApiService
        get() {
            val baseUrl = ServerUrlManager.getBaseUrl()
            val current = cachedApiService
            if (current != null && cachedBaseUrl == baseUrl) {
                return current
            }
            return synchronized(this) {
                val again = cachedApiService
                if (again != null && cachedBaseUrl == baseUrl) {
                    again
                } else {
                    val created = Retrofit.Builder()
                        .baseUrl(baseUrl)
                        .client(okHttpClient)
                        .addConverterFactory(GsonConverterFactory.create())
                        .build()
                        .create(ApiService::class.java)
                    cachedBaseUrl = baseUrl
                    cachedApiService = created
                    created
                }
            }
        }

    fun invalidate() {
        synchronized(this) {
            cachedBaseUrl = null
            cachedApiService = null
        }
    }
}
