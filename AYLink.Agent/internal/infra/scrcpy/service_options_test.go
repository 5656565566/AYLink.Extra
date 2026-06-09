package scrcpy

import (
	"testing"

	domainscrcpy "aylink-agent/internal/domain/scrcpy"
)

func TestSanitizeVideoEncoderPreservesExplicitEncoder(t *testing.T) {
	config := domainscrcpy.SessionConfig{
		VideoCodec:   "h265",
		VideoEncoder: " OMX.qcom.video.encoder.avc ",
	}

	sanitizeVideoEncoder(&config)

	if config.VideoEncoder != "OMX.qcom.video.encoder.avc" {
		t.Fatalf("expected explicit video encoder to be preserved, got %q", config.VideoEncoder)
	}
}

func TestServerOptionsIncludeExplicitVideoEncoder(t *testing.T) {
	options := newServerOptionsFromConfig("test", 1, domainscrcpy.SessionConfig{
		VideoCodec:   "h265",
		VideoEncoder: "OMX.qcom.video.encoder.avc",
	})

	args := options.Args()
	for _, arg := range args {
		if arg == "video_encoder=OMX.qcom.video.encoder.avc" {
			return
		}
	}

	t.Fatalf("expected video_encoder argument, got %#v", args)
}
