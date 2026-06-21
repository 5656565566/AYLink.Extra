package webrtc

import (
	"context"
	"errors"
	"testing"
	"time"

	domainscrcpy "aylink-agent/internal/domain/scrcpy"
)

type fakeScrcpyRuntime struct {
	health                  domainscrcpy.SourceHealthSnapshot
	refreshCount            int
	keyFrameReplay          bool
	lastVideoRefreshOptions []domainscrcpy.VideoRefreshOptions
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

func (f *fakeScrcpyRuntime) RequestVideoRefresh(options ...domainscrcpy.VideoRefreshOptions) error {
	f.refreshCount++
	f.lastVideoRefreshOptions = append([]domainscrcpy.VideoRefreshOptions(nil), options...)
	return nil
}

func (f *fakeScrcpyRuntime) SendControl([]byte) error {
	return nil
}

func (f *fakeScrcpyRuntime) Close() error {
	return nil
}

func TestRequestScrcpySourceRefreshSkipsStaticButAliveSourceForBackendWatchdog(t *testing.T) {
	runtime := &fakeScrcpyRuntime{
		health: domainscrcpy.SourceHealthSnapshot{State: domainscrcpy.SourceHealthStaticButAlive},
	}

	requestScrcpySourceRefresh(nil, runtime, "rtcp_stalled_ready")

	if runtime.refreshCount != 0 {
		t.Fatalf("expected static-but-alive source refresh to be skipped, got %d", runtime.refreshCount)
	}
}

func TestRequestScrcpySourceRefreshSkipsStaticButAliveSourceForFrontendPlaybackHealth(t *testing.T) {
	runtime := &fakeScrcpyRuntime{
		health: domainscrcpy.SourceHealthSnapshot{
			State:  domainscrcpy.SourceHealthStaticButAlive,
			Reason: "static_packets_alive",
		},
	}

	requestScrcpySourceRefresh(nil, runtime, "frontend_playback_health")

	if runtime.refreshCount != 0 {
		t.Fatalf("expected frontend playback health to skip static-but-alive source, got %d", runtime.refreshCount)
	}
}

func TestRequestScrcpySourceRefreshAllowsFrontendPacketIdleSource(t *testing.T) {
	runtime := &fakeScrcpyRuntime{
		health: domainscrcpy.SourceHealthSnapshot{
			State:  domainscrcpy.SourceHealthStaticButAlive,
			Reason: "holding_last_frame_packet_idle",
		},
	}

	requestScrcpySourceRefresh(nil, runtime, "frontend_playback_health")

	if runtime.refreshCount != 1 {
		t.Fatalf("expected frontend playback health to refresh packet-idle source, got %d", runtime.refreshCount)
	}
	if len(runtime.lastVideoRefreshOptions) != 1 || !runtime.lastVideoRefreshOptions[0].AllowPacketIdleRefresh {
		t.Fatalf("expected frontend playback health to allow packet-idle refresh, got %#v", runtime.lastVideoRefreshOptions)
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

func TestRequestScrcpySourceRefreshBypassesConfirmationForFrontendPlaybackHealth(t *testing.T) {
	runtime := &fakeScrcpyRuntime{
		health: domainscrcpy.SourceHealthSnapshot{State: domainscrcpy.SourceHealthHealthy},
	}

	requestScrcpySourceRefresh(nil, runtime, "frontend_playback_health")

	if runtime.refreshCount != 1 {
		t.Fatalf("expected frontend playback health to request source refresh, got %d", runtime.refreshCount)
	}
	if len(runtime.lastVideoRefreshOptions) != 1 || !runtime.lastVideoRefreshOptions[0].BypassConfirmation {
		t.Fatalf("expected frontend playback health to bypass confirmation, got %#v", runtime.lastVideoRefreshOptions)
	}
}

func TestRequestScrcpySourceRefreshKeepsConfirmationForBackendWatchdog(t *testing.T) {
	runtime := &fakeScrcpyRuntime{
		health: domainscrcpy.SourceHealthSnapshot{State: domainscrcpy.SourceHealthHealthy},
	}

	requestScrcpySourceRefresh(nil, runtime, "rtcp_stalled_ready")

	if runtime.refreshCount != 1 {
		t.Fatalf("expected backend watchdog to request source refresh, got %d", runtime.refreshCount)
	}
	if len(runtime.lastVideoRefreshOptions) != 0 {
		t.Fatalf("expected backend watchdog to keep default confirmation, got %#v", runtime.lastVideoRefreshOptions)
	}
}

func TestLocalMetaKeyFrameRequestFallsBackToSourceRefreshWhenReplayFails(t *testing.T) {
	runtime := &fakeScrcpyRuntime{
		health: domainscrcpy.SourceHealthSnapshot{State: domainscrcpy.SourceHealthPacketStalled},
	}

	handleLocalMetaControlPayload(nil, runtime, []byte{localMetaControlPrefix, localMetaMsgVideoKeyFrame})

	if runtime.refreshCount != 1 {
		t.Fatalf("expected stale keyframe replay to fall back to source refresh, got %d", runtime.refreshCount)
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

func TestLocalMetaKeyFrameRequestRefreshesPacketIdleSource(t *testing.T) {
	runtime := &fakeScrcpyRuntime{
		health: domainscrcpy.SourceHealthSnapshot{
			State:  domainscrcpy.SourceHealthStaticButAlive,
			Reason: "holding_last_frame_packet_idle",
		},
	}

	handleLocalMetaControlPayload(nil, runtime, []byte{localMetaControlPrefix, localMetaMsgVideoKeyFrame})

	if runtime.refreshCount != 1 {
		t.Fatalf("expected packet-idle source to refresh after keyframe replay fails, got %d", runtime.refreshCount)
	}
}

func TestIsUnhealthySourceForVideoRefresh(t *testing.T) {
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
		if got := isUnhealthySourceForVideoRefresh(tt.state); got != tt.want {
			t.Fatalf("isUnhealthySourceForVideoRefresh(%s) = %v, want %v", tt.state, got, tt.want)
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
