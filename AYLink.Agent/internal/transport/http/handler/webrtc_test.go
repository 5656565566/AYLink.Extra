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

func TestWebRTCHandlerCreateTicketRejectsInvalidJSON(t *testing.T) {
	handler := NewWebRTCHandler(&fakeWebRTCService{}, &fakeSettingsService{}, fakeScrcpyRuntimeService{})

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
	}, &fakeSettingsService{}, fakeScrcpyRuntimeService{})

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
	handler := NewWebRTCHandler(service, &fakeSettingsService{}, fakeScrcpyRuntimeService{})

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
	}, &fakeSettingsService{}, fakeScrcpyRuntimeService{})

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
	}, &fakeSettingsService{}, fakeScrcpyRuntimeService{})

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
	}, &fakeSettingsService{}, fakeScrcpyRuntimeService{})

	req := httptest.NewRequest(http.MethodPost, "/api/scrcpy-sessions/release", strings.NewReader(`{"deviceId":" ","sessionId":"abc"}`))
	recorder := httptest.NewRecorder()

	handler.Release(recorder, req)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", recorder.Code)
	}
}

func TestWebRTCHandlerReleaseReturnsSuccess(t *testing.T) {
	handler := NewWebRTCHandler(&fakeWebRTCService{}, &fakeSettingsService{}, fakeScrcpyRuntimeService{})
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
	}, &fakeSettingsService{}, fakeScrcpyRuntimeService{})

	req := httptest.NewRequest(http.MethodPost, "/api/webrtc-ticket", strings.NewReader(`{"deviceId":"1"}`))
	recorder := httptest.NewRecorder()

	handler.CreateTicket(recorder, req)

	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", recorder.Code)
	}
}
