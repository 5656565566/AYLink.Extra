package webrtc

import (
	"net"
	"testing"
	"time"

	domainscrcpy "aylink-agent/internal/domain/scrcpy"
	pion "github.com/pion/webrtc/v4"
)

type audioPacketTestRuntime struct {
	fakeScrcpyRuntime
	packets chan domainscrcpy.AudioPacket
}

func (f *audioPacketTestRuntime) SubscribeAudioPackets() (<-chan domainscrcpy.AudioPacket, func()) {
	return f.packets, func() {}
}

func (f *audioPacketTestRuntime) SubscribeErrors() (<-chan error, func()) {
	return make(chan error), func() {}
}

func TestAudioBridgeReleasesConfigAndMediaPacketsWhileConnected(t *testing.T) {
	settings := pion.SettingEngine{}
	settings.SetIncludeLoopbackCandidate(true)
	settings.SetNetworkTypes([]pion.NetworkType{pion.NetworkTypeUDP4})
	settings.SetIPFilter(func(ip net.IP) bool { return ip.IsLoopback() })
	api := pion.NewAPI(pion.WithSettingEngine(settings))
	local, err := api.NewPeerConnection(pion.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = local.Close() })
	remote, err := api.NewPeerConnection(pion.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = remote.Close() })
	connected := make(chan struct{}, 1)
	local.OnConnectionStateChange(func(state pion.PeerConnectionState) {
		if state == pion.PeerConnectionStateConnected {
			select {
			case connected <- struct{}{}:
			default:
			}
		}
	})
	if _, err := local.CreateDataChannel("test", nil); err != nil {
		t.Fatal(err)
	}
	offer, err := local.CreateOffer(nil)
	if err != nil {
		t.Fatal(err)
	}
	localGathered := pion.GatheringCompletePromise(local)
	if err := local.SetLocalDescription(offer); err != nil {
		t.Fatal(err)
	}
	awaitAudioBridgeSignal(t, localGathered, "offer candidates")
	if err := remote.SetRemoteDescription(*local.LocalDescription()); err != nil {
		t.Fatal(err)
	}
	answer, err := remote.CreateAnswer(nil)
	if err != nil {
		t.Fatal(err)
	}
	remoteGathered := pion.GatheringCompletePromise(remote)
	if err := remote.SetLocalDescription(answer); err != nil {
		t.Fatal(err)
	}
	awaitAudioBridgeSignal(t, remoteGathered, "answer candidates")
	if err := local.SetRemoteDescription(*remote.LocalDescription()); err != nil {
		t.Fatal(err)
	}
	awaitAudioBridgeSignal(t, connected, "peer connection")
	track, err := pion.NewTrackLocalStaticSample(pion.RTPCodecCapability{MimeType: pion.MimeTypeOpus, ClockRate: 48000, Channels: 2}, "audio", "scrcpy")
	if err != nil {
		t.Fatal(err)
	}
	runtime := &audioPacketTestRuntime{packets: make(chan domainscrcpy.AudioPacket, 1)}
	bridge := &scrcpyAudioBridge{runtime: runtime, track: track}
	stopped := make(chan struct{})
	go func() {
		bridge.run(local)
		close(stopped)
	}()
	t.Cleanup(func() {
		close(runtime.packets)
		awaitAudioBridgeSignal(t, stopped, "audio bridge shutdown")
	})
	for _, config := range []bool{true, false} {
		released := make(chan struct{})
		runtime.packets <- domainscrcpy.AudioPacket{
			Codec: domainscrcpy.AudioCodecOpus, IsConfig: config, Data: []byte{0xf8, 0xff, 0xfe},
			Release: func() { close(released) },
		}
		awaitAudioBridgeSignal(t, released, "audio packet release")
	}
}

func awaitAudioBridgeSignal(t *testing.T, signal <-chan struct{}, description string) {
	t.Helper()
	select {
	case <-signal:
	case <-time.After(5 * time.Second):
		t.Fatalf("timed out waiting for %s", description)
	}
}
