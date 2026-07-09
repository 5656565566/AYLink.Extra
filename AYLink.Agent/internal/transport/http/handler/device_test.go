package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
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
	getResult     *domaindevice.Device
	getErr        error
	createInput   deviceservice.CreateInput
	createResult  *domaindevice.Device
	createErr     error
	connectResult *domaindevice.Device
	connectErr    error
}

func (f *fakeDeviceService) List(context.Context) ([]domaindevice.Device, error) {
	return f.listResult, f.listErr
}

func (f *fakeDeviceService) GetByID(context.Context, int) (*domaindevice.Device, error) {
	return f.getResult, f.getErr
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

type recordingAppService struct {
	installDeviceID int
	installFileName string
	installContent  string
	installErr      error
}

func (recordingAppService) Launch(context.Context, int, string) error { return nil }
func (recordingAppService) Download(context.Context, int, string) (*appservice.DownloadResult, error) {
	panic("unexpected call")
}
func (recordingAppService) Info(context.Context, int, string) (*appservice.AppInfoResult, error) {
	panic("unexpected call")
}
func (recordingAppService) Uninstall(context.Context, int, string) error { return nil }
func (f *recordingAppService) Install(_ context.Context, deviceID int, fileName string, reader io.Reader) error {
	f.installDeviceID = deviceID
	f.installFileName = fileName
	content, err := io.ReadAll(reader)
	if err != nil {
		return err
	}
	f.installContent = string(content)
	return f.installErr
}

type fakeFileService struct{}
type recordingFileService struct {
	uploadDeviceID     int
	uploadDirectory    string
	uploadRelativePath string
	uploadFallbackName string
	uploadContent      string
	uploadErr          error
	downloadDeviceID   int
	downloadPath       string
	downloadName       string
	downloadContent    string
	downloadErr        error
}
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
func (fakeFileService) Upload(context.Context, int, string, string, string, io.Reader) error {
	panic("unexpected call")
}
func (fakeFileService) Rename(context.Context, int, string, string) error { return nil }
func (fakeFileService) Delete(context.Context, int, string) error         { return nil }

func (recordingFileService) List(context.Context, int, string) (*fileservice.ListResult, error) {
	panic("unexpected call")
}
func (f *recordingFileService) Download(_ context.Context, deviceID int, path string) (*fileservice.DownloadResult, error) {
	f.downloadDeviceID = deviceID
	f.downloadPath = path
	if f.downloadErr != nil {
		return nil, f.downloadErr
	}
	name := f.downloadName
	if name == "" {
		name = "download.bin"
	}
	return &fileservice.DownloadResult{
		Name:   name,
		Reader: io.NopCloser(strings.NewReader(f.downloadContent)),
	}, nil
}
func (f *recordingFileService) Upload(_ context.Context, deviceID int, directory string, relativePath string, fallbackName string, reader io.Reader) error {
	f.uploadDeviceID = deviceID
	f.uploadDirectory = directory
	f.uploadRelativePath = relativePath
	f.uploadFallbackName = fallbackName
	content, err := io.ReadAll(reader)
	if err != nil {
		return err
	}
	f.uploadContent = string(content)
	return f.uploadErr
}
func (recordingFileService) Rename(context.Context, int, string, string) error {
	panic("unexpected call")
}
func (recordingFileService) Delete(context.Context, int, string) error {
	panic("unexpected call")
}

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

func TestDeviceHandlerGetReturnsDevice(t *testing.T) {
	service := &fakeDeviceService{
		getResult: &domaindevice.Device{ID: 7, Name: "Pixel", Serial: "serial-1", Status: "online"},
	}
	handler := NewDeviceHandler(service, fakeDeviceAccessService{allowed: true}, nil, &fakeDevicePreviewService{}, fakeAppService{}, fakeFileService{}, fakeDeviceSettingsService{}, fakeScrcpyService{})

	req := httptest.NewRequest(http.MethodGet, "/api/devices/7", nil)
	req = req.WithContext(context.WithValue(req.Context(), middleware.IdentityKey, &domainauth.Identity{UserID: 1}))
	recorder := httptest.NewRecorder()

	handler.Get(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", recorder.Code)
	}
	if !strings.Contains(recorder.Body.String(), `"Status":"online"`) {
		t.Fatalf("expected device payload, got %s", recorder.Body.String())
	}
}

func TestDeviceHandlerGetReturnsNotFound(t *testing.T) {
	handler := NewDeviceHandler(&fakeDeviceService{}, fakeDeviceAccessService{allowed: true}, nil, &fakeDevicePreviewService{}, fakeAppService{}, fakeFileService{}, fakeDeviceSettingsService{}, fakeScrcpyService{})

	req := httptest.NewRequest(http.MethodGet, "/api/devices/7", nil)
	req = req.WithContext(context.WithValue(req.Context(), middleware.IdentityKey, &domainauth.Identity{UserID: 1}))
	recorder := httptest.NewRecorder()

	handler.Get(recorder, req)

	if recorder.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", recorder.Code)
	}
	if !strings.Contains(recorder.Body.String(), `DEVICE_NOT_FOUND`) {
		t.Fatalf("expected not found payload, got %s", recorder.Body.String())
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

func TestDeviceHandlerInstallAppStreamsMultipartPartToService(t *testing.T) {
	appService := &recordingAppService{}
	handler := NewDeviceHandler(
		&fakeDeviceService{},
		fakeDeviceAccessService{allowed: true},
		nil,
		&fakeDevicePreviewService{},
		appService,
		fakeFileService{},
		fakeDeviceSettingsService{},
		fakeScrcpyService{},
	)
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	field, err := writer.CreateFormField("ignored")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := field.Write([]byte("metadata")); err != nil {
		t.Fatal(err)
	}
	filePart, err := writer.CreateFormFile("file", "demo.apk")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := filePart.Write([]byte("apk-content")); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/devices/7/apps/install", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req = req.WithContext(context.WithValue(req.Context(), middleware.IdentityKey, &domainauth.Identity{UserID: 1}))
	recorder := httptest.NewRecorder()

	handler.InstallApp(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", recorder.Code, recorder.Body.String())
	}
	if appService.installDeviceID != 7 || appService.installFileName != "demo.apk" || appService.installContent != "apk-content" {
		t.Fatalf("expected install payload to be streamed, got device=%d name=%q content=%q", appService.installDeviceID, appService.installFileName, appService.installContent)
	}
	if req.MultipartForm != nil && (len(req.MultipartForm.Value) > 0 || len(req.MultipartForm.File) > 0) {
		t.Fatalf("expected streaming multipart reader to avoid cached form data, got %+v", req.MultipartForm)
	}
}

func TestDeviceHandlerInstallAppRequiresFilePart(t *testing.T) {
	handler := NewDeviceHandler(
		&fakeDeviceService{},
		fakeDeviceAccessService{allowed: true},
		nil,
		&fakeDevicePreviewService{},
		fakeAppService{},
		fakeFileService{},
		fakeDeviceSettingsService{},
		fakeScrcpyService{},
	)
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	field, err := writer.CreateFormField("ignored")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := field.Write([]byte("metadata")); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/devices/7/apps/install", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req = req.WithContext(context.WithValue(req.Context(), middleware.IdentityKey, &domainauth.Identity{UserID: 1}))
	recorder := httptest.NewRecorder()

	handler.InstallApp(recorder, req)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", recorder.Code)
	}
	if !strings.Contains(recorder.Body.String(), `APP_FILE_REQUIRED`) {
		t.Fatalf("expected file-required payload, got %s", recorder.Body.String())
	}
}

func TestDeviceHandlerUploadFileStreamsMultipartPartToService(t *testing.T) {
	fileService := &recordingFileService{}
	handler := NewDeviceHandler(
		&fakeDeviceService{},
		fakeDeviceAccessService{allowed: true},
		nil,
		&fakeDevicePreviewService{},
		fakeAppService{},
		fileService,
		fakeDeviceSettingsService{},
		fakeScrcpyService{},
	)
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	field, err := writer.CreateFormField("ignored")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := field.Write([]byte("metadata")); err != nil {
		t.Fatal(err)
	}
	filePart, err := writer.CreateFormFile("file", "photo.png")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := filePart.Write([]byte("image-content")); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/devices/7/files/upload?path=/sdcard/Download/&relativePath=Album/photo.png", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req = req.WithContext(context.WithValue(req.Context(), middleware.IdentityKey, &domainauth.Identity{UserID: 1}))
	recorder := httptest.NewRecorder()

	handler.UploadFile(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", recorder.Code, recorder.Body.String())
	}
	if fileService.uploadDeviceID != 7 || fileService.uploadDirectory != "/sdcard/Download/" || fileService.uploadRelativePath != "Album/photo.png" || fileService.uploadFallbackName != "photo.png" || fileService.uploadContent != "image-content" {
		t.Fatalf("expected upload payload to be streamed, got device=%d directory=%q relative=%q fallback=%q content=%q", fileService.uploadDeviceID, fileService.uploadDirectory, fileService.uploadRelativePath, fileService.uploadFallbackName, fileService.uploadContent)
	}
	if req.MultipartForm != nil && (len(req.MultipartForm.Value) > 0 || len(req.MultipartForm.File) > 0) {
		t.Fatalf("expected streaming multipart reader to avoid cached form data, got %+v", req.MultipartForm)
	}
}

func TestDeviceHandlerFileDownloadTicketIsSingleUse(t *testing.T) {
	fileService := &recordingFileService{
		downloadName:    "report.txt",
		downloadContent: "file-content",
	}
	handler := NewDeviceHandler(
		&fakeDeviceService{},
		fakeDeviceAccessService{allowed: true},
		nil,
		&fakeDevicePreviewService{},
		fakeAppService{},
		fileService,
		fakeDeviceSettingsService{},
		fakeScrcpyService{},
	)

	req := httptest.NewRequest(http.MethodPost, "/api/devices/7/files/download-ticket", strings.NewReader(`{"path":"/sdcard/report.txt"}`))
	req = req.WithContext(context.WithValue(req.Context(), middleware.IdentityKey, &domainauth.Identity{UserID: 1}))
	recorder := httptest.NewRecorder()

	handler.CreateFileDownloadTicket(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", recorder.Code, recorder.Body.String())
	}
	var payload FileDownloadTicketResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Ticket == "" || payload.URL == "" || payload.ExpiresAt == "" {
		t.Fatalf("expected ticket payload, got %+v", payload)
	}

	downloadReq := httptest.NewRequest(http.MethodGet, payload.URL, nil)
	downloadRecorder := httptest.NewRecorder()
	handler.DownloadFileByTicket(downloadRecorder, downloadReq)

	if downloadRecorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", downloadRecorder.Code, downloadRecorder.Body.String())
	}
	if downloadRecorder.Body.String() != "file-content" {
		t.Fatalf("expected downloaded content, got %q", downloadRecorder.Body.String())
	}
	if fileService.downloadDeviceID != 7 || fileService.downloadPath != "/sdcard/report.txt" {
		t.Fatalf("expected ticket download target, got device=%d path=%q", fileService.downloadDeviceID, fileService.downloadPath)
	}

	reuseRecorder := httptest.NewRecorder()
	handler.DownloadFileByTicket(reuseRecorder, downloadReq)
	if reuseRecorder.Code != http.StatusNotFound {
		t.Fatalf("expected consumed ticket to return 404, got %d", reuseRecorder.Code)
	}
}

func TestDeviceHandlerUploadFileRequiresFilePart(t *testing.T) {
	handler := NewDeviceHandler(
		&fakeDeviceService{},
		fakeDeviceAccessService{allowed: true},
		nil,
		&fakeDevicePreviewService{},
		fakeAppService{},
		&recordingFileService{},
		fakeDeviceSettingsService{},
		fakeScrcpyService{},
	)
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	field, err := writer.CreateFormField("ignored")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := field.Write([]byte("metadata")); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/devices/7/files/upload?path=/sdcard/Download/", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req = req.WithContext(context.WithValue(req.Context(), middleware.IdentityKey, &domainauth.Identity{UserID: 1}))
	recorder := httptest.NewRecorder()

	handler.UploadFile(recorder, req)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", recorder.Code)
	}
	if !strings.Contains(recorder.Body.String(), `FILE_UPLOAD_REQUIRED`) {
		t.Fatalf("expected file-required payload, got %s", recorder.Body.String())
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
