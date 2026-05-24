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
)

var errScrcpyRuntimeUnavailable = errors.New("scrcpy runtime is unavailable")

func (s *Service) attachScrcpyVideo(peerConnection *pion.PeerConnection, runtime domainscrcpy.Runtime) error {
	if runtime == nil {
		return errScrcpyRuntimeUnavailable
	}

	track, err := pion.NewTrackLocalStaticSample(pion.RTPCodecCapability{
		MimeType:  pion.MimeTypeH264,
		ClockRate: 90000,
	}, "video", "scrcpy")
	if err != nil {
		return err
	}

	sender, err := peerConnection.AddTrack(track)
	if err != nil {
		return err
	}

	bridge := &scrcpyVideoBridge{
		runtime:      runtime,
		track:        track,
		logger:       s.logger,
		debugEnabled: s.debugWebRTC,
	}

	go bridge.run(peerConnection)
	go bridge.readRTCP(sender)
	return nil
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
			if !msg.IsString && len(msg.Data) > 0 {
				if isExclusiveControlPayload(msg.Data) {
					if !s.TryAcquireControl(deviceID, sessionID) {
						return
					}
				}
				_ = runtime.SendControl(msg.Data)
			}
		})
	})
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

	mu               sync.Mutex
	lastConfig       []byte
	pendingKeyFrame  []byte
	pendingFramePTS  int64
	lastSentPTS      int64
	h264LengthSize   int
	hasSentKeyFrame  bool
	peerConnected    bool
	lastFrameWriteAt time.Time
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
			b.requestRefresh()
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
			switch packet.(type) {
			case *rtcp.PictureLossIndication, *rtcp.FullIntraRequest:
				if b.debugEnabled && b.logger != nil {
					b.logger.Debug("webrtc rtcp refresh requested", "packetType", fmt.Sprintf("%T", packet))
				}
				b.requestRefreshIfStalled()
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
		b.lastConfig = cloneBytes(annexB)
		b.pendingKeyFrame = nil
		b.pendingFramePTS = 0
		b.lastSentPTS = 0
		b.hasSentKeyFrame = false
		b.lastFrameWriteAt = time.Time{}
		return
	}

	isIDR := packet.IsKeyFrame || containsH264IDR(annexB)
	if !b.hasSentKeyFrame {
		if !b.peerConnected {
			if isIDR {
				b.pendingKeyFrame = composeVideoFramePayload(b.lastConfig, annexB)
				b.pendingFramePTS = packet.PresentationTimestamp
			}
			return
		}

		if !isIDR {
			return
		}
	}

	if isIDR {
		annexB = composeVideoFramePayload(b.lastConfig, annexB)
		b.hasSentKeyFrame = true
	}

	if !b.peerConnected {
		return
	}

	if err := b.track.WriteSample(media.Sample{
		Data:     annexB,
		Duration: b.getDuration(packet.PresentationTimestamp),
	}); err == nil {
		b.lastFrameWriteAt = time.Now()
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
		b.requestRefreshLocked()
		return
	}

	if err := b.track.WriteSample(media.Sample{
		Data:     b.pendingKeyFrame,
		Duration: defaultVideoSampleDuration,
	}); err == nil {
		b.lastFrameWriteAt = time.Now()
	}
	b.hasSentKeyFrame = true
	b.lastSentPTS = b.pendingFramePTS
	b.pendingKeyFrame = nil
	b.pendingFramePTS = 0
}

func (b *scrcpyVideoBridge) requestRefresh() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.requestRefreshLocked()
}

func (b *scrcpyVideoBridge) requestRefreshIfStalled() {
	b.mu.Lock()
	defer b.mu.Unlock()

	if !b.hasSentKeyFrame {
		b.requestRefreshLocked()
		return
	}

	if !b.lastFrameWriteAt.IsZero() && time.Since(b.lastFrameWriteAt) < videoStallThreshold {
		return
	}

	b.requestRefreshLocked()
}

func (b *scrcpyVideoBridge) requestRefreshLocked() {
	if b.debugEnabled && b.logger != nil {
		b.logger.Debug("webrtc video refresh requested", "scope", "runtime")
	}
	_ = b.runtime.RequestVideoRefresh()
}

func (b *scrcpyVideoBridge) hasAnyReadyFrame() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	return len(b.pendingKeyFrame) > 0 || b.hasSentKeyFrame
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
