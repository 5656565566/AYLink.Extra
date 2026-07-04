package handler

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	domainscrcpy "aylink-agent/internal/domain/scrcpy"
	domainwebrtc "aylink-agent/internal/domain/webrtc"
	deviceservice "aylink-agent/internal/service/device"
	scrcpyservice "aylink-agent/internal/service/scrcpy"
	webrtcservice "aylink-agent/internal/service/webrtc"

	"github.com/gorilla/websocket"
)

type fakeWebRTCService struct {
	createTicketResult webrtcservice.CreateTicketResult
	createTicketErr    error
	createTicketInput  webrtcservice.CreateTicketInput
	touchResult        bool
	touchErr           error
	releaseErr         error
	activeLease        bool
	healthSnapshot     domainwebrtc.VideoStreamHealthSnapshot
	healthErr          error
}

func (f *fakeWebRTCService) CreateTicket(_ context.Context, input webrtcservice.CreateTicketInput) (webrtcservice.CreateTicketResult, error) {
	f.createTicketInput = input
	return f.createTicketResult, f.createTicketErr
}

func (f *fakeWebRTCService) TouchSession(context.Context, string, string) (bool, error) {
	return f.touchResult, f.touchErr
}

func (f *fakeWebRTCService) ReleaseSession(context.Context, string, string) error {
	return f.releaseErr
}

func (f *fakeWebRTCService) HasActiveSessionLease(string) bool {
	return f.activeLease
}

func (f *fakeWebRTCService) HasSessionLease(string, string) bool {
	return f.activeLease
}

func (f *fakeWebRTCService) GetVideoStreamHealthSnapshot(string) (domainwebrtc.VideoStreamHealthSnapshot, error) {
	return f.healthSnapshot, f.healthErr
}

func (f *fakeWebRTCService) ConsumeTicket(context.Context, string) (domainwebrtc.Ticket, error) {
	panic("unexpected call")
}

func (f *fakeWebRTCService) MarkSessionStarted(string, string) {}

func (f *fakeWebRTCService) HandleSignalWebSocket(context.Context, string, string, *websocket.Conn, webrtcservice.SettingsProvider, domainscrcpy.Runtime) error {
	panic("unexpected call")
}

type fakeScrcpyRuntimeService struct{}

func (fakeScrcpyRuntimeService) ListEncoders(context.Context, int) ([]string, error) { return nil, nil }
func (fakeScrcpyRuntimeService) ListApps(context.Context, int) ([]domainscrcpy.AppInfo, error) {
	return nil, nil
}
func (fakeScrcpyRuntimeService) StartRuntimeForWebRTC(context.Context, int, scrcpyservice.WebRTCRuntimeOptions) (domainscrcpy.Runtime, error) {
	return nil, nil
}

type fakeHandlerScrcpyRuntime struct {
	closed bool
}

func (f *fakeHandlerScrcpyRuntime) SubscribeVideoPackets() (<-chan domainscrcpy.VideoPacket, func()) {
	ch := make(chan domainscrcpy.VideoPacket)
	close(ch)
	return ch, func() {}
}

func (f *fakeHandlerScrcpyRuntime) SubscribeAudioPackets() (<-chan domainscrcpy.AudioPacket, func()) {
	ch := make(chan domainscrcpy.AudioPacket)
	close(ch)
	return ch, func() {}
}

func (f *fakeHandlerScrcpyRuntime) SubscribeErrors() (<-chan error, func()) {
	ch := make(chan error)
	close(ch)
	return ch, func() {}
}

func (f *fakeHandlerScrcpyRuntime) GetSourceHealth() domainscrcpy.SourceHealthSnapshot {
	return domainscrcpy.SourceHealthSnapshot{}
}

func (f *fakeHandlerScrcpyRuntime) GetClipboardCached() (string, bool) { return "", false }

func (f *fakeHandlerScrcpyRuntime) GetClipboard(context.Context) (string, error) { return "", nil }

func (f *fakeHandlerScrcpyRuntime) SetClipboard(context.Context, string) error { return nil }

func (f *fakeHandlerScrcpyRuntime) PasteClipboard(context.Context, string) error { return nil }

func (f *fakeHandlerScrcpyRuntime) ReplayLatestVideoKeyFrame() bool { return false }

func (f *fakeHandlerScrcpyRuntime) RequestVideoRefresh(options ...domainscrcpy.VideoRefreshOptions) error {
	return nil
}

func (f *fakeHandlerScrcpyRuntime) SendControl([]byte) error { return nil }

func (f *fakeHandlerScrcpyRuntime) Close() error {
	f.closed = true
	return nil
}

type countingScrcpyRuntimeService struct {
	runtime    domainscrcpy.Runtime
	startCount int
}

func (c *countingScrcpyRuntimeService) ListEncoders(context.Context, int) ([]string, error) {
	return nil, nil
}

func (c *countingScrcpyRuntimeService) ListApps(context.Context, int) ([]domainscrcpy.AppInfo, error) {
	return nil, nil
}

func (c *countingScrcpyRuntimeService) StartRuntimeForWebRTC(context.Context, int, scrcpyservice.WebRTCRuntimeOptions) (domainscrcpy.Runtime, error) {
	c.startCount++
	return c.runtime, nil
}

func TestWebRTCHandlerCreateTicketRejectsInvalidJSON(t *testing.T) {
	handler := NewWebRTCHandler(&fakeWebRTCService{}, &fakeSettingsService{}, fakeScrcpyRuntimeService{}, nil)

	req := httptest.NewRequest(http.MethodPost, "/api/webrtc-ticket", strings.NewReader(`{`))
	recorder := httptest.NewRecorder()

	handler.CreateTicket(recorder, req)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", recorder.Code)
	}
}

func TestWebRTCHandlerCreateTicketMapsMissingDeviceID(t *testing.T) {
	handler := NewWebRTCHandler(&fakeWebRTCService{
		createTicketErr: webrtcservice.ErrDeviceIDRequired,
	}, &fakeSettingsService{}, fakeScrcpyRuntimeService{}, nil)

	req := httptest.NewRequest(http.MethodPost, "/api/webrtc-ticket", strings.NewReader(`{"deviceId":" "}`))
	recorder := httptest.NewRecorder()

	handler.CreateTicket(recorder, req)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", recorder.Code)
	}
}

func TestWebRTCHandlerCreateTicketTrimsPayloadAndReturnsResult(t *testing.T) {
	service := &fakeWebRTCService{
		createTicketResult: webrtcservice.CreateTicketResult{
			Ticket:           "ticket-1",
			SessionID:        "session-1",
			ExpiresInSeconds: 60,
		},
	}
	handler := NewWebRTCHandler(service, &fakeSettingsService{}, fakeScrcpyRuntimeService{}, nil)

	req := httptest.NewRequest(http.MethodPost, "/api/webrtc-ticket", strings.NewReader(`{"deviceId":" 123 ","appPackage":" com.demo.app ","appName":" Demo "}`))
	recorder := httptest.NewRecorder()

	handler.CreateTicket(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", recorder.Code)
	}
	if service.createTicketInput.DeviceID != "123" || service.createTicketInput.AppPackage != "com.demo.app" || service.createTicketInput.AppName != "Demo" {
		t.Fatalf("expected trimmed payload, got %+v", service.createTicketInput)
	}
}

func TestWebRTCHandlerHeartbeatMapsSessionIDRequired(t *testing.T) {
	handler := NewWebRTCHandler(&fakeWebRTCService{
		touchErr: webrtcservice.ErrSessionIDRequired,
	}, &fakeSettingsService{}, fakeScrcpyRuntimeService{}, nil)

	req := httptest.NewRequest(http.MethodPost, "/api/scrcpy-sessions/heartbeat", strings.NewReader(`{"deviceId":"1","sessionId":" "}`))
	recorder := httptest.NewRecorder()

	handler.Heartbeat(recorder, req)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", recorder.Code)
	}
}

func TestWebRTCHandlerHeartbeatReturnsSuccessFlag(t *testing.T) {
	handler := NewWebRTCHandler(&fakeWebRTCService{
		touchResult: true,
	}, &fakeSettingsService{}, fakeScrcpyRuntimeService{}, nil)

	req := httptest.NewRequest(http.MethodPost, "/api/scrcpy-sessions/heartbeat", strings.NewReader(`{"deviceId":"1","sessionId":"abc"}`))
	recorder := httptest.NewRecorder()

	handler.Heartbeat(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", recorder.Code)
	}
	if !strings.Contains(recorder.Body.String(), `"success":true`) {
		t.Fatalf("expected success payload, got %s", recorder.Body.String())
	}
}

func TestWebRTCHandlerReleaseMapsDeviceIDRequired(t *testing.T) {
	handler := NewWebRTCHandler(&fakeWebRTCService{
		releaseErr: webrtcservice.ErrDeviceIDRequired,
	}, &fakeSettingsService{}, fakeScrcpyRuntimeService{}, nil)

	req := httptest.NewRequest(http.MethodPost, "/api/scrcpy-sessions/release", strings.NewReader(`{"deviceId":" ","sessionId":"abc"}`))
	recorder := httptest.NewRecorder()

	handler.Release(recorder, req)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", recorder.Code)
	}
}

func TestWebRTCHandlerReleaseReturnsSuccess(t *testing.T) {
	handler := NewWebRTCHandler(&fakeWebRTCService{}, &fakeSettingsService{}, fakeScrcpyRuntimeService{}, nil)
	handler.runtimes["1"] = &managedRuntime{
		deviceID:   "1",
		refCount:   0,
		runtime:    nil,
		lastUsedAt: time.Now(),
	}

	req := httptest.NewRequest(http.MethodPost, "/api/scrcpy-sessions/release", strings.NewReader(`{"deviceId":"1","sessionId":"abc"}`))
	recorder := httptest.NewRecorder()

	handler.Release(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", recorder.Code)
	}
	if !strings.Contains(recorder.Body.String(), `"success":true`) {
		t.Fatalf("expected success payload, got %s", recorder.Body.String())
	}
}

func TestWebRTCHandlerCreateTicketMapsInternalError(t *testing.T) {
	handler := NewWebRTCHandler(&fakeWebRTCService{
		createTicketErr: errors.New("boom"),
	}, &fakeSettingsService{}, fakeScrcpyRuntimeService{}, nil)

	req := httptest.NewRequest(http.MethodPost, "/api/webrtc-ticket", strings.NewReader(`{"deviceId":"1"}`))
	recorder := httptest.NewRecorder()

	handler.CreateTicket(recorder, req)

	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", recorder.Code)
	}
}

func TestWebRTCHandlerVideoHealthRequiresDeviceID(t *testing.T) {
	handler := NewWebRTCHandler(&fakeWebRTCService{}, &fakeSettingsService{}, fakeScrcpyRuntimeService{}, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/scrcpy-sessions/video-health?sessionId=abc", nil)
	recorder := httptest.NewRecorder()

	handler.VideoHealth(recorder, req)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", recorder.Code)
	}
	if !strings.Contains(recorder.Body.String(), `DEVICE_ID_REQUIRED`) {
		t.Fatalf("expected device id error, got %s", recorder.Body.String())
	}
}

func TestWebRTCHandlerVideoHealthMapsMissingSession(t *testing.T) {
	handler := NewWebRTCHandler(&fakeWebRTCService{activeLease: false}, &fakeSettingsService{}, fakeScrcpyRuntimeService{}, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/scrcpy-sessions/video-health?deviceId=1&sessionId=missing", nil)
	recorder := httptest.NewRecorder()

	handler.VideoHealth(recorder, req)

	if recorder.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", recorder.Code)
	}
	if !strings.Contains(recorder.Body.String(), `SESSION_NOT_FOUND`) {
		t.Fatalf("expected session not found error, got %s", recorder.Body.String())
	}
}

func TestWebRTCHandlerVideoHealthReturnsSnapshot(t *testing.T) {
	handler := NewWebRTCHandler(&fakeWebRTCService{
		activeLease: true,
		healthSnapshot: domainwebrtc.VideoStreamHealthSnapshot{
			State:  domainwebrtc.VideoStreamStateObserving,
			Origin: domainwebrtc.VideoStreamHealthOriginSender,
			Reason: "ready",
			Sender: domainwebrtc.VideoSenderDiagnostics{State: "ready", PeerConnected: true},
		},
	}, &fakeSettingsService{}, fakeScrcpyRuntimeService{}, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/scrcpy-sessions/video-health?deviceId=1&sessionId=abc", nil)
	recorder := httptest.NewRecorder()

	handler.VideoHealth(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", recorder.Code)
	}
	body := recorder.Body.String()
	if !strings.Contains(body, `"state":"observing"`) || !strings.Contains(body, `"origin":"sender"`) || !strings.Contains(body, `"peerConnected":true`) {
		t.Fatalf("expected health snapshot payload, got %s", body)
	}
}

func TestSignalScrcpyStartErrorMapsDeviceOffline(t *testing.T) {
	code, messageKey, message := signalScrcpyStartError(deviceservice.ErrDeviceOffline)

	if code != "DEVICE_OFFLINE" || messageKey != "Devices.Offline" || message == "" {
		t.Fatalf("expected device offline signal mapping, got code=%q messageKey=%q message=%q", code, messageKey, message)
	}
}

func TestWebRTCHandlerAcquireRuntimeDoesNotReuseIdleRuntimeForNewSession(t *testing.T) {
	options := scrcpyservice.WebRTCRuntimeOptions{}
	oldRuntime := &fakeHandlerScrcpyRuntime{}
	newRuntime := &fakeHandlerScrcpyRuntime{}
	scrcpyService := &countingScrcpyRuntimeService{runtime: newRuntime}
	handler := NewWebRTCHandler(&fakeWebRTCService{}, &fakeSettingsService{}, scrcpyService, nil)
	handler.runtimes["1"] = &managedRuntime{
		deviceID:    "1",
		signature:   buildRuntimeSignature("1", options),
		sessionRefs: map[string]int{},
		runtime:     oldRuntime,
		refCount:    0,
		lastUsedAt:  time.Now(),
	}

	runtime, created, err := handler.acquireRuntime(context.Background(), "1", "new-session", 1, options)
	if err != nil {
		t.Fatalf("acquire runtime: %v", err)
	}
	if !created {
		t.Fatalf("expected a fresh runtime for a new session")
	}
	if runtime != newRuntime {
		t.Fatalf("expected new runtime to be returned")
	}
	if !oldRuntime.closed {
		t.Fatalf("expected idle runtime from another session to be closed")
	}
	if scrcpyService.startCount != 1 {
		t.Fatalf("expected one new runtime start, got %d", scrcpyService.startCount)
	}
}

func TestWebRTCHandlerAcquireRuntimeReusesIdleRuntimeForSameLeasedSession(t *testing.T) {
	options := scrcpyservice.WebRTCRuntimeOptions{}
	oldRuntime := &fakeHandlerScrcpyRuntime{}
	scrcpyService := &countingScrcpyRuntimeService{runtime: &fakeHandlerScrcpyRuntime{}}
	handler := NewWebRTCHandler(&fakeWebRTCService{activeLease: true}, &fakeSettingsService{}, scrcpyService, nil)
	handler.runtimes["1"] = &managedRuntime{
		deviceID:    "1",
		signature:   buildRuntimeSignature("1", options),
		sessionRefs: map[string]int{},
		runtime:     oldRuntime,
		refCount:    0,
		lastUsedAt:  time.Now(),
	}

	runtime, created, err := handler.acquireRuntime(context.Background(), "1", "same-session", 1, options)
	if err != nil {
		t.Fatalf("acquire runtime: %v", err)
	}
	if created {
		t.Fatalf("expected leased session to reuse idle runtime")
	}
	if runtime != oldRuntime {
		t.Fatalf("expected old runtime to be reused")
	}
	if oldRuntime.closed {
		t.Fatalf("expected leased runtime to stay open")
	}
	if scrcpyService.startCount != 0 {
		t.Fatalf("expected no new runtime start, got %d", scrcpyService.startCount)
	}
}

func TestWebRTCHandlerAcquireRuntimeStopsWaitingWhenContextCancels(t *testing.T) {
	handler := NewWebRTCHandler(&fakeWebRTCService{}, &fakeSettingsService{}, &countingScrcpyRuntimeService{}, nil)
	handler.runtimes["1"] = &managedRuntime{
		deviceID: "1",
		starting: true,
		ready:    make(chan struct{}),
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, _, err := handler.acquireRuntime(ctx, "1", "session-1", 1, scrcpyservice.WebRTCRuntimeOptions{})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context canceled while waiting for runtime start, got %v", err)
	}
}
