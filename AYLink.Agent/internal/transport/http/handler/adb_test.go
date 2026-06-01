package handler

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	adberrors "aylink-agent/internal/infra/adb"
	adbservice "aylink-agent/internal/service/adb"
)

type fakeADBService struct {
	startServerCalled bool
	pairHost          string
	pairPort          int
	pairCode          string
	statusErr         error
	startErr          error
	pairErr           error
}

func (f *fakeADBService) Status(context.Context) (adbservice.StatusResponse, error) {
	return adbservice.StatusResponse{}, f.statusErr
}

func (f *fakeADBService) StartServer(context.Context) error {
	f.startServerCalled = true
	return f.startErr
}

func (f *fakeADBService) KillServer(context.Context) error { return nil }

func (f *fakeADBService) Pair(_ context.Context, host string, port int, code string) (string, error) {
	f.pairHost = host
	f.pairPort = port
	f.pairCode = code
	return "", f.pairErr
}

func TestADBHandlerPairRejectsMissingFields(t *testing.T) {
	service := &fakeADBService{}
	handler := NewADBHandler(service)

	req := httptest.NewRequest(http.MethodPost, "/api/adb/pair", strings.NewReader(`{"host":"127.0.0.1"}`))
	recorder := httptest.NewRecorder()

	handler.Pair(recorder, req)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", recorder.Code)
	}
	if service.startServerCalled {
		t.Fatal("expected StartServer not to be called when fields are missing")
	}
}

func TestADBHandlerPairStartsServerAndPairs(t *testing.T) {
	service := &fakeADBService{}
	handler := NewADBHandler(service)

	req := httptest.NewRequest(http.MethodPost, "/api/adb/pair", strings.NewReader(`{"host":"127.0.0.1","pairingPort":5555,"pairingCode":"123456"}`))
	recorder := httptest.NewRecorder()

	handler.Pair(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", recorder.Code)
	}
	if !service.startServerCalled {
		t.Fatal("expected StartServer to be called before pairing")
	}
	if service.pairHost != "127.0.0.1" || service.pairPort != 5555 || service.pairCode != "123456" {
		t.Fatalf("expected pair args to be forwarded, got host=%s port=%d code=%s", service.pairHost, service.pairPort, service.pairCode)
	}
}

func TestADBHandlerStatusMapsBinaryNotFound(t *testing.T) {
	service := &fakeADBService{statusErr: adberrors.ErrBinaryNotFound}
	handler := NewADBHandler(service)

	req := httptest.NewRequest(http.MethodGet, "/api/adb/status", nil)
	recorder := httptest.NewRecorder()

	handler.Status(recorder, req)

	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", recorder.Code)
	}
	if !strings.Contains(recorder.Body.String(), "ADB_BINARY_NOT_FOUND") {
		t.Fatalf("expected binary-not-found error body, got %s", recorder.Body.String())
	}
}

func TestADBHandlerPairReportsPairFailure(t *testing.T) {
	service := &fakeADBService{pairErr: errors.New("pair failed")}
	handler := NewADBHandler(service)

	req := httptest.NewRequest(http.MethodPost, "/api/adb/pair", strings.NewReader(`{"host":"127.0.0.1","pairingPort":5555,"pairingCode":"123456"}`))
	recorder := httptest.NewRecorder()

	handler.Pair(recorder, req)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", recorder.Code)
	}
	if !strings.Contains(recorder.Body.String(), `"success":false`) {
		t.Fatalf("expected failure payload, got %s", recorder.Body.String())
	}
}
