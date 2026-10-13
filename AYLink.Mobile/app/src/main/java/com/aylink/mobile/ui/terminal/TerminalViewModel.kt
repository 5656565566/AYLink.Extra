package com.aylink.mobile.ui.terminal

import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.aylink.mobile.data.model.Device
import com.aylink.mobile.data.repo.SessionStore
import com.aylink.mobile.data.transport.TerminalConnection
import com.aylink.mobile.data.transport.TerminalListener
import com.aylink.mobile.data.transport.TerminalTransport
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlin.math.max

/**
 * 屏幕方向档位。跟随系统时把锁屏交给系统决定，只影响本次终端会话。
 */
enum class TerminalOrientation {
    FOLLOW_SYSTEM,
    LANDSCAPE,
    PORTRAIT,
    ;

    /** 按 跟随系统 → 锁定横屏 → 锁定竖屏 循环切换。 */
    fun next(): TerminalOrientation =
        when (this) {
            FOLLOW_SYSTEM -> LANDSCAPE
            LANDSCAPE -> PORTRAIT
            PORTRAIT -> FOLLOW_SYSTEM
        }
}

@Immutable
data class TerminalUiState(
    val device: Device,
    val connecting: Boolean = false,
    val ready: Boolean = false,
    val disconnected: Boolean = false,
    val transcript: String = "",
    val outputSequence: Long = 0,
    val fontSize: Int = 14,
    val keyboardVisible: Boolean = true,
    val screenOrientation: TerminalOrientation = TerminalOrientation.FOLLOW_SYSTEM,
    /** 横屏时高度紧张，顶部栏由终端状态统一收起。 */
    val landscape: Boolean = false,
    val fullscreen: Boolean = false,
    /** 全屏中按返回键后短暂置 true，超时后由 ViewModel 复位。 */
    val topBarRevealed: Boolean = false,
    val errorMessage: String? = null,
    val statusText: String = "未连接",
) {
    /** 顶部栏（含状态栏）当前是否应该可见；非沉浸式时始终可见。 */
    val chromeVisible: Boolean get() = !(fullscreen || landscape) || topBarRevealed
}

sealed interface TerminalEvent {
    data class OutputChunk(
        val data: String,
        val sequence: Long,
    ) : TerminalEvent
}

class TerminalViewModel(
    private val device: Device,
    private val sessionStore: SessionStore,
    private val terminalTransport: TerminalTransport,
    private val json: Json,
) : ViewModel() {
    private val _uiState = MutableStateFlow(TerminalUiState(device = device))
    val uiState: StateFlow<TerminalUiState> = _uiState.asStateFlow()

    private val _events = MutableSharedFlow<TerminalEvent>(extraBufferCapacity = 64)
    val events = _events.asSharedFlow()
    private val output = TerminalTranscript(MAX_TRANSCRIPT_CHARS)

    private var connection: TerminalConnection? = null
    private var connectJob: Job? = null
    private var revealJob: Job? = null
    private var chromeMenuOpen = false
    private var lastTerminalSize: TerminalSize? = null

    init {
        viewModelScope.launch {
            output.snapshots.collect { snapshot ->
                _uiState.update { it.copy(transcript = snapshot.transcript, outputSequence = snapshot.sequence) }
            }
        }
        connect()
    }

    fun sendInput(data: String) {
        if (data.isEmpty()) {
            return
        }
        connection?.send(
            json.encodeToString(
                TerminalClientMessage.serializer(),
                TerminalClientMessage(type = "input", data = data),
            ),
        )
    }

    fun resize(
        cols: Int,
        rows: Int,
    ) {
        if (cols <= 0 || rows <= 0) {
            return
        }
        val next = TerminalSize(cols = max(4, cols), rows = max(4, rows))
        if (next == lastTerminalSize) {
            return
        }
        lastTerminalSize = next
        connection?.send(
            json.encodeToString(
                TerminalClientMessage.serializer(),
                TerminalClientMessage(type = "resize", cols = next.cols, rows = next.rows),
            ),
        )
    }

    fun reconnect() {
        closeConnection()
        connect()
    }

    fun disconnect() {
        closeConnection()
        _uiState.update {
            it.copy(
                connecting = false,
                ready = false,
                disconnected = true,
                errorMessage = null,
                statusText = "终端已断开",
            )
        }
    }

    fun toggleKeyboardVisibility() {
        _uiState.update { it.copy(keyboardVisible = !it.keyboardVisible) }
    }

    /** 一个菜单项负责三态循环，标题显示当前档位。 */
    fun cycleOrientation() {
        _uiState.update { it.copy(screenOrientation = it.screenOrientation.next()) }
    }

    /** 横竖屏由界面按当前配置上报，横屏下顶部栏自动收起，离开横屏立即恢复。 */
    fun updateLandscape(landscape: Boolean) {
        if (_uiState.value.landscape == landscape) return
        revealJob?.cancel()
        revealJob = null
        _uiState.update { it.copy(landscape = landscape, topBarRevealed = false) }
    }

    /** 离开终端页时调用，方向只对本次会话生效。 */
    fun resetScreenOrientation() {
        if (_uiState.value.screenOrientation == TerminalOrientation.FOLLOW_SYSTEM) return
        _uiState.update { it.copy(screenOrientation = TerminalOrientation.FOLLOW_SYSTEM) }
    }

    fun toggleFullscreen() {
        revealJob?.cancel()
        revealJob = null
        _uiState.update { it.copy(fullscreen = !it.fullscreen, topBarRevealed = false) }
    }

    /** 全屏下返回键没有可点的顶部栏，先短暂显示，超时后自动隐藏。 */
    fun revealTopBarTemporarily() {
        if (!chromeHidden()) return
        _uiState.update { it.copy(topBarRevealed = true) }
        scheduleTopBarHide()
    }

    /**
     * 菜单展开期间不收起顶部栏：展开即取消计时，关闭后重新计时。
     * 否则菜单会在用户操作过程中被 4 秒计数器连同顶部栏一起收掉。
     */
    fun setChromeMenuOpen(open: Boolean) {
        if (chromeMenuOpen == open) return
        chromeMenuOpen = open
        if (open) {
            revealJob?.cancel()
            revealJob = null
        } else {
            scheduleTopBarHide()
        }
    }

    private fun scheduleTopBarHide() {
        revealJob?.cancel()
        if (!chromeHidden() || !_uiState.value.topBarRevealed) return
        revealJob =
            viewModelScope.launch {
                delay(TOP_BAR_REVEAL_MS)
                // 超时后仍处于沉浸式才隐藏，期间退出全屏或转竖屏不会被这里翻回去。
                _uiState.update { if (chromeHidden()) it.copy(topBarRevealed = false) else it }
            }
    }

    /** 全屏或横屏时顶部栏让位给终端内容。 */
    private fun chromeHidden() = _uiState.value.fullscreen || _uiState.value.landscape

    fun increaseFontSize() {
        _uiState.update { it.copy(fontSize = (it.fontSize + 2).coerceAtMost(MAX_FONT_SIZE)) }
    }

    fun decreaseFontSize() {
        _uiState.update { it.copy(fontSize = (it.fontSize - 2).coerceAtLeast(MIN_FONT_SIZE)) }
    }

    private fun appendOutput(data: String) {
        synchronized(output) {
            val sequence = output.append(data)
            _events.tryEmit(TerminalEvent.OutputChunk(data, sequence))
        }
    }

    private fun connect() {
        if (connectJob?.isActive == true) {
            return
        }
        connectJob =
            viewModelScope.launch {
                if (!sessionStore.hasSession) {
                    _uiState.update {
                        it.copy(
                            connecting = false,
                            ready = false,
                            disconnected = true,
                            errorMessage = "登录状态已失效，请重新登录",
                            statusText = "未登录",
                        )
                    }
                    return@launch
                }
                _uiState.update {
                    it.copy(
                        connecting = true,
                        ready = false,
                        disconnected = false,
                        errorMessage = null,
                        statusText = "正在连接",
                    )
                }

                connection =
                    terminalTransport.connect(
                        viewModelScope,
                        device.id,
                        object : TerminalListener {
                            override fun onOpen(connection: TerminalConnection) {
                                _uiState.update {
                                    it.copy(
                                        connecting = false,
                                        disconnected = false,
                                        errorMessage = null,
                                        statusText = "终端已连接",
                                    )
                                }
                                lastTerminalSize?.let { size ->
                                    connection.send(
                                        json.encodeToString(
                                            TerminalClientMessage.serializer(),
                                            TerminalClientMessage(
                                                type = "resize",
                                                cols = size.cols,
                                                rows = size.rows,
                                            ),
                                        ),
                                    )
                                }
                            }

                            override fun onMessage(
                                connection: TerminalConnection,
                                text: String,
                            ) {
                                runCatching {
                                    json.decodeFromString(TerminalServerMessage.serializer(), text)
                                }.onSuccess { message ->
                                    when (message.type) {
                                        "ready" -> {
                                            _uiState.update {
                                                it.copy(
                                                    ready = true,
                                                    connecting = false,
                                                    disconnected = false,
                                                    errorMessage = null,
                                                    statusText = "终端就绪",
                                                )
                                            }
                                            lastTerminalSize?.let { size ->
                                                connection.send(
                                                    json.encodeToString(
                                                        TerminalClientMessage.serializer(),
                                                        TerminalClientMessage(
                                                            type = "resize",
                                                            cols = size.cols,
                                                            rows = size.rows,
                                                        ),
                                                    ),
                                                )
                                            }
                                        }

                                        "output" -> {
                                            if (!message.data.isNullOrEmpty()) {
                                                appendOutput(message.data)
                                            }
                                        }

                                        "error" -> {
                                            _uiState.update {
                                                it.copy(
                                                    connecting = false,
                                                    ready = false,
                                                    disconnected = true,
                                                    errorMessage = message.message ?: "终端连接失败",
                                                    statusText = "连接失败",
                                                )
                                            }
                                        }
                                    }
                                }.onFailure {
                                    appendOutput(text)
                                }
                            }

                            override fun onClosed(reason: String) {
                                _uiState.update {
                                    it.copy(
                                        connecting = false,
                                        ready = false,
                                        disconnected = true,
                                        statusText = if (reason.isBlank()) "终端已断开" else reason,
                                    )
                                }
                            }

                            override fun onFailure(error: Throwable) {
                                _uiState.update {
                                    it.copy(
                                        connecting = false,
                                        ready = false,
                                        disconnected = true,
                                        errorMessage = error.message ?: "终端连接失败",
                                        statusText = "连接异常",
                                    )
                                }
                            }
                        },
                    )
            }
    }

    private fun closeConnection() {
        connectJob?.cancel()
        connectJob = null
        connection?.close()
        connection = null
    }

    override fun onCleared() {
        revealJob?.cancel()
        revealJob = null
        closeConnection()
        super.onCleared()
    }

    @Serializable
    private data class TerminalServerMessage(
        @SerialName("type")
        val type: String,
        @SerialName("data")
        val data: String? = null,
        @SerialName("message")
        val message: String? = null,
    )

    @Serializable
    private data class TerminalClientMessage(
        @SerialName("type")
        val type: String,
        @SerialName("data")
        val data: String? = null,
        @SerialName("cols")
        val cols: Int? = null,
        @SerialName("rows")
        val rows: Int? = null,
    )

    private data class TerminalSize(
        val cols: Int,
        val rows: Int,
    )

    companion object {
        internal const val MIN_FONT_SIZE = 8
        internal const val MAX_FONT_SIZE = 32
        internal const val TOP_BAR_REVEAL_MS = 4_000L
        private const val MAX_TRANSCRIPT_CHARS = 32_000
    }
}
