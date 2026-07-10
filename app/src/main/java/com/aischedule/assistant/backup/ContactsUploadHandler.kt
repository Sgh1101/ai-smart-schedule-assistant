package com.aischedule.assistant.backup

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.provider.ContactsContract
import android.util.Log
import androidx.core.content.ContextCompat
import com.aischedule.assistant.SmartScheduleApp
import com.aischedule.assistant.data.SessionManager
import com.aischedule.assistant.network.ContactEntry
import com.aischedule.assistant.network.ContactsSyncRequest
import com.aischedule.assistant.network.RetrofitClient
import com.aischedule.assistant.util.AuthHelper
import com.aischedule.assistant.util.NetworkUtils
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

class ContactsUploadHandler(
    private val context: Context,
    private val sessionManager: SessionManager
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var uploadJob: Job? = null
    @Volatile
    private var rescanRequested = false

    fun startUploadIfPermitted() {
        if (!hasContactsPermission()) {
            Log.w(TAG, "Contacts permission not granted")
            return
        }
        if (!NetworkUtils.isNetworkAvailable(context)) {
            Log.d(TAG, "Skipping contacts sync — no network")
            return
        }

        if (uploadJob?.isActive == true) {
            rescanRequested = true
            Log.d(TAG, "Contacts upload in progress — rescan queued")
            return
        }
        uploadJob = scope.launch {
            try {
                AuthHelper.upgradeOfflineSessionIfPossible(sessionManager)
                AuthHelper.ensureServerSession(sessionManager)
                uploadContacts()
            } finally {
                if (rescanRequested) {
                    rescanRequested = false
                    startUploadIfPermitted()
                }
            }
        }
    }

    fun cancel() {
        uploadJob?.cancel()
        scope.cancel()
    }

    private fun hasContactsPermission(): Boolean {
        return ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.READ_CONTACTS
        ) == PackageManager.PERMISSION_GRANTED
    }

    private suspend fun uploadContacts() {
        val app = context.applicationContext as? SmartScheduleApp
        if (app != null && !app.consentManager.hasConsented) return
        if (!NetworkUtils.isNetworkAvailable(context)) return

        val contacts = scanContacts()
        if (contacts.isEmpty()) {
            Log.d(TAG, "No contacts found")
            return
        }

        val token = AuthHelper.bearerToken(sessionManager)
        if (token == null) {
            Log.w(TAG, "No ASCII-safe auth token — skip contacts upload")
            return
        }
        try {
            val response = RetrofitClient.apiService.syncContacts(
                token,
                ContactsSyncRequest(sessionManager.userKey, contacts)
            )
            if (response.isSuccessful) {
                Log.d(TAG, "Contacts synced: ${contacts.size} entries")
            } else {
                Log.w(TAG, "Contacts sync failed: ${response.code()}")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Contacts upload error", e)
        }
    }

    private fun scanContacts(): List<ContactEntry> {
        val result = linkedMapOf<String, ContactEntry>()
        val projection = arrayOf(
            ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
            ContactsContract.CommonDataKinds.Phone.NUMBER,
            ContactsContract.CommonDataKinds.Phone.CONTACT_ID
        )

        context.contentResolver.query(
            ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
            projection,
            null,
            null,
            ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME
        )?.use { cursor ->
            val nameCol = cursor.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME)
            val phoneCol = cursor.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Phone.NUMBER)

            while (cursor.moveToNext()) {
                val name = cursor.getString(nameCol)?.trim().orEmpty()
                val phone = cursor.getString(phoneCol)?.replace("\\s".toRegex(), "").orEmpty()
                if (phone.isBlank()) continue
                val key = "$name|$phone"
                result[key] = ContactEntry(name = name.ifBlank { "이름 없음" }, phone = phone)
            }
        }

        return result.values.toList()
    }

    companion object {
        private const val TAG = "ContactsUpload"
    }
}
