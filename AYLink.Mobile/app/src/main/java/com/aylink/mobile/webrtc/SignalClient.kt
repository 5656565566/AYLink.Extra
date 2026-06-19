package com.aylink.mobile.webrtc

import android.net.Uri
import android.util.Log
import com.aylink.mobile.data.model.RtcAnswerMessage
import com.aylink.mobile.data.model.RtcCandidateMessage
import com.aylink.mobile.data.model.RtcOfferMessage
import com.aylink.mobile.data.model.RtcSignalErrorMessage
import com.aylink.mobile.logging.AppLogger
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener

class SignalClient(
    private val okHttpClient: OkHttpClient,
    private val json: Json,
    private val appLogger: AppLogger? = null
) {
    private companion object {
        private const val LOG_TAG = "AYLinkSignal"
    }

    data class ConnectArgs(
        val baseUrl: String,
        val ticket: String
    )

    sealed interface Event {
        data class Answer(val payload: RtcAnswerMessage) : Event
        data class Candidate(val payload: RtcCandidateMessage) : Event
        data class Error(val message: String, val retryable: Boolean = true) : Event
        data object Open : Event
        data object Closed : Event
    }

    private val _events = MutableSharedFlow<Event>(
        extraBufferCapacity = 32,
        onBufferOverflow = BufferOverflow.DROP_OLDEST
    )

    val events: SharedFlow<Event> = _events

    private var socket: WebSocket? = null
    @Volatile
    private var isSocketOpen = false
    @Volatile
    private var activeConnectionId = 0
    private var connectionSequence = 0

    val isOpen: Boolean
        get() = isSocketOpen

    fun connect(args: ConnectArgs) {
        connectionSequence += 1
        val connectionId = connectionSequence
        activeConnectionId = connectionId
        isSocketOpen = false
        val previousSocket = socket
        socket = null
        previousSocket?.close(1000, null)
        val wsUrl = buildWebSocketUrl(args.baseUrl, args.ticket)
        val request = Request.Builder().url(wsUrl).build()
        socket = okHttpClient.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                if (connectionId != activeConnectionId) {
                    webSocket.close(1000, null)
                    return
                }
                isSocketOpen = true
                Log.i(LOG_TAG, "Signaling opened, connectionId=$connectionId")
                appLogger?.i(LOG_TAG, "Signaling opened, connectionId=$connectionId")
                _events.tryEmit(Event.Open)
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                if (connectionId != activeConnectionId) {
                    return
                }
                val payload = json.parseToJsonElement(text) as? JsonObject ?: return
                val eventType = payload["type"]?.jsonPrimitive?.contentOrNull
                val candidate = payload["candidate"]?.jsonPrimitive?.contentOrNull
                val sdp = payload["sdp"]?.jsonPrimitive?.contentOrNull
                val sdpType = payload["type"]?.jsonPrimitive?.contentOrNull

                when {
                    eventType == "error" -> {
                        val signalError = json.decodeFromJsonElement(RtcSignalErrorMessage.serializer(), payload)
                        _events.tryEmit(
                            Event.Error(
                                message = buildSignalErrorMessage(signalError),
                                retryable = signalError.retryable
                            )
                        )
                    }

                    !candidate.isNullOrBlank() -> {
                        _events.tryEmit(Event.Candidate(json.decodeFromJsonElement(RtcCandidateMessage.serializer(), payload)))
                    }

                    !sdp.isNullOrBlank() && !sdpType.isNullOrBlank() -> {
                        _events.tryEmit(Event.Answer(json.decodeFromJsonElement(RtcAnswerMessage.serializer(), payload)))
                    }
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                if (connectionId != activeConnectionId) {
                    return
                }
                isSocketOpen = false
                socket = null
                Log.w(LOG_TAG, "Signaling failed, connectionId=$connectionId, responseCode=${response?.code}", t)
                appLogger?.w(LOG_TAG, "Signaling failed, connectionId=$connectionId, responseCode=${response?.code}", t)
                val message = buildString {
                    append(t.message ?: "Signal connection failed")
                    if (response != null) {
                        append(" (HTTP ")
                        append(response.code)
                        append(")")
                    }
                }
                _events.tryEmit(Event.Error(message = message, retryable = true))
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                if (connectionId != activeConnectionId) {
                    return
                }
                isSocketOpen = false
                socket = null
                Log.i(LOG_TAG, "Signaling closed, connectionId=$connectionId, code=$code, reason=$reason")
                appLogger?.i(LOG_TAG, "Signaling closed, connectionId=$connectionId, code=$code, reason=$reason")
                _events.tryEmit(Event.Closed)
            }
        })
    }

    fun sendOffer(offer: RtcOfferMessage) {
        socket?.send(json.encodeToString(RtcOfferMessage.serializer(), offer))
    }

    fun sendCandidate(candidate: RtcCandidateMessage) {
        socket?.send(json.encodeToString(RtcCandidateMessage.serializer(), candidate))
    }

    fun disconnect() {
        isSocketOpen = false
        activeConnectionId = 0
        val currentSocket = socket
        socket = null
        currentSocket?.close(1000, null)
    }

    private fun buildWebSocketUrl(baseUrl: String, ticket: String): String {
        val httpBase = baseUrl.removeSuffix("/")
        val wsBase = when {
            httpBase.startsWith("https://") -> "wss://${httpBase.removePrefix("https://")}"
            httpBase.startsWith("http://") -> "ws://${httpBase.removePrefix("http://")}"
            else -> "ws://$httpBase"
        }

        return buildString {
            append(wsBase)
            append("/webrtc?ticket=")
            append(Uri.encode(ticket))
        }
    }

    private fun buildSignalErrorMessage(payload: RtcSignalErrorMessage): String {
        val detail = payload.detail?.takeIf { it.isNotBlank() }
        return if (detail == null) {
            payload.message
        } else {
            "${payload.message}: $detail"
        }
    }
}
