package handler

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	domainsettings "aylink-agent/internal/domain/settings"
)

type fakeSettingsService struct {
	getResult      domainsettings.WebRtcNetworkSettings
	getErr         error
	saveResult     domainsettings.WebRtcNetworkSettings
	saveErr        error
	savedPayload   domainsettings.WebRtcNetworkSettings
	setLanguageErr error
}

func (f *fakeSettingsService) GetLanguage(context.Context) (string, error) { return "", nil }
func (f *fakeSettingsService) SetLanguage(context.Context, string) error   { return f.setLanguageErr }

func (f *fakeSettingsService) GetWebRtcNetworkSettings(context.Context) (domainsettings.WebRtcNetworkSettings, error) {
	return f.getResult, f.getErr
}

func (f *fakeSettingsService) SaveWebRtcNetworkSettings(_ context.Context, settings domainsettings.WebRtcNetworkSettings) (domainsettings.WebRtcNetworkSettings, error) {
	f.savedPayload = settings
	if f.saveErr != nil {
		return domainsettings.WebRtcNetworkSettings{}, f.saveErr
	}
	return f.saveResult, nil
}

func TestSettingsHandlerGetWebRtcNetworkReturnsPayload(t *testing.T) {
	service := &fakeSettingsService{
		getResult: domainsettings.WebRtcNetworkSettings{
			IceTransportPolicy: "relay",
		},
	}
	handler := NewSettingsHandler(service)

	req := httptest.NewRequest(http.MethodGet, "/api/settings/webrtc-network", nil)
	recorder := httptest.NewRecorder()

	handler.GetWebRtcNetwork(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", recorder.Code)
	}
	if !strings.Contains(recorder.Body.String(), `"IceTransportPolicy":"relay"`) {
		t.Fatalf("expected payload body, got %s", recorder.Body.String())
	}
}

func TestSettingsHandlerSaveWebRtcNetworkRejectsInvalidJSON(t *testing.T) {
	service := &fakeSettingsService{}
	handler := NewSettingsHandler(service)

	req := httptest.NewRequest(http.MethodPut, "/api/settings/webrtc-network", strings.NewReader(`{`))
	recorder := httptest.NewRecorder()

	handler.SaveWebRtcNetwork(recorder, req)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", recorder.Code)
	}
}

func TestSettingsHandlerSaveWebRtcNetworkMapsServiceError(t *testing.T) {
	service := &fakeSettingsService{saveErr: errors.New("db failed")}
	handler := NewSettingsHandler(service)

	req := httptest.NewRequest(http.MethodPut, "/api/settings/webrtc-network", strings.NewReader(`{"IceTransportPolicy":"all"}`))
	recorder := httptest.NewRecorder()

	handler.SaveWebRtcNetwork(recorder, req)

	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", recorder.Code)
	}
}
