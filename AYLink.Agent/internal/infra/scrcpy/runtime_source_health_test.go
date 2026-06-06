package scrcpy

import (
	"net"
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
	if !health.HasSeenMediaPacket {
		t.Fatalf("expected media packet to be recorded: %+v", health)
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
	if health.State != domainscrcpy.SourceHealthPTSStalled {
		t.Fatalf("expected source stalled, got %s", health.State)
	}
	if health.RepeatedPTSCount < sourceHealthRepeatedPTSStallThreshold {
		t.Fatalf("expected repeated pts count to reach threshold, got %d", health.RepeatedPTSCount)
	}
}

func TestRuntimeSourceHealthDetectsRepeatedZeroPTSStall(t *testing.T) {
	rt := &runtime{done: make(chan struct{})}

	for i := 0; i < sourceHealthRepeatedPTSStallThreshold+1; i++ {
		rt.recordVideoPacketHealth(domainscrcpy.VideoPacket{
			PresentationTimestamp: 0,
			Codec:                 domainscrcpy.VideoCodecH264,
		})
	}

	health := rt.GetSourceHealth()
	if health.State != domainscrcpy.SourceHealthPTSStalled {
		t.Fatalf("expected repeated zero pts to stall source, got %s", health.State)
	}
}

func TestClassifySourceHealthTreatsOldPacketAfterMediaAsStaticButAlive(t *testing.T) {
	now := time.Now()
	health := domainscrcpy.SourceHealthSnapshot{
		LastPacketAt:       now.Add(-30 * time.Second),
		LastNewPTSAt:       now.Add(-30 * time.Second),
		LastPTS:            100,
		HasSeenMediaPacket: true,
	}

	state, reason := classifySourceHealth(health, now)
	if state != domainscrcpy.SourceHealthStaticButAlive {
		t.Fatalf("expected static but alive, got %s", state)
	}
	if reason != "holding_last_frame_packet_idle" {
		t.Fatalf("expected holding last frame reason, got %s", reason)
	}
}

func TestClassifySourceHealthTreatsOldPacketBeforeMediaAsSourceStalled(t *testing.T) {
	now := time.Now()
	health := domainscrcpy.SourceHealthSnapshot{
		LastPacketAt: now.Add(-sourceHealthPacketFreshness - time.Second),
	}

	state, reason := classifySourceHealth(health, now)
	if state != domainscrcpy.SourceHealthSourceStalled {
		t.Fatalf("expected source stalled, got %s", state)
	}
	if reason != "no_media_packet" {
		t.Fatalf("expected no media packet reason, got %s", reason)
	}
}

func TestClassifySourceHealthTreatsFreshPacketWithOldPTSAsStaticButAlive(t *testing.T) {
	now := time.Now()
	health := domainscrcpy.SourceHealthSnapshot{
		LastPacketAt:       now,
		LastNewPTSAt:       now.Add(-sourceHealthPacketFreshness - time.Second),
		LastPTS:            100,
		HasSeenMediaPacket: true,
	}

	state, reason := classifySourceHealth(health, now)
	if state != domainscrcpy.SourceHealthStaticButAlive {
		t.Fatalf("expected static but alive, got %s", state)
	}
	if reason != "static_packets_alive" {
		t.Fatalf("expected static packets alive reason, got %s", reason)
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

func TestRuntimeReplaysFreshCachedVideoKeyFrame(t *testing.T) {
	rt := &runtime{
		done:             make(chan struct{}),
		videoSubscribers: map[int]chan domainscrcpy.VideoPacket{1: make(chan domainscrcpy.VideoPacket, 4)},
		latestVideoConfig: cachedVideoPacket{
			packet: domainscrcpy.VideoPacket{
				Data:     []byte{0, 0, 0, 1, 0x67},
				IsConfig: true,
			},
			generation: 1,
			cachedAt:   time.Now(),
		},
		latestVideoKeyFrame: cachedVideoPacket{
			packet: domainscrcpy.VideoPacket{
				Data:       []byte{0, 0, 0, 1, 0x65},
				IsKeyFrame: true,
			},
			generation: 1,
			cachedAt:   time.Now(),
		},
	}

	if !rt.ReplayLatestVideoKeyFrame() {
		t.Fatalf("expected fresh cached key frame replay")
	}
}

func TestRuntimeRefusesStaleCachedVideoKeyFrameReplay(t *testing.T) {
	rt := &runtime{
		done:             make(chan struct{}),
		videoSubscribers: map[int]chan domainscrcpy.VideoPacket{1: make(chan domainscrcpy.VideoPacket, 4)},
		latestVideoConfig: cachedVideoPacket{
			packet: domainscrcpy.VideoPacket{
				Data:     []byte{0, 0, 0, 1, 0x67},
				IsConfig: true,
			},
			generation: 1,
			cachedAt:   time.Now(),
		},
		latestVideoKeyFrame: cachedVideoPacket{
			packet: domainscrcpy.VideoPacket{
				Data:       []byte{0, 0, 0, 1, 0x65},
				IsKeyFrame: true,
			},
			generation: 1,
			cachedAt:   time.Now().Add(-replayableKeyFrameMaxAge - time.Second),
		},
	}

	if rt.ReplayLatestVideoKeyFrame() {
		t.Fatalf("expected stale cached key frame replay to be refused")
	}
}

func TestRuntimeCoalescesQueuedDroppableTouchMoves(t *testing.T) {
	clientConn, serverConn := net.Pipe()
	defer clientConn.Close()
	defer serverConn.Close()

	rt := &runtime{
		done:          make(chan struct{}),
		controlConn:   clientConn,
		controlWrites: make(chan []byte, 8),
	}

	if err := rt.SendControl([]byte{2, 2, 1}); err != nil {
		t.Fatalf("send first move: %v", err)
	}
	if err := rt.SendControl([]byte{2, 0, 9}); err != nil {
		t.Fatalf("send down: %v", err)
	}
	if err := rt.SendControl([]byte{2, 2, 2}); err != nil {
		t.Fatalf("send second move: %v", err)
	}
	if err := rt.SendControl([]byte{2, 2, 3}); err != nil {
		t.Fatalf("send third move: %v", err)
	}

	if len(rt.controlWrites) != 2 {
		t.Fatalf("expected down and latest move to remain queued, got %d", len(rt.controlWrites))
	}

	first := <-rt.controlWrites
	second := <-rt.controlWrites
	if string(first) != string([]byte{2, 0, 9}) {
		t.Fatalf("expected non-droppable down to be preserved first, got %v", first)
	}
	if string(second) != string([]byte{2, 2, 3}) {
		t.Fatalf("expected latest move to replace older moves, got %v", second)
	}
}

func TestRuntimeVideoRefreshBypassesConfirmationWhenSourceStalledBeforeMedia(t *testing.T) {
	rt := &runtime{
		done: make(chan struct{}),
		health: domainscrcpy.SourceHealthSnapshot{
			LastPacketAt: time.Now().Add(-sourceHealthPacketFreshness - time.Second),
		},
	}

	if err := rt.RequestVideoRefresh(); err != nil {
		t.Fatalf("request refresh: %v", err)
	}

	rt.refreshMu.Lock()
	defer rt.refreshMu.Unlock()
	if rt.lastRefreshTime.IsZero() {
		t.Fatalf("expected stalled source refresh to dispatch without waiting for confirmation")
	}
	if rt.refreshAskCount != 0 {
		t.Fatalf("expected confirmation counter to reset, got %d", rt.refreshAskCount)
	}
}

func TestRuntimeVideoRefreshSkipsStaticButAliveAfterMediaPacketIdle(t *testing.T) {
	now := time.Now()
	rt := &runtime{
		done: make(chan struct{}),
		health: domainscrcpy.SourceHealthSnapshot{
			LastPacketAt:       now.Add(-30 * time.Second),
			LastNewPTSAt:       now.Add(-30 * time.Second),
			LastPTS:            100,
			HasSeenMediaPacket: true,
		},
	}

	for i := 0; i < videoRefreshConfirmations+1; i++ {
		if err := rt.RequestVideoRefresh(); err != nil {
			t.Fatalf("request refresh %d: %v", i, err)
		}
	}

	rt.refreshMu.Lock()
	defer rt.refreshMu.Unlock()
	if !rt.lastRefreshTime.IsZero() {
		t.Fatalf("expected static source refresh to be skipped")
	}
	if rt.refreshAskCount != 0 {
		t.Fatalf("expected static source to clear confirmation counter, got %d", rt.refreshAskCount)
	}
}

func TestRuntimeVideoRefreshKeepsConfirmationForUncertainSource(t *testing.T) {
	now := time.Now()
	rt := &runtime{
		done: make(chan struct{}),
		health: domainscrcpy.SourceHealthSnapshot{
			LastPacketAt: now,
			LastNewPTSAt: now,
			LastPTS:      100,
		},
	}

	if err := rt.RequestVideoRefresh(); err != nil {
		t.Fatalf("request refresh: %v", err)
	}

	rt.refreshMu.Lock()
	defer rt.refreshMu.Unlock()
	if !rt.lastRefreshTime.IsZero() {
		t.Fatalf("expected uncertain source refresh to wait for confirmation")
	}
	if rt.refreshAskCount != 1 {
		t.Fatalf("expected one pending confirmation, got %d", rt.refreshAskCount)
	}
}
