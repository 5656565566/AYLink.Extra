package com.aylink.mobile.ui.remote

import android.content.Context
import android.util.Log
import android.util.DisplayMetrics
import androidx.compose.ui.unit.IntSize
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import com.aylink.mobile.data.model.Device
import com.aylink.mobile.data.model.DeviceApp
import com.aylink.mobile.data.model.PointerControlMessage
import com.aylink.mobile.data.repo.DeviceRepository
import com.aylink.mobile.data.repo.LocalSettingsStore
import com.aylink.mobile.data.repo.PointerSamplingRateHz
import com.aylink.mobile.data.repo.SessionStore
import com.aylink.mobile.logging.AppLogger
import com.aylink.mobile.webrtc.SignalClient
import com.aylink.mobile.webrtc.WebRtcManager
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.SupervisorJob
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient

data class RemoteUiState(
    val status: String = "未连接",
    val availableApps: List<DeviceApp> = emptyList(),
    val isLoadingApps: Boolean = false,
    val appError: String? = null,
    val videoSize: IntSize = IntSize.Zero,
    val isAppSelectDialogOpen: Boolean = false,
    val isControlDialogOpen: Boolean = false,
    val fillMode: Boolean = false,
    val isControlPanelCollapsed: Boolean = false,
    val isFlexDisplayEnabled: Boolean = false,
    val isAppProjectionMode: Boolean = false,
    val isNewDisplayMode: Boolean = false
)

data class RemoteViewportUiState(
    val videoSize: IntSize = IntSize.Zero,
    val fillMode: Boolean = false,
    val isFlexDisplayEnabled: Boolean = false,
    val isAppProjectionMode: Boolean = false,
    val isNewDisplayMode: Boolean = false
)

data class RemoteControlUiState(
    val status: String = "未连接",
    val isControlDialogOpen: Boolean = false,
    val isControlPanelCollapsed: Boolean = false,
    val fillMode: Boolean = false,
    val isFlexDisplayEnabled: Boolean = false
)

data class RemoteAppPickerUiState(
    val availableApps: List<DeviceApp> = emptyList(),
    val isLoadingApps: Boolean = false,
    val appError: String? = null,
    val isAppSelectDialogOpen: Boolean = false
)

sealed interface RemoteEffect {
    data object NavigateBack : RemoteEffect
}

sealed interface RemoteIntent {
    data object LoadApps : RemoteIntent
    data class ReconnectToApp(val app: DeviceApp) : RemoteIntent
    data object ReconnectToDevice : RemoteIntent
    data class SendPointer(val payload: PointerControlMessage) : RemoteIntent
    data class SendKey(val action: String) : RemoteIntent
    data class SendDisplayResize(val width: Int, val height: Int) : RemoteIntent
    data class SetControlDialogOpen(val isOpen: Boolean) : RemoteIntent
    data class SetAppSelectDialogOpen(val isOpen: Boolean) : RemoteIntent
    data class SetFillMode(val fillMode: Boolean) : RemoteIntent
    data class SetControlPanelCollapsed(val isCollapsed: Boolean) : RemoteIntent
    data object ToggleControlPanelCollapsed : RemoteIntent
    data object DisconnectAndNavigateBack : RemoteIntent
    data object DismissAppError : RemoteIntent
}

private enum class VideoRecoveryStage {
    Monitoring,
    KeyFrameRequested,
    IceRestartRequested
}

class RemoteViewModel(
    appContext: Context,
    val device: Device,
    initialAppPackage: String? = null,
    initialAppName: String? = null,
    initialNewDisplay: Boolean = false,
    private val deviceRepository: DeviceRepository,
    private val sessionStore: SessionStore,
    localSettingsStore: LocalSettingsStore,
    okHttpClient: OkHttpClient,
    json: Json,
    private val appLogger: AppLogger? = null
) : ViewModel() {
    companion object {
        private const val POINTER_SAMPLE_INTERVAL_120HZ_MS = 8L
        private const val POINTER_SAMPLE_INTERVAL_60HZ_MS = 16L
        private const val POINTER_SAMPLE_INTERVAL_30HZ_MS = 33L
        private const val POINTER_MOVE_BUFFER_LIMIT_BYTES = 64 * 1024L
        private const val WEAK_NETWORK_POINTER_MOVE_BUFFER_LIMIT_BYTES = POINTER_MOVE_BUFFER_LIMIT_BYTES / 2
        private const val POINTER_MOVE_BUFFER_PRESSURE_MEDIUM_RATIO = 0.35
        private const val POINTER_MOVE_BUFFER_PRESSURE_HIGH_RATIO = 0.75
        private const val VIDEO_RECOVERY_POLL_INTERVAL_MS = 2_000L
        private const val VIDEO_STALL_CONFIRMATION_COUNT = 2
        private const val VIDEO_KEY_FRAME_RECOVERY_OBSERVATION_MS = 3_000L
        private const val VIDEO_ICE_RECOVERY_OBSERVATION_MS = 5_000L
        private const val VIDEO_ACTIVITY_RECOVERY_WINDOW_MS = 15_000L
        private const val LOG_TAG = "AYLinkRemote"
        private const val ADAPTIVE_DISPLAY_RESIZE_DEBOUNCE_MS = 300L
        private const val ADAPTIVE_DISPLAY_RESIZE_MIN_DELTA_PX = 16
        private const val MIN_NEW_DISPLAY_DIMENSION = 240
        private const val MIN_NEW_DISPLAY_LONG_EDGE = 1280
        private const val MAX_NEW_DISPLAY_LONG_EDGE = 1920
    }

    private val _uiState = MutableStateFlow(RemoteUiState())
    val viewportUiState: StateFlow<RemoteViewportUiState> = _uiState
        .map { RemoteViewportUiState(it.videoSize, it.fillMode, it.isFlexDisplayEnabled, it.isAppProjectionMode, it.isNewDisplayMode) }
        .distinctUntilChanged()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), RemoteViewportUiState())
    val controlUiState: StateFlow<RemoteControlUiState> = _uiState
        .map { RemoteControlUiState(it.status, it.isControlDialogOpen, it.isControlPanelCollapsed, it.fillMode, it.isFlexDisplayEnabled) }
        .distinctUntilChanged()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), RemoteControlUiState())
    val appPickerUiState: StateFlow<RemoteAppPickerUiState> = _uiState
        .map { RemoteAppPickerUiState(it.availableApps, it.isLoadingApps, it.appError, it.isAppSelectDialogOpen) }
        .distinctUntilChanged()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), RemoteAppPickerUiState())
    private val _effect = MutableSharedFlow<RemoteEffect>()
    val effect = _effect.asSharedFlow()

    private val signalClient = SignalClient(okHttpClient, json, appLogger)
    val webRtcManager = WebRtcManager(appContext, json, signalClient, appLogger)
    private val baseUrl = sessionStore.baseUrl
    private val token = sessionStore.token
    private val localSettings = localSettingsStore.settings
    private var connectJob: Job? = null
    private var heartbeatJob: Job? = null
    private var reconnectJob: Job? = null
    private var pointerSamplingJob: Job? = null
    private var pointerReleaseRetryJob: Job? = null
    private var videoRecoveryJob: Job? = null
    private var adaptiveDisplayResizeJob: Job? = null
    private val sampledPointerMoves = linkedMapOf<Int, PointerControlMessage>()
    private val pendingPointerReleases = linkedMapOf<Int, PointerControlMessage>()
    private var currentAppPackage: String? = null
    private var currentAppName: String? = null
    private var currentNewDisplay = false
    private var currentViewportSize = IntSize.Zero
    private var lastObservedVideoSize = IntSize.Zero
    private var preferredDisplayAspectSize = IntSize.Zero
    private val localDisplayWidth = appContext.resources.displayMetrics.widthPixels
        .takeIf { it > 0 }
    private val localDisplayHeight = appContext.resources.displayMetrics.heightPixels
        .takeIf { it > 0 }
    private val localDisplayDensity = appContext.resources.displayMetrics.density
        .takeIf { it > 0f }
    private val localDisplayDpi = appContext.resources.displayMetrics.densityDpi
        .takeIf { it != DisplayMetrics.DENSITY_DEFAULT && it > 0 }
    private var lastReportedDisplaySize: IntSize? = null
    private var lastRequestedDisplaySize: IntSize? = null
    private var reconnectAttempt = 0
    private var manualDisconnect = false
    private var suppressReconnect = false
    private var currentSessionId: String? = null
    private var autoReconnectEnabled = true
    private var hasReleasedSession = false
    private var activeWebRtcGeneration = 0
    private var connectionRequestSequence = 0
    private var activeConnectionRequestId = 0
    private var videoRecoveryStage = VideoRecoveryStage.Monitoring
    private var lastVideoHealthSnapshot: WebRtcManager.VideoFrameHealthSnapshot? = null
    private var stalledVideoObservationCount = 0
    private var lastVideoRecoveryActivityAtMillis = 0L

    init {
        viewModelScope.launch {
            launch {
                signalClient.events.collect { event ->
                    when (event) {
                        is SignalClient.Event.Answer -> webRtcManager.setRemoteAnswer(event.payload.type, event.payload.sdp, activeWebRtcGeneration)
                        is SignalClient.Event.Candidate -> webRtcManager.addRemoteCandidate(event.payload, activeWebRtcGeneration)
                        is SignalClient.Event.Error -> {
                            if (event.retryable && webRtcManager.isPeerConnected()) {
                                Log.w(LOG_TAG, "Signaling failed while WebRTC remains connected; keeping media session alive: ${event.message}")
                                _uiState.update { current ->
                                    current.copy(status = if (current.videoSize != IntSize.Zero) "已连接" else current.status)
                                }
                                startVideoRecoveryWatchdog("signal_failed_after_connect")
                            } else {
                                _uiState.update { it.copy(status = event.message) }
                                stopHeartbeat()
                                if (event.retryable) {
                                    scheduleReconnect()
                                } else {
                                    autoReconnectEnabled = false
                                }
                            }
                        }
                        SignalClient.Event.Open -> {
                            _uiState.update { it.copy(status = "创建会话...") }
                            startHeartbeat()
                            activeWebRtcGeneration = webRtcManager.createPeerConnection()
                            webRtcManager.createOffer(activeWebRtcGeneration)
                        }
                        SignalClient.Event.Closed -> {
                            if (webRtcManager.isPeerConnected()) {
                                _uiState.update { current ->
                                    current.copy(status = if (current.videoSize != IntSize.Zero) "已连接" else current.status)
                                }
                                startVideoRecoveryWatchdog("signal_closed_after_connect")
                            } else if (autoReconnectEnabled) {
                                stopHeartbeat()
                                _uiState.update { it.copy(status = "信令断开", videoSize = IntSize.Zero) }
                                scheduleReconnect()
                            } else {
                                stopHeartbeat()
                                _uiState.update { it.copy(videoSize = IntSize.Zero) }
                            }
                        }
                    }
                }
            }

            launch {
                webRtcManager.events.collect { event ->
                    if (event.generation != activeWebRtcGeneration) {
                        return@collect
                    }
                    when (event) {
                        is WebRtcManager.Event.Connected -> {
                            reconnectAttempt = 0
                            stopReconnect()
                            _uiState.update { it.copy(status = "已连接") }
                            startVideoRecoveryWatchdog("peer_connected")
                        }
                        is WebRtcManager.Event.Disconnected -> {
                            _uiState.update { current ->
                                current.copy(
                                    status = if (autoReconnectEnabled) "连接断开" else current.status,
                                    videoSize = IntSize.Zero
                                )
                            }
                            stopVideoRecoveryWatchdog()
                            if (autoReconnectEnabled) {
                                scheduleReconnect()
                            }
                        }
                        is WebRtcManager.Event.Error -> {
                            _uiState.update { it.copy(status = event.message) }
                            stopVideoRecoveryWatchdog()
                            if (autoReconnectEnabled) {
                                scheduleReconnect()
                            }
                        }
                        is WebRtcManager.Event.VideoSizeChanged -> {
                            val videoSize = IntSize(event.width, event.height)
                            lastObservedVideoSize = videoSize
                            preferredDisplayAspectSize = videoSize
                            _uiState.update { it.copy(videoSize = videoSize) }
                            requestAdaptiveDisplayResize()
                            startVideoRecoveryWatchdog("first-frame")
                        }
                    }
                }
            }
        }

        sessionStore.updateLastRemoteDevice(device)
        appLogger?.i(LOG_TAG, "RemoteViewModel created, deviceId=${device.id}, appPackage=$initialAppPackage, newDisplay=$initialNewDisplay")
        connect(appPackage = initialAppPackage, appName = initialAppName, newDisplay = initialNewDisplay)
    }

    fun handleIntent(intent: RemoteIntent) {
        when (intent) {
            RemoteIntent.LoadApps -> loadApps()
            is RemoteIntent.ReconnectToApp -> reconnectToApp(intent.app)
            RemoteIntent.ReconnectToDevice -> reconnectToDevice()
            is RemoteIntent.SendPointer -> {
                markVideoRecoveryActivity()
                handlePointer(intent.payload)
            }
            is RemoteIntent.SendKey -> {
                markVideoRecoveryActivity()
                webRtcManager.sendKeyMessage(intent.action)
            }
            is RemoteIntent.SendDisplayResize -> {
                markVideoRecoveryActivity()
                webRtcManager.sendDisplayResize(intent.width, intent.height)
            }
            is RemoteIntent.SetControlDialogOpen -> _uiState.update { it.copy(isControlDialogOpen = intent.isOpen) }
            is RemoteIntent.SetAppSelectDialogOpen -> _uiState.update { it.copy(isAppSelectDialogOpen = intent.isOpen) }
            is RemoteIntent.SetFillMode -> _uiState.update { it.copy(fillMode = intent.fillMode) }
            is RemoteIntent.SetControlPanelCollapsed -> _uiState.update { it.copy(isControlPanelCollapsed = intent.isCollapsed) }
            RemoteIntent.ToggleControlPanelCollapsed -> _uiState.update { it.copy(isControlPanelCollapsed = !it.isControlPanelCollapsed) }
            RemoteIntent.DisconnectAndNavigateBack -> disconnectAndNavigateBack()
            RemoteIntent.DismissAppError -> _uiState.update { it.copy(appError = null) }
        }
    }

    private fun loadApps() {
        if (_uiState.value.isLoadingApps) return
        _uiState.update { it.copy(isLoadingApps = true, appError = null) }
        viewModelScope.launch {
            runCatching { deviceRepository.loadApps(device.id) }
                .onSuccess { apps -> _uiState.update { it.copy(availableApps = apps, isLoadingApps = false) } }
                .onFailure { error -> _uiState.update { it.copy(appError = error.message ?: "加载应用失败", isLoadingApps = false) } }
        }
    }

    private fun reconnectToApp(app: DeviceApp) {
        sessionStore.updateLastRemoteDevice(device)
        connect(app.packageName, app.name, newDisplay = true)
        _uiState.update { it.copy(isAppSelectDialogOpen = false, isControlDialogOpen = false) }
    }

    private fun reconnectToDevice() {
        sessionStore.updateLastRemoteDevice(device)
        connect(appPackage = null, appName = null, newDisplay = false)
        _uiState.update { it.copy(isControlDialogOpen = false) }
    }

    private fun connect(appPackage: String?, appName: String?, newDisplay: Boolean) {
        appLogger?.i(LOG_TAG, "Connect requested, deviceId=${device.id}, appPackage=$appPackage, newDisplay=$newDisplay")
        currentAppPackage = appPackage
        currentAppName = appName
        currentNewDisplay = newDisplay
        _uiState.update {
            it.copy(
                isAppProjectionMode = appPackage.isNullOrBlank().not(),
                isNewDisplayMode = newDisplay,
                fillMode = false
            )
        }
        lastReportedDisplaySize = null
        lastRequestedDisplaySize = null
        adaptiveDisplayResizeJob?.cancel()
        adaptiveDisplayResizeJob = null
        lastObservedVideoSize = IntSize.Zero
        preferredDisplayAspectSize = IntSize.Zero
        manualDisconnect = false
        autoReconnectEnabled = true
        releaseRemoteSessionAsync()
        hasReleasedSession = false
        reconnectAttempt = 0
        stopReconnect()
        stopVideoRecoveryWatchdog()
        sessionStore.updateLastRemoteDevice(device)
        refreshFlexDisplayState()
        connectInternal(appPackage, appName, newDisplay)
    }

    private fun connectInternal(appPackage: String?, appName: String?, newDisplay: Boolean) {
        connectJob?.cancel()
        val requestId = ++connectionRequestSequence
        activeConnectionRequestId = requestId
        connectJob = viewModelScope.launch {
            val currentBaseUrl = baseUrl.first()
            token.first() ?: return@launch
            if (!isActiveConnectionRequest(requestId)) return@launch
            _uiState.update {
                it.copy(
                    status = if (appName.isNullOrBlank()) "正在连接..." else "正在投屏 $appName...",
                    videoSize = IntSize.Zero
                )
            }
            suppressReconnect = true
            runCatching {
                setupConnection(requestId, currentBaseUrl, appPackage, appName, newDisplay)
            }.onFailure { error ->
                if (!isActiveConnectionRequest(requestId)) return@launch
                appLogger?.w(LOG_TAG, "Setup connection failed, requestId=$requestId, deviceId=${device.id}: ${error.message}", error)
                _uiState.update { it.copy(status = error.message ?: "连接失败") }
                suppressReconnect = false
                scheduleReconnect()
                return@launch
            }
            if (!isActiveConnectionRequest(requestId)) return@launch
            suppressReconnect = false
        }
    }

    private suspend fun setupConnection(
        requestId: Int,
        currentBaseUrl: String,
        appPackage: String?,
        appName: String?,
        newDisplay: Boolean
    ) {
        stopHeartbeat()
        resetPointerControlState()
        releaseRemoteSessionAsync()
        hasReleasedSession = false
        webRtcManager.disconnect()
        activeWebRtcGeneration = 0
        signalClient.disconnect()
        val initialDisplaySize = if (newDisplay) buildAdaptiveDisplaySize() else IntSize.Zero
        if (newDisplay) {
            lastRequestedDisplaySize = initialDisplaySize
        }
        val ticket = deviceRepository.createWebRtcTicket(
            deviceId = device.id,
            sessionId = null,
            appPackage = appPackage,
            appName = appName,
            newDisplay = newDisplay,
            newDisplayWidth = if (newDisplay) initialDisplaySize.width.takeIf { it > 0 } else null,
            newDisplayHeight = if (newDisplay) initialDisplaySize.height.takeIf { it > 0 } else null,
            newDisplayDpi = if (newDisplay) localDisplayDpi else null
        )
        if (!isActiveConnectionRequest(requestId)) {
            releaseTicketSession(ticket.sessionId)
            return
        }
        currentSessionId = ticket.sessionId.takeIf { it.isNotBlank() }
        appLogger?.i(LOG_TAG, "WebRTC ticket created, requestId=$requestId, deviceId=${device.id}, sessionId=${currentSessionId.orEmpty()}, newDisplay=$newDisplay")
        signalClient.connect(
            SignalClient.ConnectArgs(
                baseUrl = currentBaseUrl,
                ticket = ticket.ticket
            )
        )
    }

    private fun scheduleReconnect() {
        if (manualDisconnect || suppressReconnect || !autoReconnectEnabled || reconnectJob?.isActive == true) return
        reconnectJob = viewModelScope.launch {
            val delays = longArrayOf(1000L, 2000L, 5000L, 10000L)
            val delayMs = delays[reconnectAttempt.coerceAtMost(delays.lastIndex)]
            reconnectAttempt += 1
            appLogger?.i(LOG_TAG, "Reconnect scheduled, deviceId=${device.id}, attempt=$reconnectAttempt, delayMs=$delayMs")
            _uiState.update { it.copy(status = "连接中断，正在重连...") }
            delay(delayMs)
            if (!manualDisconnect && isActive) {
                connectInternal(currentAppPackage, currentAppName, currentNewDisplay)
            }
        }
    }

    private fun stopReconnect() {
        reconnectJob?.cancel()
        reconnectJob = null
    }

    fun onViewportSizeChanged(viewportSize: IntSize) {
        currentViewportSize = viewportSize
        if (!currentNewDisplay || viewportSize.width <= 0 || viewportSize.height <= 0) {
            return
        }

        requestAdaptiveDisplayResize()
    }

    fun onAppForegrounded() {
        markVideoRecoveryActivity()
        if (!manualDisconnect && localSettings.value.resumeLastRemote && !webRtcManager.isPeerConnected()) {
            if (tryIceRecovery("foreground_resume").not()) {
                scheduleReconnectNow()
            }
        } else {
            startVideoRecoveryWatchdog("foreground_resume")
        }
    }

    fun onAppBackgrounded() = Unit

    private fun handlePointer(payload: PointerControlMessage) {
        when (payload.phase.lowercase()) {
            "move" -> {
                sampledPointerMoves[payload.pointerId] = payload
                ensurePointerSamplingLoop()
            }
            "up", "cancel" -> {
                flushSampledPointerMove(payload.pointerId, preferPointerMoveChannel = false)
                sampledPointerMoves.remove(payload.pointerId)
                pendingPointerReleases[payload.pointerId] = payload
                flushPendingPointerReleases(reportFailure = false)
            }
            else -> {
                flushPendingPointerReleases(reportFailure = false)
                webRtcManager.sendPointerMessage(payload, reportFailure = false)
            }
        }
    }

    private fun ensurePointerSamplingLoop() {
        if (pointerSamplingJob?.isActive == true) return
        pointerSamplingJob = viewModelScope.launch {
            while (isActive) {
                if (sampledPointerMoves.isEmpty()) break
                if (webRtcManager.getPointerMoveBufferedAmount() > getCurrentPointerMoveBufferLimit()) {
                    delay(getCurrentPointerSampleIntervalMs())
                    continue
                }
                val moves = sampledPointerMoves.values.toList()
                sampledPointerMoves.clear()
                moves.forEach { move -> webRtcManager.sendPointerMessage(move, reportFailure = false) }
                delay(getCurrentPointerSampleIntervalMs())
            }
            pointerSamplingJob = null
        }
    }

    private fun flushSampledPointerMove(pointerId: Int, preferPointerMoveChannel: Boolean = true) {
        val sampled = sampledPointerMoves.remove(pointerId) ?: return
        webRtcManager.sendPointerMessage(
            payload = sampled,
            preferPointerMoveChannel = preferPointerMoveChannel,
            reportFailure = false
        )
    }

    private fun flushPendingPointerReleases(reportFailure: Boolean) {
        if (pendingPointerReleases.isEmpty()) {
            stopPointerReleaseRetry()
            return
        }

        val releases = pendingPointerReleases.values.toList()
        for (release in releases) {
            val sent = webRtcManager.sendPointerMessage(
                payload = release,
                preferPointerMoveChannel = false,
                reportFailure = reportFailure
            )
            if (sent) {
                pendingPointerReleases.remove(release.pointerId)
            }
        }

        if (pendingPointerReleases.isEmpty()) {
            stopPointerReleaseRetry()
        } else {
            ensurePointerReleaseRetryLoop()
        }
    }

    private fun ensurePointerReleaseRetryLoop() {
        if (pointerReleaseRetryJob?.isActive == true || pendingPointerReleases.isEmpty()) return
        pointerReleaseRetryJob = viewModelScope.launch {
            while (isActive && pendingPointerReleases.isNotEmpty()) {
                delay(250L)
                flushPendingPointerReleases(reportFailure = false)
            }
            pointerReleaseRetryJob = null
        }
    }

    private fun stopPointerReleaseRetry() {
        pointerReleaseRetryJob?.cancel()
        pointerReleaseRetryJob = null
    }

    private fun resetPointerControlState() {
        sampledPointerMoves.clear()
        pendingPointerReleases.clear()
        pointerSamplingJob?.cancel()
        pointerSamplingJob = null
        stopPointerReleaseRetry()
    }

    private fun startHeartbeat() {
        heartbeatJob?.cancel()
        heartbeatJob = viewModelScope.launch {
            while (isActive) {
                val sessionId = currentSessionId
                if (!sessionId.isNullOrBlank()) {
                    runCatching { deviceRepository.heartbeatScrcpySession(device.id, sessionId) }
                        .onFailure { error ->
                            Log.w(LOG_TAG, "Scrcpy session heartbeat failed, sessionId=$sessionId", error)
                            appLogger?.w(LOG_TAG, "Scrcpy session heartbeat failed, sessionId=$sessionId", error)
                        }
                }
                delay(15_000)
            }
        }
    }

    private fun getConfiguredPointerSampleIntervalMs(): Long {
        return when (localSettings.value.pointerSamplingRateHz) {
            PointerSamplingRateHz.HZ_30 -> POINTER_SAMPLE_INTERVAL_30HZ_MS
            PointerSamplingRateHz.HZ_60 -> POINTER_SAMPLE_INTERVAL_60HZ_MS
            PointerSamplingRateHz.HZ_120 -> POINTER_SAMPLE_INTERVAL_120HZ_MS
        }
    }

    private fun getCurrentPointerMoveBufferLimit(): Long {
        return if (localSettings.value.weakNetworkMode && !localSettings.value.adaptivePointerSampling) {
            WEAK_NETWORK_POINTER_MOVE_BUFFER_LIMIT_BYTES
        } else {
            POINTER_MOVE_BUFFER_LIMIT_BYTES
        }
    }

    private fun getAdaptivePointerSampleIntervalMs(): Long {
        val bufferedAmount = webRtcManager.getPointerMoveBufferedAmount()
        val bufferLimit = getCurrentPointerMoveBufferLimit().toDouble()
        return when {
            bufferedAmount >= bufferLimit * POINTER_MOVE_BUFFER_PRESSURE_HIGH_RATIO -> POINTER_SAMPLE_INTERVAL_30HZ_MS
            bufferedAmount >= bufferLimit * POINTER_MOVE_BUFFER_PRESSURE_MEDIUM_RATIO -> POINTER_SAMPLE_INTERVAL_60HZ_MS
            else -> POINTER_SAMPLE_INTERVAL_120HZ_MS
        }
    }

    private fun getCurrentPointerSampleIntervalMs(): Long {
        val settings = localSettings.value
        if (settings.adaptivePointerSampling) {
            return getAdaptivePointerSampleIntervalMs()
        }

        val configuredInterval = getConfiguredPointerSampleIntervalMs()
        if (!settings.weakNetworkMode) {
            return configuredInterval
        }

        return maxOf(configuredInterval, getAdaptivePointerSampleIntervalMs())
    }

    private fun stopHeartbeat() {
        heartbeatJob?.cancel()
        heartbeatJob = null
    }

    private fun startVideoRecoveryWatchdog(reason: String) {
        if (manualDisconnect) {
            return
        }
        if (videoRecoveryJob?.isActive == true) {
            return
        }
        resetVideoRecoveryState()
        videoRecoveryJob?.cancel()
        videoRecoveryJob = viewModelScope.launch {
            while (isActive && !manualDisconnect) {
                delay(VIDEO_RECOVERY_POLL_INTERVAL_MS)
                observeVideoHealth("watchdog_$reason")
            }
        }
    }

    private fun stopVideoRecoveryWatchdog() {
        videoRecoveryJob?.cancel()
        videoRecoveryJob = null
        resetVideoRecoveryState()
    }

    private fun tryIceRecovery(reason: String): Boolean {
        if (!signalClient.isOpen || manualDisconnect || suppressReconnect) {
            return false
        }
        return runCatching {
            _uiState.update { it.copy(status = "网络波动，正在尝试恢复连接...") }
            videoRecoveryStage = VideoRecoveryStage.IceRestartRequested
            stalledVideoObservationCount = 0
            webRtcManager.restartIce(activeWebRtcGeneration)
        }.isSuccess
    }

    private fun tryVideoKeyFrameRecovery(reason: String): Boolean {
        if (manualDisconnect || suppressReconnect) {
            return false
        }
        val requested = webRtcManager.requestVideoKeyFrameReplay(reason)
        if (!requested) {
            appLogger?.w(LOG_TAG, "Video key frame recovery unavailable, reason=$reason, deviceId=${device.id}")
            return false
        }

        appLogger?.i(LOG_TAG, "Video key frame recovery requested, reason=$reason, deviceId=${device.id}")
        videoRecoveryStage = VideoRecoveryStage.KeyFrameRequested
        stalledVideoObservationCount = 0
        return true
    }

    private fun observeVideoHealth(reason: String) {
        if (manualDisconnect || suppressReconnect || !autoReconnectEnabled) {
            return
        }

        val snapshot = webRtcManager.getVideoFrameHealthSnapshot()
        if (snapshot.generation != activeWebRtcGeneration) {
            resetVideoRecoveryState(snapshot)
            return
        }

        val previous = lastVideoHealthSnapshot
        lastVideoHealthSnapshot = snapshot

        val hasVideo = _uiState.value.videoSize != IntSize.Zero && snapshot.hasVideoFrame
        if (!snapshot.isPeerConnected || !hasVideo) {
            resetVideoRecoveryState(snapshot)
            return
        }

        val frameAdvanced = previous == null || previous.generation != snapshot.generation || snapshot.frameCount > previous.frameCount
        if (frameAdvanced) {
            resetVideoRecoveryState(snapshot)
            if (snapshot.isPeerConnected && hasVideo) {
                _uiState.update { it.copy(status = "已连接") }
            }
            return
        }

        if (!hasRecentVideoRecoveryActivity()) {
            resetVideoRecoveryState(snapshot)
            _uiState.update { it.copy(status = "已连接") }
            return
        }

        stalledVideoObservationCount += 1
        recoverVideoIfConfirmed(reason)
    }

    private fun recoverVideoIfConfirmed(
        reason: String,
        confirmationCount: Int = VIDEO_STALL_CONFIRMATION_COUNT
    ) {
        if (stalledVideoObservationCount < confirmationCount) {
            return
        }

        when (videoRecoveryStage) {
            VideoRecoveryStage.Monitoring -> {
                appLogger?.w(LOG_TAG, "Video stall confirmed, reason=$reason, deviceId=${device.id}, generation=$activeWebRtcGeneration")
                _uiState.update { it.copy(status = "画面恢复中...") }
                if (!tryVideoKeyFrameRecovery(reason)) {
                    if (tryIceRecovery("key_frame_unavailable_$reason").not()) {
                        scheduleReconnectNow()
                    }
                }
            }
            VideoRecoveryStage.KeyFrameRequested -> {
                val observationCount = observationCountFor(VIDEO_KEY_FRAME_RECOVERY_OBSERVATION_MS)
                if (stalledVideoObservationCount < observationCount) {
                    return
                }
                appLogger?.w(LOG_TAG, "Video key frame recovery failed, reason=$reason, deviceId=${device.id}")
                if (tryIceRecovery("key_frame_recovery_failed_$reason").not()) {
                    scheduleReconnectNow()
                }
            }
            VideoRecoveryStage.IceRestartRequested -> {
                val observationCount = observationCountFor(VIDEO_ICE_RECOVERY_OBSERVATION_MS)
                if (stalledVideoObservationCount < observationCount) {
                    return
                }
                appLogger?.w(LOG_TAG, "ICE recovery observation expired, reason=$reason, deviceId=${device.id}")
                scheduleReconnectNow()
            }
        }
    }

    private fun resetVideoRecoveryState(snapshot: WebRtcManager.VideoFrameHealthSnapshot? = null) {
        videoRecoveryStage = VideoRecoveryStage.Monitoring
        stalledVideoObservationCount = 0
        lastVideoHealthSnapshot = snapshot
    }

    private fun observationCountFor(durationMs: Long): Int {
        return ((durationMs + VIDEO_RECOVERY_POLL_INTERVAL_MS - 1) / VIDEO_RECOVERY_POLL_INTERVAL_MS).toInt().coerceAtLeast(1)
    }

    private fun markVideoRecoveryActivity() {
        lastVideoRecoveryActivityAtMillis = System.currentTimeMillis()
    }

    private fun hasRecentVideoRecoveryActivity(): Boolean {
        val lastActivity = lastVideoRecoveryActivityAtMillis
        if (lastActivity <= 0L) {
            return false
        }
        return System.currentTimeMillis() - lastActivity <= VIDEO_ACTIVITY_RECOVERY_WINDOW_MS
    }

    private fun scheduleReconnectNow() {
        if (manualDisconnect || suppressReconnect || !autoReconnectEnabled) {
            return
        }
        appLogger?.i(LOG_TAG, "Reconnect requested immediately, deviceId=${device.id}")
        reconnectJob?.cancel()
        reconnectJob = viewModelScope.launch {
            _uiState.update { it.copy(status = "连接恢复失败，正在重新连接...") }
            connectInternal(currentAppPackage, currentAppName, currentNewDisplay)
        }
    }

    private fun refreshFlexDisplayState() {
        if (!currentNewDisplay) {
            _uiState.update { it.copy(isFlexDisplayEnabled = false) }
            return
        }
        viewModelScope.launch {
            runCatching { deviceRepository.loadDeviceSettings(device.id) }
                .onSuccess { settings ->
                    _uiState.update { it.copy(isFlexDisplayEnabled = settings.flexDisplay) }
                    requestAdaptiveDisplayResize()
                }
                .onFailure {
                    _uiState.update { it.copy(isFlexDisplayEnabled = false) }
                }
        }
    }

    private fun disconnectAndNavigateBack() {
        viewModelScope.launch {
            manualDisconnect = true
            releaseRuntimeResources()
            releaseRemoteSessionAsync()
            webRtcManager.disconnect()
            signalClient.disconnect()
            sessionStore.clearLastRemoteDevice()
            _effect.emit(RemoteEffect.NavigateBack)
        }
    }

    override fun onCleared() {
        manualDisconnect = true
        releaseRuntimeResources()
        releaseRemoteSessionAsync()
        webRtcManager.release()
        signalClient.disconnect()
        super.onCleared()
    }

    private fun releaseRuntimeResources() {
        activeConnectionRequestId = ++connectionRequestSequence
        connectJob?.cancel()
        connectJob = null
        stopReconnect()
        stopHeartbeat()
        stopVideoRecoveryWatchdog()
        adaptiveDisplayResizeJob?.cancel()
        adaptiveDisplayResizeJob = null
        activeWebRtcGeneration = 0
        resetPointerControlState()
    }

    private fun releaseRemoteSessionAsync() {
        val sessionId = currentSessionId?.takeIf { it.isNotBlank() } ?: return
        if (hasReleasedSession) {
            currentSessionId = null
            return
        }
        hasReleasedSession = true
        currentSessionId = null
        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
            releaseTicketSession(sessionId)
        }
    }

    private fun isActiveConnectionRequest(requestId: Int): Boolean {
        return requestId == activeConnectionRequestId && !manualDisconnect
    }

    private suspend fun releaseTicketSession(sessionId: String?) {
        val releasedSessionId = sessionId?.takeIf { it.isNotBlank() } ?: return
        runCatching { deviceRepository.releaseScrcpySession(device.id, releasedSessionId) }
    }

    private fun requestAdaptiveDisplayResize() {
        if (!currentNewDisplay || !_uiState.value.isFlexDisplayEnabled) {
            return
        }
        if (isAppProjectionMode()) {
            return
        }

        val targetSize = buildAdaptiveDisplaySize()
        if (targetSize.width <= 0 || targetSize.height <= 0 || !shouldReportAdaptiveDisplaySize(targetSize)) {
            return
        }

        adaptiveDisplayResizeJob?.cancel()
        adaptiveDisplayResizeJob = viewModelScope.launch {
            delay(ADAPTIVE_DISPLAY_RESIZE_DEBOUNCE_MS)
            val latestTargetSize = buildAdaptiveDisplaySize()
            if (latestTargetSize.width <= 0 || latestTargetSize.height <= 0 || !shouldReportAdaptiveDisplaySize(latestTargetSize)) {
                return@launch
            }

            lastRequestedDisplaySize = latestTargetSize
            lastReportedDisplaySize = latestTargetSize
            webRtcManager.sendDisplayResize(latestTargetSize.width, latestTargetSize.height)
        }
    }

    private fun shouldReportAdaptiveDisplaySize(targetSize: IntSize): Boolean {
        val lastSize = lastReportedDisplaySize ?: lastRequestedDisplaySize ?: return true
        if (targetSize == lastSize) {
            return false
        }

        val targetLandscape = targetSize.width >= targetSize.height
        val lastLandscape = lastSize.width >= lastSize.height
        val sameOrientation = targetLandscape == lastLandscape
        val widthDelta = kotlin.math.abs(targetSize.width - lastSize.width)
        val heightDelta = kotlin.math.abs(targetSize.height - lastSize.height)
        return !sameOrientation || widthDelta >= ADAPTIVE_DISPLAY_RESIZE_MIN_DELTA_PX || heightDelta >= ADAPTIVE_DISPLAY_RESIZE_MIN_DELTA_PX
    }

    private fun isAppProjectionMode(): Boolean = currentAppPackage.isNullOrBlank().not()

    private fun buildAdaptiveDisplaySize(): IntSize {
        if (isAppProjectionMode()) {
            return buildAppProjectionDisplaySize()
        }

        val aspectSource = when {
            preferredDisplayAspectSize.width > 0 && preferredDisplayAspectSize.height > 0 -> preferredDisplayAspectSize
            lastObservedVideoSize.width > 0 && lastObservedVideoSize.height > 0 -> lastObservedVideoSize
            currentViewportSize.width > 0 && currentViewportSize.height > 0 -> currentViewportSize
            localDisplayWidth != null && localDisplayHeight != null -> IntSize(localDisplayWidth, localDisplayHeight)
            else -> IntSize(1280, 720)
        }

        val viewportSource = when {
            currentViewportSize.width > 0 && currentViewportSize.height > 0 -> currentViewportSize
            localDisplayWidth != null && localDisplayHeight != null -> IntSize(localDisplayWidth, localDisplayHeight)
            else -> aspectSource
        }

        val densityScale = (localDisplayDensity ?: 1f).coerceIn(1f, 2f)
        val targetLongEdge = (maxOf(viewportSource.width, viewportSource.height) * densityScale)
            .toInt()
            .coerceIn(MIN_NEW_DISPLAY_LONG_EDGE, MAX_NEW_DISPLAY_LONG_EDGE)
        val baseLongEdge = maxOf(aspectSource.width, aspectSource.height).coerceAtLeast(1)
        val scale = targetLongEdge.toFloat() / baseLongEdge.toFloat()

        return IntSize(
            width = roundDisplayDimension(aspectSource.width * scale),
            height = roundDisplayDimension(aspectSource.height * scale)
        )
    }

    private fun buildAppProjectionDisplaySize(): IntSize {
        val inspectedDisplay = when {
            localDisplayWidth != null && localDisplayHeight != null -> IntSize(localDisplayWidth, localDisplayHeight)
            currentViewportSize.width > 0 && currentViewportSize.height > 0 -> currentViewportSize
            else -> IntSize(1280, 720)
        }
        val shortSide = minOf(inspectedDisplay.width, inspectedDisplay.height).coerceAtLeast(MIN_NEW_DISPLAY_DIMENSION)
        val longSide = maxOf(inspectedDisplay.width, inspectedDisplay.height).coerceAtLeast(MIN_NEW_DISPLAY_DIMENSION)
        val preferLandscape = when {
            preferredDisplayAspectSize.width > 0 && preferredDisplayAspectSize.height > 0 ->
                preferredDisplayAspectSize.width >= preferredDisplayAspectSize.height
            lastObservedVideoSize.width > 0 && lastObservedVideoSize.height > 0 ->
                lastObservedVideoSize.width >= lastObservedVideoSize.height
            currentViewportSize.width > 0 && currentViewportSize.height > 0 ->
                currentViewportSize.width >= currentViewportSize.height
            else -> false
        }

        return if (preferLandscape) {
            IntSize(
                width = roundDisplayDimension(longSide.toFloat()),
                height = roundDisplayDimension(shortSide.toFloat())
            )
        } else {
            IntSize(
                width = roundDisplayDimension(shortSide.toFloat()),
                height = roundDisplayDimension(longSide.toFloat())
            )
        }
    }

    private fun roundDisplayDimension(value: Float): Int {
        val rounded = value.toInt().coerceAtLeast(MIN_NEW_DISPLAY_DIMENSION)
        return if (rounded % 2 == 0) rounded else rounded + 1
    }

}
