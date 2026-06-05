package com.aylink.mobile.ui.terminal

import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.aylink.mobile.data.model.Device
import com.aylink.mobile.data.repo.SessionStore
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import kotlin.math.max

@Immutable
data class TerminalUiState(
    val device: Device,
    val connecting: Boolean = false,
    val ready: Boolean = false,
    val disconnected: Boolean = false,
    val transcript: String = "",
    val errorMessage: String? = null,
    val statusText: String = "未连接"
)

sealed interface TerminalEvent {
    data class OutputChunk(val data: String) : TerminalEvent
}

class TerminalViewModel(
    private val device: Device,
    private val sessionStore: SessionStore,
    private val okHttpClient: OkHttpClient,
    private val json: Json
) : ViewModel() {

    private val _uiState = MutableStateFlow(TerminalUiState(device = device))
    val uiState: StateFlow<TerminalUiState> = _uiState.asStateFlow()

    private val _events = MutableSharedFlow<TerminalEvent>(extraBufferCapacity = 64)
    val events = _events.asSharedFlow()

    private var webSocket: WebSocket? = null
    private var connectJob: Job? = null
    private var lastTerminalSize: TerminalSize? = null

    init {
        connect()
    }

    fun sendInput(data: String) {
        if (data.isEmpty()) {
            return
        }
        webSocket?.send(
            json.encodeToString(
                TerminalClientMessage.serializer(),
                TerminalClientMessage(type = "input", data = data)
            )
        )
    }

    fun resize(cols: Int, rows: Int) {
        if (cols <= 0 || rows <= 0) {
            return
        }
        val next = TerminalSize(cols = max(4, cols), rows = max(4, rows))
        if (next == lastTerminalSize) {
            return
        }
        lastTerminalSize = next
        webSocket?.send(
            json.encodeToString(
                TerminalClientMessage.serializer(),
                TerminalClientMessage(type = "resize", cols = next.cols, rows = next.rows)
            )
        )
    }

    fun reconnect() {
        disconnect()
        connect()
    }

    private fun connect() {
        if (connectJob?.isActive == true) {
            return
        }
        connectJob = viewModelScope.launch {
            val baseUrl = sessionStore.baseUrl.first()
            val token = sessionStore.token.first().orEmpty()
            if (token.isBlank()) {
                _uiState.update {
                    it.copy(
                        connecting = false,
                        ready = false,
                        disconnected = true,
                        errorMessage = "登录状态已失效，请重新登录",
                        statusText = "未登录"
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
                    statusText = "正在连接 ${device.name.ifBlank { device.serial }}"
                )
            }

            val request = Request.Builder()
                .url(buildWebSocketUrl(baseUrl, device.id))
                .header("Authorization", "Bearer $token")
                .build()

            webSocket = okHttpClient.newWebSocket(request, object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    _uiState.update {
                        it.copy(
                            connecting = false,
                            disconnected = false,
                            errorMessage = null,
                            statusText = "终端已连接"
                        )
                    }
                    lastTerminalSize?.let { size ->
                        webSocket.send(
                            json.encodeToString(
                                TerminalClientMessage.serializer(),
                                TerminalClientMessage(type = "resize", cols = size.cols, rows = size.rows)
                            )
                        )
                    }
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
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
                                        statusText = "终端就绪"
                                    )
                                }
                                lastTerminalSize?.let { size ->
                                    webSocket.send(
                                        json.encodeToString(
                                            TerminalClientMessage.serializer(),
                                            TerminalClientMessage(type = "resize", cols = size.cols, rows = size.rows)
                                        )
                                    )
                                }
                            }

                            "output" -> {
                                if (!message.data.isNullOrEmpty()) {
                                    _uiState.update { state ->
                                        state.copy(transcript = (state.transcript + message.data).takeLast(MAX_TRANSCRIPT_CHARS))
                                    }
                                    _events.tryEmit(TerminalEvent.OutputChunk(message.data))
                                }
                            }

                            "error" -> {
                                _uiState.update {
                                    it.copy(
                                        connecting = false,
                                        ready = false,
                                        disconnected = true,
                                        errorMessage = message.message ?: "终端连接失败",
                                        statusText = "连接失败"
                                    )
                                }
                            }
                        }
                    }.onFailure {
                        _uiState.update { state ->
                            state.copy(transcript = (state.transcript + text).takeLast(MAX_TRANSCRIPT_CHARS))
                        }
                        _events.tryEmit(TerminalEvent.OutputChunk(text))
                    }
                }

                override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                    webSocket.close(code, reason)
                }

                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    _uiState.update {
                        it.copy(
                            connecting = false,
                            ready = false,
                            disconnected = true,
                            statusText = if (reason.isBlank()) "终端已断开" else reason
                        )
                    }
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    _uiState.update {
                        it.copy(
                            connecting = false,
                            ready = false,
                            disconnected = true,
                            errorMessage = t.message ?: "终端连接失败",
                            statusText = "连接异常"
                        )
                    }
                }
            })
        }
    }

    private fun disconnect() {
        connectJob?.cancel()
        connectJob = null
        webSocket?.close(1000, "closed")
        webSocket = null
    }

    override fun onCleared() {
        disconnect()
        super.onCleared()
    }

    private fun buildWebSocketUrl(baseUrl: String, deviceId: Int): String {
        val normalized = baseUrl.removeSuffix("/")
        val wsBase = when {
            normalized.startsWith("https://") -> "wss://${normalized.removePrefix("https://")}"
            normalized.startsWith("http://") -> "ws://${normalized.removePrefix("http://")}"
            else -> normalized
        }
        return "$wsBase/api/devices/$deviceId/terminal/ws"
    }

    @Serializable
    private data class TerminalServerMessage(
        @SerialName("type")
        val type: String,
        @SerialName("data")
        val data: String? = null,
        @SerialName("message")
        val message: String? = null
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
        val rows: Int? = null
    )

    private data class TerminalSize(
        val cols: Int,
        val rows: Int
    )

    private companion object {
        const val MAX_TRANSCRIPT_CHARS = 32_000
    }
}
