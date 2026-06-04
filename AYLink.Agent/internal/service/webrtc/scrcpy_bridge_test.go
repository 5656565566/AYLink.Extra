package webrtc

import (
	"context"
	"errors"
	"testing"

	domainscrcpy "aylink-agent/internal/domain/scrcpy"
)

type fakeScrcpyRuntime struct {
	health         domainscrcpy.SourceHealthSnapshot
	refreshCount   int
	keyFrameReplay bool
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

func (f *fakeScrcpyRuntime) RequestVideoRefresh() error {
	f.refreshCount++
	return nil
}

func (f *fakeScrcpyRuntime) SendControl([]byte) error {
	return nil
}

func (f *fakeScrcpyRuntime) Close() error {
	return nil
}

func TestRequestScrcpySourceRefreshSkipsIdleStaticSource(t *testing.T) {
	runtime := &fakeScrcpyRuntime{
		health: domainscrcpy.SourceHealthSnapshot{State: domainscrcpy.SourceHealthIdleStatic},
	}

	requestScrcpySourceRefresh(nil, runtime, "browser_playback_starved")

	if runtime.refreshCount != 0 {
		t.Fatalf("expected idle static source refresh to be skipped, got %d", runtime.refreshCount)
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
