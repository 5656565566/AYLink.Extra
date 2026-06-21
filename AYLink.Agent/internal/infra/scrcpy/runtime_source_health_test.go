package scrcpy

import (
	"encoding/binary"
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

func TestRuntimeThrottlesCachedVideoKeyFrameReplay(t *testing.T) {
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
		health: domainscrcpy.SourceHealthSnapshot{
			LastKeyFrameReplayAt: time.Now().Add(-videoKeyFrameReplayCooldown / 2),
		},
	}

	if rt.ReplayLatestVideoKeyFrame() {
		t.Fatalf("expected cached key frame replay to be throttled")
	}
	if len(rt.videoSubscribers[1]) != 0 {
		t.Fatalf("expected throttled replay to avoid queueing packets, got %d", len(rt.videoSubscribers[1]))
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

func TestRuntimeSubscribeVideoPacketsWarmsOnlyConfigAndKeyFrame(t *testing.T) {
	rt := &runtime{
		done:             make(chan struct{}),
		videoSubscribers: make(map[int]chan domainscrcpy.VideoPacket),
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
				Data:                  []byte{0, 0, 0, 1, 0x65},
				IsKeyFrame:            true,
				PresentationTimestamp: 100,
			},
			generation: 1,
			cachedAt:   time.Now(),
		},
	}

	ch, unsubscribe := rt.SubscribeVideoPackets()
	defer unsubscribe()

	first := <-ch
	second := <-ch
	if !first.IsConfig {
		t.Fatalf("expected first warm packet to be config, got %+v", first)
	}
	if !second.IsKeyFrame {
		t.Fatalf("expected second warm packet to be key frame, got %+v", second)
	}
	select {
	case packet := <-ch:
		t.Fatalf("expected no extra warm packets, got %+v", packet)
	default:
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

func TestRuntimeReleasesStaleTouchPointerBeforeNewDown(t *testing.T) {
	clientConn, serverConn := net.Pipe()
	defer clientConn.Close()
	defer serverConn.Close()

	rt := &runtime{
		done:          make(chan struct{}),
		controlConn:   clientConn,
		controlWrites: make(chan []byte, 8),
	}

	firstDown := buildTestTouchPayload(0, 7, 100, 200, 1)
	secondDown := buildTestTouchPayload(0, 7, 300, 400, 1)
	if err := rt.SendControl(firstDown); err != nil {
		t.Fatalf("send first down: %v", err)
	}
	if err := rt.SendControl(secondDown); err != nil {
		t.Fatalf("send second down: %v", err)
	}

	if len(rt.controlWrites) != 3 {
		t.Fatalf("expected first down, stale release, and second down, got %d", len(rt.controlWrites))
	}
	_ = <-rt.controlWrites
	release := <-rt.controlWrites
	down := <-rt.controlWrites

	if release[1] != 1 {
		t.Fatalf("expected stale pointer release before second down, got action %d", release[1])
	}
	if binary.BigEndian.Uint64(release[2:10]) != 7 {
		t.Fatalf("expected stale release for pointer 7, got %d", binary.BigEndian.Uint64(release[2:10]))
	}
	if binary.BigEndian.Uint16(release[22:24]) != 0 {
		t.Fatalf("expected release pressure to be zero, got %d", binary.BigEndian.Uint16(release[22:24]))
	}
	if binary.BigEndian.Uint32(release[28:32]) != 0 {
		t.Fatalf("expected release buttons to be zero, got %d", binary.BigEndian.Uint32(release[28:32]))
	}
	if string(down) != string(secondDown) {
		t.Fatalf("expected second down to remain queued after stale release")
	}
}

func buildTestTouchPayload(action byte, pointerID uint64, x int, y int, buttons uint32) []byte {
	payload := make([]byte, 32)
	payload[0] = 2
	payload[1] = action
	binary.BigEndian.PutUint64(payload[2:10], pointerID)
	binary.BigEndian.PutUint32(payload[10:14], uint32(x))
	binary.BigEndian.PutUint32(payload[14:18], uint32(y))
	binary.BigEndian.PutUint16(payload[18:20], 1080)
	binary.BigEndian.PutUint16(payload[20:22], 2400)
	binary.BigEndian.PutUint16(payload[22:24], 0xffff)
	binary.BigEndian.PutUint32(payload[24:28], buttons)
	binary.BigEndian.PutUint32(payload[28:32], buttons)
	return payload
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

func TestRuntimeVideoRefreshBypassOptionSkipsConfirmationForHealthySource(t *testing.T) {
	now := time.Now()
	rt := &runtime{
		done: make(chan struct{}),
		health: domainscrcpy.SourceHealthSnapshot{
			State:              domainscrcpy.SourceHealthHealthy,
			LastPacketAt:       now,
			LastNewPTSAt:       now,
			LastPTS:            100,
			HasSeenMediaPacket: true,
		},
	}

	if err := rt.RequestVideoRefresh(domainscrcpy.VideoRefreshOptions{BypassConfirmation: true}); err != nil {
		t.Fatalf("request refresh: %v", err)
	}

	rt.refreshMu.Lock()
	defer rt.refreshMu.Unlock()
	if rt.lastRefreshTime.IsZero() {
		t.Fatalf("expected bypass refresh to dispatch without waiting for confirmation")
	}
	if rt.refreshAskCount != 0 {
		t.Fatalf("expected confirmation counter to reset, got %d", rt.refreshAskCount)
	}
}

func TestRuntimeVideoRefreshBypassOptionStillSkipsStaticButAliveSource(t *testing.T) {
	now := time.Now()
	rt := &runtime{
		done: make(chan struct{}),
		health: domainscrcpy.SourceHealthSnapshot{
			State:              domainscrcpy.SourceHealthStaticButAlive,
			LastPacketAt:       now.Add(-30 * time.Second),
			LastNewPTSAt:       now,
			LastPTS:            100,
			HasSeenMediaPacket: true,
		},
	}

	if err := rt.RequestVideoRefresh(domainscrcpy.VideoRefreshOptions{BypassConfirmation: true}); err != nil {
		t.Fatalf("request refresh: %v", err)
	}

	rt.refreshMu.Lock()
	defer rt.refreshMu.Unlock()
	if !rt.lastRefreshTime.IsZero() {
		t.Fatalf("expected bypass refresh to keep static source protection")
	}
	if rt.refreshAskCount != 0 {
		t.Fatalf("expected static source to clear confirmation counter, got %d", rt.refreshAskCount)
	}
}

func TestRuntimeVideoRefreshAllowsPacketIdleStaticSourceWithOption(t *testing.T) {
	now := time.Now()
	rt := &runtime{
		done: make(chan struct{}),
		health: domainscrcpy.SourceHealthSnapshot{
			State:              domainscrcpy.SourceHealthStaticButAlive,
			LastPacketAt:       now.Add(-sourceHealthPacketFreshness - time.Second),
			LastNewPTSAt:       now.Add(-sourceHealthPacketFreshness - time.Second),
			LastPTS:            100,
			HasSeenMediaPacket: true,
		},
	}

	if err := rt.RequestVideoRefresh(domainscrcpy.VideoRefreshOptions{BypassConfirmation: true, AllowPacketIdleRefresh: true}); err != nil {
		t.Fatalf("request refresh: %v", err)
	}

	rt.refreshMu.Lock()
	defer rt.refreshMu.Unlock()
	if rt.lastRefreshTime.IsZero() {
		t.Fatalf("expected packet-idle static source refresh to dispatch")
	}
	if rt.refreshAskCount != 0 {
		t.Fatalf("expected confirmation counter to reset, got %d", rt.refreshAskCount)
	}
}
