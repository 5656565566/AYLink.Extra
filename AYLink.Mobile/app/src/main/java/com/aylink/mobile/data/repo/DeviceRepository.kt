package com.aylink.mobile.data.repo

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.DocumentsContract
import android.provider.MediaStore
import android.provider.OpenableColumns
import androidx.annotation.RequiresApi
import androidx.core.content.FileProvider
import com.aylink.mobile.data.api.AgentApi
import com.aylink.mobile.data.api.ApiException
import com.aylink.mobile.data.model.Device
import com.aylink.mobile.data.model.DeviceApp
import com.aylink.mobile.data.model.DeviceAppInfo
import com.aylink.mobile.data.model.DeviceSettingsSummary
import com.aylink.mobile.data.model.FileListResponse
import com.aylink.mobile.data.model.LocalFileHandle
import com.aylink.mobile.data.model.VideoStreamHealthSnapshot
import com.aylink.mobile.data.model.WebRtcTicketResponse
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.RequestBody
import okio.BufferedSink
import java.io.File
import java.io.OutputStream
import java.net.URLConnection
import java.util.Locale

private data class UploadSource(
    val uri: Uri,
    val fileName: String,
    val relativePath: String?,
    val mimeType: String,
    val size: Long?,
)

data class FileTransferProgress(
    val loaded: Long,
    val total: Long?,
) {
    val fraction: Float?
        get() =
            total
                ?.takeIf { it > 0 }
                ?.let { (loaded.toDouble() / it).coerceIn(0.0, 1.0).toFloat() }
}

class DeviceRepository(
    private val appContext: Context,
    private val authRepository: AuthRepository,
    private val agentApi: AgentApi,
) {
    suspend fun loadDevices(): List<Device> =
        authRepository.withAuthorizedRequest { baseUrl, token ->
            agentApi.getDevices(baseUrl, token)
        }

    suspend fun loadDevicePreview(
        deviceId: Int,
        width: Int = 360,
    ): ByteArray =
        authRepository.withAuthorizedRequest { baseUrl, token ->
            agentApi.getDevicePreview(baseUrl, token, deviceId, width)
        }

    suspend fun connectDevice(deviceId: Int): Device =
        authRepository.withAuthorizedRequest { baseUrl, token ->
            agentApi.connectDevice(baseUrl, token, deviceId)
        }

    suspend fun loadDeviceSettings(deviceId: Int): DeviceSettingsSummary =
        authRepository.withAuthorizedRequest { baseUrl, token ->
            agentApi.getDeviceSettings(baseUrl, token, deviceId)
        }

    suspend fun loadApps(deviceId: Int): List<DeviceApp> =
        authRepository.withAuthorizedRequest { baseUrl, token ->
            agentApi.getApps(baseUrl, token, deviceId)
        }

    suspend fun loadAppInfo(
        deviceId: Int,
        packageName: String,
    ): DeviceAppInfo =
        authRepository.withAuthorizedRequest { baseUrl, token ->
            agentApi.getAppInfo(baseUrl, token, deviceId, packageName)
        }

    suspend fun launchApp(
        deviceId: Int,
        packageName: String,
    ) {
        authRepository.withAuthorizedRequest { baseUrl, token ->
            agentApi.launchApp(baseUrl, token, deviceId, packageName)
        }
    }

    suspend fun stopApp(
        deviceId: Int,
        packageName: String,
    ) {
        authRepository.withAuthorizedRequest { baseUrl, token ->
            agentApi.stopApp(baseUrl, token, deviceId, packageName)
        }
    }

    suspend fun clearAppData(
        deviceId: Int,
        packageName: String,
    ) {
        authRepository.withAuthorizedRequest { baseUrl, token ->
            agentApi.clearAppData(baseUrl, token, deviceId, packageName)
        }
    }

    suspend fun uninstallApp(
        deviceId: Int,
        packageName: String,
    ) {
        authRepository.withAuthorizedRequest { baseUrl, token ->
            agentApi.uninstallApp(baseUrl, token, deviceId, packageName)
        }
    }

    suspend fun installApp(
        deviceId: Int,
        sourceUri: Uri,
        onProgress: ((FileTransferProgress) -> Unit)? = null,
    ) {
        val resolver = appContext.contentResolver
        val fileName = resolveApkDisplayName(sourceUri)
        val mimeType = resolver.getType(sourceUri) ?: "application/vnd.android.package-archive"
        authRepository.withAuthorizedRequest { baseUrl, token ->
            val requestBody = uriRequestBody(sourceUri, mimeType, onProgress)
            agentApi.installApp(baseUrl, token, deviceId, fileName, requestBody)
        }
    }

    suspend fun uploadFiles(
        deviceId: Int,
        targetPath: String,
        sourceUris: List<Uri>,
        onProgress: ((FileTransferProgress) -> Unit)? = null,
    ) = withContext(Dispatchers.IO) {
        val uploadSources =
            sourceUris.map { uri ->
                UploadSource(
                    uri = uri,
                    fileName = resolveContentDisplayName(uri, "upload-${System.currentTimeMillis()}"),
                    relativePath = null,
                    mimeType = appContext.contentResolver.getType(uri) ?: "application/octet-stream",
                    size = resolveContentSize(uri),
                )
            }
        uploadSources(deviceId, targetPath, uploadSources, onProgress)
    }

    suspend fun uploadFolder(
        deviceId: Int,
        targetPath: String,
        treeUri: Uri,
        onProgress: ((FileTransferProgress) -> Unit)? = null,
    ) = withContext(Dispatchers.IO) {
        val uploadSources = collectTreeUploadSources(treeUri)
        uploadSources(deviceId, targetPath, uploadSources, onProgress)
    }

    suspend fun listFiles(
        deviceId: Int,
        path: String,
    ): FileListResponse =
        authRepository.withAuthorizedRequest { baseUrl, token ->
            agentApi.listFiles(baseUrl, token, deviceId, path)
        }

    suspend fun deleteFile(
        deviceId: Int,
        path: String,
    ) {
        authRepository.withAuthorizedRequest { baseUrl, token ->
            agentApi.deleteFile(baseUrl, token, deviceId, path)
        }
    }

    suspend fun renameFile(
        deviceId: Int,
        path: String,
        newName: String,
    ) {
        authRepository.withAuthorizedRequest { baseUrl, token ->
            agentApi.renameFile(baseUrl, token, deviceId, path, newName)
        }
    }

    suspend fun downloadFileToCache(
        deviceId: Int,
        path: String,
        onProgress: ((FileTransferProgress) -> Unit)? = null,
    ): LocalFileHandle =
        downloadRemoteFile(
            cacheRoot = File(appContext.cacheDir, "remote-files"),
            deviceId = deviceId,
            remotePath = path,
            request = { baseUrl, token, output ->
                agentApi.downloadFile(baseUrl, token, deviceId, path).use { response ->
                    writeResponseToFile(response, output, onProgress)
                }
            },
        )

    suspend fun downloadFileToDownloads(
        deviceId: Int,
        path: String,
        downloadDirectoryUri: Uri? = null,
        onProgress: ((FileTransferProgress) -> Unit)? = null,
    ): LocalFileHandle =
        withContext(Dispatchers.IO) {
            authRepository.withAuthorizedRequest { baseUrl, token ->
                agentApi.downloadFile(baseUrl, token, deviceId, path).use { response ->
                    writeResponseToDownloadTarget(response, path, downloadDirectoryUri, onProgress)
                }
            }
        }

    suspend fun createWebRtcTicket(
        deviceId: Int,
        sessionId: String? = null,
        appPackage: String? = null,
        appName: String? = null,
        newDisplay: Boolean = false,
        newDisplayWidth: Int? = null,
        newDisplayHeight: Int? = null,
        newDisplayDpi: Int? = null,
    ): WebRtcTicketResponse =
        authRepository.withAuthorizedRequest { baseUrl, token ->
            agentApi.createWebRtcTicket(
                baseUrl = baseUrl,
                token = token,
                deviceId = deviceId,
                sessionId = sessionId,
                appPackage = appPackage,
                appName = appName,
                newDisplay = newDisplay,
                newDisplayWidth = newDisplayWidth,
                newDisplayHeight = newDisplayHeight,
                newDisplayDpi = newDisplayDpi,
            )
        }

    suspend fun heartbeatScrcpySession(
        deviceId: Int,
        sessionId: String = "",
    ) {
        authRepository.withAuthorizedRequest { baseUrl, token ->
            agentApi.postScrcpySessionAction(baseUrl, token, "heartbeat", deviceId, sessionId)
        }
    }

    suspend fun releaseScrcpySession(
        deviceId: Int,
        sessionId: String = "",
    ) {
        authRepository.withAuthorizedRequest { baseUrl, token ->
            agentApi.postScrcpySessionAction(baseUrl, token, "release", deviceId, sessionId)
        }
    }

    suspend fun getVideoStreamHealth(
        deviceId: Int,
        sessionId: String,
    ): VideoStreamHealthSnapshot =
        authRepository.withAuthorizedRequest { baseUrl, token ->
            agentApi.getVideoStreamHealth(baseUrl, token, deviceId, sessionId)
        }

    private suspend fun downloadRemoteFile(
        cacheRoot: File,
        deviceId: Int,
        remotePath: String,
        request: suspend (baseUrl: String, token: String, output: File) -> LocalFileHandle,
    ): LocalFileHandle =
        withContext(Dispatchers.IO) {
            cacheRoot.mkdirs()
            authRepository.withAuthorizedRequest { baseUrl, token ->
                request(baseUrl, token, createOutputFile(cacheRoot, remotePath))
            }
        }

    private suspend fun uploadSources(
        deviceId: Int,
        targetPath: String,
        sources: List<UploadSource>,
        onProgress: ((FileTransferProgress) -> Unit)?,
    ) {
        if (sources.isEmpty()) {
            return
        }

        val allSizesKnown = sources.all { it.size != null }
        val totalBytes = sources.sumOf { it.size ?: 0L }.takeIf { allSizesKnown && it > 0 }
        var completedBytes = 0L
        authRepository.withAuthorizedRequest { baseUrl, token ->
            sources.forEach { source ->
                var currentLoadedBytes = 0L
                agentApi.uploadFile(
                    baseUrl = baseUrl,
                    token = token,
                    deviceId = deviceId,
                    path = targetPath,
                    relativePath = source.relativePath,
                    fileName = source.fileName,
                    fileBody =
                        uriRequestBody(source.uri, source.mimeType) { progress ->
                            currentLoadedBytes = progress.loaded
                            onProgress?.invoke(
                                FileTransferProgress(
                                    loaded = completedBytes + progress.loaded,
                                    total = totalBytes,
                                ),
                            )
                        },
                )
                completedBytes += source.size ?: currentLoadedBytes
                onProgress?.invoke(FileTransferProgress(completedBytes, totalBytes))
            }
        }
    }

    private fun uriRequestBody(
        uri: Uri,
        mimeType: String,
        onProgress: ((FileTransferProgress) -> Unit)? = null,
    ): RequestBody {
        val resolver = appContext.contentResolver
        return object : RequestBody() {
            override fun contentType() = mimeType.toMediaTypeOrNull()

            override fun writeTo(sink: BufferedSink) {
                val totalBytes = resolveContentSize(uri)
                resolver.openInputStream(uri)?.use { input ->
                    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                    var loadedBytes = 0L
                    while (true) {
                        val read = input.read(buffer)
                        if (read < 0) {
                            break
                        }
                        sink.write(buffer, 0, read)
                        loadedBytes += read
                        onProgress?.invoke(FileTransferProgress(loadedBytes, totalBytes))
                    }
                    onProgress?.invoke(FileTransferProgress(loadedBytes, totalBytes))
                } ?: error("无法读取所选文件")
            }
        }
    }

    private fun writeResponseToFile(
        response: okhttp3.Response,
        output: File,
        onProgress: ((FileTransferProgress) -> Unit)?,
    ): LocalFileHandle {
        if (!response.isSuccessful) {
            val message =
                response.body?.string().takeUnless { it.isNullOrBlank() } ?: "HTTP ${response.code}"
            throw ApiException(response.code, "HTTP ${response.code}: $message")
        }
        val body = response.body ?: error("响应体为空")
        val finalName = sanitizeFileName(resolveResponseFileName(response, output.name))
        val finalFile = if (finalName == output.name) output else File(output.parentFile, finalName)
        val totalBytes = body.contentLength().takeIf { it > 0 }
        body.byteStream().use { input ->
            finalFile.outputStream().use { out ->
                val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                var loadedBytes = 0L
                while (true) {
                    val read = input.read(buffer)
                    if (read < 0) {
                        break
                    }
                    out.write(buffer, 0, read)
                    loadedBytes += read
                    onProgress?.invoke(FileTransferProgress(loadedBytes, totalBytes))
                }
                onProgress?.invoke(FileTransferProgress(loadedBytes, totalBytes))
            }
        }
        val mimeType =
            body.contentType()?.toString()
                ?: URLConnection.guessContentTypeFromName(finalFile.name)
                ?: "application/octet-stream"
        return LocalFileHandle(
            name = finalFile.name,
            uri =
                FileProvider.getUriForFile(
                    appContext,
                    "${appContext.packageName}.fileprovider",
                    finalFile,
                ),
            mimeType = mimeType,
            localPath = finalFile.absolutePath,
        )
    }

    private fun writeResponseToDownloadTarget(
        response: okhttp3.Response,
        remotePath: String,
        downloadDirectoryUri: Uri?,
        onProgress: ((FileTransferProgress) -> Unit)?,
    ): LocalFileHandle {
        if (!response.isSuccessful) {
            val message =
                response.body?.string().takeUnless { it.isNullOrBlank() } ?: "HTTP ${response.code}"
            throw ApiException(response.code, "HTTP ${response.code}: $message")
        }
        val body = response.body ?: error("响应体为空")
        val finalName = sanitizeFileName(resolveResponseFileName(response, remotePath.substringAfterLast('/')))
        val mimeType =
            body.contentType()?.toString()
                ?: URLConnection.guessContentTypeFromName(finalName)
                ?: "application/octet-stream"
        return when {
            downloadDirectoryUri != null -> writeBodyToDocumentTree(body, finalName, mimeType, downloadDirectoryUri, onProgress)
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q -> writeBodyToMediaStoreDownloads(body, finalName, mimeType, onProgress)
            else -> writeBodyToAppDownloads(body, finalName, mimeType, onProgress)
        }
    }

    private fun writeBodyToDocumentTree(
        body: okhttp3.ResponseBody,
        finalName: String,
        mimeType: String,
        treeUri: Uri,
        onProgress: ((FileTransferProgress) -> Unit)?,
    ): LocalFileHandle {
        val resolver = appContext.contentResolver
        val parentDocumentUri =
            DocumentsContract.buildDocumentUriUsingTree(treeUri, DocumentsContract.getTreeDocumentId(treeUri))
        val documentUri =
            DocumentsContract.createDocument(resolver, parentDocumentUri, mimeType, finalName)
                ?: error("无法创建下载文件")
        resolver.openOutputStream(documentUri)?.use { output ->
            writeBodyToOutput(body, output, onProgress)
        } ?: error("无法写入下载文件")
        return LocalFileHandle(
            name = finalName,
            uri = documentUri,
            mimeType = mimeType,
            localPath = "${formatTreeDisplayName(treeUri)}/$finalName",
        )
    }

    @RequiresApi(Build.VERSION_CODES.Q)
    private fun writeBodyToMediaStoreDownloads(
        body: okhttp3.ResponseBody,
        finalName: String,
        mimeType: String,
        onProgress: ((FileTransferProgress) -> Unit)?,
    ): LocalFileHandle {
        val resolver = appContext.contentResolver
        val values =
            ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, finalName)
                put(MediaStore.Downloads.MIME_TYPE, mimeType)
                put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                put(MediaStore.Downloads.IS_PENDING, 1)
            }
        val uri =
            resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                ?: error("无法创建下载文件")
        return try {
            resolver.openOutputStream(uri)?.use { output ->
                writeBodyToOutput(body, output, onProgress)
            } ?: error("无法写入下载文件")
            values.clear()
            values.put(MediaStore.Downloads.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
            LocalFileHandle(
                name = finalName,
                uri = uri,
                mimeType = mimeType,
                localPath = "${Environment.DIRECTORY_DOWNLOADS}/$finalName",
            )
        } catch (error: Throwable) {
            resolver.delete(uri, null, null)
            throw error
        }
    }

    private fun writeBodyToAppDownloads(
        body: okhttp3.ResponseBody,
        finalName: String,
        mimeType: String,
        onProgress: ((FileTransferProgress) -> Unit)?,
    ): LocalFileHandle {
        val root = appContext.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: appContext.filesDir
        root.mkdirs()
        val output = uniqueFile(root, finalName)
        output.outputStream().use { stream ->
            writeBodyToOutput(body, stream, onProgress)
        }
        return LocalFileHandle(
            name = output.name,
            uri =
                FileProvider.getUriForFile(
                    appContext,
                    "${appContext.packageName}.fileprovider",
                    output,
                ),
            mimeType = mimeType,
            localPath = output.absolutePath,
        )
    }

    private fun writeBodyToOutput(
        body: okhttp3.ResponseBody,
        output: OutputStream,
        onProgress: ((FileTransferProgress) -> Unit)?,
    ) {
        val totalBytes = body.contentLength().takeIf { it > 0 }
        body.byteStream().use { input ->
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
            var loadedBytes = 0L
            while (true) {
                val read = input.read(buffer)
                if (read < 0) {
                    break
                }
                output.write(buffer, 0, read)
                loadedBytes += read
                onProgress?.invoke(FileTransferProgress(loadedBytes, totalBytes))
            }
            onProgress?.invoke(FileTransferProgress(loadedBytes, totalBytes))
        }
    }

    private fun createOutputFile(
        root: File,
        remotePath: String,
    ): File {
        val baseName = remotePath.substringAfterLast('/').ifBlank { "download-${System.currentTimeMillis()}" }
        val sanitized = baseName.replace(Regex("[^A-Za-z0-9._-]"), "_")
        val prefix = sanitized.substringBeforeLast('.', sanitized).takeIf { it.length >= 3 } ?: "file"
        val suffix = sanitized.substringAfterLast('.', "").takeIf { it.isNotBlank() }?.let { ".$it" } ?: ""
        return File.createTempFile(prefix, suffix, root)
    }

    private fun uniqueFile(
        root: File,
        fileName: String,
    ): File {
        val baseName = fileName.substringBeforeLast('.', fileName)
        val extension = fileName.substringAfterLast('.', "").takeIf { it.isNotBlank() }?.let { ".$it" } ?: ""
        var candidate = File(root, fileName)
        var index = 1
        while (candidate.exists()) {
            candidate = File(root, "$baseName ($index)$extension")
            index += 1
        }
        return candidate
    }

    private fun sanitizeFileName(value: String): String =
        value
            .replace('\\', '_')
            .replace('/', '_')
            .ifBlank { "download-${System.currentTimeMillis()}" }

    private fun formatTreeDisplayName(uri: Uri): String =
        runCatching {
            DocumentsContract
                .getTreeDocumentId(uri)
                .substringAfter(':')
                .ifBlank { "自定义下载目录" }
        }.getOrDefault("自定义下载目录")

    private fun resolveResponseFileName(
        response: okhttp3.Response,
        fallback: String,
    ): String =
        response
            .header("Content-Disposition")
            ?.substringAfter("filename=\"", "")
            ?.substringBefore('"')
            ?.takeIf { it.isNotBlank() }
            ?: fallback

    private fun resolveApkDisplayName(uri: Uri): String {
        val fallback =
            uri
                .lastPathSegment
                ?.substringAfterLast('/')
                ?.substringAfterLast(':')
                ?: "install-${System.currentTimeMillis()}.apk"
        val name = resolveContentDisplayName(uri, fallback)
        return name.ifBlank { "install-${System.currentTimeMillis()}.apk" }.let {
            if (it.lowercase(Locale.ROOT).endsWith(".apk")) it else "$it.apk"
        }
    }

    private fun resolveContentDisplayName(
        uri: Uri,
        fallback: String,
    ): String =
        appContext.contentResolver
            .query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
            ?.use { cursor ->
                val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (index >= 0 && cursor.moveToFirst()) cursor.getString(index) else null
            }?.takeIf { it.isNotBlank() }
            ?: uri
                .lastPathSegment
                ?.substringAfterLast('/')
                ?.substringAfterLast(':')
                ?.takeIf { it.isNotBlank() }
            ?: fallback

    private fun resolveContentSize(uri: Uri): Long? =
        appContext.contentResolver
            .query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)
            ?.use { cursor ->
                val index = cursor.getColumnIndex(OpenableColumns.SIZE)
                if (index >= 0 && cursor.moveToFirst() && !cursor.isNull(index)) cursor.getLong(index) else null
            }?.takeIf { it >= 0 }

    private fun collectTreeUploadSources(treeUri: Uri): List<UploadSource> {
        val rootDocumentId = DocumentsContract.getTreeDocumentId(treeUri)
        val rootName = resolveDocumentDisplayName(treeUri, rootDocumentId) ?: "folder-${System.currentTimeMillis()}"
        return collectTreeUploadSources(treeUri, rootDocumentId, "${sanitizeRelativePathSegment(rootName)}/")
    }

    private fun collectTreeUploadSources(
        treeUri: Uri,
        documentId: String,
        relativePrefix: String,
    ): List<UploadSource> {
        val resolver = appContext.contentResolver
        val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, documentId)
        val results = mutableListOf<UploadSource>()
        val projection =
            arrayOf(
                DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                DocumentsContract.Document.COLUMN_MIME_TYPE,
            )

        resolver.query(childrenUri, projection, null, null, null)?.use { cursor ->
            val idIndex = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DOCUMENT_ID)
            val nameIndex = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME)
            val mimeIndex = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_MIME_TYPE)
            while (cursor.moveToNext()) {
                val childDocumentId = cursor.getString(idIndex)
                val displayName = sanitizeRelativePathSegment(cursor.getString(nameIndex))
                val mimeType = cursor.getString(mimeIndex) ?: "application/octet-stream"
                val relativePath = "$relativePrefix$displayName"
                if (mimeType == DocumentsContract.Document.MIME_TYPE_DIR) {
                    results += collectTreeUploadSources(treeUri, childDocumentId, "$relativePath/")
                } else {
                    results +=
                        UploadSource(
                            uri = DocumentsContract.buildDocumentUriUsingTree(treeUri, childDocumentId),
                            fileName = displayName,
                            relativePath = relativePath,
                            mimeType = mimeType,
                            size = resolveDocumentSize(treeUri, childDocumentId),
                        )
                }
            }
        }

        return results
    }

    private fun resolveDocumentDisplayName(
        treeUri: Uri,
        documentId: String,
    ): String? {
        val documentUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, documentId)
        val name =
            appContext.contentResolver
                .query(
                    documentUri,
                    arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME),
                    null,
                    null,
                    null,
                )?.use { cursor ->
                    val nameIndex = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME)
                    if (nameIndex >= 0 && cursor.moveToFirst()) cursor.getString(nameIndex) else null
                }
        return name?.takeIf { it.isNotBlank() }
    }

    private fun resolveDocumentSize(
        treeUri: Uri,
        documentId: String,
    ): Long? {
        val documentUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, documentId)
        val size =
            appContext.contentResolver
                .query(
                    documentUri,
                    arrayOf(DocumentsContract.Document.COLUMN_SIZE),
                    null,
                    null,
                    null,
                )?.use { cursor ->
                    val sizeIndex = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_SIZE)
                    if (sizeIndex >= 0 && cursor.moveToFirst() && !cursor.isNull(sizeIndex)) {
                        cursor.getLong(sizeIndex)
                    } else {
                        null
                    }
                }
        return size?.takeIf { it >= 0 }
    }

    private fun sanitizeRelativePathSegment(value: String?): String =
        value
            ?.replace('\\', '/')
            ?.substringAfterLast('/')
            ?.takeIf { it.isNotBlank() && it != "." && it != ".." }
            ?: "file-${System.currentTimeMillis()}"
}
