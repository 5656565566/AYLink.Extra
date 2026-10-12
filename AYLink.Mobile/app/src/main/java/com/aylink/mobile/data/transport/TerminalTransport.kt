package com.aylink.mobile.data.transport

import com.aylink.mobile.data.api.ApiException
import com.aylink.mobile.data.repo.AuthRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.BufferedSink
import java.io.IOException

interface TerminalConnection {
    fun send(text: String): Boolean

    fun close()
}

interface TerminalListener {
    fun onOpen(connection: TerminalConnection)

    fun onMessage(
        connection: TerminalConnection,
        text: String,
    )

    fun onClosed(reason: String)

    fun onFailure(error: Throwable)
}

class TerminalTransport(
    private val client: OkHttpClient,
    private val auth: AuthRepository,
    private val transport: DeviceTransport,
) {
    fun connect(
        scope: CoroutineScope,
        deviceId: Int,
        listener: TerminalListener,
    ): TerminalConnection = ManagedConnection(scope, deviceId, listener).also { it.connect() }

    private inner class ManagedConnection(
        private val scope: CoroutineScope,
        private val deviceId: Int,
        private val listener: TerminalListener,
    ) : TerminalConnection {
        @Volatile private var closed = false

        @Volatile private var socket: WebSocket? = null

        @Volatile private var input: TerminalInputBody? = null
        private var job: Job? = null

        fun connect() {
            job =
                scope.launch(Dispatchers.IO) {
                    try {
                        auth.withAuthorizedRequest { baseUrl, token ->
                            val account = transport.accountKey()
                            val connection = transport.pool.acquire(deviceId)
                            if (account != transport.accountKey() || closed) throw CancellationException("Terminal session changed")
                            if (connection == null) {
                                connectSocket(baseUrl, token)
                            } else {
                                val body = TerminalInputBody()
                                input = body
                                try {
                                    val request =
                                        Request
                                            .Builder()
                                            .url("$baseUrl/api/devices/$deviceId/terminal/stream")
                                            .header("Authorization", "Bearer $token")
                                            .post(body)
                                            .build()
                                    connection.request(request).use { response ->
                                        if (!response.isSuccessful) {
                                            throw ApiException(
                                                response.code,
                                                "HTTP ${response.code}: ${response.body?.string().orEmpty()}",
                                            )
                                        }
                                        if (closed) throw CancellationException("Terminal closed")
                                        listener.onOpen(this@ManagedConnection)
                                        val source = response.body?.source() ?: throw IOException("Terminal response is empty")
                                        while (!closed && !source.exhausted()) {
                                            listener.onMessage(this@ManagedConnection, source.readUtf8LineStrict(1024 * 1024))
                                        }
                                    }
                                } finally {
                                    body.close()
                                    input = null
                                }
                            }
                        }
                        if (socket == null && !closed) {
                            listener.onClosed("")
                            close()
                        }
                    } catch (error: CancellationException) {
                        close()
                    } catch (error: Exception) {
                        if (!closed) listener.onFailure(error)
                        close()
                    }
                }
        }

        private suspend fun connectSocket(
            baseUrl: String,
            token: String,
        ) {
            val opened = CompletableDeferred<Unit>()
            val url = baseUrl.replaceFirst("https://", "wss://").replaceFirst("http://", "ws://")
            val request =
                Request
                    .Builder()
                    .url("$url/api/devices/$deviceId/terminal/ws")
                    .header("Authorization", "Bearer $token")
                    .build()
            val next =
                client.newWebSocket(
                    request,
                    object : WebSocketListener() {
                        override fun onOpen(
                            webSocket: WebSocket,
                            response: Response,
                        ) {
                            if (closed) {
                                webSocket.cancel()
                                return
                            }
                            socket = webSocket
                            listener.onOpen(this@ManagedConnection)
                            opened.complete(Unit)
                        }

                        override fun onMessage(
                            webSocket: WebSocket,
                            text: String,
                        ) {
                            if (!closed) listener.onMessage(this@ManagedConnection, text)
                        }

                        override fun onClosing(
                            webSocket: WebSocket,
                            code: Int,
                            reason: String,
                        ) {
                            webSocket.close(code, reason)
                        }

                        override fun onClosed(
                            webSocket: WebSocket,
                            code: Int,
                            reason: String,
                        ) {
                            opened.completeExceptionally(IOException("Terminal closed before opening"))
                            if (!closed) listener.onClosed(reason)
                            close()
                        }

                        override fun onFailure(
                            webSocket: WebSocket,
                            t: Throwable,
                            response: Response?,
                        ) {
                            val error = if (response?.code == 401) ApiException(401, "Terminal authentication expired") else t
                            if (!opened.isCompleted) {
                                opened.completeExceptionally(error)
                            } else if (!closed) {
                                listener.onFailure(error)
                                close()
                            }
                        }
                    },
                )
            socket = next
            try {
                opened.await()
            } catch (error: Exception) {
                next.cancel()
                socket = null
                throw error
            }
        }

        override fun send(text: String): Boolean {
            if (closed) return false
            if (socket == null && input == null) return false
            val sent = socket?.send(text) ?: input?.send(text) ?: false
            if (!sent) {
                listener.onFailure(IOException("Terminal input queue is full or closed"))
                close()
            }
            return sent
        }

        override fun close() {
            closed = true
            input?.close()
            socket?.cancel()
            job?.cancel()
        }
    }
}

internal class TerminalInputBody : RequestBody() {
    private val lock = Object()
    private val queue = ArrayDeque<ByteArray>()
    private var queuedBytes = 0
    private var closed = false

    override fun contentType() = "application/x-ndjson".toMediaType()

    override fun isDuplex() = true

    fun send(text: String): Boolean {
        val bytes = "$text\n".encodeToByteArray()
        synchronized(lock) {
            if (closed || bytes.size > RTC_WINDOW_BYTES - queuedBytes) return false
            queue.addLast(bytes)
            queuedBytes += bytes.size
            lock.notifyAll()
            return true
        }
    }

    override fun writeTo(sink: BufferedSink) {
        while (true) {
            val bytes =
                synchronized(lock) {
                    while (queue.isEmpty() && !closed) lock.wait()
                    if (closed) return
                    queue.removeFirst().also { queuedBytes -= it.size }
                }
            sink.write(bytes)
            sink.flush()
        }
    }

    fun close() {
        synchronized(lock) {
            closed = true
            queue.clear()
            queuedBytes = 0
            lock.notifyAll()
        }
    }
}
