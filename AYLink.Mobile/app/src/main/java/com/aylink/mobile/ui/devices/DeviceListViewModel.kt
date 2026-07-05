package com.aylink.mobile.ui.devices

import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.aylink.mobile.data.model.Device
import com.aylink.mobile.data.model.DeviceGroup
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

enum class DeviceListViewMode {
    LIST,
    PREVIEW,
}

@Immutable
data class DeviceListUiState(
    val devices: List<Device> = emptyList(),
    val loading: Boolean = false,
    val errorMessage: String? = null,
    val isDeviceMenuOpen: Boolean = false,
    val selectedDevice: Device? = null,
    val viewMode: DeviceListViewMode = DeviceListViewMode.LIST,
    val selectedGroupId: Int = 0,
)

@Immutable
data class DeviceListContentUiState(
    val devices: List<Device> = emptyList(),
    val loading: Boolean = false,
    val errorMessage: String? = null,
)

@Immutable
data class DeviceListDialogUiState(
    val isDeviceMenuOpen: Boolean = false,
    val selectedDevice: Device? = null,
    val loading: Boolean = false,
)

sealed interface DeviceListIntent {
    data object Refresh : DeviceListIntent

    data class ConnectDevice(
        val device: Device,
    ) : DeviceListIntent

    data class ShowDeviceMenu(
        val device: Device,
    ) : DeviceListIntent

    data object HideDeviceMenu : DeviceListIntent

    data object ToggleViewMode : DeviceListIntent

    data class SelectGroup(
        val groupId: Int,
    ) : DeviceListIntent

    data class NavigateToAppManager(
        val device: Device,
    ) : DeviceListIntent

    data class NavigateToFileManager(
        val device: Device,
    ) : DeviceListIntent

    data class NavigateToTerminal(
        val device: Device,
    ) : DeviceListIntent

    data object DismissError : DeviceListIntent
}

sealed interface DeviceListEffect {
    data class NavigateToRemote(
        val device: Device,
    ) : DeviceListEffect

    data class NavigateToAppManager(
        val device: Device,
    ) : DeviceListEffect

    data class NavigateToFileManager(
        val device: Device,
    ) : DeviceListEffect

    data class NavigateToTerminal(
        val device: Device,
    ) : DeviceListEffect
}

class DeviceListViewModel(
    private val deviceRepository: DeviceRepository,
) : ViewModel() {
    private val _uiState = MutableStateFlow(DeviceListUiState())
    val uiState: StateFlow<DeviceListUiState> = _uiState.asStateFlow()
    val contentUiState: StateFlow<DeviceListContentUiState> =
        _uiState
            .map { DeviceListContentUiState(it.devices, it.loading, it.errorMessage) }
            .distinctUntilChanged()
            .stateIn(
                viewModelScope,
                SharingStarted.WhileSubscribed(5_000),
                DeviceListContentUiState(),
            )
    val dialogUiState: StateFlow<DeviceListDialogUiState> =
        _uiState
            .map { DeviceListDialogUiState(it.isDeviceMenuOpen, it.selectedDevice, it.loading) }
            .distinctUntilChanged()
            .stateIn(
                viewModelScope,
                SharingStarted.WhileSubscribed(5_000),
                DeviceListDialogUiState(),
            )

    private val _effect = MutableSharedFlow<DeviceListEffect>()
    val effect = _effect.asSharedFlow()

    init {
        handleIntent(DeviceListIntent.Refresh)
    }

    fun handleIntent(intent: DeviceListIntent) {
        when (intent) {
            DeviceListIntent.Refresh -> refresh()
            is DeviceListIntent.ConnectDevice -> ensureConnected(intent.device)
            is DeviceListIntent.ShowDeviceMenu -> {
                _uiState.update {
                    it.copy(selectedDevice = intent.device, isDeviceMenuOpen = true)
                }
            }
            DeviceListIntent.HideDeviceMenu -> _uiState.update { it.copy(isDeviceMenuOpen = false) }
            DeviceListIntent.ToggleViewMode -> {
                _uiState.update {
                    val nextViewMode =
                        if (it.viewMode == DeviceListViewMode.LIST) {
                            DeviceListViewMode.PREVIEW
                        } else {
                            DeviceListViewMode.LIST
                        }
                    it.copy(
                        viewMode = nextViewMode,
                    )
                }
            }
            is DeviceListIntent.SelectGroup -> _uiState.update { it.copy(selectedGroupId = intent.groupId) }
            is DeviceListIntent.NavigateToAppManager -> {
                _uiState.update { it.copy(isDeviceMenuOpen = false) }
                viewModelScope.launch { _effect.emit(DeviceListEffect.NavigateToAppManager(intent.device)) }
            }
            is DeviceListIntent.NavigateToFileManager -> {
                _uiState.update { it.copy(isDeviceMenuOpen = false) }
                viewModelScope.launch { _effect.emit(DeviceListEffect.NavigateToFileManager(intent.device)) }
            }
            is DeviceListIntent.NavigateToTerminal -> {
                _uiState.update { it.copy(isDeviceMenuOpen = false) }
                viewModelScope.launch { _effect.emit(DeviceListEffect.NavigateToTerminal(intent.device)) }
            }
            DeviceListIntent.DismissError -> _uiState.update { it.copy(errorMessage = null) }
        }
    }

    private fun refresh() {
        _uiState.update { it.copy(loading = true, errorMessage = null) }
        viewModelScope.launch {
            val result = runCatching { deviceRepository.loadDevices() }
            result.onSuccess { devices ->
                _uiState.update { state ->
                    val availableGroupIds =
                        devices
                            .flatMap { device -> device.groups.map(DeviceGroup::id) }
                            .toSet()
                    val normalizedGroupId =
                        state.selectedGroupId.takeIf { groupId ->
                            groupId == 0 || availableGroupIds.contains(groupId)
                        } ?: 0
                    state.copy(loading = false, devices = devices, selectedGroupId = normalizedGroupId)
                }
            }
            result.onFailure { error ->
                _uiState.update {
                    it.copy(loading = false, errorMessage = error.message ?: "加载设备失败")
                }
            }
        }
    }

    suspend fun loadDevicePreview(
        deviceId: Int,
        width: Int = 360,
    ): ByteArray = deviceRepository.loadDevicePreview(deviceId, width)

    private fun ensureConnected(device: Device) {
        _uiState.update {
            it.copy(loading = true, errorMessage = null, isDeviceMenuOpen = false)
        }
        viewModelScope.launch {
            val result =
                runCatching {
                    if (device.status.equals("offline", ignoreCase = true)) {
                        deviceRepository.connectDevice(device.id)
                    } else {
                        device
                    }
                }
            result.onSuccess { readyDevice ->
                _uiState.update { it.copy(loading = false) }
                _effect.emit(DeviceListEffect.NavigateToRemote(readyDevice))
            }
            result.onFailure { error ->
                _uiState.update {
                    it.copy(loading = false, errorMessage = error.message ?: "连接设备失败")
                }
            }
        }
    }
}
