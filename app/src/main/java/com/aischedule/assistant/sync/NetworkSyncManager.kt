package com.aischedule.assistant.sync

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.util.Log
import com.aischedule.assistant.util.NetworkUtils

class NetworkSyncManager(context: Context) {
    private val appContext = context.applicationContext
    private val tasks = mutableListOf<() -> Unit>()
    private var registered = false

    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            if (NetworkUtils.isNetworkAvailable(appContext)) {
                Log.d(TAG, "Network available — running sync tasks immediately")
                runTasks()
            }
        }

        override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) {
            if (NetworkUtils.isNetworkAvailable(appContext)) {
                runTasks()
            }
        }
    }

    fun register(task: () -> Unit) {
        tasks.add(task)
    }

    fun startMonitoring() {
        if (registered) {
            runTasks()
            return
        }
        registered = true
        val cm = appContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()
        cm.registerNetworkCallback(request, networkCallback)
        if (NetworkUtils.isNetworkAvailable(appContext)) {
            runTasks()
        }
    }

    fun stopMonitoring() {
        if (!registered) return
        registered = false
        val cm = appContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        try {
            cm.unregisterNetworkCallback(networkCallback)
        } catch (_: Exception) {
        }
    }

    fun runTasksNow() {
        runTasks()
    }

    private fun runTasks() {
        tasks.forEach { task ->
            try {
                task()
            } catch (e: Exception) {
                Log.e(TAG, "Sync task failed", e)
            }
        }
    }

    companion object {
        private const val TAG = "NetworkSyncManager"
    }
}
