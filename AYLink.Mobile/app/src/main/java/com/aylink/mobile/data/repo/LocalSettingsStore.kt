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

enum class PointerSamplingRateHz(val hz: Int) {
    HZ_120(120),
    HZ_60(60),
    HZ_30(30);

    companion object {
        fun fromValue(value: Int?): PointerSamplingRateHz {
            return entries.firstOrNull { it.hz == value } ?: HZ_120
        }
    }
}

data class LocalUiSettings(
    val themeMode: ThemeMode = ThemeMode.SYSTEM,
    val useDynamicColor: Boolean = true,
    val resumeLastRemote: Boolean = true,
    val adaptivePointerSampling: Boolean = true,
    val pointerSamplingRateHz: PointerSamplingRateHz = PointerSamplingRateHz.HZ_120,
    val weakNetworkMode: Boolean = false
)

class LocalSettingsStore(context: Context) {
    private val preferences = context.getSharedPreferences("aylink_mobile_local_settings", Context.MODE_PRIVATE)

    private val _settings = MutableStateFlow(
        LocalUiSettings(
            themeMode = preferences.getString(KEY_THEME_MODE, ThemeMode.SYSTEM.name)
                ?.let { runCatching { ThemeMode.valueOf(it) }.getOrDefault(ThemeMode.SYSTEM) }
                ?: ThemeMode.SYSTEM,
            useDynamicColor = preferences.getBoolean(KEY_DYNAMIC_COLOR, true),
            resumeLastRemote = preferences.getBoolean(KEY_RESUME_LAST_REMOTE, true),
            adaptivePointerSampling = preferences.getBoolean(KEY_ADAPTIVE_POINTER_SAMPLING, true),
            pointerSamplingRateHz = PointerSamplingRateHz.fromValue(
                preferences.getInt(KEY_POINTER_SAMPLING_RATE_HZ, PointerSamplingRateHz.HZ_120.hz)
            ),
            weakNetworkMode = preferences.getBoolean(KEY_WEAK_NETWORK_MODE, false)
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

    fun updateAdaptivePointerSampling(enabled: Boolean) {
        _settings.value = _settings.value.copy(adaptivePointerSampling = enabled)
        preferences.edit { putBoolean(KEY_ADAPTIVE_POINTER_SAMPLING, enabled) }
    }

    fun updatePointerSamplingRate(rate: PointerSamplingRateHz) {
        _settings.value = _settings.value.copy(pointerSamplingRateHz = rate)
        preferences.edit { putInt(KEY_POINTER_SAMPLING_RATE_HZ, rate.hz) }
    }

    fun updateWeakNetworkMode(enabled: Boolean) {
        _settings.value = _settings.value.copy(weakNetworkMode = enabled)
        preferences.edit { putBoolean(KEY_WEAK_NETWORK_MODE, enabled) }
    }

    companion object {
        private const val KEY_THEME_MODE = "theme_mode"
        private const val KEY_DYNAMIC_COLOR = "dynamic_color"
        private const val KEY_RESUME_LAST_REMOTE = "resume_last_remote"
        private const val KEY_ADAPTIVE_POINTER_SAMPLING = "adaptive_pointer_sampling"
        private const val KEY_POINTER_SAMPLING_RATE_HZ = "pointer_sampling_rate_hz"
        private const val KEY_WEAK_NETWORK_MODE = "weak_network_mode"
    }
}
