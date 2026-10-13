package com.aylink.mobile.ui.theme

import android.graphics.Color
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.aylink.mobile.data.model.Device
import com.aylink.mobile.data.repo.LocalUiSettings
import com.aylink.mobile.data.repo.ThemeMode
import com.aylink.mobile.ui.MainLayout
import com.aylink.mobile.ui.Screen
import com.aylink.mobile.ui.terminal.TerminalBackgroundColor
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SystemBarsTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun lightThemeRestoresBarsAfterTerminalAndRemote() = verifyTransitions(ThemeMode.LIGHT)

    @Test
    fun darkThemeRestoresBarsAfterTerminalAndRemote() = verifyTransitions(ThemeMode.DARK)

    @Test
    fun dynamicLightThemeRestoresBarsAfterTerminalAndRemote() = verifyTransitions(ThemeMode.LIGHT, dynamicColor = true)

    private fun verifyTransitions(
        themeMode: ThemeMode,
        dynamicColor: Boolean = false,
    ) {
        val device = Device(id = 1, name = "test")
        val screen = mutableStateOf<Screen>(Screen.Devices)
        var surfaceColor = 0
        compose.setContent {
            AYLinkTheme(
                settings = LocalUiSettings(themeMode = themeMode, useDynamicColor = dynamicColor),
                statusBarStyle = if (screen.value is Screen.Remote) SystemBarStyle.dark(Color.TRANSPARENT) else null,
                navigationBarStyle =
                    when (screen.value) {
                        is Screen.Terminal -> SystemBarStyle.dark(TerminalBackgroundColor.toArgb())
                        is Screen.Remote -> SystemBarStyle.dark(Color.BLACK)
                        else -> null
                    },
            ) {
                surfaceColor = MaterialTheme.colorScheme.surface.toArgb()
                if (screen.value is Screen.Remote) {
                    Box(Modifier.fillMaxSize().background(androidx.compose.ui.graphics.Color.Black))
                } else {
                    MainLayout(
                        currentScreen = screen.value,
                        selectedDevice = device,
                        onNavigate = { screen.value = it },
                        onLogout = {},
                    ) {}
                }
            }
        }
        val lightTheme = themeMode == ThemeMode.LIGHT
        assertBarIcons(lightStatus = lightTheme, lightNavigation = lightTheme)

        compose.runOnIdle { screen.value = Screen.Terminal(device) }
        assertBarIcons(lightStatus = lightTheme, lightNavigation = false)
        val statusBarHeight =
            compose.runOnIdle {
                ViewCompat
                    .getRootWindowInsets(compose.activity.window.decorView)
                    ?.getInsets(WindowInsetsCompat.Type.statusBars())
                    ?.top ?: 0
            }
        assertTrue(statusBarHeight > 0)
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val screenshot = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
        try {
            assertEquals(surfaceColor, screenshot.getPixel(screenshot.width / 2, statusBarHeight / 2))
        } finally {
            screenshot.recycle()
        }

        compose.runOnIdle { screen.value = Screen.Settings }
        assertBarIcons(lightStatus = lightTheme, lightNavigation = lightTheme)
        compose.runOnIdle { screen.value = Screen.Remote(device) }
        assertBarIcons(lightStatus = false, lightNavigation = false)
        compose.runOnIdle { screen.value = Screen.Settings }
        assertBarIcons(lightStatus = lightTheme, lightNavigation = lightTheme)
    }

    private fun assertBarIcons(
        lightStatus: Boolean,
        lightNavigation: Boolean,
    ) {
        compose.waitForIdle()
        compose.runOnIdle {
            val controller = WindowCompat.getInsetsController(compose.activity.window, compose.activity.window.decorView)
            assertEquals(lightStatus, controller.isAppearanceLightStatusBars)
            assertEquals(lightNavigation, controller.isAppearanceLightNavigationBars)
        }
    }
}
