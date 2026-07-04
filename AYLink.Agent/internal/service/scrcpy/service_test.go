package scrcpy

import (
	"context"
	"errors"
	"testing"

	"aylink-agent/internal/domain/device"
	domainscrcpy "aylink-agent/internal/domain/scrcpy"
	deviceservice "aylink-agent/internal/service/device"
)

type fakeDeviceResolver struct {
	serial string
	err    error
}

func (f fakeDeviceResolver) ResolveSerialForAccess(context.Context, int) (string, error) {
	return f.serial, f.err
}

type fakeSettingsRepository struct{}

func (fakeSettingsRepository) GetByDeviceID(context.Context, int) (device.SettingsProfile, error) {
	return device.SettingsProfile{Video: true, Audio: true, Control: true}, nil
}

type fakeBackend struct {
	startCalled bool
}

func (f *fakeBackend) IsAvailable() bool                                      { return true }
func (f *fakeBackend) ServerPath() string                                     { return "scrcpy-server" }
func (f *fakeBackend) ListEncoders(context.Context, string) ([]string, error) { return nil, nil }
func (f *fakeBackend) ListAudioEncoderOptions(context.Context, string) ([]domainscrcpy.AudioEncoderOption, error) {
	return nil, nil
}
func (f *fakeBackend) ListApps(context.Context, string) ([]domainscrcpy.AppInfo, error) {
	return nil, nil
}
func (f *fakeBackend) StartSession(context.Context, string, domainscrcpy.SessionConfig) (*domainscrcpy.Session, error) {
	f.startCalled = true
	return &domainscrcpy.Session{VideoPort: 27183}, nil
}
func (f *fakeBackend) OpenRuntime(context.Context, *domainscrcpy.Session) (domainscrcpy.Runtime, error) {
	return nil, errors.New("unexpected runtime open")
}

func TestStartRuntimeForWebRTCGatesDeviceAccess(t *testing.T) {
	backend := &fakeBackend{}
	service := NewService(
		fakeDeviceResolver{err: deviceservice.ErrDeviceOffline},
		fakeSettingsRepository{},
		backend,
	)

	_, err := service.StartRuntimeForWebRTC(context.Background(), 1, WebRTCRuntimeOptions{})
	if !errors.Is(err, deviceservice.ErrDeviceOffline) {
		t.Fatalf("expected device offline error, got %v", err)
	}
	if backend.startCalled {
		t.Fatal("expected scrcpy backend not to start for an offline device")
	}
}
