package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestVersionHandlerGetReturnsVersionMetadata(t *testing.T) {
	handler := NewVersionHandler("1.2.3", "1.2.3", "v1.2.3")

	req := httptest.NewRequest(http.MethodGet, "/api/app/version", nil)
	recorder := httptest.NewRecorder()

	handler.Get(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", recorder.Code)
	}

	body := recorder.Body.String()
	for _, expected := range []string{
		`"agentVersion":"1.2.3"`,
		`"webVersion":"1.2.3"`,
		`"releaseTag":"v1.2.3"`,
		`"latestReleaseUrl":"https://github.com/5656565566/AYLink.Extra/releases/latest"`,
	} {
		if !strings.Contains(body, expected) {
			t.Fatalf("expected response to contain %s, got %s", expected, body)
		}
	}
}

func TestVersionHandlerRejectsNonGetRequests(t *testing.T) {
	handler := NewVersionHandler("1.2.3", "1.2.3", "v1.2.3")

	req := httptest.NewRequest(http.MethodPost, "/api/app/version", nil)
	recorder := httptest.NewRecorder()

	handler.Get(recorder, req)

	if recorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405, got %d", recorder.Code)
	}
}
