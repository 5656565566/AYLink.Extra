package com.aylink.mobile.ui.theme

import android.graphics.Color
import android.os.Build
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import com.aylink.mobile.data.repo.LocalUiSettings
import com.aylink.mobile.data.repo.ThemeMode

private val LightColors = lightColorScheme()
private val DarkColors = darkColorScheme()

@Composable
fun AYLinkTheme(
    settings: LocalUiSettings,
    statusBarStyle: SystemBarStyle? = null,
    navigationBarStyle: SystemBarStyle? = null,
    content: @Composable () -> Unit,
) {
    val context = LocalContext.current
    val view = LocalView.current
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

    if (!view.isInEditMode) {
        SideEffect {
            // 应用内可以独立选择深浅主题，系统栏不能只依赖系统夜间模式。
            (view.context as? ComponentActivity)?.enableEdgeToEdge(
                statusBarStyle = statusBarStyle ?: SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT) { darkTheme },
                navigationBarStyle =
                    navigationBarStyle
                        ?: SystemBarStyle.auto(colorScheme.background.toArgb(), colorScheme.background.toArgb()) { darkTheme },
            )
        }
    }

    MaterialTheme(
        colorScheme = colorScheme,
        content = content,
    )
}
