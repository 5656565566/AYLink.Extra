package webrtc

import (
	"time"

	domainscrcpy "aylink-agent/internal/domain/scrcpy"
	domainwebrtc "aylink-agent/internal/domain/webrtc"

	pion "github.com/pion/webrtc/v4"
)

func (s *Service) GetVideoStreamHealthSnapshot(sessionID string) (domainwebrtc.VideoStreamHealthSnapshot, error) {
	if sessionID == "" {
		return domainwebrtc.VideoStreamHealthSnapshot{}, ErrSessionIDRequired
	}

	s.mu.Lock()
	session := s.signaling[sessionID]
	s.mu.Unlock()
	if session == nil {
		return domainwebrtc.VideoStreamHealthSnapshot{}, ErrSessionNotFound
	}

	return session.getVideoStreamHealthSnapshot(time.Now()), nil
}

func (s *signalingSession) getVideoStreamHealthSnapshot(now time.Time) domainwebrtc.VideoStreamHealthSnapshot {
	sourceHealth := s.runtime.GetSourceHealth()
	senderDiagnostics := getVideoSenderDiagnostics(s.videoBridge)
	transportDiagnostics := s.getVideoTransportDiagnostics()

	state, origin, reason := classifyVideoStreamHealth(sourceHealth, senderDiagnostics, transportDiagnostics)
	return domainwebrtc.VideoStreamHealthSnapshot{
		State:      state,
		Origin:     origin,
		Reason:     reason,
		CapturedAt: now,
		Source:     buildVideoSourceDiagnostics(sourceHealth),
		Sender:     senderDiagnostics,
		Transport:  transportDiagnostics,
	}
}

func buildVideoSourceDiagnostics(health domainscrcpy.SourceHealthSnapshot) domainwebrtc.VideoSourceDiagnostics {
	return domainwebrtc.VideoSourceDiagnostics{
		State:                string(health.State),
		Reason:               health.Reason,
		LastPacketAt:         health.LastPacketAt,
		LastNewPTSAt:         health.LastNewPTSAt,
		LastKeyFrameAt:       health.LastKeyFrameAt,
		LastKeyFrameReplayAt: health.LastKeyFrameReplayAt,
		LastVideoRefreshAt:   health.LastVideoRefreshAt,
		LastPTS:              health.LastPTS,
		RepeatedPTSCount:     health.RepeatedPTSCount,
		HasSeenMediaPacket:   health.HasSeenMediaPacket,
		RuntimeClosed:        health.RuntimeClosed,
	}
}

func getVideoSenderDiagnostics(bridge *scrcpyVideoBridge) domainwebrtc.VideoSenderDiagnostics {
	if bridge == nil {
		return domainwebrtc.VideoSenderDiagnostics{State: "unknown", Reason: "video_bridge_unavailable"}
	}

	bridge.mu.Lock()
	defer bridge.mu.Unlock()

	return domainwebrtc.VideoSenderDiagnostics{
		State:              bridge.state.String(),
		Generation:         bridge.generation,
		PeerConnected:      bridge.peerConnected,
		HasConfig:          len(bridge.lastConfig) > 0,
		HasPendingKeyFrame: len(bridge.pendingKeyFrame) > 0,
		LastFrameWriteAt:   bridge.lastFrameWriteAt,
		LastConfigAt:       bridge.lastConfigAt,
		LastKeyFrameAt:     bridge.lastKeyFrameAt,
		StateSince:         bridge.stateSince,
	}
}

func (s *signalingSession) getVideoTransportDiagnostics() domainwebrtc.VideoTransportDiagnostics {
	s.mu.Lock()
	closed := s.closed
	signalingAttached := s.conn != nil
	peerState := s.currentPeerState
	s.mu.Unlock()

	return domainwebrtc.VideoTransportDiagnostics{
		PeerConnectionState: peerState.String(),
		SignalingAttached:   signalingAttached,
		SessionClosed:       closed,
	}
}

func classifyVideoStreamHealth(
	source domainscrcpy.SourceHealthSnapshot,
	sender domainwebrtc.VideoSenderDiagnostics,
	transport domainwebrtc.VideoTransportDiagnostics,
) (domainwebrtc.VideoStreamState, domainwebrtc.VideoStreamHealthOrigin, string) {
	if transport.SessionClosed || transport.PeerConnectionState == pion.PeerConnectionStateClosed.String() || transport.PeerConnectionState == pion.PeerConnectionStateFailed.String() {
		return domainwebrtc.VideoStreamStateIdle, domainwebrtc.VideoStreamHealthOriginTransport, transport.PeerConnectionState
	}
	if transport.PeerConnectionState == pion.PeerConnectionStateNew.String() || transport.PeerConnectionState == pion.PeerConnectionStateConnecting.String() {
		return domainwebrtc.VideoStreamStateConnecting, domainwebrtc.VideoStreamHealthOriginTransport, transport.PeerConnectionState
	}
	if isStalledVideoSource(source.State) {
		return domainwebrtc.VideoStreamStateStalled, domainwebrtc.VideoStreamHealthOriginSource, source.Reason
	}
	if source.State == domainscrcpy.SourceHealthRecovering {
		return domainwebrtc.VideoStreamStateRecovering, domainwebrtc.VideoStreamHealthOriginSource, source.Reason
	}
	if sender.State == "waiting_config" || sender.State == "waiting_keyframe" {
		return domainwebrtc.VideoStreamStateConnecting, domainwebrtc.VideoStreamHealthOriginSender, sender.State
	}
	if sender.State == "ready" && sender.PeerConnected {
		if transport.SignalingAttached {
			return domainwebrtc.VideoStreamStateObserving, domainwebrtc.VideoStreamHealthOriginSender, sender.State
		}
		return domainwebrtc.VideoStreamStateDetached, domainwebrtc.VideoStreamHealthOriginTransport, "signaling_detached"
	}
	return domainwebrtc.VideoStreamStateIdle, domainwebrtc.VideoStreamHealthOriginUnknown, "not_observing"
}

func isStalledVideoSource(state domainscrcpy.SourceHealthState) bool {
	switch state {
	case domainscrcpy.SourceHealthPacketIdle, domainscrcpy.SourceHealthPacketStalled, domainscrcpy.SourceHealthPTSStalled, domainscrcpy.SourceHealthSourceStalled:
		return true
	default:
		return false
	}
}
