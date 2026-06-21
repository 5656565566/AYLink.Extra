package webrtc

import "testing"

func TestVideoStreamStateNamesMatchClientStateMachine(t *testing.T) {
	tests := map[VideoStreamState]string{
		VideoStreamStateIdle:       "idle",
		VideoStreamStateConnecting: "connecting",
		VideoStreamStateObserving:  "observing",
		VideoStreamStateStable:     "stable",
		VideoStreamStateStalled:    "stalled",
		VideoStreamStateDetached:   "detached",
	}

	for state, want := range tests {
		if got := string(state); got != want {
			t.Fatalf("video stream state = %q, want %q", got, want)
		}
	}
}
