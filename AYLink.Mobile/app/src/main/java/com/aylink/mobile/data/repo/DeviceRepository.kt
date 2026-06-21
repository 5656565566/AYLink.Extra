package com.aylink.mobile.data.repo

import android.content.Context
import android.net.Uri
import androidx.core.content.FileProvider
import com.aylink.mobile.data.api.ApiException
import com.aylink.mobile.data.api.AgentApi
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
import java.net.URLConnection
import java.util.Locale

class DeviceRepository(
    private val appContext: Context,
    private val authRepository: AuthRepository,
    private val agentApi: AgentApi
) {
    suspend fun loadDevices(): List<Device> =
        authRepository.withAuthorizedRequest { baseUrl, token ->
            agentApi.getDevices(baseUrl, token)
        }

    suspend fun loadDevicePreview(deviceId: Int, width: Int = 360): ByteArray =
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

    suspend fun loadAppInfo(deviceId: Int, packageName: String): DeviceAppInfo =
        authRepository.withAuthorizedRequest { baseUrl, token ->
            agentApi.getAppInfo(baseUrl, token, deviceId, packageName)
        }
    
    suspend fun launchApp(deviceId: Int, packageName: String) {
        authRepository.withAuthorizedRequest { baseUrl, token ->
            agentApi.launchApp(baseUrl, token, deviceId, packageName)
        }
    }
    
    suspend fun stopApp(deviceId: Int, packageName: String) {
        authRepository.withAuthorizedRequest { baseUrl, token ->
            agentApi.stopApp(baseUrl, token, deviceId, packageName)
        }
    }
    
    suspend fun clearAppData(deviceId: Int, packageName: String) {
        authRepository.withAuthorizedRequest { baseUrl, token ->
            agentApi.clearAppData(baseUrl, token, deviceId, packageName)
        }
    }
    
    suspend fun uninstallApp(deviceId: Int, packageName: String) {
        authRepository.withAuthorizedRequest { baseUrl, token ->
            agentApi.uninstallApp(baseUrl, token, deviceId, packageName)
        }
    }

    suspend fun installApp(deviceId: Int, sourceUri: Uri) {
        val resolver = appContext.contentResolver
        val fileName = resolveDisplayName(sourceUri)
        val mimeType = resolver.getType(sourceUri) ?: "application/vnd.android.package-archive"
        authRepository.withAuthorizedRequest { baseUrl, token ->
            val requestBody = object : RequestBody() {
                override fun contentType() = mimeType.toMediaTypeOrNull()

                override fun writeTo(sink: BufferedSink) {
                    resolver.openInputStream(sourceUri)?.use { input ->
                        sink.outputStream().use { output -> input.copyTo(output) }
                    } ?: error("无法读取所选 APK")
                }
            }
            agentApi.installApp(baseUrl, token, deviceId, fileName, requestBody)
        }
    }

    suspend fun listFiles(deviceId: Int, path: String): FileListResponse =
        authRepository.withAuthorizedRequest { baseUrl, token ->
            agentApi.listFiles(baseUrl, token, deviceId, path)
        }

    suspend fun deleteFile(deviceId: Int, path: String) {
        authRepository.withAuthorizedRequest { baseUrl, token ->
            agentApi.deleteFile(baseUrl, token, deviceId, path)
        }
    }

    suspend fun renameFile(deviceId: Int, path: String, newName: String) {
        authRepository.withAuthorizedRequest { baseUrl, token ->
            agentApi.renameFile(baseUrl, token, deviceId, path, newName)
        }
    }

    suspend fun downloadFileToCache(deviceId: Int, path: String): LocalFileHandle =
        downloadRemoteFile(
            cacheRoot = File(appContext.cacheDir, "remote-files"),
            deviceId = deviceId,
            remotePath = path,
            request = { baseUrl, token, output ->
                agentApi.downloadFile(baseUrl, token, deviceId, path).use { response ->
                    writeResponseToFile(response, output)
                }
            }
        )

    suspend fun downloadFileToDownloads(deviceId: Int, path: String): LocalFileHandle =
        downloadRemoteFile(
            cacheRoot = File(appContext.getExternalFilesDir(null) ?: appContext.filesDir, "downloads"),
            deviceId = deviceId,
            remotePath = path,
            request = { baseUrl, token, output ->
                agentApi.downloadFile(baseUrl, token, deviceId, path).use { response ->
                    writeResponseToFile(response, output)
                }
            }
        )

    suspend fun createWebRtcTicket(
        deviceId: Int,
        sessionId: String? = null,
        appPackage: String? = null,
        appName: String? = null,
        newDisplay: Boolean = false,
        newDisplayWidth: Int? = null,
        newDisplayHeight: Int? = null,
        newDisplayDpi: Int? = null
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
                newDisplayDpi = newDisplayDpi
            )
        }

    suspend fun heartbeatScrcpySession(deviceId: Int, sessionId: String = "") {
        authRepository.withAuthorizedRequest { baseUrl, token ->
            agentApi.postScrcpySessionAction(baseUrl, token, "heartbeat", deviceId, sessionId)
        }
    }

    suspend fun releaseScrcpySession(deviceId: Int, sessionId: String = "") {
        authRepository.withAuthorizedRequest { baseUrl, token ->
            agentApi.postScrcpySessionAction(baseUrl, token, "release", deviceId, sessionId)
        }
    }

    suspend fun getVideoStreamHealth(deviceId: Int, sessionId: String): VideoStreamHealthSnapshot =
        authRepository.withAuthorizedRequest { baseUrl, token ->
            agentApi.getVideoStreamHealth(baseUrl, token, deviceId, sessionId)
        }

    private suspend fun downloadRemoteFile(
        cacheRoot: File,
        deviceId: Int,
        remotePath: String,
        request: suspend (baseUrl: String, token: String, output: File) -> LocalFileHandle
    ): LocalFileHandle = withContext(Dispatchers.IO) {
        cacheRoot.mkdirs()
        authRepository.withAuthorizedRequest { baseUrl, token ->
            request(baseUrl, token, createOutputFile(cacheRoot, remotePath))
        }
    }

    private fun writeResponseToFile(response: okhttp3.Response, output: File): LocalFileHandle {
        if (!response.isSuccessful) {
            val message = response.body?.string().takeUnless { it.isNullOrBlank() } ?: "HTTP ${response.code}"
            throw ApiException(response.code, "HTTP ${response.code}: $message")
        }
        val finalName = response.header("Content-Disposition")
            ?.substringAfter("filename=\"", "")
            ?.substringBefore('"')
            ?.takeIf { it.isNotBlank() }
            ?: output.name
        val finalFile = if (finalName == output.name) output else File(output.parentFile, finalName)
        response.body?.byteStream()?.use { input ->
            finalFile.outputStream().use { out -> input.copyTo(out) }
        } ?: error("响应体为空")
        val mimeType = response.body?.contentType()?.toString()
            ?: URLConnection.guessContentTypeFromName(finalFile.name)
            ?: "application/octet-stream"
        return LocalFileHandle(
            name = finalFile.name,
            uri = FileProvider.getUriForFile(
                appContext,
                "${appContext.packageName}.fileprovider",
                finalFile
            ),
            mimeType = mimeType,
            localPath = finalFile.absolutePath
        )
    }

    private fun createOutputFile(root: File, remotePath: String): File {
        val baseName = remotePath.substringAfterLast('/').ifBlank { "download-${System.currentTimeMillis()}" }
        val sanitized = baseName.replace(Regex("[^A-Za-z0-9._-]"), "_")
        val prefix = sanitized.substringBeforeLast('.', sanitized).takeIf { it.length >= 3 } ?: "file"
        val suffix = sanitized.substringAfterLast('.', "").takeIf { it.isNotBlank() }?.let { ".$it" } ?: ""
        return File.createTempFile(prefix, suffix, root)
    }

    private fun resolveDisplayName(uri: Uri): String {
        val fallback = uri.lastPathSegment?.substringAfterLast('/')?.substringAfterLast(':')
            ?: "install-${System.currentTimeMillis()}.apk"
        val name = appContext.contentResolver.query(uri, arrayOf("_display_name"), null, null, null)?.use { cursor ->
            val index = cursor.getColumnIndex("_display_name")
            if (index >= 0 && cursor.moveToFirst()) cursor.getString(index) else null
        }
        return (name ?: fallback).ifBlank { "install-${System.currentTimeMillis()}.apk" }.let {
            if (it.lowercase(Locale.ROOT).endsWith(".apk")) it else "$it.apk"
        }
    }
}
