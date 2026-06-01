package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	domainauth "aylink-agent/internal/domain/auth"
)

type fakeAuthService struct {
	identity *domainauth.Identity
	err      error
}

func (f fakeAuthService) ValidateAccessToken(context.Context, string) (*domainauth.Identity, error) {
	return f.identity, f.err
}

func TestAuthRejectsMissingBearerToken(t *testing.T) {
	handler := Auth(fakeAuthService{})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/test", nil)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", recorder.Code)
	}
}

func TestAuthInjectsIdentityIntoContext(t *testing.T) {
	expected := &domainauth.Identity{
		UserID:               7,
		Username:             "tester",
		Permissions:          []string{"devices.view"},
		AccessToken:          "token-value",
		AccessTokenExpiresAt: time.Now().Add(time.Hour),
	}
	handler := Auth(fakeAuthService{identity: expected})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		actual, ok := r.Context().Value(IdentityKey).(*domainauth.Identity)
		if !ok || actual == nil || actual.UserID != expected.UserID {
			t.Fatalf("expected identity to be injected into context")
		}
		w.WriteHeader(http.StatusNoContent)
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/test", nil)
	req.Header.Set("Authorization", "Bearer token-value")
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", recorder.Code)
	}
}

func TestRequirePermissionRejectsMissingPermission(t *testing.T) {
	handler := RequirePermission("devices.manage")(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/test", nil)
	req = req.WithContext(context.WithValue(req.Context(), IdentityKey, &domainauth.Identity{
		UserID:      7,
		Permissions: []string{"devices.view"},
	}))
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", recorder.Code)
	}
}
