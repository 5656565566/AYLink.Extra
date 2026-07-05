package com.aylink.mobile.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import com.aylink.mobile.data.repo.LocalUiSettings
import com.aylink.mobile.data.repo.ThemeMode

private val LightColors = lightColorScheme()
private val DarkColors = darkColorScheme()

@Composable
fun AYLinkTheme(
    settings: LocalUiSettings,
    content: @Composable () -> Unit,
) {
    val context = LocalContext.current
    val darkTheme =
        when (settings.themeMode) {
            ThemeMode.SYSTEM -> isSystemInDarkTheme()
            ThemeMode.LIGHT -> false
            ThemeMode.DARK -> true
        }
    val colorScheme =
        when {
            settings.useDynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
                if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
            }
            darkTheme -> DarkColors
            else -> LightColors
        }

    MaterialTheme(
        colorScheme = colorScheme,
        content = content,
    )
}
