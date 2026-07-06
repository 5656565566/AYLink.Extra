package webrtc

import (
	"testing"
	"time"

	domainscrcpy "aylink-agent/internal/domain/scrcpy"
	domainwebrtc "aylink-agent/internal/domain/webrtc"

	pion "github.com/pion/webrtc/v4"
)

func TestClassifyVideoStreamHealthReportsConnectingForNewTransport(t *testing.T) {
	state, origin, reason := classifyVideoStreamHealth(
		domainscrcpy.SourceHealthSnapshot{},
		domainwebrtc.VideoSenderDiagnostics{State: "waiting_config"},
		domainwebrtc.VideoTransportDiagnostics{PeerConnectionState: pion.PeerConnectionStateNew.String(), SignalingAttached: true},
	)

	if state != domainwebrtc.VideoStreamStateConnecting || origin != domainwebrtc.VideoStreamHealthOriginTransport || reason != pion.PeerConnectionStateNew.String() {
		t.Fatalf("expected connecting transport state, got state=%s origin=%s reason=%s", state, origin, reason)
	}
}

func TestClassifyVideoStreamHealthReportsConnectingTransportBeforeSourceStall(t *testing.T) {
	state, origin, reason := classifyVideoStreamHealth(
		domainscrcpy.SourceHealthSnapshot{State: domainscrcpy.SourceHealthSourceStalled, Reason: "no_video_packet"},
		domainwebrtc.VideoSenderDiagnostics{State: "waiting_config"},
		domainwebrtc.VideoTransportDiagnostics{PeerConnectionState: pion.PeerConnectionStateConnecting.String(), SignalingAttached: true},
	)

	if state != domainwebrtc.VideoStreamStateConnecting || origin != domainwebrtc.VideoStreamHealthOriginTransport || reason != pion.PeerConnectionStateConnecting.String() {
		t.Fatalf("expected connecting transport state before source stall, got state=%s origin=%s reason=%s", state, origin, reason)
	}
}

func TestClassifyVideoStreamHealthReportsStalledForSourceStall(t *testing.T) {
	state, origin, reason := classifyVideoStreamHealth(
		domainscrcpy.SourceHealthSnapshot{State: domainscrcpy.SourceHealthPacketStalled, Reason: "packet_gap"},
		domainwebrtc.VideoSenderDiagnostics{State: "ready", PeerConnected: true},
		domainwebrtc.VideoTransportDiagnostics{PeerConnectionState: pion.PeerConnectionStateConnected.String(), SignalingAttached: true},
	)

	if state != domainwebrtc.VideoStreamStateStalled || origin != domainwebrtc.VideoStreamHealthOriginSource || reason != "packet_gap" {
		t.Fatalf("expected stalled source state, got state=%s origin=%s reason=%s", state, origin, reason)
	}
}

func TestClassifyVideoStreamHealthReportsSourceStallBeforeWaitingSender(t *testing.T) {
	state, origin, reason := classifyVideoStreamHealth(
		domainscrcpy.SourceHealthSnapshot{State: domainscrcpy.SourceHealthSourceStalled, Reason: "no_video_packet"},
		domainwebrtc.VideoSenderDiagnostics{State: "waiting_config"},
		domainwebrtc.VideoTransportDiagnostics{PeerConnectionState: pion.PeerConnectionStateConnected.String(), SignalingAttached: true},
	)

	if state != domainwebrtc.VideoStreamStateStalled || origin != domainwebrtc.VideoStreamHealthOriginSource || reason != "no_video_packet" {
		t.Fatalf("expected stalled source state before waiting sender, got state=%s origin=%s reason=%s", state, origin, reason)
	}
}

func TestClassifyVideoStreamHealthReportsStalledForPacketIdleSource(t *testing.T) {
	state, origin, reason := classifyVideoStreamHealth(
		domainscrcpy.SourceHealthSnapshot{State: domainscrcpy.SourceHealthPacketIdle, Reason: "holding_last_frame_packet_idle"},
		domainwebrtc.VideoSenderDiagnostics{State: "ready", PeerConnected: true},
		domainwebrtc.VideoTransportDiagnostics{PeerConnectionState: pion.PeerConnectionStateConnected.String(), SignalingAttached: true},
	)

	if state != domainwebrtc.VideoStreamStateStalled || origin != domainwebrtc.VideoStreamHealthOriginSource || reason != "holding_last_frame_packet_idle" {
		t.Fatalf("expected stalled packet-idle source state, got state=%s origin=%s reason=%s", state, origin, reason)
	}
}

func TestClassifyVideoStreamHealthReportsRecoveringForSourceRecovering(t *testing.T) {
	state, origin, reason := classifyVideoStreamHealth(
		domainscrcpy.SourceHealthSnapshot{State: domainscrcpy.SourceHealthRecovering, Reason: "refresh_recovering"},
		domainwebrtc.VideoSenderDiagnostics{State: "ready", PeerConnected: true},
		domainwebrtc.VideoTransportDiagnostics{PeerConnectionState: pion.PeerConnectionStateConnected.String(), SignalingAttached: true},
	)

	if state != domainwebrtc.VideoStreamStateRecovering || origin != domainwebrtc.VideoStreamHealthOriginSource || reason != "refresh_recovering" {
		t.Fatalf("expected recovering source state, got state=%s origin=%s reason=%s", state, origin, reason)
	}
}

func TestClassifyVideoStreamHealthReportsObservingForReadyAttachedStream(t *testing.T) {
	state, origin, reason := classifyVideoStreamHealth(
		domainscrcpy.SourceHealthSnapshot{State: domainscrcpy.SourceHealthHealthy, Reason: "pts_advancing"},
		domainwebrtc.VideoSenderDiagnostics{State: "ready", PeerConnected: true},
		domainwebrtc.VideoTransportDiagnostics{PeerConnectionState: pion.PeerConnectionStateConnected.String(), SignalingAttached: true},
	)

	if state != domainwebrtc.VideoStreamStateObserving || origin != domainwebrtc.VideoStreamHealthOriginSender || reason != "ready" {
		t.Fatalf("expected observing sender state, got state=%s origin=%s reason=%s", state, origin, reason)
	}
}

func TestClassifyVideoStreamHealthReportsDetachedForReadyStreamWithoutSignaling(t *testing.T) {
	state, origin, reason := classifyVideoStreamHealth(
		domainscrcpy.SourceHealthSnapshot{State: domainscrcpy.SourceHealthHealthy, Reason: "pts_advancing"},
		domainwebrtc.VideoSenderDiagnostics{State: "ready", PeerConnected: true},
		domainwebrtc.VideoTransportDiagnostics{PeerConnectionState: pion.PeerConnectionStateConnected.String()},
	)

	if state != domainwebrtc.VideoStreamStateDetached || origin != domainwebrtc.VideoStreamHealthOriginTransport || reason != "signaling_detached" {
		t.Fatalf("expected detached transport state, got state=%s origin=%s reason=%s", state, origin, reason)
	}
}

func TestVideoSenderDiagnosticsCopiesBridgeState(t *testing.T) {
	now := time.Now()
	bridge := &scrcpyVideoBridge{
		lastConfig:       []byte{1, 2, 3},
		pendingKeyFrame:  []byte{4, 5, 6},
		peerConnected:    true,
		lastFrameWriteAt: now,
		generation:       7,
		state:            videoBridgeStateReady,
		stateSince:       now.Add(-time.Second),
		lastConfigAt:     now.Add(-2 * time.Second),
		lastKeyFrameAt:   now.Add(-3 * time.Second),
	}

	diagnostics := getVideoSenderDiagnostics(bridge)

	if diagnostics.State != "ready" || diagnostics.Generation != 7 || !diagnostics.PeerConnected || !diagnostics.HasConfig || !diagnostics.HasPendingKeyFrame {
		t.Fatalf("unexpected sender diagnostics: %+v", diagnostics)
	}
	if !diagnostics.LastFrameWriteAt.Equal(now) {
		t.Fatalf("expected last frame write time to be copied")
	}
}
