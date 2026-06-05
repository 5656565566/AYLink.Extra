@file:OptIn(kotlinx.serialization.ExperimentalSerializationApi::class)

package com.aylink.mobile.data.model

import androidx.compose.runtime.Immutable
import android.net.Uri
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonNames

@Serializable
data class LoginRequest(
    val username: String,
    val password: String
)

@Serializable
data class RefreshTokenRequest(
    val refreshToken: String
)

@Serializable
data class LoginResponse(
    val accessToken: String? = null,
    val accessTokenExpiresAt: String? = null,
    val refreshToken: String? = null,
    val refreshTokenExpiresAt: String? = null
)

@Serializable
data class WebRtcTicketRequest(
    val deviceId: String,
    val sessionId: String = "",
    val appPackage: String = "",
    val appName: String = "",
    val newDisplay: Boolean = false,
    val newDisplayWidth: Int? = null,
    val newDisplayHeight: Int? = null,
    val newDisplayDpi: Int? = null
)

@Serializable
data class WebRtcTicketResponse(
    val ticket: String,
    val sessionId: String = "",
    val expiresInSeconds: Int
)

@Serializable
data class ScrcpySessionActionRequest(
    val deviceId: String,
    val sessionId: String = ""
)

@Serializable
data class ApiErrorResponse(
    val error: ApiErrorPayload? = null
)

@Serializable
data class ApiErrorPayload(
    val code: String? = null,
    val messageKey: String? = null,
    val message: String? = null
)

@Serializable
data class Device(
    @SerialName("id")
    @JsonNames("Id")
    val id: Int = 0,
    @SerialName("name")
    @JsonNames("Name")
    val name: String = "",
    @SerialName("serial")
    @JsonNames("Serial")
    val serial: String = "",
    @SerialName("status")
    @JsonNames("Status")
    val status: String = "unknown",
    @SerialName("ipAddress")
    @JsonNames("IpAddress")
    val ipAddress: String? = null,
    @SerialName("port")
    @JsonNames("Port")
    val port: Int? = null,
    @SerialName("updatedAt")
    @JsonNames("UpdatedAt")
    val updatedAt: String? = null,
    @SerialName("groups")
    @JsonNames("Groups")
    val groups: List<DeviceGroup> = emptyList()
)

@Serializable
@Immutable
data class DeviceGroup(
    @SerialName("id")
    @JsonNames("Id")
    val id: Int = 0,
    @SerialName("name")
    @JsonNames("Name")
    val name: String = "",
)

@Serializable
@Immutable
data class DeviceApp(
    @SerialName("name")
    @JsonNames("Name")
    val name: String,
    @SerialName("packageName")
    @JsonNames("PackageName")
    val packageName: String
)

@Serializable
@Immutable
data class DeviceAppInfo(
    val packageName: String = "",
    val versionName: String = "",
    val versionCode: String = "",
    val firstInstallTime: String = "",
    val lastUpdateTime: String = "",
    val installerPackageName: String = "",
    val primaryApkPath: String = "",
    val apkPaths: List<String> = emptyList()
)

@Serializable
@Immutable
data class DeviceSettingsSummary(
    @SerialName("NewDisplay")
    val newDisplay: String = "",
    @SerialName("FlexDisplay")
    val flexDisplay: Boolean = false,
    @SerialName("HidKeyboard")
    val hidKeyboard: Boolean = false,
    @SerialName("HidMouse")
    val hidMouse: Boolean = false
)

@Immutable
data class LocalFileHandle(
    val name: String,
    val uri: Uri,
    val mimeType: String,
    val localPath: String
)

@Serializable
data class PointerControlMessage(
    val type: String = "pointer",
    val phase: String,
    val pointerId: Int,
    val pointerType: String,
    val isPrimary: Boolean,
    val xRatio: Float,
    val yRatio: Float,
    val frameWidth: Int,
    val frameHeight: Int,
    val pressure: Float,
    val buttons: Int
)

@Serializable
data class KeyControlMessage(
    val type: String = "key",
    val action: String
)

@Serializable
data class DisplayControlMessage(
    val type: String = "display",
    val action: String = "resize",
    val width: Int,
    val height: Int
)

@Serializable
data class VideoControlMessage(
    val type: String = "video",
    val action: String = "reset",
    val width: Int,
    val height: Int,
    val reason: String
)

@Serializable
data class RtcCandidateMessage(
    val candidate: String,
    val sdpMid: String? = null,
    val sdpMLineIndex: Int? = null,
    val usernameFragment: String? = null
)

@Serializable
data class RtcAnswerMessage(
    val type: String,
    val sdp: String
)

@Serializable
data class RtcOfferMessage(
    val type: String,
    val sdp: String
)

@Serializable
data class RtcSignalErrorMessage(
    val type: String,
    val code: String? = null,
    val messageKey: String? = null,
    val message: String,
    val detail: String? = null,
    val retryable: Boolean = false
)

@Serializable
data class AgentStatus(
    @SerialName("Status") val status: String,
    @SerialName("Mode") val mode: String,
    @SerialName("Timestamp") val timestamp: String
)
