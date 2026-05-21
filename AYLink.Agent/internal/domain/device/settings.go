package device

type SettingsProfile struct {
	Video               bool     `json:"Video"`
	Audio               bool     `json:"Audio"`
	Control             bool     `json:"Control"`
	VideoCodec          string   `json:"VideoCodec"`
	MaxSize             *int     `json:"MaxSize"`
	VideoBitRate        *int     `json:"VideoBitRate"`
	MaxFps              *float64 `json:"MaxFps"`
	AudioCodec          string   `json:"AudioCodec"`
	AudioBitRate        *int     `json:"AudioBitRate"`
	VideoSource         string   `json:"VideoSource"`
	AudioSource         string   `json:"AudioSource"`
	StayAwake           bool     `json:"StayAwake"`
	ShowTouches         bool     `json:"ShowTouches"`
	PowerOn             bool     `json:"PowerOn"`
	PowerOffOnClose     bool     `json:"PowerOffOnClose"`
	ScreenOffTimeout    *int     `json:"ScreenOffTimeout"`
	HidKeyboard         bool     `json:"HidKeyboard"`
	HidMouse            bool     `json:"HidMouse"`
	CameraFacing        string   `json:"CameraFacing"`
	CameraID            string   `json:"CameraId"`
	CameraSize          string   `json:"CameraSize"`
	CameraFps           string   `json:"CameraFps"`
	CameraHighSpeed     bool     `json:"CameraHighSpeed"`
	AudioDup            bool     `json:"AudioDup"`
	VdDestroyContent    bool     `json:"VdDestroyContent"`
	VdSystemDecorations bool     `json:"VdSystemDecorations"`
	NewDisplay          string   `json:"NewDisplay"`
	FlexDisplay         bool     `json:"FlexDisplay"`
	VideoEncoder        string   `json:"VideoEncoder"`
	AudioEncoder        string   `json:"AudioEncoder"`
	CodecOptions        string   `json:"CodecOptions"`
}

func DefaultSettingsProfile() SettingsProfile {
	screenOffTimeout := -1
	return SettingsProfile{
		Video:               true,
		Audio:               true,
		Control:             true,
		VideoCodec:          "h264",
		AudioCodec:          "opus",
		VideoSource:         "display",
		AudioSource:         "output",
		PowerOn:             true,
		ScreenOffTimeout:    &screenOffTimeout,
		CameraFacing:        "front",
		CameraID:            "",
		CameraSize:          "",
		CameraFps:           "",
		VdDestroyContent:    true,
		VdSystemDecorations: true,
		NewDisplay:          "",
		VideoEncoder:        "",
		AudioEncoder:        "",
		CodecOptions:        "",
	}
}
