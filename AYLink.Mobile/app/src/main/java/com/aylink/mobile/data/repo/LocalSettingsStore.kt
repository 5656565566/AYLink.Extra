package com.aylink.mobile.data.repo

import android.content.Context
import androidx.core.content.edit
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

enum class ThemeMode {
    SYSTEM,
    LIGHT,
    DARK
}

data class LocalUiSettings(
    val themeMode: ThemeMode = ThemeMode.SYSTEM,
    val useDynamicColor: Boolean = true,
    val resumeLastRemote: Boolean = true
)

class LocalSettingsStore(context: Context) {
    private val preferences = context.getSharedPreferences("aylink_mobile_local_settings", Context.MODE_PRIVATE)

    private val _settings = MutableStateFlow(
        LocalUiSettings(
            themeMode = preferences.getString(KEY_THEME_MODE, ThemeMode.SYSTEM.name)
                ?.let { runCatching { ThemeMode.valueOf(it) }.getOrDefault(ThemeMode.SYSTEM) }
                ?: ThemeMode.SYSTEM,
            useDynamicColor = preferences.getBoolean(KEY_DYNAMIC_COLOR, true),
            resumeLastRemote = preferences.getBoolean(KEY_RESUME_LAST_REMOTE, true)
        )
    )

    val settings: StateFlow<LocalUiSettings> = _settings.asStateFlow()

    fun updateThemeMode(mode: ThemeMode) {
        _settings.value = _settings.value.copy(themeMode = mode)
        preferences.edit { putString(KEY_THEME_MODE, mode.name) }
    }

    fun updateDynamicColor(enabled: Boolean) {
        _settings.value = _settings.value.copy(useDynamicColor = enabled)
        preferences.edit { putBoolean(KEY_DYNAMIC_COLOR, enabled) }
    }

    fun updateResumeLastRemote(enabled: Boolean) {
        _settings.value = _settings.value.copy(resumeLastRemote = enabled)
        preferences.edit { putBoolean(KEY_RESUME_LAST_REMOTE, enabled) }
    }

    companion object {
        private const val KEY_THEME_MODE = "theme_mode"
        private const val KEY_DYNAMIC_COLOR = "dynamic_color"
        private const val KEY_RESUME_LAST_REMOTE = "resume_last_remote"
    }
}
