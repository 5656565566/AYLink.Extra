package handler

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	domainauth "aylink-agent/internal/domain/auth"
	domaindevice "aylink-agent/internal/domain/device"
	domainscrcpy "aylink-agent/internal/domain/scrcpy"
	appservice "aylink-agent/internal/service/app"
	deviceservice "aylink-agent/internal/service/device"
	fileservice "aylink-agent/internal/service/file"
	scrcpyservice "aylink-agent/internal/service/scrcpy"
	"aylink-agent/internal/transport/http/middleware"
)

type fakeDeviceService struct {
	listResult    []domaindevice.Device
	listErr       error
	createInput   deviceservice.CreateInput
	createResult  *domaindevice.Device
	createErr     error
	connectResult *domaindevice.Device
	connectErr    error
}

func (f *fakeDeviceService) List(context.Context) ([]domaindevice.Device, error) {
	return f.listResult, f.listErr
}

func (f *fakeDeviceService) Create(_ context.Context, input deviceservice.CreateInput) (*domaindevice.Device, error) {
	f.createInput = input
	return f.createResult, f.createErr
}

func (f *fakeDeviceService) Delete(context.Context, int) error { return nil }
func (f *fakeDeviceService) Connect(context.Context, int) (*domaindevice.Device, error) {
	return f.connectResult, f.connectErr
}
func (f *fakeDeviceService) Rename(context.Context, int, string) (*domaindevice.Device, error) {
	return nil, nil
}

type fakeDeviceSettingsService struct{}

func (fakeDeviceSettingsService) GetByDeviceID(context.Context, int) (domaindevice.SettingsProfile, error) {
	return domaindevice.SettingsProfile{}, nil
}
func (fakeDeviceSettingsService) SaveByDeviceID(context.Context, int, domaindevice.SettingsProfile) (domaindevice.SettingsProfile, error) {
	return domaindevice.SettingsProfile{}, nil
}
func (fakeDeviceSettingsService) ResetByDeviceID(context.Context, int) (domaindevice.SettingsProfile, error) {
	return domaindevice.SettingsProfile{}, nil
}

type fakeAppService struct{}

func (fakeAppService) Launch(context.Context, int, string) error { return nil }
func (fakeAppService) Download(context.Context, int, string) (*appservice.DownloadResult, error) {
	panic("unexpected call")
}
func (fakeAppService) Info(context.Context, int, string) (*appservice.AppInfoResult, error) {
	panic("unexpected call")
}
func (fakeAppService) Uninstall(context.Context, int, string) error { return nil }
func (fakeAppService) Install(context.Context, int, string, io.Reader) error {
	return nil
}

type fakeFileService struct{}
type fakeScrcpyService struct{}
type fakeDevicePreviewService struct {
	lastWidth int
}
type fakeDeviceAccessService struct {
	allowed bool
	err     error
}

func (fakeFileService) List(context.Context, int, string) (*fileservice.ListResult, error) {
	panic("unexpected call")
}
func (fakeFileService) Download(context.Context, int, string) (*fileservice.DownloadResult, error) {
	panic("unexpected call")
}
func (fakeFileService) Rename(context.Context, int, string, string) error { return nil }
func (fakeFileService) Delete(context.Context, int, string) error         { return nil }

func (f fakeDeviceAccessService) CanAccessDevice(context.Context, *domainauth.Identity, int) (bool, error) {
	return f.allowed, f.err
}

func (f fakeDeviceAccessService) FilterDevices(_ context.Context, _ *domainauth.Identity, devices []domaindevice.Device) ([]domaindevice.Device, error) {
	return devices, f.err
}

func (fakeScrcpyService) ListEncoders(context.Context, int) ([]string, error) { return nil, nil }
func (fakeScrcpyService) ListApps(context.Context, int) ([]domainscrcpy.AppInfo, error) {
	return nil, nil
}
func (fakeScrcpyService) StartRuntimeForWebRTC(context.Context, int, scrcpyservice.WebRTCRuntimeOptions) (domainscrcpy.Runtime, error) {
	return nil, nil
}

func (f *fakeDevicePreviewService) Get(_ context.Context, _ int, width int) ([]byte, error) {
	f.lastWidth = width
	return []byte("preview"), nil
}

func TestDeviceHandlerListReturnsDevices(t *testing.T) {
	service := &fakeDeviceService{
		listResult: []domaindevice.Device{{ID: 1, Name: "Pixel", Serial: "serial-1"}},
	}
	handler := NewDeviceHandler(service, nil, nil, &fakeDevicePreviewService{}, fakeAppService{}, fakeFileService{}, fakeDeviceSettingsService{}, fakeScrcpyService{})

	req := httptest.NewRequest(http.MethodGet, "/api/devices", nil)
	recorder := httptest.NewRecorder()

	handler.List(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", recorder.Code)
	}
	if !strings.Contains(recorder.Body.String(), `"Name":"Pixel"`) {
		t.Fatalf("expected device list payload, got %s", recorder.Body.String())
	}
}

func TestDeviceHandlerCreateMapsDomainValidationError(t *testing.T) {
	service := &fakeDeviceService{createErr: deviceservice.ErrDeviceSerialEmpty}
	handler := NewDeviceHandler(service, nil, nil, &fakeDevicePreviewService{}, fakeAppService{}, fakeFileService{}, fakeDeviceSettingsService{}, fakeScrcpyService{})

	req := httptest.NewRequest(http.MethodPost, "/api/devices", strings.NewReader(`{"Name":"Pixel"}`))
	recorder := httptest.NewRecorder()

	handler.Create(recorder, req)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", recorder.Code)
	}
	if !strings.Contains(recorder.Body.String(), `DEVICE_SERIAL_REQUIRED`) {
		t.Fatalf("expected serial-required error, got %s", recorder.Body.String())
	}
}

func TestDeviceHandlerCreatePassesPayloadToService(t *testing.T) {
	service := &fakeDeviceService{
		createResult: &domaindevice.Device{ID: 2, Name: "Pixel", Serial: "serial-2"},
	}
	handler := NewDeviceHandler(service, nil, nil, &fakeDevicePreviewService{}, fakeAppService{}, fakeFileService{}, fakeDeviceSettingsService{}, fakeScrcpyService{})

	req := httptest.NewRequest(http.MethodPost, "/api/devices", strings.NewReader(`{"Serial":"serial-2","Name":"Pixel","PairingPort":1234,"PairingCode":"654321"}`))
	recorder := httptest.NewRecorder()

	handler.Create(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", recorder.Code)
	}
	if service.createInput.Serial != "serial-2" || service.createInput.Name != "Pixel" || service.createInput.PairingPort != 1234 || service.createInput.PairingCode != "654321" {
		t.Fatalf("expected payload to be forwarded, got %+v", service.createInput)
	}
}

func TestDeviceHandlerConnectReturnsInternalServerErrorForUnexpectedFailure(t *testing.T) {
	service := &fakeDeviceService{
		connectErr: errors.New("adb connect failed"),
	}
	handler := NewDeviceHandler(service, nil, nil, &fakeDevicePreviewService{}, fakeAppService{}, fakeFileService{}, fakeDeviceSettingsService{}, fakeScrcpyService{})

	req := httptest.NewRequest(http.MethodPost, "/api/devices/connect/7", nil)
	recorder := httptest.NewRecorder()

	handler.Connect(recorder, req)

	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", recorder.Code)
	}
	if !strings.Contains(recorder.Body.String(), `DEVICE_CONNECT_FAILED`) {
		t.Fatalf("expected device connect failure payload, got %s", recorder.Body.String())
	}
}

func TestDeviceHandlerPreviewPassesWidthFromQuery(t *testing.T) {
	previewService := &fakeDevicePreviewService{}
	handler := NewDeviceHandler(&fakeDeviceService{}, nil, nil, previewService, fakeAppService{}, fakeFileService{}, fakeDeviceSettingsService{}, fakeScrcpyService{})

	req := httptest.NewRequest(http.MethodGet, "/api/devices/7/preview?width=320", nil)
	recorder := httptest.NewRecorder()

	handler.Preview(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", recorder.Code)
	}
	if previewService.lastWidth != 320 {
		t.Fatalf("expected preview width 320, got %d", previewService.lastWidth)
	}
}

func TestDeviceHandlerPreviewRejectsInvalidWidth(t *testing.T) {
	previewService := &fakeDevicePreviewService{}
	handler := NewDeviceHandler(&fakeDeviceService{}, nil, nil, previewService, fakeAppService{}, fakeFileService{}, fakeDeviceSettingsService{}, fakeScrcpyService{})

	req := httptest.NewRequest(http.MethodGet, "/api/devices/7/preview?width=0", nil)
	recorder := httptest.NewRecorder()

	handler.Preview(recorder, req)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", recorder.Code)
	}
	if previewService.lastWidth != 0 {
		t.Fatalf("expected preview service not to be called, got width %d", previewService.lastWidth)
	}
}

func TestDeviceHandlerDeleteFileRejectsInaccessibleDevice(t *testing.T) {
	handler := NewDeviceHandler(
		&fakeDeviceService{},
		fakeDeviceAccessService{allowed: false},
		nil,
		&fakeDevicePreviewService{},
		fakeAppService{},
		fakeFileService{},
		fakeDeviceSettingsService{},
		fakeScrcpyService{},
	)

	req := httptest.NewRequest(http.MethodPost, "/api/devices/7/files/delete", strings.NewReader(`{"path":"/sdcard/test.txt"}`))
	req = req.WithContext(context.WithValue(req.Context(), middleware.IdentityKey, &domainauth.Identity{UserID: 1}))
	recorder := httptest.NewRecorder()

	handler.DeleteFile(recorder, req)

	if recorder.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", recorder.Code)
	}
	if !strings.Contains(recorder.Body.String(), `DEVICE_NOT_FOUND`) {
		t.Fatalf("expected device not found payload, got %s", recorder.Body.String())
	}
}
