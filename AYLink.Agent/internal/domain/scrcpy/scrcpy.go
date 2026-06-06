package scrcpy

import (
	"context"
	"time"
)

type AppInfo struct {
	Name        string `json:"Name"`
	PackageName string `json:"PackageName"`
}

type AudioEncoderOption struct {
	Codec   string
	Encoder string
}

type SessionConfig struct {
	Video   bool
	Audio   bool
	Control bool

	VideoCodec   string
	AudioCodec   string
	VideoSource  string
	AudioSource  string
	AudioDup     bool
	VideoEncoder string
	AudioEncoder string
	CodecOptions string

	NewDisplay          string
	FlexDisplay         bool
	VdDestroyContent    bool
	VdSystemDecorations bool
	MaxSize             *int
	VideoBitRate        *int
	AudioBitRate        *int
	MaxFps              *float64
	DisplayID           *int

	CameraFacing    string
	CameraID        string
	CameraSize      string
	CameraFps       string
	CameraHighSpeed bool

	ShowTouches      bool
	StayAwake        bool
	PowerOn          bool
	PowerOffOnClose  bool
	ScreenOffTimeout *int
	HidKeyboard      bool
	HidMouse         bool
	SendDummyByte    bool
}

type Session struct {
	SCID        int
	VideoPort   int
	AudioPort   int
	ControlPort int
}

type VideoCodec string

const (
	VideoCodecH264 VideoCodec = "h264"
	VideoCodecH265 VideoCodec = "h265"
	VideoCodecAV1  VideoCodec = "av1"
)

type VideoPacket struct {
	Data                  []byte
	Buffer                []byte
	Release               func()
	PresentationTimestamp int64
	IsConfig              bool
	IsKeyFrame            bool
	Codec                 VideoCodec
	ScreenWidth           int
	ScreenHeight          int
}

type SourceHealthState string

const (
	SourceHealthHealthy        SourceHealthState = "healthy"
	SourceHealthStaticButAlive SourceHealthState = "static_but_alive"
	SourceHealthPacketStalled  SourceHealthState = "packet_stalled"
	SourceHealthPTSStalled     SourceHealthState = "pts_stalled"
	SourceHealthSourceStalled  SourceHealthState = "source_stalled"
	SourceHealthRecovering     SourceHealthState = "source_recovering"
)

type SourceHealthSnapshot struct {
	State                SourceHealthState
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

type AudioCodec string

const (
	AudioCodecOpus AudioCodec = "opus"
	AudioCodecRaw  AudioCodec = "raw"
	AudioCodecAAC  AudioCodec = "aac"
	AudioCodecFLAC AudioCodec = "flac"
)

type AudioPacket struct {
	Data                  []byte
	Buffer                []byte
	Release               func()
	PresentationTimestamp int64
	IsConfig              bool
	Codec                 AudioCodec
}

type Runtime interface {
	SubscribeVideoPackets() (<-chan VideoPacket, func())
	SubscribeAudioPackets() (<-chan AudioPacket, func())
	SubscribeErrors() (<-chan error, func())
	GetSourceHealth() SourceHealthSnapshot
	GetClipboardCached() (string, bool)
	GetClipboard(ctx context.Context) (string, error)
	SetClipboard(ctx context.Context, text string) error
	PasteClipboard(ctx context.Context, text string) error
	ReplayLatestVideoKeyFrame() bool
	RequestVideoRefresh() error
	SendControl([]byte) error
	Close() error
}
