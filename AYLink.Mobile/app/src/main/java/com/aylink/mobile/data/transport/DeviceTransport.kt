package com.aylink.mobile.data.transport

import android.content.Context
import com.aylink.mobile.data.api.ApiException
import com.aylink.mobile.data.api.executeJson
import com.aylink.mobile.data.api.executeRaw
import com.aylink.mobile.data.repo.SessionStore
import com.aylink.mobile.logging.AppLogger
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runInterruptible
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okio.buffer
import org.webrtc.DataChannel
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import java.io.IOException
import java.nio.ByteBuffer

@Serializable
private data class NetworkSettings(
    @SerialName("IceTransportPolicy") val policy: String = "all",
    @SerialName("IceServers") val servers: List<IceServerSettings> = emptyList(),
)

@Serializable
private data class IceServerSettings(
    @SerialName("Urls") val urls: List<String> = emptyList(),
    @SerialName("Username") val username: String? = null,
    @SerialName("Credential") val credential: String? = null,
)

@Serializable
private data class Description(
    val type: String,
    val sdp: String,
)

class DeviceTransport(
    private val context: Context,
    private val client: OkHttpClient,
    private val json: Json,
    private val sessions: SessionStore,
    private val logger: AppLogger,
    private val preferFileTransfer: () -> Boolean,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val initialized by lazy {
        PeerConnectionFactory.initialize(PeerConnectionFactory.InitializationOptions.builder(context).createInitializationOptions())
        true
    }
    internal val pool = DeviceConnectionPool(scope, ::accountKey, ::connect)

    init {
        scope.launch { sessions.transportGeneration.collect { pool.refreshAccount() } }
    }

    internal fun accountKey() = "${sessions.baseUrl.value}|${sessions.username.value}|${sessions.transportGeneration.value}"

    suspend fun executeFile(
        request: Request,
        deviceId: Int,
        fallback: OkHttpClient,
    ): Response {
        val account = accountKey()
        val base = sessions.baseUrl.value.toHttpUrl()
        if (request.url.scheme != base.scheme ||
            request.url.host != base.host ||
            request.url.port != base.port ||
            !request.url.encodedPath.startsWith("${base.encodedPath.removeSuffix("/")}/api/devices/$deviceId/")
        ) {
            throw CancellationException("File request server changed")
        }
        val connection = if (preferFileTransfer()) pool.acquire(deviceId) else null
        if (accountKey() != account) throw CancellationException("Account session changed")
        // 只在建连失败时回退；RTC 请求开始后发生错误不能重放写操作。
        return connection?.request(request) ?: fallback.executeRaw(request)
    }

    private suspend fun connect(deviceId: Int): DeviceConnection {
        var connection: PeerDeviceConnection? = null
        var factory: PeerConnectionFactory? = null
        try {
            return withTimeout(15_000) {
                val baseUrl = sessions.baseUrl.value
                val token = sessions.token.value ?: throw CancellationException("Not logged in")
                val endpoint = "$baseUrl/api/devices/$deviceId/transport"
                val settings =
                    client.executeJson(
                        Request
                            .Builder()
                            .url(endpoint)
                            .header("Authorization", "Bearer $token")
                            .build(),
                        json,
                        NetworkSettings.serializer(),
                    )
                check(initialized)
                val createdFactory = PeerConnectionFactory.builder().createPeerConnectionFactory()
                factory = createdFactory
                val peer = PeerDeviceConnection(createdFactory, settings, scope, json, baseUrl.toHttpUrl().encodedPath.removeSuffix("/"))
                connection = peer
                val offer = peer.offer()
                val answer =
                    client.executeJson(
                        Request
                            .Builder()
                            .url(endpoint)
                            .header("Authorization", "Bearer $token")
                            .post(json.encodeToString(Description.serializer(), offer).toRequestBody("application/json".toMediaType()))
                            .build(),
                        json,
                        Description.serializer(),
                    )
                peer.accept(answer)
                peer
            }
        } catch (error: Exception) {
            val active = connection
            if (active != null) active.close() else factory?.dispose()
            if (error is CancellationException && error !is TimeoutCancellationException) throw error
            if (error is ApiException && error.statusCode == 401) throw error
            logger.w("DeviceTransport", "RTC establishment failed for device=$deviceId; new operation will use HTTP/WS: ${error.message}")
            throw IOException("RTC establishment failed", error)
        }
    }
}

private class PeerDeviceConnection(
    private val factory: PeerConnectionFactory,
    settings: NetworkSettings,
    private val scope: CoroutineScope,
    private val json: Json,
    private val basePath: String,
) : DeviceConnection {
    private class Pending(
        val channel: DataChannel,
        val stream: RtcByteStream,
    ) {
        val upload = Job()
        val setup = CompletableDeferred<Unit>()
        val disposed = CompletableDeferred<Unit>()
    }

    private val lock = Any()
    private val ready = CompletableDeferred<Unit>()
    private val gathered = CompletableDeferred<Unit>()
    private val pending = mutableSetOf<Pending>()
    private var nextRequest = 0L
    private var idle: Job? = null

    @Volatile private var closed = false

    @Volatile private var connected = false
    private val peer: PeerConnection
    private val handshake: DataChannel

    override val isOpen: Boolean get() = !closed && connected && ready.isCompleted && !ready.isCancelled

    init {
        val servers =
            settings.servers.mapNotNull { server ->
                val urls = server.urls.map { it.trim() }.filter { it.isNotEmpty() }
                if (urls.isEmpty()) {
                    null
                } else {
                    PeerConnection.IceServer
                        .builder(urls)
                        .setUsername(server.username.orEmpty())
                        .setPassword(server.credential.orEmpty())
                        .createIceServer()
                }
            }
        val config =
            PeerConnection
                .RTCConfiguration(
                    servers.ifEmpty {
                        listOf(PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer())
                    },
                ).apply {
                    sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
                    iceTransportsType =
                        if (settings.policy == "relay") PeerConnection.IceTransportsType.RELAY else PeerConnection.IceTransportsType.ALL
                }
        peer = factory.createPeerConnection(
            config,
            object : PeerConnection.Observer {
                override fun onSignalingChange(state: PeerConnection.SignalingState) = Unit

                override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) {
                    connected = state == PeerConnection.IceConnectionState.CONNECTED || state == PeerConnection.IceConnectionState.COMPLETED
                    if (state == PeerConnection.IceConnectionState.FAILED || state == PeerConnection.IceConnectionState.CLOSED) close()
                }

                override fun onIceConnectionReceivingChange(receiving: Boolean) = Unit

                override fun onIceGatheringChange(state: PeerConnection.IceGatheringState) {
                    if (state == PeerConnection.IceGatheringState.COMPLETE) gathered.complete(Unit)
                }

                override fun onIceCandidate(candidate: IceCandidate) = Unit

                override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>) = Unit

                override fun onAddStream(stream: MediaStream) = Unit

                override fun onRemoveStream(stream: MediaStream) = Unit

                override fun onDataChannel(channel: DataChannel) {
                    channel.close()
                }

                override fun onRenegotiationNeeded() = Unit
            },
        ) ?: throw IOException("Cannot create RTC peer")
        var createdChannel: DataChannel? = null
        try {
            handshake = peer.createDataChannel("ready", DataChannel.Init())
            createdChannel = handshake
            handshake.registerObserver(
                object : DataChannel.Observer {
                    override fun onBufferedAmountChange(previousAmount: Long) = Unit

                    override fun onStateChange() {
                        if (handshake.state() == DataChannel.State.CLOSED) close()
                    }

                    override fun onMessage(buffer: DataChannel.Buffer) {
                        if (buffer.data.remaining() > RTC_CHUNK_BYTES) {
                            close()
                            return
                        }
                        val data = ByteArray(buffer.data.remaining()).also { buffer.data.get(it) }
                        if (!buffer.binary && data.decodeToString() == "ready") {
                            connected = true
                            ready.complete(Unit)
                        } else {
                            close()
                        }
                    }
                },
            )
        } catch (error: Exception) {
            closed = true
            createdChannel?.unregisterObserver()
            createdChannel?.close()
            createdChannel?.dispose()
            peer.close()
            peer.dispose()
            throw error
        }
    }

    suspend fun offer(): Description {
        val offer = CompletableDeferred<SessionDescription>()
        peer.createOffer(
            object : SdpCallbacks() {
                override fun onCreateSuccess(description: SessionDescription) {
                    offer.complete(description)
                }

                override fun onCreateFailure(error: String) {
                    offer.completeExceptionally(IOException(error))
                }
            },
            MediaConstraints(),
        )
        setDescription(offer.await(), local = true)
        gathered.await()
        return Description("offer", peer.localDescription.description)
    }

    suspend fun accept(answer: Description) {
        if (answer.type != "answer") throw IOException("Invalid RTC answer")
        setDescription(SessionDescription(SessionDescription.Type.ANSWER, answer.sdp), local = false)
        ready.await()
        resetIdle()
    }

    private suspend fun setDescription(
        description: SessionDescription,
        local: Boolean,
    ) {
        val done = CompletableDeferred<Unit>()
        val observer =
            object : SdpCallbacks() {
                override fun onSetSuccess() {
                    done.complete(Unit)
                }

                override fun onSetFailure(error: String) {
                    done.completeExceptionally(IOException(error))
                }
            }
        if (local) peer.setLocalDescription(observer, description) else peer.setRemoteDescription(observer, description)
        done.await()
    }

    override suspend fun request(request: Request): Response {
        val cancellation = Job(currentCoroutineContext()[Job])
        val item =
            try {
                synchronized(lock) {
                    if (!isOpen) throw IOException("RTC connection closed before request")
                    if (pending.size >= 16) throw IOException("Too many concurrent RTC requests")
                    idle?.cancel()
                    val channel = peer.createDataChannel("request-${++nextRequest}", DataChannel.Init())
                    lateinit var item: Pending
                    val stream =
                        RtcByteStream(json, { bytes, binary -> channel.send(DataChannel.Buffer(ByteBuffer.wrap(bytes), binary)) }) {
                            cancellation.complete()
                            scope.launch {
                                try {
                                    item.setup.await()
                                    item.upload.cancelAndJoin()
                                    channel.unregisterObserver()
                                    channel.close()
                                    channel.dispose()
                                } finally {
                                    synchronized(lock) { pending.remove(item) }
                                    item.disposed.complete(Unit)
                                    resetIdle()
                                }
                            }
                        }
                    item = Pending(channel, stream)
                    pending.add(item)
                    item
                }
            } catch (error: Exception) {
                cancellation.complete()
                resetIdle()
                throw error
            }
        cancellation.invokeOnCompletion { cause -> if (cause != null) item.stream.fail(IOException("RTC request cancelled", cause)) }
        val started = CompletableDeferred<Unit>()
        try {
            item.channel.registerObserver(
                object : DataChannel.Observer {
                    override fun onBufferedAmountChange(previousAmount: Long) = Unit

                    override fun onStateChange() {
                        when (item.channel.state()) {
                            DataChannel.State.OPEN -> started.complete(Unit)
                            DataChannel.State.CLOSED -> item.stream.fail(IOException("RTC data channel closed during request"))
                            else -> Unit
                        }
                    }

                    override fun onMessage(buffer: DataChannel.Buffer) {
                        if (buffer.data.remaining() > RTC_CHUNK_BYTES) {
                            item.stream.fail(IOException("RTC frame exceeds chunk limit"))
                            return
                        }
                        val data = ByteArray(buffer.data.remaining()).also { buffer.data.get(it) }
                        item.stream.receive(data, buffer.binary)
                    }
                },
            )
            scope.launch(item.upload) {
                try {
                    withTimeout(15_000) {
                        if (item.channel.state() == DataChannel.State.OPEN) started.complete(Unit)
                        started.await()
                    }
                    runInterruptible {
                        item.stream.start(request, basePath)
                        val sink = item.stream.sink().buffer()
                        request.body?.writeTo(sink)
                        sink.flush()
                        item.stream.end()
                    }
                } catch (error: Exception) {
                    if (!item.stream.responseEnded) item.stream.fail(IOException("RTC request failed", error))
                }
            }
        } catch (error: Exception) {
            item.stream.fail(IOException("RTC channel setup failed", error))
            throw error
        } finally {
            item.setup.complete(Unit)
        }
        try {
            return withTimeout(5 * 60_000) { item.stream.awaitResponse(request) }
        } catch (error: Exception) {
            item.stream.fail(IOException("RTC request failed", error))
            throw error
        }
    }

    private fun resetIdle() {
        synchronized(lock) {
            idle?.cancel()
            if (!closed && pending.isEmpty()) {
                idle =
                    scope.launch {
                        delay(60_000)
                        close()
                    }
            }
        }
    }

    override fun close() {
        val requests =
            synchronized(lock) {
                if (closed) return
                closed = true
                idle?.cancel()
                pending.toList()
            }
        ready.completeExceptionally(IOException("RTC connection closed"))
        gathered.completeExceptionally(IOException("RTC connection closed"))
        requests.forEach { it.stream.fail(IOException("RTC connection closed")) }
        // WebRTC 的 dispose 不能在其 observer 回调线程内执行。
        scope.launch {
            requests.forEach { it.disposed.await() }
            handshake.unregisterObserver()
            handshake.close()
            handshake.dispose()
            peer.close()
            peer.dispose()
            factory.dispose()
        }
    }
}

private open class SdpCallbacks : SdpObserver {
    override fun onCreateSuccess(description: SessionDescription) = Unit

    override fun onSetSuccess() = Unit

    override fun onCreateFailure(error: String) = Unit

    override fun onSetFailure(error: String) = Unit
}
