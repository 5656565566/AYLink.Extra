package webrtc

import (
	"errors"
	"testing"
	"time"

	domainscrcpy "aylink-agent/internal/domain/scrcpy"

	"github.com/pion/interceptor"
	"github.com/pion/rtp"
	pion "github.com/pion/webrtc/v4"
)

type videoTimingWriter struct {
	frames   []rtp.Header
	attempts []rtp.Header
	err      error
}

func (w *videoTimingWriter) WriteRTP(header *rtp.Header, payload []byte) (int, error) {
	if header.Marker {
		w.attempts = append(w.attempts, *header)
	}
	if w.err != nil {
		return 0, w.err
	}
	if header.Marker {
		w.frames = append(w.frames, *header)
	}
	return len(payload), nil
}

func (w *videoTimingWriter) Write(data []byte) (int, error) {
	var packet rtp.Packet
	if err := packet.Unmarshal(data); err != nil {
		return 0, err
	}
	return w.WriteRTP(&packet.Header, packet.Payload)
}

type videoTimingTrackContext struct {
	writer *videoTimingWriter
}

func (c videoTimingTrackContext) CodecParameters() []pion.RTPCodecParameters {
	return []pion.RTPCodecParameters{{
		RTPCodecCapability: pion.RTPCodecCapability{
			MimeType:    pion.MimeTypeH264,
			ClockRate:   90000,
			SDPFmtpLine: "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f",
		},
		PayloadType: 96,
	}}
}

func (c videoTimingTrackContext) HeaderExtensions() []pion.RTPHeaderExtensionParameter { return nil }
func (c videoTimingTrackContext) SSRC() pion.SSRC                                      { return 1 }
func (c videoTimingTrackContext) SSRCRetransmission() pion.SSRC                        { return 0 }
func (c videoTimingTrackContext) SSRCForwardErrorCorrection() pion.SSRC                { return 0 }
func (c videoTimingTrackContext) WriteStream() pion.TrackLocalWriter                   { return c.writer }
func (c videoTimingTrackContext) ID() string                                           { return "video-timing-test" }
func (c videoTimingTrackContext) RTCPReader() interceptor.RTCPReader                   { return nil }

func newVideoTimingBridge(t *testing.T) (*scrcpyVideoBridge, *pion.PeerConnection, *videoTimingWriter) {
	t.Helper()
	writer := &videoTimingWriter{}
	track, err := pion.NewTrackLocalStaticSample(pion.RTPCodecCapability{
		MimeType: pion.MimeTypeH264, ClockRate: 90000,
	}, "video", "timing-test")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := track.Bind(videoTimingTrackContext{writer: writer}); err != nil {
		t.Fatal(err)
	}
	peer, err := pion.NewPeerConnection(pion.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = peer.Close() })
	bridge := &scrcpyVideoBridge{
		runtime:       &fakeScrcpyRuntime{},
		track:         track,
		lastConfig:    []byte{0, 0, 0, 1, 0x67, 0x42, 0, 0x1f, 0x55, 0, 0, 0, 1, 0x68, 0x55},
		generation:    1,
		peerConnected: true,
		state:         videoBridgeStateReady,
	}
	return bridge, peer, writer
}

func videoTimingPacket(pts int64, keyFrame bool) domainscrcpy.VideoPacket {
	header := byte(0x41)
	if keyFrame {
		header = 0x65
	}
	return domainscrcpy.VideoPacket{
		Data:                  []byte{0, 0, 0, 1, header, 0x55, 0x55},
		Codec:                 domainscrcpy.VideoCodecH264,
		PresentationTimestamp: pts,
		IsKeyFrame:            keyFrame,
	}
}

func assertVideoTiming(t *testing.T, frames []rtp.Header, pts []int64) {
	t.Helper()
	if len(frames) != len(pts) {
		t.Fatalf("expected %d frames, got %d", len(pts), len(frames))
	}
	for i := 1; i < len(pts); i++ {
		got := frames[i].Timestamp - frames[0].Timestamp
		want := uint32((pts[i] - pts[0]) * 90000 / 1000000)
		// Quantization may carry a fractional 90 kHz tick across a new PTS baseline.
		if difference := int64(got) - int64(want); difference < -1 || difference > 1 {
			t.Errorf("frame %d: PTS offset=%dus, RTP offset=%d ticks, want %d", i, pts[i]-pts[0], got, want)
		}
	}
}

func TestVideoBridgePreservesSourcePTSDeltas(t *testing.T) {
	tests := []struct {
		name string
		pts  []int64
	}{
		{name: "30fps", pts: []int64{1000000, 1033333, 1066666, 1099999}},
		{name: "60fps", pts: []int64{1000000, 1016667, 1033334, 1050001}},
		{name: "90fps", pts: []int64{1000000, 1011111, 1022222, 1033333}},
		{name: "120fps", pts: []int64{1000000, 1008333, 1016666, 1024999}},
		{name: "144fps", pts: []int64{1000000, 1006944, 1013888, 1020832}},
		{name: "5fps", pts: []int64{1000000, 1200000, 1400000, 1600000}},
		{name: "100.5ms", pts: []int64{1000000, 1100500, 1201000, 1301500}},
		{name: "variable", pts: []int64{1000000, 1016667, 1116667, 1133334}},
		{name: "zero_initial_pts", pts: []int64{0, 8333, 16666, 24999}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			bridge, peer, writer := newVideoTimingBridge(t)
			for _, pts := range tt.pts {
				bridge.handlePacket(peer, videoTimingPacket(pts, false))
			}
			assertVideoTiming(t, writer.frames, tt.pts)
		})
	}
}

func TestVideoBridgeIdleUsesSourcePTS(t *testing.T) {
	bridge, peer, writer := newVideoTimingBridge(t)
	bridge.handlePacket(peer, videoTimingPacket(1000000, false))
	bridge.handlePacket(peer, videoTimingPacket(1016667, false))
	bridge.lastFrameWriteAt = time.Now().Add(-800 * time.Millisecond)
	bridge.handlePacket(peer, videoTimingPacket(1816667, false))
	assertVideoTiming(t, writer.frames, []int64{1000000, 1016667, 1816667})
}

func TestVideoBridgePendingKeyFramePreservesNextPTSGap(t *testing.T) {
	bridge, peer, writer := newVideoTimingBridge(t)
	bridge.peerConnected = false
	bridge.state = videoBridgeStateWaitingKeyFrame
	bridge.handlePacket(peer, videoTimingPacket(1000000, true))
	bridge.handlePeerConnectionState(pion.PeerConnectionStateConnected)
	bridge.handlePacket(peer, videoTimingPacket(1008333, false))
	assertVideoTiming(t, writer.frames, []int64{1000000, 1008333})
}

func TestVideoBridgeConfigRestartsSourcePTS(t *testing.T) {
	bridge, peer, writer := newVideoTimingBridge(t)
	bridge.handlePacket(peer, videoTimingPacket(1000000, false))
	bridge.handlePacket(peer, videoTimingPacket(1016667, false))
	bridge.handlePacket(peer, domainscrcpy.VideoPacket{
		Data: bridge.lastConfig, Codec: domainscrcpy.VideoCodecH264, IsConfig: true,
	})
	bridge.handlePacket(peer, videoTimingPacket(0, true))
	bridge.handlePacket(peer, videoTimingPacket(8333, false))
	bridge.handlePacket(peer, videoTimingPacket(16666, false))
	if len(writer.frames) != 5 {
		t.Fatalf("expected 5 frames across config update, got %d", len(writer.frames))
	}
	if writer.frames[2].Timestamp == writer.frames[1].Timestamp {
		t.Fatal("config update reused the previous frame's RTP timestamp")
	}
	assertVideoTiming(t, writer.frames[2:], []int64{0, 8333, 16666})
}

func TestVideoBridgeWriteFailureDoesNotAdvanceTimestampTwice(t *testing.T) {
	bridge, peer, writer := newVideoTimingBridge(t)
	bridge.handlePacket(peer, videoTimingPacket(1000000, false))
	writer.err = errors.New("RTP write failed")
	bridge.handlePacket(peer, videoTimingPacket(1016667, false))
	writer.err = nil
	bridge.handlePacket(peer, videoTimingPacket(1033334, false))
	assertVideoTiming(t, writer.frames, []int64{1000000, 1033334})
}

func TestVideoBridgeFirstWriteFailurePreservesNextPTSGap(t *testing.T) {
	bridge, peer, writer := newVideoTimingBridge(t)
	writer.err = errors.New("first RTP write failed")
	bridge.handlePacket(peer, videoTimingPacket(1000000, false))
	writer.err = nil
	bridge.handlePacket(peer, videoTimingPacket(1008333, false))
	assertVideoTiming(t, writer.attempts, []int64{1000000, 1008333})
}
