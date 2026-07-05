package com.aylink.mobile.data.repo

import android.content.Context
import androidx.core.content.edit
import com.aylink.mobile.data.model.Device
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

class SessionStore(
    context: Context,
) {
    private val preferences = context.getSharedPreferences("aylink_mobile_session", Context.MODE_PRIVATE)

    private val _baseUrl =
        MutableStateFlow(
            preferences.getString(KEY_BASE_URL, null)?.trim()?.removeSuffix("/") ?: DEFAULT_BASE_URL,
        )
    private val _username =
        MutableStateFlow(
            normalizeUsername(preferences.getString(KEY_USERNAME, DEFAULT_USERNAME)),
        )
    private val _token = MutableStateFlow(preferences.getString(KEY_TOKEN, null))
    private val _refreshToken = MutableStateFlow(preferences.getString(KEY_REFRESH_TOKEN, null))
    private val _lastSelectedDevice = MutableStateFlow(readDevice(KEY_LAST_SELECTED_DEVICE))
    private val _lastRemoteDevice = MutableStateFlow(readLastRemoteDevice())

    val baseUrl: StateFlow<String> = _baseUrl.asStateFlow()
    val username: StateFlow<String> = _username.asStateFlow()
    val token: StateFlow<String?> = _token.asStateFlow()
    val refreshToken: StateFlow<String?> = _refreshToken.asStateFlow()
    val lastSelectedDevice: StateFlow<Device?> = _lastSelectedDevice.asStateFlow()
    val lastRemoteDevice: StateFlow<Device?> = _lastRemoteDevice.asStateFlow()
    val hasConfiguredBaseUrl: Boolean
        get() = !preferences.getString(KEY_BASE_URL, null).isNullOrBlank()
    val hasSession: Boolean
        get() = !token.value.isNullOrBlank()

    fun updateBaseUrl(value: String) {
        val normalized = value.trim().removeSuffix("/")
        if (_baseUrl.value != normalized) {
            clearSession()
        }
        _baseUrl.value = normalized
        preferences.edit { putString(KEY_BASE_URL, normalized) }
    }

    fun updateUsername(value: String) {
        _username.value = value.trim().ifBlank { DEFAULT_USERNAME }
        preferences.edit { putString(KEY_USERNAME, _username.value) }
    }

    fun updateSession(
        accessToken: String?,
        refreshToken: String?,
    ) {
        _token.value = accessToken
        _refreshToken.value = refreshToken
        preferences.edit {
            putString(KEY_TOKEN, accessToken)
            putString(KEY_REFRESH_TOKEN, refreshToken)
        }
    }

    fun updateAccessToken(value: String?) {
        _token.value = value
        preferences.edit { putString(KEY_TOKEN, value) }
    }

    fun clearSession() {
        _token.value = null
        _refreshToken.value = null
        clearLastSelectedDevice()
        clearLastRemoteDevice()
        preferences.edit {
            remove(KEY_TOKEN)
            remove(KEY_REFRESH_TOKEN)
        }
    }

    fun updateLastSelectedDevice(device: Device?) {
        _lastSelectedDevice.value = device
        writeDevice(KEY_LAST_SELECTED_DEVICE, device)
    }

    fun clearLastSelectedDevice() {
        updateLastSelectedDevice(null)
    }

    fun updateLastRemoteDevice(device: Device?) {
        _lastRemoteDevice.value = device
        writeDevice(KEY_LAST_REMOTE_DEVICE, device)
    }

    fun clearLastRemoteDevice() {
        updateLastRemoteDevice(null)
    }

    private fun readLastRemoteDevice(): Device? = readDevice(KEY_LAST_REMOTE_DEVICE)

    private fun readDevice(prefix: String): Device? {
        if (!preferences.contains("${prefix}_id")) {
            return null
        }
        return Device(
            id = preferences.getInt("${prefix}_id", 0),
            name = preferences.getString("${prefix}_name", "").orEmpty(),
            serial = preferences.getString("${prefix}_serial", "").orEmpty(),
            status = preferences.getString("${prefix}_status", "unknown").orEmpty(),
            ipAddress = preferences.getString("${prefix}_ip", null),
            port =
                if (preferences.contains("${prefix}_port")) {
                    preferences.getInt("${prefix}_port", 0)
                } else {
                    null
                },
        )
    }

    private fun normalizeUsername(value: String?): String = value?.trim().orEmpty().ifBlank { DEFAULT_USERNAME }

    private fun writeDevice(
        prefix: String,
        device: Device?,
    ) {
        preferences.edit {
            if (device == null) {
                remove("${prefix}_id")
                remove("${prefix}_name")
                remove("${prefix}_serial")
                remove("${prefix}_status")
                remove("${prefix}_ip")
                remove("${prefix}_port")
            } else {
                putInt("${prefix}_id", device.id)
                putString("${prefix}_name", device.name)
                putString("${prefix}_serial", device.serial)
                putString("${prefix}_status", device.status)
                putString("${prefix}_ip", device.ipAddress)
                if (device.port != null) {
                    putInt("${prefix}_port", device.port)
                } else {
                    remove("${prefix}_port")
                }
            }
        }
    }

    companion object {
        private const val KEY_BASE_URL = "base_url"
        private const val KEY_USERNAME = "username"
        private const val KEY_TOKEN = "token"
        private const val KEY_REFRESH_TOKEN = "refresh_token"
        private const val KEY_LAST_SELECTED_DEVICE = "last_selected_device"
        private const val KEY_LAST_REMOTE_DEVICE = "last_remote_device"
        private const val DEFAULT_BASE_URL = "http://10.0.2.2:5500"
        private const val DEFAULT_USERNAME = "admin"
    }
}
