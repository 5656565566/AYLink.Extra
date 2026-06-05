package com.aylink.mobile.ui

import com.aylink.mobile.data.model.Device

sealed interface Screen {
    data object AddressSetup : Screen
    data object Login : Screen
    data object Devices : Screen
    data object Settings : Screen
    data object AppManagerHome : Screen
    data object FileManagerHome : Screen
    data object TerminalHome : Screen
    data class Remote(
        val device: Device,
        val appPackageName: String? = null,
        val appDisplayName: String? = null,
        val newDisplay: Boolean = false
    ) : Screen
    data class AppManager(val device: Device) : Screen
    data class FileManager(val device: Device) : Screen
    data class Terminal(val device: Device) : Screen
}
