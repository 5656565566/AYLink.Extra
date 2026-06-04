package scrcpy

import (
	"testing"
	"time"

	domainscrcpy "aylink-agent/internal/domain/scrcpy"
)

func TestRuntimeSourceHealthTracksVideoPTSProgress(t *testing.T) {
	rt := &runtime{done: make(chan struct{})}

	rt.recordVideoPacketHealth(domainscrcpy.VideoPacket{
		PresentationTimestamp: 100,
		Codec:                 domainscrcpy.VideoCodecH264,
	})

	health := rt.GetSourceHealth()
	if health.State != domainscrcpy.SourceHealthHealthy {
		t.Fatalf("expected healthy source, got %s", health.State)
	}
	if health.LastPTS != 100 {
		t.Fatalf("expected last pts 100, got %d", health.LastPTS)
	}
	if health.LastPacketAt.IsZero() || health.LastNewPTSAt.IsZero() {
		t.Fatalf("expected packet and pts timestamps to be recorded: %+v", health)
	}
}

func TestRuntimeSourceHealthDetectsRepeatedPTSStall(t *testing.T) {
	rt := &runtime{done: make(chan struct{})}

	for i := 0; i < sourceHealthRepeatedPTSStallThreshold+1; i++ {
		rt.recordVideoPacketHealth(domainscrcpy.VideoPacket{
			PresentationTimestamp: 100,
			Codec:                 domainscrcpy.VideoCodecH264,
		})
	}

	health := rt.GetSourceHealth()
	if health.State != domainscrcpy.SourceHealthSourceStalled {
		t.Fatalf("expected source stalled, got %s", health.State)
	}
	if health.RepeatedPTSCount < sourceHealthRepeatedPTSStallThreshold {
		t.Fatalf("expected repeated pts count to reach threshold, got %d", health.RepeatedPTSCount)
	}
}

func TestClassifySourceHealthTreatsOldPacketAsIdleStatic(t *testing.T) {
	now := time.Now()
	health := domainscrcpy.SourceHealthSnapshot{
		LastPacketAt: now.Add(-sourceHealthPacketFreshness - time.Second),
		LastNewPTSAt: now.Add(-sourceHealthPacketFreshness - time.Second),
		LastPTS:      100,
	}

	state := classifySourceHealth(health, now)
	if state != domainscrcpy.SourceHealthIdleStatic {
		t.Fatalf("expected idle static, got %s", state)
	}
}

func TestRuntimeSourceHealthMarksRecoveringAfterRefresh(t *testing.T) {
	rt := &runtime{done: make(chan struct{})}
	now := time.Now()

	rt.markVideoRefreshRequested(now)

	health := rt.GetSourceHealth()
	if health.State != domainscrcpy.SourceHealthRecovering {
		t.Fatalf("expected recovering, got %s", health.State)
	}
}
