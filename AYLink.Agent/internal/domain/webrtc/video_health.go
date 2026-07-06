package webrtc

import "time"

type VideoStreamState string

const (
	VideoStreamStateIdle       VideoStreamState = "idle"
	VideoStreamStateConnecting VideoStreamState = "connecting"
	VideoStreamStateObserving  VideoStreamState = "observing"
	VideoStreamStateStable     VideoStreamState = "stable"
	VideoStreamStateStalled    VideoStreamState = "stalled"
	VideoStreamStateRecovering VideoStreamState = "recovering"
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
	State      VideoStreamState          `json:"state"`
	Origin     VideoStreamHealthOrigin   `json:"origin"`
	Reason     string                    `json:"reason"`
	CapturedAt time.Time                 `json:"capturedAt"`
	Source     VideoSourceDiagnostics    `json:"source"`
	Sender     VideoSenderDiagnostics    `json:"sender"`
	Transport  VideoTransportDiagnostics `json:"transport"`
}

type VideoSourceDiagnostics struct {
	State                string    `json:"state"`
	Reason               string    `json:"reason"`
	LastPacketAt         time.Time `json:"lastPacketAt"`
	LastNewPTSAt         time.Time `json:"lastNewPtsAt"`
	LastKeyFrameAt       time.Time `json:"lastKeyFrameAt"`
	LastKeyFrameReplayAt time.Time `json:"lastKeyFrameReplayAt"`
	LastVideoRefreshAt   time.Time `json:"lastVideoRefreshAt"`
	LastPTS              int64     `json:"lastPts"`
	RepeatedPTSCount     int       `json:"repeatedPtsCount"`
	HasSeenMediaPacket   bool      `json:"hasSeenMediaPacket"`
	RuntimeClosed        bool      `json:"runtimeClosed"`
}

type VideoSenderDiagnostics struct {
	State              string    `json:"state"`
	Reason             string    `json:"reason"`
	Generation         uint64    `json:"generation"`
	PeerConnected      bool      `json:"peerConnected"`
	HasConfig          bool      `json:"hasConfig"`
	HasPendingKeyFrame bool      `json:"hasPendingKeyFrame"`
	LastFrameWriteAt   time.Time `json:"lastFrameWriteAt"`
	LastConfigAt       time.Time `json:"lastConfigAt"`
	LastKeyFrameAt     time.Time `json:"lastKeyFrameAt"`
	StateSince         time.Time `json:"stateSince"`
}

type VideoTransportDiagnostics struct {
	PeerConnectionState string `json:"peerConnectionState"`
	SignalingAttached   bool   `json:"signalingAttached"`
	SessionClosed       bool   `json:"sessionClosed"`
}
