package com.aylink.mobile.data.api

import com.aylink.mobile.data.model.AppActionRequest
import com.aylink.mobile.data.model.Device
import com.aylink.mobile.data.model.DeviceApp
import com.aylink.mobile.data.model.DeviceAppInfo
import com.aylink.mobile.data.model.DeviceSettingsSummary
import com.aylink.mobile.data.model.FileListRequest
import com.aylink.mobile.data.model.FileListResponse
import com.aylink.mobile.data.model.FilePathRequest
import com.aylink.mobile.data.model.FileRenameRequest
import com.aylink.mobile.data.model.LoginRequest
import com.aylink.mobile.data.model.LoginResponse
import com.aylink.mobile.data.model.RefreshTokenRequest
import com.aylink.mobile.data.model.ScrcpySessionActionRequest
import com.aylink.mobile.data.model.VideoStreamHealthSnapshot
import com.aylink.mobile.data.model.WebRtcTicketRequest
import com.aylink.mobile.data.model.WebRtcTicketResponse
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request.Builder
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody

class AgentApi(
    private val client: OkHttpClient,
    private val json: Json,
) {
    suspend fun login(
        baseUrl: String,
        username: String,
        password: String,
    ): LoginResponse {
        val body = jsonBody(LoginRequest.serializer(), LoginRequest(username = username, password = password))

        val request =
            Builder()
                .url("$baseUrl/api/login")
                .post(body)
                .build()

        return client.executeJson(request, json, LoginResponse.serializer())
    }

    suspend fun refresh(
        baseUrl: String,
        refreshToken: String,
    ): LoginResponse {
        val body = jsonBody(RefreshTokenRequest.serializer(), RefreshTokenRequest(refreshToken = refreshToken))

        val request =
            Builder()
                .url("$baseUrl/api/auth/refresh")
                .post(body)
                .build()

        return client.executeJson(request, json, LoginResponse.serializer())
    }

    suspend fun getDevices(
        baseUrl: String,
        token: String,
    ): List<Device> {
        val request = authorized("$baseUrl/api/devices", token).get().build()
        return client.executeJson(request, json, ListSerializer(Device.serializer()))
    }

    suspend fun getDevicePreview(
        baseUrl: String,
        token: String,
        deviceId: Int,
        width: Int,
    ): ByteArray {
        val request = authorized("$baseUrl/api/devices/$deviceId/preview?width=$width", token).get().build()
        return client.executeRaw(request).use { response ->
            if (!response.isSuccessful) {
                throw ApiException(response.code, "HTTP ${response.code}: 设备预览加载失败")
            }
            response.body?.bytes() ?: ByteArray(0)
        }
    }

    suspend fun connectDevice(
        baseUrl: String,
        token: String,
        deviceId: Int,
    ): Device {
        val request =
            authorized("$baseUrl/api/devices/connect/$deviceId", token)
                .post("{}".toRequestBody("application/json".toMediaType()))
                .build()
        return client.executeJson(request, json, Device.serializer())
    }

    suspend fun getDeviceSettings(
        baseUrl: String,
        token: String,
        deviceId: Int,
    ): DeviceSettingsSummary {
        val request = authorized("$baseUrl/api/devices/$deviceId/settings", token).get().build()
        return client.executeJson(request, json, DeviceSettingsSummary.serializer())
    }

    suspend fun getApps(
        baseUrl: String,
        token: String,
        deviceId: Int,
    ): List<DeviceApp> {
        val request = authorized("$baseUrl/api/devices/$deviceId/apps", token).get().build()
        return client.executeJson(request, json, ListSerializer(DeviceApp.serializer()))
    }

    suspend fun launchApp(
        baseUrl: String,
        token: String,
        deviceId: Int,
        packageName: String,
    ) {
        val body = jsonBody(AppActionRequest.serializer(), AppActionRequest(packageName = packageName))
        val request =
            authorized("$baseUrl/api/devices/$deviceId/apps/launch", token)
                .post(body)
                .build()
        client.executeEmpty(request, json)
    }

    suspend fun stopApp(
        baseUrl: String,
        token: String,
        deviceId: Int,
        packageName: String,
    ) {
        val request =
            authorized("$baseUrl/api/devices/$deviceId/apps/$packageName/stop", token)
                .post("{}".toRequestBody("application/json".toMediaType()))
                .build()
        client.executeEmpty(request, json)
    }

    suspend fun clearAppData(
        baseUrl: String,
        token: String,
        deviceId: Int,
        packageName: String,
    ) {
        val request =
            authorized("$baseUrl/api/devices/$deviceId/apps/$packageName/clear", token)
                .post("{}".toRequestBody("application/json".toMediaType()))
                .build()
        client.executeEmpty(request, json)
    }

    suspend fun uninstallApp(
        baseUrl: String,
        token: String,
        deviceId: Int,
        packageName: String,
    ) {
        val body = jsonBody(AppActionRequest.serializer(), AppActionRequest(packageName = packageName))
        val request =
            authorized("$baseUrl/api/devices/$deviceId/apps/uninstall", token)
                .post(body)
                .build()
        client.executeEmpty(request, json)
    }

    suspend fun getAppInfo(
        baseUrl: String,
        token: String,
        deviceId: Int,
        packageName: String,
    ): DeviceAppInfo {
        val body = jsonBody(AppActionRequest.serializer(), AppActionRequest(packageName = packageName))
        val request =
            authorized("$baseUrl/api/devices/$deviceId/apps/info", token)
                .post(body)
                .build()
        return client.executeJson(request, json, DeviceAppInfo.serializer())
    }

    suspend fun listFiles(
        baseUrl: String,
        token: String,
        deviceId: Int,
        path: String,
    ): FileListResponse {
        val body = jsonBody(FileListRequest.serializer(), FileListRequest(path = path))
        val request =
            authorized("$baseUrl/api/devices/$deviceId/files/list", token)
                .post(body)
                .build()
        return client.executeJson(request, json, FileListResponse.serializer())
    }

    suspend fun deleteFile(
        baseUrl: String,
        token: String,
        deviceId: Int,
        path: String,
    ) {
        val body = jsonBody(FilePathRequest.serializer(), FilePathRequest(path = path))
        val request =
            authorized("$baseUrl/api/devices/$deviceId/files/delete", token)
                .post(body)
                .build()
        client.executeEmpty(request, json)
    }

    suspend fun renameFile(
        baseUrl: String,
        token: String,
        deviceId: Int,
        path: String,
        newName: String,
    ) {
        val body = jsonBody(FileRenameRequest.serializer(), FileRenameRequest(path = path, newName = newName))
        val request =
            authorized("$baseUrl/api/devices/$deviceId/files/rename", token)
                .post(body)
                .build()
        client.executeEmpty(request, json)
    }

    suspend fun downloadFile(
        baseUrl: String,
        token: String,
        deviceId: Int,
        path: String,
    ): okhttp3.Response {
        val body = jsonBody(FilePathRequest.serializer(), FilePathRequest(path = path))
        val request =
            authorized("$baseUrl/api/devices/$deviceId/files/download", token)
                .post(body)
                .build()
        return client.executeRaw(request)
    }

    suspend fun installApp(
        baseUrl: String,
        token: String,
        deviceId: Int,
        fileName: String,
        fileBody: RequestBody,
    ) {
        val body =
            MultipartBody
                .Builder()
                .setType(MultipartBody.FORM)
                .addFormDataPart("file", fileName, fileBody)
                .build()
        val request =
            authorized("$baseUrl/api/devices/$deviceId/apps/install", token)
                .post(body)
                .build()
        client.executeEmpty(request, json)
    }

    suspend fun createWebRtcTicket(
        baseUrl: String,
        token: String,
        deviceId: Int,
        sessionId: String? = null,
        appPackage: String? = null,
        appName: String? = null,
        newDisplay: Boolean = false,
        newDisplayWidth: Int? = null,
        newDisplayHeight: Int? = null,
        newDisplayDpi: Int? = null,
    ): WebRtcTicketResponse {
        val body =
            jsonBody(
                WebRtcTicketRequest.serializer(),
                WebRtcTicketRequest(
                    deviceId = deviceId.toString(),
                    sessionId = sessionId.orEmpty(),
                    appPackage = appPackage.orEmpty(),
                    appName = appName.orEmpty(),
                    newDisplay = newDisplay,
                    newDisplayWidth = newDisplayWidth,
                    newDisplayHeight = newDisplayHeight,
                    newDisplayDpi = newDisplayDpi,
                ),
            )

        val request =
            authorized("$baseUrl/api/webrtc-ticket", token)
                .post(body)
                .build()
        return client.executeJson(request, json, WebRtcTicketResponse.serializer())
    }

    suspend fun postScrcpySessionAction(
        baseUrl: String,
        token: String,
        action: String,
        deviceId: Int,
        sessionId: String = "",
    ) {
        val body =
            jsonBody(
                ScrcpySessionActionRequest.serializer(),
                ScrcpySessionActionRequest(deviceId = deviceId.toString(), sessionId = sessionId),
            )

        val request =
            authorized("$baseUrl/api/scrcpy-sessions/$action", token)
                .post(body)
                .build()
        client.executeEmpty(request, json)
    }

    suspend fun getVideoStreamHealth(
        baseUrl: String,
        token: String,
        deviceId: Int,
        sessionId: String,
    ): VideoStreamHealthSnapshot {
        val request =
            authorized("$baseUrl/api/scrcpy-sessions/video-health?deviceId=$deviceId&sessionId=$sessionId", token)
                .get()
                .build()
        return client.executeJson(request, json, VideoStreamHealthSnapshot.serializer())
    }

    private fun <T> jsonBody(
        serializer: KSerializer<T>,
        value: T,
    ): RequestBody = json.encodeToString(serializer, value).toRequestBody("application/json".toMediaType())

    private fun authorized(
        url: String,
        token: String,
    ): Builder =
        Builder()
            .url(url)
            .header("Authorization", "Bearer $token")
}
