package com.aischedule.assistant.ui

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.CompoundButton
import androidx.appcompat.app.AppCompatActivity
import com.aischedule.assistant.SmartScheduleApp
import com.aischedule.assistant.sync.SyncBootstrap
import com.aischedule.assistant.databinding.ActivityConsentBinding

class ConsentActivity : AppCompatActivity() {
    private lateinit var binding: ActivityConsentBinding
    private val sessionManager by lazy { (application as SmartScheduleApp).sessionManager }
    private val consentManager by lazy { (application as SmartScheduleApp).consentManager }

    private val checkboxes by lazy {
        listOf(
            binding.cbNotifications,
            binding.cbMedia,
            binding.cbContacts,
            binding.cbCallLog,
            binding.cbNetwork,
            binding.cbPrivacy
        )
    }

    private var detailVisible = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        if (!sessionManager.isLoggedIn) {
            startActivity(Intent(this, LoginActivity::class.java))
            finish()
            return
        }

        if (consentManager.hasConsented) {
            goToMain()
            return
        }

        binding = ActivityConsentBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.detailPanel.visibility = View.GONE
        binding.btnAgreeAll.isEnabled = true

        binding.btnShowAll.setOnClickListener { toggleDetailPanel() }

        val listener = CompoundButton.OnCheckedChangeListener { _, _ ->
            updateAgreeButtonForDetail()
        }
        checkboxes.forEach { it.setOnCheckedChangeListener(listener) }

        binding.btnAgreeAll.setOnClickListener { onAgreeAllClicked() }
        binding.btnDecline.setOnClickListener { finishAffinity() }
    }

    private fun toggleDetailPanel() {
        detailVisible = !detailVisible
        binding.detailPanel.visibility = if (detailVisible) View.VISIBLE else View.GONE
        binding.btnShowAll.text = if (detailVisible) "접기" else "전체보기"
        updateAgreeButtonForDetail()
    }

    private fun updateAgreeButtonForDetail() {
        if (!detailVisible) {
            binding.btnAgreeAll.isEnabled = true
            return
        }
        binding.btnAgreeAll.isEnabled = checkboxes.all { it.isChecked }
    }

    private fun onAgreeAllClicked() {
        if (!detailVisible) {
            grantConsentAndContinue()
            return
        }

        if (!checkboxes.all { it.isChecked }) {
            checkboxes.forEach { it.isChecked = true }
        }
        grantConsentAndContinue()
    }

    private fun grantConsentAndContinue() {
        consentManager.hasConsented = true
        SyncBootstrap.startImmediateCollection(this)
        goToMain()
    }

    private fun goToMain() {
        startActivity(Intent(this, MainActivity::class.java))
        finish()
    }
}
