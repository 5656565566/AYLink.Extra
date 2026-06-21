package webrtc

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"sync"
	"time"

	domainscrcpy "aylink-agent/internal/domain/scrcpy"
	"aylink-agent/internal/infra/logging"

	"github.com/pion/rtcp"
	pion "github.com/pion/webrtc/v4"
	"github.com/pion/webrtc/v4/pkg/media"
)

const (
	defaultVideoSampleDuration = 33 * time.Millisecond
	defaultAudioSampleDuration = 20 * time.Millisecond
	videoReadyTimeout          = 5 * time.Second
	videoStallThreshold        = 3 * time.Second
	videoTimestampResyncGap    = 500 * time.Millisecond
	videoStallConfirmations    = 2
	videoRefreshConfigGrace    = 1500 * time.Millisecond
	videoRefreshKeyFrameGrace  = 1500 * time.Millisecond
	localMetaControlPrefix     = 0xFF
	localMetaMsgVideoRefresh   = 0x01
	localMetaMsgVideoKeyFrame  = 0x02
)

var errScrcpyRuntimeUnavailable = errors.New("scrcpy runtime is unavailable")

func (s *Service) attachScrcpyVideo(peerConnection *pion.PeerConnection, runtime domainscrcpy.Runtime) (*scrcpyVideoBridge, error) {
	if runtime == nil {
		return nil, errScrcpyRuntimeUnavailable
	}

	track, err := pion.NewTrackLocalStaticSample(pion.RTPCodecCapability{
		MimeType:  pion.MimeTypeH264,
		ClockRate: 90000,
	}, "video", "scrcpy")
	if err != nil {
		return nil, err
	}

	sender, err := peerConnection.AddTrack(track)
	if err != nil {
		return nil, err
	}

	bridge := &scrcpyVideoBridge{
		runtime:      runtime,
		track:        track,
		logger:       s.logger,
		debugEnabled: s.debugWebRTC,
		state:        videoBridgeStateWaitingConfig,
		stateSince:   time.Now(),
	}

	go bridge.run(peerConnection)
	go bridge.readRTCP(sender)
	return bridge, nil
}

func (s *Service) attachScrcpyAudio(peerConnection *pion.PeerConnection, runtime domainscrcpy.Runtime) error {
	if runtime == nil {
		return errScrcpyRuntimeUnavailable
	}

	track, err := pion.NewTrackLocalStaticSample(pion.RTPCodecCapability{
		MimeType:  pion.MimeTypeOpus,
		ClockRate: 48000,
		Channels:  2,
	}, "audio", "scrcpy")
	if err != nil {
		return err
	}

	_, err = peerConnection.AddTrack(track)
	if err != nil {
		return err
	}

	bridge := &scrcpyAudioBridge{
		runtime: runtime,
		track:   track,
	}

	go bridge.run(peerConnection)
	return nil
}

func (s *Service) bindScrcpyControl(peerConnection *pion.PeerConnection, deviceID string, sessionID string, runtime domainscrcpy.Runtime) {
	if runtime == nil || deviceID == "" || sessionID == "" {
		return
	}

	peerConnection.OnDataChannel(func(channel *pion.DataChannel) {
		channel.OnMessage(func(msg pion.DataChannelMessage) {
			if msg.IsString || len(msg.Data) == 0 {
				return
			}
			if channel.Label() == "control-meta" && isLocalMetaControlPayload(msg.Data) {
				handleLocalMetaControlPayload(s.logger, runtime, msg.Data)
				return
			}
			if isExclusiveControlPayload(msg.Data) {
				if !s.TryAcquireControl(deviceID, sessionID) {
					return
				}
			}
			if err := runtime.SendControl(msg.Data); err != nil && s.logger != nil {
				s.logger.Warn("webrtc scrcpy control forwarding failed",
					"channel", channel.Label(),
					"payloadType", msg.Data[0],
					"payloadSize", len(msg.Data),
					"err", err,
				)
			}
		})
	})
}

func isLocalMetaControlPayload(payload []byte) bool {
	return len(payload) >= 2 && payload[0] == localMetaControlPrefix
}

func handleLocalMetaControlPayload(logger logging.Logger, runtime domainscrcpy.Runtime, payload []byte) {
	if runtime == nil || len(payload) < 2 {
		return
	}

	switch payload[1] {
	case localMetaMsgVideoKeyFrame:
		if logger != nil {
			logger.Info("webrtc video key frame replay requested", "source", "frontend_playback_health")
		}
		if runtime.ReplayLatestVideoKeyFrame() {
			return
		}
		requestScrcpySourceRefresh(logger, runtime, "frontend_playback_health")
	case localMetaMsgVideoRefresh:
		if logger != nil {
			logger.Info("webrtc video refresh requested", "source", "frontend_playback_health")
		}
		requestScrcpySourceRefresh(logger, runtime, "frontend_playback_health")
	}
}

func isExclusiveControlPayload(payload []byte) bool {
	if len(payload) == 0 {
		return false
	}

	switch payload[0] {
	case 0, 1, 2, 9, 10, 13:
		return true
	default:
		return false
	}
}

type scrcpyAudioBridge struct {
	runtime domainscrcpy.Runtime
	track   *pion.TrackLocalStaticSample
}

func (b *scrcpyAudioBridge) run(peerConnection *pion.PeerConnection) {
	audioPackets, unsubscribeAudio := b.runtime.SubscribeAudioPackets()
	defer unsubscribeAudio()
	errorsCh, unsubscribeErrors := b.runtime.SubscribeErrors()
	defer unsubscribeErrors()
	stateCheck := time.NewTicker(500 * time.Millisecond)
	defer stateCheck.Stop()

	for {
		select {
		case <-stateCheck.C:
			if isTerminalPeerConnectionState(peerConnection.ConnectionState()) {
				return
			}
		case packet, ok := <-audioPackets:
			if !ok {
				return
			}

			if peerConnection.ConnectionState() == pion.PeerConnectionStateConnected {
				// 转发原始 Opus 数据载荷
				if packet.Codec == domainscrcpy.AudioCodecOpus {
					// 过滤 Config 包 Config 包不能发送给 WebRTC 的轨道 否则会导致解码器错误而没有声音
					if packet.IsConfig {
						continue
					}

					_ = b.track.WriteSample(media.Sample{
						Data:     packet.Data,
						Duration: defaultAudioSampleDuration,
					})
				}
			}
			if packet.Release != nil {
				packet.Release()
			}
			if isTerminalPeerConnectionState(peerConnection.ConnectionState()) {
				return
			}
		case err, ok := <-errorsCh:
			if ok && err != nil && !errors.Is(err, io.EOF) {
				_ = peerConnection.Close()
			}
			return
		}
	}
}

type scrcpyVideoBridge struct {
	runtime      domainscrcpy.Runtime
	track        *pion.TrackLocalStaticSample
	logger       logging.Logger
	debugEnabled bool

	mu                sync.Mutex
	lastConfig        []byte
	pendingKeyFrame   []byte
	pendingFramePTS   int64
	pendingGeneration uint64
	lastSentPTS       int64
	h264LengthSize    int
	peerConnected     bool
	lastFrameWriteAt  time.Time
	generation        uint64
	state             videoBridgeState
	stateSince        time.Time
	lastConfigAt      time.Time
	lastKeyFrameAt    time.Time
	stallReadyCount   int
}

type videoBridgeState int

const (
	videoBridgeStateWaitingConfig videoBridgeState = iota
	videoBridgeStateWaitingKeyFrame
	videoBridgeStateReady
)

func (s videoBridgeState) String() string {
	switch s {
	case videoBridgeStateWaitingConfig:
		return "waiting_config"
	case videoBridgeStateWaitingKeyFrame:
		return "waiting_keyframe"
	case videoBridgeStateReady:
		return "ready"
	default:
		return "unknown"
	}
}

func (b *scrcpyVideoBridge) run(peerConnection *pion.PeerConnection) {
	videoReady := time.NewTimer(videoReadyTimeout)
	defer videoReady.Stop()
	videoPackets, unsubscribeVideo := b.runtime.SubscribeVideoPackets()
	defer unsubscribeVideo()
	errorsCh, unsubscribeErrors := b.runtime.SubscribeErrors()
	defer unsubscribeErrors()
	stateCheck := time.NewTicker(500 * time.Millisecond)
	defer stateCheck.Stop()

	for {
		select {
		case <-stateCheck.C:
			b.handlePeerConnectionState(peerConnection.ConnectionState())
			if isTerminalPeerConnectionState(peerConnection.ConnectionState()) {
				return
			}
		case packet, ok := <-videoPackets:
			if !ok {
				return
			}
			b.handlePacket(peerConnection, packet)
			if packet.Release != nil {
				packet.Release()
			}
			if isTerminalPeerConnectionState(peerConnection.ConnectionState()) {
				return
			}
			if b.hasAnyReadyFrame() && !videoReady.Stop() {
				select {
				case <-videoReady.C:
				default:
				}
			}
		case err, ok := <-errorsCh:
			if ok && err != nil && !errors.Is(err, io.EOF) {
				_ = peerConnection.Close()
			}
			return
		case <-videoReady.C:
			if isTerminalPeerConnectionState(peerConnection.ConnectionState()) {
				return
			}
			b.requestRefresh("video_ready_timeout")
			videoReady.Reset(videoReadyTimeout)
		}
	}
}

func (b *scrcpyVideoBridge) readRTCP(sender *pion.RTPSender) {
	if sender == nil {
		return
	}

	buffer := make([]byte, 1500)
	for {
		n, _, err := sender.Read(buffer)
		if err != nil {
			return
		}
		packets, err := rtcp.Unmarshal(buffer[:n])
		if err != nil {
			continue
		}
		for _, packet := range packets {
			switch rtcpPacket := packet.(type) {
			case *rtcp.TransportLayerNack:
				if b.logger != nil {
					nackCount := 0
					for _, pair := range rtcpPacket.Nacks {
						pair.Range(func(_ uint16) bool {
							nackCount++
							return true
						})
					}
					b.logger.Info("webrtc rtcp nack received",
						"mediaSSRC", rtcpPacket.MediaSSRC,
						"senderSSRC", rtcpPacket.SenderSSRC,
						"nackCount", nackCount,
					)
				}
			case *rtcp.PictureLossIndication, *rtcp.FullIntraRequest:
				if b.debugEnabled && b.logger != nil {
					b.logger.Debug("webrtc rtcp refresh requested", "packetType", fmt.Sprintf("%T", packet))
				}
				b.requestRefreshIfStalled()
			case *rtcp.ReceiverReport:
				if b.debugEnabled && b.logger != nil {
					for _, report := range rtcpPacket.Reports {
						b.logger.Debug("webrtc rtcp receiver report",
							"ssrc", report.SSRC,
							"fractionLost", report.FractionLost,
							"totalLost", report.TotalLost,
							"jitter", report.Jitter,
							"lastSequenceNumber", report.LastSequenceNumber,
						)
					}
				}
			}
		}
	}
}

func (b *scrcpyVideoBridge) handlePacket(peerConnection *pion.PeerConnection, packet domainscrcpy.VideoPacket) {
	b.mu.Lock()
	defer b.mu.Unlock()

	if b.handlePeerConnectionStateLocked(peerConnection.ConnectionState()) {
		return
	}

	if packet.Codec != domainscrcpy.VideoCodecH264 {
		return
	}

	annexB := b.normalizeH264(packet.Data, packet.IsConfig)
	if len(annexB) == 0 {
		return
	}

	if packet.IsConfig {
		now := time.Now()
		b.generation++
		b.stallReadyCount = 0
		b.lastConfig = cloneBytes(annexB)
		b.pendingKeyFrame = nil
		b.pendingFramePTS = 0
		b.pendingGeneration = 0
		b.lastSentPTS = 0
		b.lastFrameWriteAt = time.Time{}
		b.lastConfigAt = now
		b.setStateLocked(videoBridgeStateWaitingKeyFrame, now)
		b.logDebugLocked("webrtc video config arrived",
			"generation", b.generation,
			"size", len(annexB),
			"state", b.state.String(),
		)
		return
	}

	if len(b.lastConfig) == 0 || b.generation == 0 {
		if b.state != videoBridgeStateWaitingConfig {
			b.setStateLocked(videoBridgeStateWaitingConfig, time.Now())
			b.logDebugLocked("webrtc video bridge waiting for config")
		}
		return
	}

	isIDR := packet.IsKeyFrame || containsH264IDR(annexB)
	if b.state != videoBridgeStateReady {
		if !isIDR {
			return
		}

		if !b.peerConnected {
			b.pendingKeyFrame = composeVideoFramePayload(b.lastConfig, annexB)
			b.pendingFramePTS = packet.PresentationTimestamp
			b.pendingGeneration = b.generation
			b.lastKeyFrameAt = time.Now()
			b.setStateLocked(videoBridgeStateWaitingKeyFrame, b.lastKeyFrameAt)
			b.logDebugLocked("webrtc video key frame cached",
				"generation", b.generation,
				"pts", packet.PresentationTimestamp,
			)
			return
		}
	}

	if isIDR {
		annexB = composeVideoFramePayload(b.lastConfig, annexB)
	}

	if !b.peerConnected {
		return
	}

	now := time.Now()
	b.advanceVideoTimestampAfterIdleLocked(now)
	if err := b.track.WriteSample(media.Sample{
		Data:     annexB,
		Duration: b.getDuration(packet.PresentationTimestamp),
	}); err == nil {
		now = time.Now()
		b.stallReadyCount = 0
		b.lastFrameWriteAt = now
		if isIDR {
			b.lastKeyFrameAt = now
		}
		if b.state != videoBridgeStateReady {
			b.setStateLocked(videoBridgeStateReady, now)
			b.pendingKeyFrame = nil
			b.pendingFramePTS = 0
			b.pendingGeneration = 0
			b.logDebugLocked("webrtc video bridge ready",
				"generation", b.generation,
				"pts", packet.PresentationTimestamp,
			)
		}
	}
}

func (b *scrcpyVideoBridge) handlePeerConnectionState(state pion.PeerConnectionState) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.handlePeerConnectionStateLocked(state)
}

func (b *scrcpyVideoBridge) handlePeerConnectionStateLocked(state pion.PeerConnectionState) bool {
	switch state {
	case pion.PeerConnectionStateConnected:
		if !b.peerConnected {
			b.peerConnected = true
			b.flushPendingLocked()
		}
	case pion.PeerConnectionStateFailed, pion.PeerConnectionStateClosed, pion.PeerConnectionStateDisconnected:
		return true
	}

	return false
}

func (b *scrcpyVideoBridge) flushPendingLocked() {
	if len(b.pendingKeyFrame) == 0 {
		if b.shouldRequestRefreshLocked(time.Now(), "flush_pending_missing_keyframe") {
			b.requestRefreshLocked("flush_pending_missing_keyframe")
		}
		return
	}
	if b.pendingGeneration != b.generation {
		b.logDebugLocked("webrtc video pending key frame discarded due to generation mismatch",
			"pendingGeneration", b.pendingGeneration,
			"generation", b.generation,
		)
		b.pendingKeyFrame = nil
		b.pendingFramePTS = 0
		b.pendingGeneration = 0
		b.state = videoBridgeStateWaitingKeyFrame
		if b.shouldRequestRefreshLocked(time.Now(), "flush_pending_generation_mismatch") {
			b.requestRefreshLocked("flush_pending_generation_mismatch")
		}
		return
	}

	if err := b.track.WriteSample(media.Sample{
		Data:     b.pendingKeyFrame,
		Duration: defaultVideoSampleDuration,
	}); err == nil {
		now := time.Now()
		b.stallReadyCount = 0
		b.lastFrameWriteAt = now
		b.lastKeyFrameAt = now
		b.setStateLocked(videoBridgeStateReady, now)
		b.logDebugLocked("webrtc video pending key frame flushed",
			"generation", b.generation,
			"pts", b.pendingFramePTS,
		)
		b.lastSentPTS = b.pendingFramePTS
		b.pendingKeyFrame = nil
		b.pendingFramePTS = 0
		b.pendingGeneration = 0
		return
	}
	b.logDebugLocked("webrtc video pending key frame flush failed",
		"generation", b.generation,
		"pts", b.pendingFramePTS,
	)
}

func (b *scrcpyVideoBridge) requestRefresh(reason string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if !b.shouldRequestRefreshLocked(time.Now(), reason) {
		return
	}
	b.requestRefreshLocked(reason)
}

func (b *scrcpyVideoBridge) requestRefreshIfStalled() {
	b.mu.Lock()
	defer b.mu.Unlock()

	if b.state != videoBridgeStateReady {
		if !b.shouldRequestRefreshLocked(time.Now(), "rtcp_not_ready") {
			return
		}
		b.requestRefreshLocked("rtcp_not_ready")
		return
	}

	if !b.lastFrameWriteAt.IsZero() && time.Since(b.lastFrameWriteAt) < videoStallThreshold {
		b.stallReadyCount = 0
		return
	}

	health := b.runtime.GetSourceHealth()
	if !isUnhealthySourceForVideoRefresh(health.State) {
		b.stallReadyCount = 0
		b.logDebugLocked("webrtc video refresh skipped",
			"reason", "rtcp_stalled_ready",
			"detail", "source_not_unhealthy",
			"sourceHealth", string(health.State),
			"sourceHealthReason", health.Reason,
			"generation", b.generation,
			"state", b.state.String(),
			"peerConnected", b.peerConnected,
		)
		return
	}

	b.stallReadyCount++
	if b.stallReadyCount < videoStallConfirmations {
		if b.logger != nil {
			b.logger.Info("webrtc video refresh deferred",
				"source", "backend_bridge",
				"reason", "rtcp_stalled_ready",
				"stalledCount", b.stallReadyCount,
				"stalledThreshold", videoStallConfirmations,
				"sourceHealth", string(health.State),
				"sourceHealthReason", health.Reason,
				"generation", b.generation,
				"state", b.state.String(),
				"peerConnected", b.peerConnected,
			)
		}
		return
	}

	b.stallReadyCount = 0
	b.requestRefreshLocked("rtcp_stalled_ready")
}

func isUnhealthySourceForVideoRefresh(state domainscrcpy.SourceHealthState) bool {
	switch state {
	case domainscrcpy.SourceHealthPacketStalled, domainscrcpy.SourceHealthPTSStalled, domainscrcpy.SourceHealthSourceStalled:
		return true
	default:
		return false
	}
}

func (b *scrcpyVideoBridge) requestRefreshLocked(reason string) {
	if b.runtime.ReplayLatestVideoKeyFrame() {
		if b.logger != nil {
			b.logger.Info("webrtc video refresh satisfied by cached key frame replay",
				"source", "backend_bridge",
				"reason", reason,
				"generation", b.generation,
				"state", b.state.String(),
				"peerConnected", b.peerConnected,
			)
		}
		return
	}

	requestScrcpySourceRefresh(b.logger, b.runtime, reason,
		"source", "backend_bridge",
		"generation", b.generation,
		"state", b.state.String(),
		"peerConnected", b.peerConnected,
	)
}

func requestScrcpySourceRefresh(logger logging.Logger, runtime domainscrcpy.Runtime, reason string, args ...any) {
	if runtime == nil {
		return
	}

	health := runtime.GetSourceHealth()
	logArgs := append([]any{
		"reason", reason,
		"sourceHealth", string(health.State),
		"sourceHealthReason", health.Reason,
		"lastPacketAge", formatSourceHealthAge(health.LastPacketAt),
		"lastNewPTSAge", formatSourceHealthAge(health.LastNewPTSAt),
		"repeatedPTSCount", health.RepeatedPTSCount,
	}, args...)

	if health.State == domainscrcpy.SourceHealthStaticButAlive && !shouldRequestStaticButAliveRefresh(health, reason) {
		if logger != nil {
			logger.Info("scrcpy source refresh skipped",
				append([]any{
					"skipReason", "source_static_but_alive",
				}, logArgs...)...,
			)
		}
		return
	}

	if logger != nil {
		logger.Info("scrcpy source refresh requested", logArgs...)
	}
	_ = runtime.RequestVideoRefresh(videoRefreshOptionsForReason(reason)...)
}

func videoRefreshOptionsForReason(reason string) []domainscrcpy.VideoRefreshOptions {
	if reason == "frontend_playback_health" {
		return []domainscrcpy.VideoRefreshOptions{{BypassConfirmation: true, AllowPacketIdleRefresh: true}}
	}
	return nil
}

func shouldRequestStaticButAliveRefresh(health domainscrcpy.SourceHealthSnapshot, reason string) bool {
	return reason == "frontend_playback_health" && health.Reason == "holding_last_frame_packet_idle"
}

func formatSourceHealthAge(value time.Time) string {
	if value.IsZero() {
		return ""
	}
	return time.Since(value).String()
}

func (b *scrcpyVideoBridge) hasAnyReadyFrame() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	return len(b.pendingKeyFrame) > 0 || b.state == videoBridgeStateReady
}

func (b *scrcpyVideoBridge) shouldRequestRefreshLocked(now time.Time, reason string) bool {
	if !b.peerConnected {
		b.logDebugLocked("webrtc video refresh skipped", "reason", reason, "detail", "peer_not_connected", "generation", b.generation, "state", b.state.String())
		return false
	}

	switch b.state {
	case videoBridgeStateWaitingConfig:
		if !b.stateSince.IsZero() && now.Sub(b.stateSince) < videoReadyTimeout {
			b.logDebugLocked("webrtc video refresh skipped", "reason", reason, "detail", "waiting_for_config_grace", "generation", b.generation, "state", b.state.String())
			return false
		}
		return true
	case videoBridgeStateWaitingKeyFrame:
		if len(b.pendingKeyFrame) > 0 {
			b.logDebugLocked("webrtc video refresh skipped", "reason", reason, "detail", "pending_keyframe_present", "generation", b.generation, "state", b.state.String())
			return false
		}
		if !b.lastConfigAt.IsZero() && now.Sub(b.lastConfigAt) < videoRefreshConfigGrace {
			b.logDebugLocked("webrtc video refresh skipped", "reason", reason, "detail", "recent_config", "generation", b.generation, "state", b.state.String())
			return false
		}
		if !b.lastKeyFrameAt.IsZero() && now.Sub(b.lastKeyFrameAt) < videoRefreshKeyFrameGrace {
			b.logDebugLocked("webrtc video refresh skipped", "reason", reason, "detail", "recent_keyframe", "generation", b.generation, "state", b.state.String())
			return false
		}
		return true
	case videoBridgeStateReady:
		return true
	default:
		return true
	}
}

func (b *scrcpyVideoBridge) setStateLocked(state videoBridgeState, now time.Time) {
	if b.state == state {
		return
	}
	b.state = state
	b.stateSince = now
}

func (b *scrcpyVideoBridge) logDebugLocked(message string, args ...any) {
	if !b.debugEnabled || b.logger == nil {
		return
	}
	b.logger.Debug(message, args...)
}

func (b *scrcpyVideoBridge) getDuration(pts int64) time.Duration {
	if pts <= 0 {
		return defaultVideoSampleDuration
	}
	if b.lastSentPTS == 0 {
		b.lastSentPTS = pts
		return defaultVideoSampleDuration
	}
	delta := pts - b.lastSentPTS
	b.lastSentPTS = pts
	if delta <= 0 {
		return defaultVideoSampleDuration
	}

	candidates := []time.Duration{
		time.Duration(delta) * time.Microsecond,
		time.Duration(delta) * time.Millisecond,
		time.Duration(delta) * time.Second / 90000,
	}
	for _, candidate := range candidates {
		if candidate >= 10*time.Millisecond && candidate <= 100*time.Millisecond {
			return candidate
		}
	}
	return defaultVideoSampleDuration
}

func (b *scrcpyVideoBridge) advanceVideoTimestampAfterIdleLocked(now time.Time) {
	duration := b.getVideoTimestampResyncDuration(now)
	if duration <= 0 {
		return
	}

	if err := b.track.WriteSample(media.Sample{Duration: duration}); err != nil {
		b.logDebugLocked("webrtc video timestamp resync failed",
			"idleDuration", now.Sub(b.lastFrameWriteAt).String(),
			"resyncDuration", duration.String(),
			"error", err,
		)
		return
	}

	b.logDebugLocked("webrtc video timestamp resynced after source idle",
		"idleDuration", now.Sub(b.lastFrameWriteAt).String(),
		"resyncDuration", duration.String(),
	)
}

func (b *scrcpyVideoBridge) getVideoTimestampResyncDuration(now time.Time) time.Duration {
	if b.lastFrameWriteAt.IsZero() {
		return 0
	}
	idleDuration := now.Sub(b.lastFrameWriteAt)
	if idleDuration <= videoTimestampResyncGap {
		return 0
	}
	resyncDuration := idleDuration - defaultVideoSampleDuration
	if resyncDuration <= 0 {
		return 0
	}
	return resyncDuration
}

func (b *scrcpyVideoBridge) normalizeH264(sample []byte, isConfig bool) []byte {
	if len(sample) == 0 || startsWithAnnexBStartCode(sample) {
		return sample
	}

	if !isConfig && b.h264LengthSize > 0 {
		if converted, ok := convertLengthPrefixedNALUnits(sample, b.h264LengthSize); ok {
			return converted
		}
	}

	if isConfig && sample[0] == 1 {
		if converted, lengthSize, ok := convertAVCDecoderConfigurationRecord(sample); ok {
			b.h264LengthSize = lengthSize
			return converted
		}
	}

	for _, lengthSize := range []int{4, 3, 2, 1} {
		if converted, ok := convertLengthPrefixedNALUnits(sample, lengthSize); ok {
			b.h264LengthSize = lengthSize
			return converted
		}
	}

	return sample
}

func composeVideoFramePayload(config []byte, frame []byte) []byte {
	if len(config) == 0 {
		return frame
	}
	payload := make([]byte, 0, len(config)+len(frame))
	payload = append(payload, config...)
	payload = append(payload, frame...)
	return payload
}

func startsWithAnnexBStartCode(sample []byte) bool {
	return len(sample) >= 4 && ((sample[0] == 0 && sample[1] == 0 && sample[2] == 1) || (sample[0] == 0 && sample[1] == 0 && sample[2] == 0 && sample[3] == 1))
}

func convertAVCDecoderConfigurationRecord(sample []byte) ([]byte, int, bool) {
	if len(sample) < 7 || sample[0] != 1 {
		return nil, 0, false
	}

	lengthSize := int(sample[4]&0x03) + 1
	spsCount := int(sample[5] & 0x1F)
	offset := 6
	var out bytes.Buffer

	for range spsCount {
		if offset+2 > len(sample) {
			return nil, 0, false
		}
		nalSize := int(binary.BigEndian.Uint16(sample[offset : offset+2]))
		offset += 2
		if offset+nalSize > len(sample) {
			return nil, 0, false
		}
		out.Write([]byte{0, 0, 0, 1})
		out.Write(sample[offset : offset+nalSize])
		offset += nalSize
	}

	if offset >= len(sample) {
		return nil, 0, false
	}

	ppsCount := int(sample[offset])
	offset++
	for range ppsCount {
		if offset+2 > len(sample) {
			return nil, 0, false
		}
		nalSize := int(binary.BigEndian.Uint16(sample[offset : offset+2]))
		offset += 2
		if offset+nalSize > len(sample) {
			return nil, 0, false
		}
		out.Write([]byte{0, 0, 0, 1})
		out.Write(sample[offset : offset+nalSize])
		offset += nalSize
	}

	return out.Bytes(), lengthSize, out.Len() > 0
}

func convertLengthPrefixedNALUnits(sample []byte, lengthSize int) ([]byte, bool) {
	if lengthSize <= 0 || len(sample) <= lengthSize {
		return nil, false
	}

	offset := 0
	var out bytes.Buffer
	for offset < len(sample) {
		if offset+lengthSize > len(sample) {
			return nil, false
		}

		nalSize := readLengthPrefix(sample[offset:offset+lengthSize], lengthSize)
		offset += lengthSize
		if nalSize <= 0 || offset+nalSize > len(sample) {
			return nil, false
		}
		out.Write([]byte{0, 0, 0, 1})
		out.Write(sample[offset : offset+nalSize])
		offset += nalSize
	}

	return out.Bytes(), out.Len() > 0
}

func readLengthPrefix(buffer []byte, lengthSize int) int {
	switch lengthSize {
	case 1:
		return int(buffer[0])
	case 2:
		return int(binary.BigEndian.Uint16(buffer))
	case 3:
		return int(buffer[0])<<16 | int(buffer[1])<<8 | int(buffer[2])
	default:
		return int(binary.BigEndian.Uint32(buffer))
	}
}

func containsH264IDR(sample []byte) bool {
	for i := 0; i+4 < len(sample); i++ {
		startCodeLength := 0
		if i+3 < len(sample) && sample[i] == 0 && sample[i+1] == 0 && sample[i+2] == 1 {
			startCodeLength = 3
		} else if i+4 < len(sample) && sample[i] == 0 && sample[i+1] == 0 && sample[i+2] == 0 && sample[i+3] == 1 {
			startCodeLength = 4
		}
		if startCodeLength == 0 {
			continue
		}

		headerIndex := i + startCodeLength
		if headerIndex < len(sample) && (sample[headerIndex]&0x1F) == 5 {
			return true
		}
	}
	return false
}

func isTerminalPeerConnectionState(state pion.PeerConnectionState) bool {
	return state == pion.PeerConnectionStateClosed ||
		state == pion.PeerConnectionStateFailed ||
		state == pion.PeerConnectionStateDisconnected
}

func cloneBytes(value []byte) []byte {
	if len(value) == 0 {
		return nil
	}
	clone := make([]byte, len(value))
	copy(clone, value)
	return clone
}

func waitForContext(ctx context.Context) error {
	if ctx == nil {
		return fmt.Errorf("nil context")
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
		return nil
	}
}
