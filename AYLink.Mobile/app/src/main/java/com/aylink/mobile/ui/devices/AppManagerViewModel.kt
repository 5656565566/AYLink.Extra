package com.aylink.mobile.ui.devices

import android.net.Uri
import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.aylink.mobile.data.model.Device
import com.aylink.mobile.data.model.DeviceApp
import com.aylink.mobile.data.model.DeviceAppInfo
import com.aylink.mobile.data.repo.DeviceRepository
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

@Immutable
data class AppManagerUiState(
    val apps: List<DeviceApp> = emptyList(),
    val loading: Boolean = false,
    val errorMessage: String? = null,
    val selectedApp: DeviceApp? = null,
    val isAppInfoDialogOpen: Boolean = false,
    val actionLoading: Boolean = false,
    val appInfo: DeviceAppInfo? = null,
    val appInfoLoading: Boolean = false,
    val installLoading: Boolean = false
)

@Immutable
data class AppManagerListUiState(
    val apps: List<DeviceApp> = emptyList(),
    val loading: Boolean = false,
    val errorMessage: String? = null
)

@Immutable
data class AppManagerDialogUiState(
    val selectedApp: DeviceApp? = null,
    val isAppInfoDialogOpen: Boolean = false,
    val actionLoading: Boolean = false,
    val appInfo: DeviceAppInfo? = null,
    val appInfoLoading: Boolean = false,
    val installLoading: Boolean = false
)

sealed interface AppManagerIntent {
    data object Refresh : AppManagerIntent
    data class ShowAppInfo(val app: DeviceApp) : AppManagerIntent
    data object HideAppInfo : AppManagerIntent
    data class InstallApk(val uri: Uri) : AppManagerIntent
    data class StartRemoteForApp(val app: DeviceApp) : AppManagerIntent
    data class LaunchApp(val packageName: String) : AppManagerIntent
    data class UninstallApp(val packageName: String) : AppManagerIntent
    data class CopyPackageName(val packageName: String) : AppManagerIntent
    data object DismissError : AppManagerIntent
}

sealed interface AppManagerEffect {
    data class ShowToast(val message: String) : AppManagerEffect
    data class CopyText(val text: String, val successMessage: String) : AppManagerEffect
    data class NavigateToRemote(val device: Device, val packageName: String, val appName: String) : AppManagerEffect
}

class AppManagerViewModel(
    private val device: Device,
    private val deviceRepository: DeviceRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(AppManagerUiState())
    val uiState: StateFlow<AppManagerUiState> = _uiState.asStateFlow()
    val listUiState: StateFlow<AppManagerListUiState> = _uiState
        .map { AppManagerListUiState(it.apps, it.loading, it.errorMessage) }
        .distinctUntilChanged()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), AppManagerListUiState())
    val dialogUiState: StateFlow<AppManagerDialogUiState> = _uiState
        .map {
            AppManagerDialogUiState(
                selectedApp = it.selectedApp,
                isAppInfoDialogOpen = it.isAppInfoDialogOpen,
                actionLoading = it.actionLoading,
                appInfo = it.appInfo,
                appInfoLoading = it.appInfoLoading,
                installLoading = it.installLoading
            )
        }
        .distinctUntilChanged()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), AppManagerDialogUiState())

    private val _effect = MutableSharedFlow<AppManagerEffect>()
    val effect = _effect.asSharedFlow()

    init {
        handleIntent(AppManagerIntent.Refresh)
    }

    fun handleIntent(intent: AppManagerIntent) {
        when (intent) {
            AppManagerIntent.Refresh -> refresh()
            is AppManagerIntent.ShowAppInfo -> showAppInfo(intent.app)
            AppManagerIntent.HideAppInfo -> _uiState.update { it.copy(isAppInfoDialogOpen = false, appInfo = null, appInfoLoading = false) }
            is AppManagerIntent.InstallApk -> installApk(intent.uri)
            is AppManagerIntent.StartRemoteForApp -> startRemoteForApp(intent.app)
            is AppManagerIntent.LaunchApp -> launchApp(intent.packageName)
            is AppManagerIntent.UninstallApp -> uninstallApp(intent.packageName)
            is AppManagerIntent.CopyPackageName -> copyPackageName(intent.packageName)
            AppManagerIntent.DismissError -> _uiState.update { it.copy(errorMessage = null) }
        }
    }

    private fun refresh() {
        _uiState.update { it.copy(loading = true, errorMessage = null) }
        viewModelScope.launch {
            runCatching { deviceRepository.loadApps(device.id) }
                .onSuccess { apps ->
                    _uiState.update { it.copy(loading = false, apps = apps) }
                }
                .onFailure { error ->
                    _uiState.update { it.copy(loading = false, errorMessage = error.message ?: "加载应用列表失败") }
                }
        }
    }

    private fun showAppInfo(app: DeviceApp) {
        _uiState.update {
            it.copy(
                selectedApp = app,
                isAppInfoDialogOpen = true,
                appInfo = null,
                appInfoLoading = true
            )
        }
        viewModelScope.launch {
            runCatching { deviceRepository.loadAppInfo(device.id, app.packageName) }
                .onSuccess { info ->
                    _uiState.update { state -> state.copy(appInfo = info, appInfoLoading = false) }
                }
                .onFailure { error ->
                    _uiState.update { state ->
                        state.copy(appInfoLoading = false, errorMessage = error.message ?: "加载应用信息失败")
                    }
                }
        }
    }

    private fun launchApp(packageName: String) {
        _uiState.update { it.copy(actionLoading = true) }
        viewModelScope.launch {
            runCatching { deviceRepository.launchApp(device.id, packageName) }
                .onSuccess {
                    _uiState.update { it.copy(actionLoading = false) }
                    _effect.emit(AppManagerEffect.ShowToast("已启动"))
                }
                .onFailure { error ->
                    _uiState.update { it.copy(actionLoading = false, errorMessage = error.message ?: "启动失败") }
                }
        }
    }

    private fun uninstallApp(packageName: String) {
        _uiState.update { it.copy(actionLoading = true) }
        viewModelScope.launch {
            runCatching { deviceRepository.uninstallApp(device.id, packageName) }
                .onSuccess {
                    _uiState.update { it.copy(actionLoading = false, isAppInfoDialogOpen = false) }
                    _effect.emit(AppManagerEffect.ShowToast("已卸载"))
                    refresh()
                }
                .onFailure { error ->
                    _uiState.update { it.copy(actionLoading = false, errorMessage = error.message ?: "卸载失败") }
                }
        }
    }

    private fun installApk(uri: Uri) {
        _uiState.update { it.copy(installLoading = true, errorMessage = null) }
        viewModelScope.launch {
            runCatching { deviceRepository.installApp(device.id, uri) }
                .onSuccess {
                    _uiState.update { it.copy(installLoading = false) }
                    _effect.emit(AppManagerEffect.ShowToast("APK 安装成功"))
                    refresh()
                }
                .onFailure { error ->
                    _uiState.update { it.copy(installLoading = false, errorMessage = error.message ?: "APK 安装失败") }
                }
        }
    }

    private fun copyPackageName(packageName: String) {
        viewModelScope.launch {
            _effect.emit(AppManagerEffect.CopyText(packageName, "包名已复制"))
        }
    }

    private fun startRemoteForApp(app: DeviceApp) {
        viewModelScope.launch {
            _effect.emit(AppManagerEffect.NavigateToRemote(device, app.packageName, app.name))
        }
    }
}
