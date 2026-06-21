package webrtc

type VideoStreamState string

const (
	VideoStreamStateIdle       VideoStreamState = "idle"
	VideoStreamStateConnecting VideoStreamState = "connecting"
	VideoStreamStateObserving  VideoStreamState = "observing"
	VideoStreamStateStable     VideoStreamState = "stable"
	VideoStreamStateStalled    VideoStreamState = "stalled"
	VideoStreamStateDetached   VideoStreamState = "detached"
)
