package webrtc

import (
	"context"
	"errors"
	"testing"
	"time"

	domainscrcpy "aylink-agent/internal/domain/scrcpy"

	pion "github.com/pion/webrtc/v4"
)

type fakeScrcpyRuntime struct {
	health                  domainscrcpy.SourceHealthSnapshot
	refreshCount            int
	keyFrameReplay          bool
	lastVideoRefreshRequest []domainscrcpy.VideoRefreshRequest
}

func (f *fakeScrcpyRuntime) SubscribeVideoPackets() (<-chan domainscrcpy.VideoPacket, func()) {
	ch := make(chan domainscrcpy.VideoPacket)
	close(ch)
	return ch, func() {}
}

func (f *fakeScrcpyRuntime) SubscribeAudioPackets() (<-chan domainscrcpy.AudioPacket, func()) {
	ch := make(chan domainscrcpy.AudioPacket)
	close(ch)
	return ch, func() {}
}

func (f *fakeScrcpyRuntime) SubscribeErrors() (<-chan error, func()) {
	ch := make(chan error)
	close(ch)
	return ch, func() {}
}

func (f *fakeScrcpyRuntime) GetSourceHealth() domainscrcpy.SourceHealthSnapshot {
	return f.health
}

func (f *fakeScrcpyRuntime) GetClipboardCached() (string, bool) {
	return "", false
}

func (f *fakeScrcpyRuntime) GetClipboard(context.Context) (string, error) {
	return "", errors.New("not implemented")
}

func (f *fakeScrcpyRuntime) SetClipboard(context.Context, string) error {
	return errors.New("not implemented")
}

func (f *fakeScrcpyRuntime) PasteClipboard(context.Context, string) error {
	return errors.New("not implemented")
}

func (f *fakeScrcpyRuntime) ReplayLatestVideoKeyFrame() bool {
	return f.keyFrameReplay
}

func (f *fakeScrcpyRuntime) RequestVideoRefresh(requests ...domainscrcpy.VideoRefreshRequest) error {
	f.refreshCount++
	f.lastVideoRefreshRequest = append([]domainscrcpy.VideoRefreshRequest(nil), requests...)
	return nil
}

func (f *fakeScrcpyRuntime) SendControl([]byte) error {
	return nil
}

func (f *fakeScrcpyRuntime) Close() error {
	return nil
}

func TestRequestScrcpySourceRefreshPassesBackendWatchdogTrigger(t *testing.T) {
	runtime := &fakeScrcpyRuntime{
		health: domainscrcpy.SourceHealthSnapshot{State: domainscrcpy.SourceHealthStaticButAlive},
	}

	requestScrcpySourceRefresh(nil, runtime, "rtcp_stalled_ready")

	if runtime.refreshCount != 1 {
		t.Fatalf("expected backend watchdog to delegate source refresh, got %d", runtime.refreshCount)
	}
	if len(runtime.lastVideoRefreshRequest) != 1 || runtime.lastVideoRefreshRequest[0].Trigger != domainscrcpy.VideoRefreshTriggerBackendWatchdog {
		t.Fatalf("expected backend watchdog trigger, got %#v", runtime.lastVideoRefreshRequest)
	}
}

func TestRequestScrcpySourceRefreshPassesFrontendPlaybackHealthTrigger(t *testing.T) {
	runtime := &fakeScrcpyRuntime{
		health: domainscrcpy.SourceHealthSnapshot{
			State:  domainscrcpy.SourceHealthStaticButAlive,
			Reason: "static_packets_alive",
		},
	}

	requestScrcpySourceRefresh(nil, runtime, "frontend_playback_health")

	if runtime.refreshCount != 1 {
		t.Fatalf("expected frontend playback health to delegate source refresh, got %d", runtime.refreshCount)
	}
	if len(runtime.lastVideoRefreshRequest) != 1 || runtime.lastVideoRefreshRequest[0].Trigger != domainscrcpy.VideoRefreshTriggerFrontendPlaybackHealth {
		t.Fatalf("expected frontend playback health trigger, got %#v", runtime.lastVideoRefreshRequest)
	}
}

func TestRequestScrcpySourceRefreshRequestsWhenSourceStalled(t *testing.T) {
	runtime := &fakeScrcpyRuntime{
		health: domainscrcpy.SourceHealthSnapshot{State: domainscrcpy.SourceHealthSourceStalled},
	}

	requestScrcpySourceRefresh(nil, runtime, "video_ready_timeout")

	if runtime.refreshCount != 1 {
		t.Fatalf("expected one source refresh, got %d", runtime.refreshCount)
	}
}

func TestRequestScrcpySourceRefreshPassesFrontendPlaybackHealthTriggerForPacketStalled(t *testing.T) {
	runtime := &fakeScrcpyRuntime{
		health: domainscrcpy.SourceHealthSnapshot{State: domainscrcpy.SourceHealthPacketStalled},
	}

	requestScrcpySourceRefresh(nil, runtime, "frontend_playback_health")

	if runtime.refreshCount != 1 {
		t.Fatalf("expected frontend playback health to request source refresh, got %d", runtime.refreshCount)
	}
	if len(runtime.lastVideoRefreshRequest) != 1 || runtime.lastVideoRefreshRequest[0].Trigger != domainscrcpy.VideoRefreshTriggerFrontendPlaybackHealth {
		t.Fatalf("expected frontend playback health trigger, got %#v", runtime.lastVideoRefreshRequest)
	}
}

func TestRequestScrcpySourceRefreshPassesBackendWatchdogTriggerForPacketStalled(t *testing.T) {
	runtime := &fakeScrcpyRuntime{
		health: domainscrcpy.SourceHealthSnapshot{State: domainscrcpy.SourceHealthPacketStalled},
	}

	requestScrcpySourceRefresh(nil, runtime, "rtcp_stalled_ready")

	if runtime.refreshCount != 1 {
		t.Fatalf("expected backend watchdog to request source refresh, got %d", runtime.refreshCount)
	}
	if len(runtime.lastVideoRefreshRequest) != 1 || runtime.lastVideoRefreshRequest[0].Trigger != domainscrcpy.VideoRefreshTriggerBackendWatchdog {
		t.Fatalf("expected backend watchdog trigger, got %#v", runtime.lastVideoRefreshRequest)
	}
}

func TestLocalMetaKeyFrameRequestDoesNotFallbackToSourceRefreshWhenReplayFails(t *testing.T) {
	runtime := &fakeScrcpyRuntime{
		health: domainscrcpy.SourceHealthSnapshot{State: domainscrcpy.SourceHealthPacketStalled},
	}

	handleLocalMetaControlPayload(nil, runtime, []byte{localMetaControlPrefix, localMetaMsgVideoKeyFrame})

	if runtime.refreshCount != 0 {
		t.Fatalf("expected client keyframe replay request not to reset video source, got %d", runtime.refreshCount)
	}
}

func TestLocalMetaKeyFrameRequestDoesNotRefreshStaticButAliveSource(t *testing.T) {
	runtime := &fakeScrcpyRuntime{
		health: domainscrcpy.SourceHealthSnapshot{
			State:  domainscrcpy.SourceHealthStaticButAlive,
			Reason: "static_packets_alive",
		},
	}

	handleLocalMetaControlPayload(nil, runtime, []byte{localMetaControlPrefix, localMetaMsgVideoKeyFrame})

	if runtime.refreshCount != 0 {
		t.Fatalf("expected static source to skip keyframe fallback refresh, got %d", runtime.refreshCount)
	}
}

func TestLocalMetaKeyFrameRequestDoesNotRefreshPacketIdleSource(t *testing.T) {
	runtime := &fakeScrcpyRuntime{
		health: domainscrcpy.SourceHealthSnapshot{
			State:  domainscrcpy.SourceHealthStaticButAlive,
			Reason: "holding_last_frame_packet_idle",
		},
	}

	handleLocalMetaControlPayload(nil, runtime, []byte{localMetaControlPrefix, localMetaMsgVideoKeyFrame})

	if runtime.refreshCount != 0 {
		t.Fatalf("expected client keyframe replay request not to refresh packet-idle source, got %d", runtime.refreshCount)
	}
}

func TestLocalMetaVideoRefreshRequestUsesFrontendPlaybackHealthTrigger(t *testing.T) {
	runtime := &fakeScrcpyRuntime{
		health: domainscrcpy.SourceHealthSnapshot{State: domainscrcpy.SourceHealthSourceStalled},
	}

	handleLocalMetaControlPayload(nil, runtime, []byte{localMetaControlPrefix, localMetaMsgVideoRefresh})

	if runtime.refreshCount != 1 {
		t.Fatalf("expected client video refresh request to delegate source refresh, got %d", runtime.refreshCount)
	}
	if len(runtime.lastVideoRefreshRequest) != 1 || runtime.lastVideoRefreshRequest[0].Trigger != domainscrcpy.VideoRefreshTriggerFrontendPlaybackHealth {
		t.Fatalf("expected frontend playback health trigger, got %#v", runtime.lastVideoRefreshRequest)
	}
}

func TestLocalMetaVideoRefreshRequestDelegatesStaticSourceToRuntime(t *testing.T) {
	runtime := &fakeScrcpyRuntime{
		health: domainscrcpy.SourceHealthSnapshot{State: domainscrcpy.SourceHealthStaticButAlive},
	}

	handleLocalMetaControlPayload(nil, runtime, []byte{localMetaControlPrefix, localMetaMsgVideoRefresh})

	if runtime.refreshCount != 1 {
		t.Fatalf("expected client video refresh request to delegate static source decision, got %d", runtime.refreshCount)
	}
	if len(runtime.lastVideoRefreshRequest) != 1 || runtime.lastVideoRefreshRequest[0].Trigger != domainscrcpy.VideoRefreshTriggerFrontendPlaybackHealth {
		t.Fatalf("expected frontend playback health trigger, got %#v", runtime.lastVideoRefreshRequest)
	}
}

func TestIsStalledSourceForBridgeWatchdog(t *testing.T) {
	tests := []struct {
		state domainscrcpy.SourceHealthState
		want  bool
	}{
		{domainscrcpy.SourceHealthHealthy, false},
		{domainscrcpy.SourceHealthStaticButAlive, false},
		{domainscrcpy.SourceHealthRecovering, false},
		{domainscrcpy.SourceHealthPacketStalled, true},
		{domainscrcpy.SourceHealthPTSStalled, true},
		{domainscrcpy.SourceHealthSourceStalled, true},
	}

	for _, tt := range tests {
		if got := isStalledSourceForBridgeWatchdog(tt.state); got != tt.want {
			t.Fatalf("isStalledSourceForBridgeWatchdog(%s) = %v, want %v", tt.state, got, tt.want)
		}
	}
}

func TestVideoTimestampResyncIgnoresNormalFrameGap(t *testing.T) {
	now := time.Now()
	bridge := &scrcpyVideoBridge{
		lastFrameWriteAt: now.Add(-defaultVideoSampleDuration),
	}

	if got := bridge.getVideoTimestampResyncDuration(now); got != 0 {
		t.Fatalf("expected normal frame gap to skip timestamp resync, got %s", got)
	}
}

func TestVideoTimestampResyncAdvancesAfterStaticIdle(t *testing.T) {
	now := time.Now()
	bridge := &scrcpyVideoBridge{
		lastFrameWriteAt: now.Add(-20 * time.Second),
	}

	got := bridge.getVideoTimestampResyncDuration(now)
	want := 20*time.Second - defaultVideoSampleDuration
	if got != want {
		t.Fatalf("expected static idle timestamp resync %s, got %s", want, got)
	}
}

func TestVideoBridgeKeepsDisconnectedPeerDuringGrace(t *testing.T) {
	bridge := &scrcpyVideoBridge{peerConnected: true}

	if bridge.handlePeerConnectionStateLocked(pion.PeerConnectionStateDisconnected) {
		t.Fatalf("expected disconnected peer to stay alive during grace")
	}
	if bridge.peerConnected {
		t.Fatalf("expected disconnected peer to stop accepting writes")
	}
	if bridge.disconnectedAt.IsZero() {
		t.Fatalf("expected disconnected timestamp to be recorded")
	}
}

func TestVideoBridgeStopsDisconnectedPeerAfterGrace(t *testing.T) {
	bridge := &scrcpyVideoBridge{
		disconnectedAt: time.Now().Add(-peerDisconnectedGrace - time.Millisecond),
	}

	if !bridge.handlePeerConnectionStateLocked(pion.PeerConnectionStateDisconnected) {
		t.Fatalf("expected disconnected peer to stop after grace")
	}
}

func TestVideoBridgeConnectedClearsDisconnectedGrace(t *testing.T) {
	bridge := &scrcpyVideoBridge{
		disconnectedAt: time.Now().Add(-time.Second),
		peerConnected:  true,
	}

	if bridge.handlePeerConnectionStateLocked(pion.PeerConnectionStateConnected) {
		t.Fatalf("expected connected peer to stay alive")
	}
	if !bridge.disconnectedAt.IsZero() {
		t.Fatalf("expected connected peer to clear disconnected timestamp")
	}
}
