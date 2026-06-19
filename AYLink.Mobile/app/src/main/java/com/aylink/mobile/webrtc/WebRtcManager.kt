package com.aylink.mobile.webrtc

import android.media.AudioAttributes
import android.content.Context
import android.util.Log
import com.aylink.mobile.data.model.PointerControlMessage
import com.aylink.mobile.data.model.RtcCandidateMessage
import com.aylink.mobile.data.model.RtcOfferMessage
import com.aylink.mobile.logging.AppLogger
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.serialization.json.Json
import org.webrtc.AudioTrack
import org.webrtc.DataChannel
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.MediaStreamTrack
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpTransceiver
import org.webrtc.RtpReceiver
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.SurfaceViewRenderer
import org.webrtc.VideoFrame
import org.webrtc.VideoSink
import org.webrtc.VideoTrack
import org.webrtc.audio.JavaAudioDeviceModule
import java.nio.ByteBuffer
import java.nio.ByteOrder

class WebRtcManager(
    context: Context,
    private val json: Json,
    private val signalClient: SignalClient,
    private val appLogger: AppLogger? = null
) {
    data class VideoFrameHealthSnapshot(
        val generation: Int,
        val frameCount: Long,
        val lastFrameAtMillis: Long,
        val width: Int,
        val height: Int,
        val isPeerConnected: Boolean,
        val hasVideoFrame: Boolean
    )

    companion object {
        private const val LOG_TAG = "AYLinkWebRtc"
        private const val CONTROL_CHANNEL_LABEL = "control"
        private const val META_CONTROL_CHANNEL_LABEL = "control-meta"
        private const val POINTER_MOVE_CHANNEL_LABEL = "pointer-move"
        private const val LOCAL_META_CONTROL_PREFIX: Byte = -1
        private const val LOCAL_META_MSG_VIDEO_KEY_FRAME: Byte = 2
        private const val SCRCPY_MSG_INJECT_KEYCODE: Byte = 0
        private const val SCRCPY_MSG_INJECT_TOUCH_EVENT: Byte = 2
        private const val SCRCPY_MSG_SET_SCREEN_POWER_MODE: Byte = 10
        private const val SCRCPY_MSG_RESIZE_DISPLAY: Byte = 21

        private const val SCRCPY_ACTION_DOWN: Byte = 0
        private const val SCRCPY_ACTION_UP: Byte = 1
        private const val SCRCPY_ACTION_MOVE: Byte = 2

        private const val ANDROID_KEYCODE_HOME = 3
        private const val ANDROID_KEYCODE_BACK = 4
        private const val ANDROID_KEYCODE_POWER = 26
        private const val ANDROID_KEYCODE_VOLUME_UP = 24
        private const val ANDROID_KEYCODE_VOLUME_DOWN = 25
        private const val ANDROID_KEYCODE_MENU = 82
        private const val ANDROID_KEYCODE_MUTE = 164
        private const val ANDROID_KEYCODE_RECENT = 187
    }

    sealed interface Event {
        val generation: Int

        data class Connected(override val generation: Int) : Event
        data class Disconnected(override val generation: Int) : Event
        data class VideoSizeChanged(override val generation: Int, val width: Int, val height: Int) : Event
        data class Error(override val generation: Int, val message: String) : Event
    }

    private val _events = MutableSharedFlow<Event>(
        extraBufferCapacity = 16,
        onBufferOverflow = BufferOverflow.DROP_OLDEST
    )
    val events: SharedFlow<Event> = _events

    private val eglBase = EglBase.create()
    private val peerConnectionFactory: PeerConnectionFactory
    private val audioDeviceModule: JavaAudioDeviceModule
    private var peerConnection: PeerConnection? = null
    private var dataChannel: DataChannel? = null
    private var metaControlChannel: DataChannel? = null
    private var pointerMoveChannel: DataChannel? = null
    private var remoteVideoTrack: VideoTrack? = null
    private var remoteAudioTrack: AudioTrack? = null
    private var frameSizeSink: VideoSink? = null
    private var renderer: SurfaceViewRenderer? = null
    @Volatile
    private var isDisconnecting = false
    @Volatile
    private var connectionGeneration = 0
    private var lastVideoWidth = 0
    private var lastVideoHeight = 0
    @Volatile
    private var lastFrameAtMillis = 0L
    @Volatile
    private var videoFrameCount = 0L
    private var isIceConnected = false
    private var isPrimaryControlChannelOpen = false
    private var hasVideoFrame = false
    private var hasEmittedConnected = false
    init {
        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions.builder(context)
                .createInitializationOptions()
        )

        audioDeviceModule = JavaAudioDeviceModule.builder(context)
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MOVIE)
                    .build()
            )
            .createAudioDeviceModule()

        val options = PeerConnectionFactory.Options()
        peerConnectionFactory = PeerConnectionFactory.builder()
            .setOptions(options)
            .setAudioDeviceModule(audioDeviceModule)
            .setVideoDecoderFactory(DefaultVideoDecoderFactory(eglBase.eglBaseContext))
            .setVideoEncoderFactory(DefaultVideoEncoderFactory(eglBase.eglBaseContext, true, true))
            .createPeerConnectionFactory()
    }

    fun initializeRenderer(renderer: SurfaceViewRenderer) {
        this.renderer = renderer
        renderer.init(eglBase.eglBaseContext, null)
        renderer.setEnableHardwareScaler(false)
        renderer.setMirror(false)
    }

    fun releaseRenderer(renderer: SurfaceViewRenderer) {
        remoteVideoTrack?.removeSink(renderer)
        frameSizeSink?.let { remoteVideoTrack?.removeSink(it) }
        if (this.renderer === renderer) {
            this.renderer = null
        }
        renderer.release()
    }

    fun createPeerConnection(): Int {
        isDisconnecting = true
        closePeerConnection()
        isDisconnecting = false
        val generation = ++connectionGeneration
        frameSizeSink = createFrameSizeSink(generation)
        val rtcConfig = PeerConnection.RTCConfiguration(emptyList()).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
        }

        peerConnection = peerConnectionFactory.createPeerConnection(rtcConfig, object : PeerConnection.Observer {
            override fun onSignalingChange(newState: PeerConnection.SignalingState) = Unit
            override fun onIceConnectionChange(newState: PeerConnection.IceConnectionState) {
                if (!isCurrentGeneration(generation)) {
                    return
                }
                Log.i(LOG_TAG, "ICE connection state changed, generation=$generation, state=$newState")
                appLogger?.i(LOG_TAG, "ICE connection state changed, generation=$generation, state=$newState")
                when (newState) {
                    PeerConnection.IceConnectionState.CONNECTED,
                    PeerConnection.IceConnectionState.COMPLETED -> {
                        isIceConnected = true
                        emitConnectedIfReady(generation)
                    }
                    PeerConnection.IceConnectionState.DISCONNECTED,
                    PeerConnection.IceConnectionState.CLOSED,
                    PeerConnection.IceConnectionState.FAILED -> {
                        resetConnectionReadyState()
                        _events.tryEmit(Event.Disconnected(generation))
                    }
                    else -> Unit
                }
            }

            override fun onIceConnectionReceivingChange(receiving: Boolean) = Unit
            override fun onIceGatheringChange(newState: PeerConnection.IceGatheringState) = Unit
            override fun onIceCandidate(candidate: IceCandidate) {
                if (!isCurrentGeneration(generation)) {
                    return
                }
                signalClient.sendCandidate(
                    RtcCandidateMessage(
                        candidate = candidate.sdp,
                        sdpMid = candidate.sdpMid,
                        sdpMLineIndex = candidate.sdpMLineIndex
                    )
                )
            }

            override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>) = Unit
            override fun onAddStream(stream: MediaStream) = Unit
            override fun onRemoveStream(stream: MediaStream) = Unit
            override fun onDataChannel(channel: DataChannel) {
                Log.i(LOG_TAG, "Remote data channel received, generation=$generation, label=${channel.label()}")
                appLogger?.i(LOG_TAG, "Remote data channel received, generation=$generation, label=${channel.label()}")
                when (channel.label()) {
                    POINTER_MOVE_CHANNEL_LABEL -> {
                        pointerMoveChannel = channel
                        observeDataChannel(channel, generation)
                    }
                    META_CONTROL_CHANNEL_LABEL -> {
                        metaControlChannel = channel
                        observeDataChannel(channel, generation)
                    }
                    else -> {
                        dataChannel = channel
                        observeDataChannel(channel, generation)
                    }
                }
            }

            override fun onRenegotiationNeeded() = Unit
            override fun onAddTrack(receiver: RtpReceiver, mediaStreams: Array<out MediaStream>) = Unit

            override fun onTrack(transceiver: RtpTransceiver) {
                if (!isCurrentGeneration(generation)) {
                    return
                }
                when (val track = transceiver.receiver.track()) {
                    is VideoTrack -> {
                        remoteVideoTrack?.removeSink(frameSizeSink)
                        renderer?.let { remoteVideoTrack?.removeSink(it) }
                        remoteVideoTrack = track
                        bindTrackToRenderer()
                    }
                    is AudioTrack -> remoteAudioTrack = track
                }
            }
        })

        peerConnection?.addTransceiver(MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO, recvOnlyInit())
        peerConnection?.addTransceiver(MediaStreamTrack.MediaType.MEDIA_TYPE_AUDIO, recvOnlyInit())
        dataChannel = peerConnection?.createDataChannel(CONTROL_CHANNEL_LABEL, DataChannel.Init())?.also { observeDataChannel(it, generation) }
        metaControlChannel = peerConnection?.createDataChannel(META_CONTROL_CHANNEL_LABEL, DataChannel.Init())?.also { observeDataChannel(it, generation) }
        pointerMoveChannel = peerConnection?.createDataChannel(
            POINTER_MOVE_CHANNEL_LABEL,
            DataChannel.Init().apply {
                ordered = false
                maxRetransmits = 0
            }
        )?.also { observeDataChannel(it, generation) }
        return generation
    }

    fun bindRemoteVideo(renderer: SurfaceViewRenderer) {
        this.renderer = renderer
        bindTrackToRenderer()
    }

    fun createOffer(generation: Int = connectionGeneration) {
        createOfferInternal(generation)
    }

    fun restartIce(generation: Int = connectionGeneration) {
        val connection = peerConnection ?: return
        connection.restartIce()
        createOfferInternal(generation)
    }

    fun isPeerConnected(): Boolean {
        val state = peerConnection?.connectionState()
        return state == PeerConnection.PeerConnectionState.CONNECTED
    }

    fun hasRecentFrame(withinMs: Long): Boolean {
        val last = lastFrameAtMillis
        if (last <= 0L) {
            return false
        }
        return System.currentTimeMillis() - last <= withinMs
    }

    fun getVideoFrameHealthSnapshot(): VideoFrameHealthSnapshot {
        return VideoFrameHealthSnapshot(
            generation = connectionGeneration,
            frameCount = videoFrameCount,
            lastFrameAtMillis = lastFrameAtMillis,
            width = lastVideoWidth,
            height = lastVideoHeight,
            isPeerConnected = isPeerConnected(),
            hasVideoFrame = hasVideoFrame
        )
    }

    private fun createOfferInternal(generation: Int) {
        val connection = peerConnection ?: return
        connection.createOffer(object : SdpObserver {
            override fun onCreateSuccess(description: SessionDescription) {
                if (!isCurrentConnection(connection, generation)) {
                    return
                }
                connection.setLocalDescription(object : SdpObserver {
                    override fun onSetSuccess() {
                        if (!isCurrentConnection(connection, generation)) {
                            return
                        }
                        signalClient.sendOffer(
                            RtcOfferMessage(
                                type = description.type.canonicalForm(),
                                sdp = description.description
                            )
                        )
                    }

                    override fun onSetFailure(error: String) {
                        if (!isCurrentConnection(connection, generation)) {
                            return
                        }
                        _events.tryEmit(Event.Error(generation, error))
                    }

                    override fun onCreateSuccess(description: SessionDescription) = Unit
                    override fun onCreateFailure(error: String) = Unit
                }, description)
            }

            override fun onCreateFailure(error: String) {
                if (!isCurrentConnection(connection, generation)) {
                    return
                }
                _events.tryEmit(Event.Error(generation, error))
            }

            override fun onSetSuccess() = Unit
            override fun onSetFailure(error: String) = Unit
        }, MediaConstraints())
    }

    fun setRemoteAnswer(type: String, sdp: String, generation: Int = connectionGeneration) {
        val connection = peerConnection ?: return
        val description = SessionDescription(
            if (type.equals("answer", ignoreCase = true)) SessionDescription.Type.ANSWER else SessionDescription.Type.OFFER,
            sdp
        )
        connection.setRemoteDescription(noopSdpObserver(connection, generation), description)
    }

    fun addRemoteCandidate(candidate: RtcCandidateMessage, generation: Int = connectionGeneration) {
        val connection = peerConnection ?: return
        if (!isCurrentConnection(connection, generation)) {
            return
        }
        connection.addIceCandidate(
            IceCandidate(candidate.sdpMid, candidate.sdpMLineIndex ?: 0, candidate.candidate)
        )
    }

    fun sendPointerMessage(
        payload: PointerControlMessage,
        preferPointerMoveChannel: Boolean = true,
        reportFailure: Boolean = true
    ): Boolean {
        val action = when (payload.phase.lowercase()) {
            "down" -> SCRCPY_ACTION_DOWN
            "up", "cancel" -> SCRCPY_ACTION_UP
            else -> SCRCPY_ACTION_MOVE
        }
        val message = buildTouchMessage(payload, action)
        return if (action == SCRCPY_ACTION_MOVE && preferPointerMoveChannel) {
            sendPointerMove(message)
        } else {
            sendControl(message, reportFailure)
        }
    }

    fun sendKeyMessage(action: String) {
        when (action.lowercase()) {
            "screenon" -> sendMetaControl(buildScreenPowerMessage(true))
            "screenoff" -> sendMetaControl(buildScreenPowerMessage(false))
            else -> {
                val keyCode = mapAndroidCommandToKeycode(action) ?: return
                sendControl(buildInjectKeycodeMessage(SCRCPY_ACTION_DOWN, keyCode))
                sendControl(buildInjectKeycodeMessage(SCRCPY_ACTION_UP, keyCode))
            }
        }
    }

    fun sendDisplayResize(width: Int, height: Int) {
        sendMetaControl(buildResizeDisplayMessage(width, height))
    }

    fun requestVideoKeyFrameReplay(reason: String): Boolean {
        val requested = sendBinary(
            selectDedicatedMetaControlChannel(),
            byteArrayOf(LOCAL_META_CONTROL_PREFIX, LOCAL_META_MSG_VIDEO_KEY_FRAME),
            reportFailure = false
        )
        appLogger?.i(LOG_TAG, "Video key frame replay request result=$requested, reason=$reason, generation=$connectionGeneration")
        return requested
    }

    fun disconnect() {
        isDisconnecting = true
        connectionGeneration += 1
        closePeerConnection()
        signalClient.disconnect()
        isDisconnecting = false
    }

    fun release() {
        disconnect()
        audioDeviceModule.release()
        peerConnectionFactory.dispose()
        eglBase.release()
    }

    private fun sendControl(message: ByteArray, reportFailure: Boolean = true): Boolean {
        return sendBinary(selectControlChannel(), message, reportFailure)
    }

    private fun sendMetaControl(message: ByteArray): Boolean {
        return sendBinary(selectMetaControlChannel(), message, reportFailure = true)
    }

    private fun sendPointerMove(message: ByteArray): Boolean {
        val dedicatedPointerMoveChannel = pointerMoveChannel
        if (dedicatedPointerMoveChannel?.state() == DataChannel.State.OPEN &&
            sendBinary(dedicatedPointerMoveChannel, message, reportFailure = false)
        ) {
            return true
        }

        return sendBinary(selectControlChannel(), message, reportFailure = false)
    }

    private fun sendBinary(
        channel: DataChannel?,
        message: ByteArray,
        reportFailure: Boolean
    ): Boolean {
        val targetChannel = channel ?: run {
            if (reportFailure) {
                reportControlChannelIssue("控制通道不可用")
            }
            return false
        }
        if (targetChannel.state() != DataChannel.State.OPEN) {
            if (reportFailure) {
                reportControlChannelIssue("控制通道不可用")
            }
            return false
        }
        val buffer = ByteBuffer.wrap(message)
        val sent = targetChannel.send(DataChannel.Buffer(buffer, true))
        if (!sent && reportFailure) {
            reportControlChannelIssue("控制通道发送失败")
        }
        return sent
    }

    private fun selectControlChannel(): DataChannel? {
        return if (dataChannel?.state() == DataChannel.State.OPEN) dataChannel else null
    }

    private fun selectMetaControlChannel(): DataChannel? {
        return when {
            metaControlChannel?.state() == DataChannel.State.OPEN -> metaControlChannel
            dataChannel?.state() == DataChannel.State.OPEN -> dataChannel
            else -> null
        }
    }

    private fun selectDedicatedMetaControlChannel(): DataChannel? {
        return if (metaControlChannel?.state() == DataChannel.State.OPEN) metaControlChannel else null
    }

    private fun selectHighFrequencyControlChannel(): DataChannel? {
        return when {
            pointerMoveChannel?.state() == DataChannel.State.OPEN -> pointerMoveChannel
            dataChannel?.state() == DataChannel.State.OPEN -> dataChannel
            else -> null
        }
    }

    fun getPointerMoveBufferedAmount(): Long {
        return selectHighFrequencyControlChannel()?.bufferedAmount() ?: 0L
    }

    private fun recvOnlyInit(): RtpTransceiver.RtpTransceiverInit {
        return RtpTransceiver.RtpTransceiverInit(RtpTransceiver.RtpTransceiverDirection.RECV_ONLY)
    }

    private fun bindTrackToRenderer() {
        val track = remoteVideoTrack ?: return
        val target = renderer
        val sink = frameSizeSink
        if (sink != null) {
            track.removeSink(sink)
        }
        if (target != null) {
            track.removeSink(target)
        }
        if (sink != null) {
            track.addSink(sink)
        }
        if (target != null) {
            track.addSink(target)
        }
    }

    private fun createFrameSizeSink(generation: Int): VideoSink {
        return VideoSink { frame: VideoFrame ->
            if (!isCurrentGeneration(generation)) {
                return@VideoSink
            }
            lastFrameAtMillis = System.currentTimeMillis()
            videoFrameCount += 1
            val width = frame.rotatedWidth
            val height = frame.rotatedHeight
            val wasMissingVideoFrame = !hasVideoFrame
            val sizeChanged = width != lastVideoWidth || height != lastVideoHeight
            if (width > 0 && height > 0) {
                lastVideoWidth = width
                lastVideoHeight = height
                hasVideoFrame = true
                if (wasMissingVideoFrame || sizeChanged) {
                    _events.tryEmit(Event.VideoSizeChanged(generation, width, height))
                }
                emitConnectedIfReady(generation)
            }
        }
    }

    private fun closePeerConnection() {
        resetConnectionReadyState()
        dataChannel?.unregisterObserver()
        metaControlChannel?.unregisterObserver()
        pointerMoveChannel?.unregisterObserver()
        dataChannel?.close()
        metaControlChannel?.close()
        pointerMoveChannel?.close()
        dataChannel = null
        metaControlChannel = null
        pointerMoveChannel = null

        remoteAudioTrack?.setEnabled(false)
        remoteVideoTrack?.setEnabled(false)
        frameSizeSink?.let { remoteVideoTrack?.removeSink(it) }
        renderer?.let { remoteVideoTrack?.removeSink(it) }
        remoteVideoTrack = null
        remoteAudioTrack = null
        frameSizeSink = null

        peerConnection?.close()
        peerConnection?.dispose()
        peerConnection = null

        lastVideoWidth = 0
        lastVideoHeight = 0
        lastFrameAtMillis = 0L
        videoFrameCount = 0L
    }

    private fun observeDataChannel(channel: DataChannel, generation: Int) {
        channel.registerObserver(object : DataChannel.Observer {
            override fun onBufferedAmountChange(previousAmount: Long) = Unit

            override fun onStateChange() {
                if (!isCurrentGeneration(generation)) {
                    return
                }
                val state = channel.state()
                Log.i(LOG_TAG, "Data channel state changed, generation=$generation, label=${channel.label()}, state=$state")
                appLogger?.i(LOG_TAG, "Data channel state changed, generation=$generation, label=${channel.label()}, state=$state")
                if (state == DataChannel.State.CLOSED) {
                    val wasPrimaryControlChannel = channel.label() == CONTROL_CHANNEL_LABEL
                    when (channel.label()) {
                        POINTER_MOVE_CHANNEL_LABEL -> if (pointerMoveChannel === channel) pointerMoveChannel = null
                        META_CONTROL_CHANNEL_LABEL -> if (metaControlChannel === channel) metaControlChannel = null
                        else -> if (dataChannel === channel) dataChannel = null
                    }
                    if (wasPrimaryControlChannel) {
                        isPrimaryControlChannelOpen = false
                        hasEmittedConnected = false
                        reportControlChannelIssue("控制通道断开")
                    }
                }
                if (state == DataChannel.State.OPEN && channel.label() == CONTROL_CHANNEL_LABEL) {
                    isPrimaryControlChannelOpen = true
                    emitConnectedIfReady(generation)
                }
            }

            override fun onMessage(buffer: DataChannel.Buffer) = Unit
        })
    }

    private fun isCurrentGeneration(generation: Int): Boolean {
        return generation == connectionGeneration
    }

    private fun isCurrentConnection(connection: PeerConnection, generation: Int): Boolean {
        return isCurrentGeneration(generation) && peerConnection === connection
    }

    private fun resetConnectionReadyState() {
        isIceConnected = false
        isPrimaryControlChannelOpen = false
        hasVideoFrame = false
        hasEmittedConnected = false
    }

    private fun emitConnectedIfReady(generation: Int) {
        if (hasEmittedConnected) {
            return
        }
        if (isCurrentGeneration(generation) && isIceConnected && isPrimaryControlChannelOpen && hasVideoFrame) {
            hasEmittedConnected = true
            _events.tryEmit(Event.Connected(generation))
        }
    }

    private fun reportControlChannelIssue(message: String) {
        if (isDisconnecting) {
            return
        }
        if (peerConnection?.connectionState() == PeerConnection.PeerConnectionState.CLOSED) {
            return
        }
        _events.tryEmit(Event.Error(connectionGeneration, message))
    }

    private fun mapAndroidCommandToKeycode(action: String): Int? {
        return when (action.lowercase()) {
            "back" -> ANDROID_KEYCODE_BACK
            "home" -> ANDROID_KEYCODE_HOME
            "menu" -> ANDROID_KEYCODE_MENU
            "recent" -> ANDROID_KEYCODE_RECENT
            "power" -> ANDROID_KEYCODE_POWER
            "volumeup" -> ANDROID_KEYCODE_VOLUME_UP
            "volumedown" -> ANDROID_KEYCODE_VOLUME_DOWN
            "mute" -> ANDROID_KEYCODE_MUTE
            else -> null
        }
    }

    private fun buildInjectKeycodeMessage(
        action: Byte,
        keycode: Int,
        repeat: Int = 0,
        metaState: Int = 0
    ): ByteArray {
        // Scrcpy format: type(1) + action(1) + keycode(4) + repeat(4) + metastate(4) = 14 bytes
        val buffer = ByteBuffer.allocate(14).order(ByteOrder.BIG_ENDIAN)
        buffer.put(SCRCPY_MSG_INJECT_KEYCODE)
        buffer.put(action)
        buffer.putInt(keycode)
        buffer.putInt(repeat)
        buffer.putInt(metaState)
        return buffer.array()
    }

    private fun buildScreenPowerMessage(isOn: Boolean): ByteArray {
        // type(1) + mode(1) = 2 bytes
        return byteArrayOf(
            SCRCPY_MSG_SET_SCREEN_POWER_MODE,
            if (isOn) 1 else 0
        )
    }

    private fun buildResizeDisplayMessage(width: Int, height: Int): ByteArray {
        // type(1) + width(2) + height(2) = 5 bytes
        val buffer = ByteBuffer.allocate(5).order(ByteOrder.BIG_ENDIAN)
        buffer.put(SCRCPY_MSG_RESIZE_DISPLAY)
        buffer.putShort(width.coerceIn(0, 0xFFFF).toShort())
        buffer.putShort(height.coerceIn(0, 0xFFFF).toShort())
        return buffer.array()
    }

    private fun buildTouchMessage(payload: PointerControlMessage, action: Byte): ByteArray {
        val frameWidth = payload.frameWidth.coerceAtLeast(1)
        val frameHeight = payload.frameHeight.coerceAtLeast(1)
        
        // Use coordinates matched to the reported frame size
        val x = (payload.xRatio.coerceIn(0f, 1f) * frameWidth).toInt()
        val y = (payload.yRatio.coerceIn(0f, 1f) * frameHeight).toInt()
        val pressure = (payload.pressure.coerceIn(0f, 1f) * 0xFFFF).toInt()
        
        val actionButton = when (action) {
            SCRCPY_ACTION_DOWN, SCRCPY_ACTION_UP -> 1
            else -> 0
        }
        val buttons = when (action) {
            SCRCPY_ACTION_UP -> 0
            else -> 1
        }
        
        // type(1) + action(1) + pointerId(8) + x(4) + y(4) + width(2) + height(2) + pressure(2) + actionButton(4) + buttons(4) = 32 bytes
        val buffer = ByteBuffer.allocate(32).order(ByteOrder.BIG_ENDIAN)
        buffer.put(SCRCPY_MSG_INJECT_TOUCH_EVENT)
        buffer.put(action)
        buffer.putLong(payload.pointerId.toLong() and 0xFFFFFFFFL)
        buffer.putInt(x)
        buffer.putInt(y)
        buffer.putShort(frameWidth.coerceIn(0, 0xFFFF).toShort())
        buffer.putShort(frameHeight.coerceIn(0, 0xFFFF).toShort())
        buffer.putShort(pressure.toShort())
        buffer.putInt(actionButton)
        buffer.putInt(buttons)
        return buffer.array()
    }

    private fun noopSdpObserver(connection: PeerConnection, generation: Int) = object : SdpObserver {
        override fun onCreateSuccess(description: SessionDescription) = Unit
        override fun onSetSuccess() = Unit
        override fun onCreateFailure(error: String) = Unit
        override fun onSetFailure(error: String) {
            if (!isCurrentConnection(connection, generation)) {
                return
            }
            _events.tryEmit(Event.Error(generation, error))
        }
    }
}
