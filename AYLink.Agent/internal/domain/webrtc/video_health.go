package webrtc

import "time"

type VideoStreamState string

const (
	VideoStreamStateIdle       VideoStreamState = "idle"
	VideoStreamStateConnecting VideoStreamState = "connecting"
	VideoStreamStateObserving  VideoStreamState = "observing"
	VideoStreamStateStable     VideoStreamState = "stable"
	VideoStreamStateStalled    VideoStreamState = "stalled"
	VideoStreamStateDetached   VideoStreamState = "detached"
)

type VideoStreamHealthOrigin string

const (
	VideoStreamHealthOriginUnknown   VideoStreamHealthOrigin = "unknown"
	VideoStreamHealthOriginSource    VideoStreamHealthOrigin = "source"
	VideoStreamHealthOriginSender    VideoStreamHealthOrigin = "sender"
	VideoStreamHealthOriginTransport VideoStreamHealthOrigin = "transport"
	VideoStreamHealthOriginClient    VideoStreamHealthOrigin = "client"
)

type VideoStreamHealthSnapshot struct {
	State      VideoStreamState
	Origin     VideoStreamHealthOrigin
	Reason     string
	CapturedAt time.Time
	Source     VideoSourceDiagnostics
	Sender     VideoSenderDiagnostics
	Transport  VideoTransportDiagnostics
}

type VideoSourceDiagnostics struct {
	State                string
	Reason               string
	LastPacketAt         time.Time
	LastNewPTSAt         time.Time
	LastKeyFrameAt       time.Time
	LastKeyFrameReplayAt time.Time
	LastVideoRefreshAt   time.Time
	LastPTS              int64
	RepeatedPTSCount     int
	HasSeenMediaPacket   bool
	RuntimeClosed        bool
}

type VideoSenderDiagnostics struct {
	State              string
	Reason             string
	Generation         uint64
	PeerConnected      bool
	HasConfig          bool
	HasPendingKeyFrame bool
	LastFrameWriteAt   time.Time
	LastConfigAt       time.Time
	LastKeyFrameAt     time.Time
	StateSince         time.Time
}

type VideoTransportDiagnostics struct {
	PeerConnectionState string
	SignalingAttached   bool
	SessionClosed       bool
}
