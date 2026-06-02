package scrcpy

import (
	"context"
	"errors"
	"fmt"
	"strings"

	domaindevice "aylink-agent/internal/domain/device"
	domainscrcpy "aylink-agent/internal/domain/scrcpy"
)

var (
	ErrDeviceNotFound      = errors.New("device not found")
	ErrDeviceSerialMissing = errors.New("device serial missing")
	ErrServerUnavailable   = errors.New("scrcpy server unavailable")
)

type DeviceRepository interface {
	GetByID(ctx context.Context, id int) (*domaindevice.Device, error)
}

type SettingsRepository interface {
	GetByDeviceID(ctx context.Context, id int) (domaindevice.SettingsProfile, error)
}

type Backend interface {
	IsAvailable() bool
	ServerPath() string
	ListEncoders(ctx context.Context, serial string) ([]string, error)
	ListAudioEncoderOptions(ctx context.Context, serial string) ([]domainscrcpy.AudioEncoderOption, error)
	ListApps(ctx context.Context, serial string) ([]domainscrcpy.AppInfo, error)
	StartSession(ctx context.Context, serial string, config domainscrcpy.SessionConfig) (*domainscrcpy.Session, error)
	OpenRuntime(ctx context.Context, session *domainscrcpy.Session) (domainscrcpy.Runtime, error)
}

type Service struct {
	devices  DeviceRepository
	settings SettingsRepository
	backend  Backend
}

const scrcpyControlMsgResizeDisplay byte = 21

type WebRTCRuntimeOptions struct {
	AppPackage       string
	AppName          string
	NewDisplay       bool
	NewDisplayWidth  *int
	NewDisplayHeight *int
	NewDisplayDPI    *int
}

func NewService(devices DeviceRepository, settings SettingsRepository, backend Backend) *Service {
	return &Service{
		devices:  devices,
		settings: settings,
		backend:  backend,
	}
}

func (s *Service) ListEncoders(ctx context.Context, deviceID int) ([]string, error) {
	serial, err := s.resolveSerial(ctx, deviceID)
	if err != nil {
		return nil, err
	}
	if !s.backend.IsAvailable() {
		return nil, ErrServerUnavailable
	}
	return s.backend.ListEncoders(ctx, serial)
}

func (s *Service) ListApps(ctx context.Context, deviceID int) ([]domainscrcpy.AppInfo, error) {
	serial, err := s.resolveSerial(ctx, deviceID)
	if err != nil {
		return nil, err
	}
	if !s.backend.IsAvailable() {
		return nil, ErrServerUnavailable
	}
	return s.backend.ListApps(ctx, serial)
}

func (s *Service) StartSession(ctx context.Context, deviceID int) (*domainscrcpy.Session, error) {
	serial, err := s.resolveSerial(ctx, deviceID)
	if err != nil {
		return nil, err
	}
	if !s.backend.IsAvailable() {
		return nil, ErrServerUnavailable
	}

	settings, err := s.settings.GetByDeviceID(ctx, deviceID)
	if err != nil {
		return nil, err
	}

	return s.backend.StartSession(ctx, serial, mapSettings(settings))
}

func (s *Service) StartRuntime(ctx context.Context, deviceID int) (domainscrcpy.Runtime, error) {
	serial, err := s.resolveSerial(ctx, deviceID)
	if err != nil {
		return nil, err
	}
	if !s.backend.IsAvailable() {
		return nil, ErrServerUnavailable
	}

	settings, err := s.settings.GetByDeviceID(ctx, deviceID)
	if err != nil {
		return nil, err
	}

	config := mapSettings(settings)
	session, err := s.backend.StartSession(ctx, serial, config)
	if err != nil {
		return nil, err
	}
	runtime, err := s.backend.OpenRuntime(ctx, session)
	if err != nil {
		return nil, err
	}
	return wrapRuntimeForConfig(runtime, config), nil
}

func (s *Service) StartRuntimeForWebRTC(ctx context.Context, deviceID int, options WebRTCRuntimeOptions) (domainscrcpy.Runtime, error) {
	serial, err := s.resolveSerial(ctx, deviceID)
	if err != nil {
		return nil, err
	}
	if !s.backend.IsAvailable() {
		return nil, ErrServerUnavailable
	}

	settings, err := s.settings.GetByDeviceID(ctx, deviceID)
	if err != nil {
		return nil, err
	}

	config := mapSettings(settings)
	config = applyWebRTCRuntimeOptions(config, options)

	session, err := s.backend.StartSession(ctx, serial, config)
	if err != nil {
		return nil, err
	}
	runtime, err := s.backend.OpenRuntime(ctx, session)
	if err != nil {
		return nil, err
	}
	return wrapRuntimeForConfig(runtime, config), nil
}

func (s *Service) resolveSerial(ctx context.Context, deviceID int) (string, error) {
	device, err := s.devices.GetByID(ctx, deviceID)
	if err != nil {
		return "", err
	}
	if device == nil {
		return "", ErrDeviceNotFound
	}
	serial := strings.TrimSpace(device.Serial)
	if serial == "" {
		return "", ErrDeviceSerialMissing
	}
	return serial, nil
}

func mapSettings(settings domaindevice.SettingsProfile) domainscrcpy.SessionConfig {
	return domainscrcpy.SessionConfig{
		Video:               settings.Video,
		Audio:               settings.Audio,
		Control:             settings.Control,
		VideoCodec:          settings.VideoCodec,
		AudioCodec:          settings.AudioCodec,
		VideoSource:         settings.VideoSource,
		AudioSource:         settings.AudioSource,
		AudioDup:            settings.AudioDup,
		VideoEncoder:        settings.VideoEncoder,
		AudioEncoder:        settings.AudioEncoder,
		CodecOptions:        settings.CodecOptions,
		NewDisplay:          settings.NewDisplay,
		FlexDisplay:         settings.FlexDisplay,
		VdDestroyContent:    settings.VdDestroyContent,
		VdSystemDecorations: settings.VdSystemDecorations,
		MaxSize:             settings.MaxSize,
		VideoBitRate:        settings.VideoBitRate,
		AudioBitRate:        settings.AudioBitRate,
		MaxFps:              settings.MaxFps,
		CameraFacing:        settings.CameraFacing,
		CameraID:            settings.CameraID,
		CameraSize:          settings.CameraSize,
		CameraFps:           settings.CameraFps,
		CameraHighSpeed:     settings.CameraHighSpeed,
		ShowTouches:         settings.ShowTouches,
		StayAwake:           settings.StayAwake,
		PowerOn:             settings.PowerOn,
		PowerOffOnClose:     settings.PowerOffOnClose,
		ScreenOffTimeout:    settings.ScreenOffTimeout,
		HidKeyboard:         settings.HidKeyboard,
		HidMouse:            settings.HidMouse,
	}
}

func applyWebRTCRuntimeOptions(config domainscrcpy.SessionConfig, options WebRTCRuntimeOptions) domainscrcpy.SessionConfig {
	appPackage := strings.TrimSpace(options.AppPackage)
	requiresDedicatedDisplay := options.NewDisplay || appPackage != ""
	dpiSuffix := buildNewDisplayDPISuffix(options.NewDisplayDPI)
	sizeValue := buildNewDisplaySizeValue(options.NewDisplayWidth, options.NewDisplayHeight)

	if requiresDedicatedDisplay {
		if sizeValue != "" {
			config.NewDisplay = sizeValue + dpiSuffix
		} else {
			trimmedNewDisplay := strings.TrimSpace(config.NewDisplay)
			if trimmedNewDisplay == "" {
				if dpiSuffix != "" {
					config.NewDisplay = dpiSuffix
				} else {
					config.NewDisplay = " "
				}
			} else if dpiSuffix != "" && !strings.Contains(trimmedNewDisplay, "/") {
				config.NewDisplay = trimmedNewDisplay + dpiSuffix
			} else {
				config.NewDisplay = trimmedNewDisplay
			}
		}
		config.DisplayID = nil
	} else {
		// 默认应始终在主显示屏上进行
		config.NewDisplay = ""
		config.FlexDisplay = false
	}

	if appPackage != "" {
		config.Control = true
	}

	return config
}

func buildNewDisplaySizeValue(width *int, height *int) string {
	if width == nil || height == nil {
		return ""
	}

	if *width < 240 || *height < 240 {
		return ""
	}

	return fmt.Sprintf("%dx%d", *width, *height)
}

func buildNewDisplayDPISuffix(dpi *int) string {
	if dpi == nil {
		return ""
	}

	if *dpi < 72 || *dpi > 960 {
		return ""
	}

	return fmt.Sprintf("/%d", *dpi)
}

func wrapRuntimeForConfig(runtime domainscrcpy.Runtime, config domainscrcpy.SessionConfig) domainscrcpy.Runtime {
	if runtime == nil {
		return nil
	}

	return &runtimeControlGuard{
		Runtime:            runtime,
		allowDisplayResize: config.NewDisplay != "" && config.FlexDisplay,
	}
}

type runtimeControlGuard struct {
	domainscrcpy.Runtime
	allowDisplayResize bool
}

func (r *runtimeControlGuard) SendControl(payload []byte) error {
	if len(payload) > 0 && payload[0] == scrcpyControlMsgResizeDisplay && !r.allowDisplayResize {
		return nil
	}

	return r.Runtime.SendControl(payload)
}
