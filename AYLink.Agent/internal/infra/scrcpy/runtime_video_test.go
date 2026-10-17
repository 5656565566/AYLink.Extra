package scrcpy

import (
	"bytes"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"

	domainscrcpy "aylink-agent/internal/domain/scrcpy"
)

func TestRuntimeReplayKeepsConfigBeforeKeyFrameAtQueueBoundary(t *testing.T) {
	for depth := 0; depth <= videoPacketQueueSize; depth++ {
		t.Run(fmt.Sprint(depth), func(t *testing.T) {
			queue := make(chan domainscrcpy.VideoPacket, videoPacketQueueSize)
			releases := make([]int, depth)
			for i := range releases {
				queue <- domainscrcpy.VideoPacket{
					PresentationTimestamp: int64(i),
					Release:               func() { releases[i]++ },
				}
			}
			config := domainscrcpy.VideoPacket{Data: []byte{0, 0, 0, 1, 0x67, 0x55}, IsConfig: true}
			keyFrame := domainscrcpy.VideoPacket{Data: []byte{0, 0, 0, 1, 0x65, 0x55}, IsKeyFrame: true}
			rt := &runtime{
				done:                make(chan struct{}),
				videoSubscribers:    map[int]chan domainscrcpy.VideoPacket{0: queue},
				latestVideoConfig:   cloneVideoPacketForCache(config, 1),
				latestVideoKeyFrame: cloneVideoPacketForCache(keyFrame, 1),
			}
			if !rt.ReplayLatestVideoKeyFrame() {
				t.Fatal("cached config and key frame were not replayed")
			}
			var packets []domainscrcpy.VideoPacket
			for len(queue) > 0 {
				packet := <-queue
				packets = append(packets, packet)
				if packet.Release != nil {
					packet.Release()
				}
			}
			if len(packets) < 2 || !packets[len(packets)-2].IsConfig || !packets[len(packets)-1].IsKeyFrame {
				t.Fatalf("replay must end in config then key frame, got %+v", packets)
			}
			if depth+2 <= cap(queue) {
				for i := 0; i < depth; i++ {
					if packets[i].PresentationTimestamp != int64(i) {
						t.Fatalf("queued frame %d changed order", i)
					}
				}
			}
			for i, count := range releases {
				if count != 1 {
					t.Errorf("queued frame %d released %d times, want once", i, count)
				}
			}
		})
	}
}

func TestRuntimePublishesDetectedH264KeyFrameFlag(t *testing.T) {
	tests := []struct {
		name string
		data []byte
		key  bool
	}{
		{name: "annex_b_idr", data: []byte{0, 0, 0, 1, 0x65, 0x88}, key: true},
		{name: "length_prefixed_idr", data: []byte{0, 0, 0, 2, 0x65, 0x88}, key: true},
		{name: "annex_b_p", data: []byte{0, 0, 1, 0x41, 0x88}},
		{name: "length_prefixed_p", data: []byte{0, 0, 0, 2, 0x41, 0x88}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			queue := make(chan domainscrcpy.VideoPacket, videoPacketQueueSize)
			rt := &runtime{
				done: make(chan struct{}), videoGeneration: 1,
				videoSubscribers: map[int]chan domainscrcpy.VideoPacket{0: queue},
			}
			rt.offerLatestVideoPacket(domainscrcpy.VideoPacket{Data: tt.data, Codec: domainscrcpy.VideoCodecH264})
			packet := <-queue
			if packet.IsKeyFrame != tt.key {
				t.Fatalf("published key frame flag=%v, want %v", packet.IsKeyFrame, tt.key)
			}
			if !bytes.Equal(packet.Data, tt.data) {
				t.Fatal("classification changed the packet bytes")
			}
			cachedKey := rt.latestVideoKeyFrame.generation != 0
			healthKey := !rt.GetSourceHealth().LastKeyFrameAt.IsZero()
			if cachedKey != tt.key || healthKey != tt.key {
				t.Fatal("published flag, cache and source health disagree")
			}
		})
	}
}

func TestRuntimeReplayRequiresMatchingConfigAndKeyFrame(t *testing.T) {
	for _, invalid := range []string{"missing_config", "missing_key_frame", "different_generation"} {
		t.Run(invalid, func(t *testing.T) {
			queue := make(chan domainscrcpy.VideoPacket, videoPacketQueueSize)
			rt := &runtime{
				done: make(chan struct{}), videoSubscribers: map[int]chan domainscrcpy.VideoPacket{0: queue},
				latestVideoConfig:   cachedVideoPacket{packet: domainscrcpy.VideoPacket{Data: []byte{0x67}}, generation: 1},
				latestVideoKeyFrame: cachedVideoPacket{packet: domainscrcpy.VideoPacket{Data: []byte{0x65}}, generation: 1},
			}
			switch invalid {
			case "missing_config":
				rt.latestVideoConfig.packet.Data = nil
			case "missing_key_frame":
				rt.latestVideoKeyFrame.packet.Data = nil
			case "different_generation":
				rt.latestVideoKeyFrame.generation = 2
			}
			if rt.ReplayLatestVideoKeyFrame() || len(queue) != 0 || !rt.getLastVideoKeyFrameReplayAt().IsZero() {
				t.Fatal("incomplete or mismatched cache was replayed")
			}
		})
	}
}

func TestContainsH264IDRPacketFormats(t *testing.T) {
	tests := []struct {
		name string
		data []byte
		want bool
	}{
		{name: "empty"},
		{name: "truncated_start_code", data: []byte{0, 0, 0, 1}},
		{name: "three_byte_start_code", data: []byte{0, 0, 1, 0x65, 0x88}, want: true},
		{name: "four_byte_start_code", data: []byte{0, 0, 0, 1, 0x65, 0x88}, want: true},
		{name: "multiple_nals", data: []byte{0, 0, 0, 1, 0x09, 0x10, 0, 0, 1, 0x65, 0x88}, want: true},
		{name: "escaped_payload", data: []byte{0, 0, 0, 1, 0x41, 0, 0, 3, 1, 0x65}},
		{name: "truncated_length", data: []byte{0, 0, 0, 8, 0x65, 0x88}},
	}
	for size := 1; size <= 4; size++ {
		for _, key := range []bool{false, true} {
			data := make([]byte, size+2)
			data[size-1] = 2
			data[size] = 0x41
			if key {
				data[size] = 0x65
			}
			data[size+1] = 0x88
			tests = append(tests, struct {
				name string
				data []byte
				want bool
			}{name: fmt.Sprintf("length_%d_key_%v", size, key), data: data, want: key})
		}
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := containsH264IDRPacket(tt.data); got != tt.want {
				t.Fatalf("IDR=%v, want %v for %x", got, tt.want, tt.data)
			}
		})
	}
}

func TestRuntimeVideoPacketOwnershipAcrossOverflowAndUnsubscribe(t *testing.T) {
	for _, count := range []int{1, 4} {
		t.Run(fmt.Sprint(count), func(t *testing.T) {
			rt := &runtime{done: make(chan struct{}), videoSubscribers: make(map[int]chan domainscrcpy.VideoPacket)}
			queues := make([]<-chan domainscrcpy.VideoPacket, count)
			unsubscribe := make([]func(), count)
			for i := range queues {
				queues[i], unsubscribe[i] = rt.SubscribeVideoPackets()
				t.Cleanup(unsubscribe[i])
			}
			data := []byte{0, 0, 0, 1, 0x41, 0x88}
			var heldReleases, queuedReleases atomic.Int32
			rt.offerLatestVideoPacket(domainscrcpy.VideoPacket{
				Data: data, Codec: domainscrcpy.VideoCodecH264,
				Release: func() {
					heldReleases.Add(1)
					clear(data)
				},
			})
			held := make([]domainscrcpy.VideoPacket, count)
			for i := range queues {
				held[i] = <-queues[i]
			}
			for i := 0; i < videoPacketQueueSize+2; i++ {
				rt.offerLatestVideoPacket(domainscrcpy.VideoPacket{
					Data: []byte{0, 0, 0, 1, 0x41, 0x99}, Codec: domainscrcpy.VideoCodecH264,
					Release: func() { queuedReleases.Add(1) },
				})
			}
			if got := queuedReleases.Load(); got != 2 {
				t.Fatalf("overflow released %d source buffers, want 2", got)
			}
			for _, stop := range unsubscribe {
				stop()
			}
			if got := queuedReleases.Load(); got != videoPacketQueueSize+2 {
				t.Fatalf("unsubscribe released %d source buffers, want %d", got, videoPacketQueueSize+2)
			}
			if heldReleases.Load() != 0 || !bytes.Equal(held[0].Data, []byte{0, 0, 0, 1, 0x41, 0x88}) {
				t.Fatal("held source buffer was released before its consumers finished")
			}
			var group sync.WaitGroup
			for _, packet := range held {
				group.Go(packet.Release)
			}
			group.Wait()
			for _, packet := range held {
				packet.Release()
			}
			if got := heldReleases.Load(); got != 1 {
				t.Fatalf("held source buffer released %d times, want once", got)
			}
		})
	}
}

func BenchmarkVideoPacketDispatch(b *testing.B) {
	for _, count := range []int{0, 1, 4} {
		b.Run(fmt.Sprintf("subscribers_%d", count), func(b *testing.B) {
			rt := &runtime{done: make(chan struct{}), videoSubscribers: make(map[int]chan domainscrcpy.VideoPacket)}
			for i := 0; i < count; i++ {
				rt.videoSubscribers[i] = make(chan domainscrcpy.VideoPacket, videoPacketQueueSize)
			}
			data := bytes.Repeat([]byte{0x55}, 16*1024)
			copy(data, []byte{0, 0, 0, 1, 0x41})
			packet := domainscrcpy.VideoPacket{Data: data, Codec: domainscrcpy.VideoCodecH264, Release: func() {}}
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				packet.PresentationTimestamp++
				rt.offerLatestVideoPacket(packet)
				for _, queue := range rt.videoSubscribers {
					(<-queue).Release()
				}
			}
		})
	}
}
