package com.aylink.mobile.webrtc

import android.media.AudioAttributes
import android.content.Context
import com.aylink.mobile.data.model.PointerControlMessage
import com.aylink.mobile.data.model.RtcCandidateMessage
import com.aylink.mobile.data.model.RtcOfferMessage
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
    private val signalClient: SignalClient
) {
    companion object {
        private const val CONTROL_CHANNEL_LABEL = "control"
        private const val META_CONTROL_CHANNEL_LABEL = "control-meta"
        private const val POINTER_MOVE_CHANNEL_LABEL = "pointer-move"
        private const val SCRCPY_MSG_INJECT_KEYCODE: Byte = 0
        private const val SCRCPY_MSG_INJECT_TOUCH_EVENT: Byte = 2
        private const val SCRCPY_MSG_SET_SCREEN_POWER_MODE: Byte = 10
        private const val SCRCPY_MSG_RESET_VIDEO: Byte = 17
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
        data object Connected : Event
        data object Disconnected : Event
        data class VideoSizeChanged(val width: Int, val height: Int) : Event
        data class Error(val message: String) : Event
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
    private var renderer: SurfaceViewRenderer? = null
    @Volatile
    private var isDisconnecting = false
    private var lastVideoWidth = 0
    private var lastVideoHeight = 0
    @Volatile
    private var lastFrameAtMillis = 0L
    private val frameSizeSink = VideoSink { frame: VideoFrame ->
        lastFrameAtMillis = System.currentTimeMillis()
        val width = frame.rotatedWidth
        val height = frame.rotatedHeight
        if (width > 0 && height > 0 && (width != lastVideoWidth || height != lastVideoHeight)) {
            lastVideoWidth = width
            lastVideoHeight = height
            _events.tryEmit(Event.VideoSizeChanged(width, height))
        }
    }

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
        remoteVideoTrack?.removeSink(frameSizeSink)
        if (this.renderer === renderer) {
            this.renderer = null
        }
        renderer.release()
    }

    fun createPeerConnection() {
        isDisconnecting = false
        val rtcConfig = PeerConnection.RTCConfiguration(emptyList()).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
        }

        peerConnection = peerConnectionFactory.createPeerConnection(rtcConfig, object : PeerConnection.Observer {
            override fun onSignalingChange(newState: PeerConnection.SignalingState) = Unit
            override fun onIceConnectionChange(newState: PeerConnection.IceConnectionState) {
                when (newState) {
                    PeerConnection.IceConnectionState.CONNECTED,
                    PeerConnection.IceConnectionState.COMPLETED -> _events.tryEmit(Event.Connected)
                    PeerConnection.IceConnectionState.DISCONNECTED,
                    PeerConnection.IceConnectionState.CLOSED,
                    PeerConnection.IceConnectionState.FAILED -> _events.tryEmit(Event.Disconnected)
                    else -> Unit
                }
            }

            override fun onIceConnectionReceivingChange(receiving: Boolean) = Unit
            override fun onIceGatheringChange(newState: PeerConnection.IceGatheringState) = Unit
            override fun onIceCandidate(candidate: IceCandidate) {
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
                when (channel.label()) {
                    POINTER_MOVE_CHANNEL_LABEL -> {
                        pointerMoveChannel = channel
                        observeDataChannel(channel)
                    }
                    META_CONTROL_CHANNEL_LABEL -> {
                        metaControlChannel = channel
                        observeDataChannel(channel)
                    }
                    else -> {
                        dataChannel = channel
                        observeDataChannel(channel)
                    }
                }
            }

            override fun onRenegotiationNeeded() = Unit
            override fun onAddTrack(receiver: RtpReceiver, mediaStreams: Array<out MediaStream>) = Unit

            override fun onTrack(transceiver: RtpTransceiver) {
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
        dataChannel = peerConnection?.createDataChannel(CONTROL_CHANNEL_LABEL, DataChannel.Init())?.also(::observeDataChannel)
        metaControlChannel = peerConnection?.createDataChannel(META_CONTROL_CHANNEL_LABEL, DataChannel.Init())?.also(::observeDataChannel)
        pointerMoveChannel = peerConnection?.createDataChannel(
            POINTER_MOVE_CHANNEL_LABEL,
            DataChannel.Init().apply {
                ordered = false
                maxRetransmits = 0
            }
        )?.also(::observeDataChannel)
    }

    fun bindRemoteVideo(renderer: SurfaceViewRenderer) {
        this.renderer = renderer
        bindTrackToRenderer()
    }

    fun createOffer() {
        createOfferInternal()
    }

    fun restartIce() {
        val connection = peerConnection ?: return
        connection.restartIce()
        createOfferInternal()
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

    private fun createOfferInternal() {
        val connection = peerConnection ?: return
        connection.createOffer(object : SdpObserver {
            override fun onCreateSuccess(description: SessionDescription) {
                connection.setLocalDescription(object : SdpObserver {
                    override fun onSetSuccess() {
                        signalClient.sendOffer(
                            RtcOfferMessage(
                                type = description.type.canonicalForm(),
                                sdp = description.description
                            )
                        )
                    }

                    override fun onSetFailure(error: String) {
                        _events.tryEmit(Event.Error(error))
                    }

                    override fun onCreateSuccess(description: SessionDescription) = Unit
                    override fun onCreateFailure(error: String) = Unit
                }, description)
            }

            override fun onCreateFailure(error: String) {
                _events.tryEmit(Event.Error(error))
            }

            override fun onSetSuccess() = Unit
            override fun onSetFailure(error: String) = Unit
        }, MediaConstraints())
    }

    fun setRemoteAnswer(type: String, sdp: String) {
        val connection = peerConnection ?: return
        val description = SessionDescription(
            if (type.equals("answer", ignoreCase = true)) SessionDescription.Type.ANSWER else SessionDescription.Type.OFFER,
            sdp
        )
        connection.setRemoteDescription(noopSdpObserver(), description)
    }

    fun addRemoteCandidate(candidate: RtcCandidateMessage) {
        peerConnection?.addIceCandidate(
            IceCandidate(candidate.sdpMid, candidate.sdpMLineIndex ?: 0, candidate.candidate)
        )
    }

    fun sendPointerMessage(payload: PointerControlMessage) {
        val action = when (payload.phase.lowercase()) {
            "down" -> SCRCPY_ACTION_DOWN
            "up", "cancel" -> SCRCPY_ACTION_UP
            else -> SCRCPY_ACTION_MOVE
        }
        sendControl(buildTouchMessage(payload, action))
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

    fun sendVideoReset(width: Int, height: Int, reason: String) {
        sendMetaControl(byteArrayOf(SCRCPY_MSG_RESET_VIDEO))
    }

    fun disconnect() {
        isDisconnecting = true
        remoteAudioTrack?.setEnabled(false)
        remoteVideoTrack?.setEnabled(false)
        dataChannel?.close()
        metaControlChannel?.close()
        pointerMoveChannel?.close()
        dataChannel = null
        metaControlChannel = null
        pointerMoveChannel = null
        peerConnection?.close()
        peerConnection?.dispose()
        peerConnection = null
        remoteVideoTrack?.removeSink(frameSizeSink)
        renderer?.let { remoteVideoTrack?.removeSink(it) }
        remoteVideoTrack = null
        remoteAudioTrack = null
        lastVideoWidth = 0
        lastVideoHeight = 0
        lastFrameAtMillis = 0L
        signalClient.disconnect()
        isDisconnecting = false
    }

    fun release() {
        disconnect()
        audioDeviceModule.release()
        peerConnectionFactory.dispose()
        eglBase.release()
    }

    private fun sendControl(message: ByteArray): Boolean {
        return sendBinary(selectControlChannel(), message, reportFailure = true)
    }

    private fun sendMetaControl(message: ByteArray): Boolean {
        return sendBinary(selectMetaControlChannel(), message, reportFailure = true)
    }

    private fun sendPointerMove(message: ByteArray): Boolean {
        return sendBinary(selectPointerMoveChannel(), message, reportFailure = false)
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

    private fun selectPointerMoveChannel(): DataChannel? {
        return when {
            pointerMoveChannel?.state() == DataChannel.State.OPEN -> pointerMoveChannel
            dataChannel?.state() == DataChannel.State.OPEN -> dataChannel
            else -> null
        }
    }

    fun getPointerMoveBufferedAmount(): Long {
        return selectControlChannel()?.bufferedAmount() ?: 0L
    }

    private fun recvOnlyInit(): RtpTransceiver.RtpTransceiverInit {
        return RtpTransceiver.RtpTransceiverInit(RtpTransceiver.RtpTransceiverDirection.RECV_ONLY)
    }

    private fun bindTrackToRenderer() {
        val track = remoteVideoTrack ?: return
        val target = renderer
        track.removeSink(frameSizeSink)
        if (target != null) {
            track.removeSink(target)
        }
        track.addSink(frameSizeSink)
        if (target != null) {
            track.addSink(target)
        }
    }

    private fun observeDataChannel(channel: DataChannel) {
        channel.registerObserver(object : DataChannel.Observer {
            override fun onBufferedAmountChange(previousAmount: Long) = Unit

            override fun onStateChange() {
                val state = channel.state()
                if (state == DataChannel.State.CLOSED) {
                    val wasPrimaryControlChannel = channel.label() == CONTROL_CHANNEL_LABEL
                    when (channel.label()) {
                        POINTER_MOVE_CHANNEL_LABEL -> if (pointerMoveChannel === channel) pointerMoveChannel = null
                        META_CONTROL_CHANNEL_LABEL -> if (metaControlChannel === channel) metaControlChannel = null
                        else -> if (dataChannel === channel) dataChannel = null
                    }
                    if (wasPrimaryControlChannel) {
                        reportControlChannelIssue("控制通道断开")
                    }
                }
                if (state == DataChannel.State.OPEN && lastVideoWidth > 0 && lastVideoHeight > 0) {
                    sendVideoReset(lastVideoWidth, lastVideoHeight, "channel-open")
                }
            }

            override fun onMessage(buffer: DataChannel.Buffer) = Unit
        })
    }

    private fun reportControlChannelIssue(message: String) {
        if (isDisconnecting) {
            return
        }
        if (peerConnection?.connectionState() == PeerConnection.PeerConnectionState.CLOSED) {
            return
        }
        _events.tryEmit(Event.Error(message))
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

    private fun noopSdpObserver() = object : SdpObserver {
        override fun onCreateSuccess(description: SessionDescription) = Unit
        override fun onSetSuccess() = Unit
        override fun onCreateFailure(error: String) = Unit
        override fun onSetFailure(error: String) {
            _events.tryEmit(Event.Error(error))
        }
    }
}
