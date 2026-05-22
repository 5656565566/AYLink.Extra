package scrcpy

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
	SendControl([]byte) error
	Close() error
}
