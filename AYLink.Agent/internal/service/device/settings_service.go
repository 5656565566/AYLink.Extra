package device

import (
	"context"
	"errors"
	"strings"

	domaindevice "aylink-agent/internal/domain/device"
)

type SettingsRepository interface {
	GetBySerial(ctx context.Context, serial string) (domaindevice.SettingsProfile, error)
	SaveBySerial(ctx context.Context, serial string, profile domaindevice.SettingsProfile) (domaindevice.SettingsProfile, error)
	DeleteBySerial(ctx context.Context, serial string) error
}

type SettingsService struct {
	devices  Repository
	settings SettingsRepository
}

func NewSettingsService(devices Repository, settings SettingsRepository) *SettingsService {
	return &SettingsService{
		devices:  devices,
		settings: settings,
	}
}

func (s *SettingsService) GetByDeviceID(ctx context.Context, id int) (domaindevice.SettingsProfile, error) {
	device, err := s.devices.GetByID(ctx, id)
	if err != nil {
		return domaindevice.SettingsProfile{}, err
	}
	if device == nil {
		return domaindevice.SettingsProfile{}, ErrDeviceNotFound
	}
	return s.settings.GetBySerial(ctx, device.Serial)
}

func (s *SettingsService) SaveByDeviceID(ctx context.Context, id int, profile domaindevice.SettingsProfile) (domaindevice.SettingsProfile, error) {
	device, err := s.devices.GetByID(ctx, id)
	if err != nil {
		return domaindevice.SettingsProfile{}, err
	}
	if device == nil {
		return domaindevice.SettingsProfile{}, ErrDeviceNotFound
	}
	if strings.TrimSpace(device.Serial) == "" {
		return domaindevice.SettingsProfile{}, ErrDeviceSerialEmpty
	}

	normalized := normalizeSettingsProfile(profile)
	return s.settings.SaveBySerial(ctx, device.Serial, normalized)
}

func (s *SettingsService) ResetByDeviceID(ctx context.Context, id int) (domaindevice.SettingsProfile, error) {
	device, err := s.devices.GetByID(ctx, id)
	if err != nil {
		return domaindevice.SettingsProfile{}, err
	}
	if device == nil {
		return domaindevice.SettingsProfile{}, ErrDeviceNotFound
	}
	if strings.TrimSpace(device.Serial) == "" {
		return domaindevice.SettingsProfile{}, ErrDeviceSerialEmpty
	}
	if err := s.settings.DeleteBySerial(ctx, device.Serial); err != nil {
		return domaindevice.SettingsProfile{}, err
	}
	return domaindevice.DefaultSettingsProfile(), nil
}

func normalizeSettingsProfile(profile domaindevice.SettingsProfile) domaindevice.SettingsProfile {
	defaults := domaindevice.DefaultSettingsProfile()

	if strings.TrimSpace(profile.VideoCodec) == "" {
		profile.VideoCodec = defaults.VideoCodec
	}
	if strings.TrimSpace(profile.AudioCodec) == "" {
		profile.AudioCodec = defaults.AudioCodec
	}
	if strings.TrimSpace(profile.VideoSource) == "" {
		profile.VideoSource = defaults.VideoSource
	}
	if strings.TrimSpace(profile.AudioSource) == "" {
		profile.AudioSource = defaults.AudioSource
	}
	if strings.TrimSpace(profile.CameraFacing) == "" {
		profile.CameraFacing = defaults.CameraFacing
	}
	if profile.ScreenOffTimeout == nil {
		profile.ScreenOffTimeout = defaults.ScreenOffTimeout
	}

	return profile
}

var errNoop = errors.New("noop")
