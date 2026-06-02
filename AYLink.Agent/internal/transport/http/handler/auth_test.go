package handler

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	domainauth "aylink-agent/internal/domain/auth"
	authservice "aylink-agent/internal/service/auth"
	"aylink-agent/internal/transport/http/middleware"
)

type fakeAuthHandlerService struct {
	loginResult      *domainauth.LoginResult
	loginErr         error
	loginUser        string
	loginPass        string
	refreshResult    *domainauth.LoginResult
	refreshErr       error
	currentUser      *domainauth.User
	currentUserErr   error
	currentUserToken string
	logoutErr        error
	logoutAllErr     error
	logoutAccess     string
	logoutRefresh    string
	logoutAllUserID  int
}

func (f *fakeAuthHandlerService) Login(_ context.Context, username, password string) (*domainauth.LoginResult, error) {
	f.loginUser = username
	f.loginPass = password
	return f.loginResult, f.loginErr
}

func (f *fakeAuthHandlerService) Refresh(_ context.Context, refreshToken string) (*domainauth.LoginResult, error) {
	f.logoutRefresh = refreshToken
	return f.refreshResult, f.refreshErr
}
func (f *fakeAuthHandlerService) CurrentUser(_ context.Context, accessToken string) (*domainauth.User, error) {
	f.currentUserToken = accessToken
	return f.currentUser, f.currentUserErr
}
func (f *fakeAuthHandlerService) Logout(_ context.Context, accessToken, refreshToken string) error {
	f.logoutAccess = accessToken
	f.logoutRefresh = refreshToken
	return f.logoutErr
}
func (f *fakeAuthHandlerService) ChangeOwnPassword(context.Context, int, string, string) error {
	panic("unexpected call")
}
func (f *fakeAuthHandlerService) LogoutAll(_ context.Context, userID int) error {
	f.logoutAllUserID = userID
	return f.logoutAllErr
}
func (f *fakeAuthHandlerService) GetUsers(context.Context) ([]domainauth.User, error) {
	panic("unexpected call")
}
func (f *fakeAuthHandlerService) CreateUser(context.Context, string, string, []int, []int) (*domainauth.User, error) {
	panic("unexpected call")
}
func (f *fakeAuthHandlerService) UpdateUser(context.Context, int, string, bool, []int, []int, *int) (*domainauth.User, error) {
	panic("unexpected call")
}
func (f *fakeAuthHandlerService) DeleteUser(context.Context, int, *int) error {
	panic("unexpected call")
}
func (f *fakeAuthHandlerService) ResetPassword(context.Context, int, string) (string, error) {
	panic("unexpected call")
}
func (f *fakeAuthHandlerService) SetUserActiveState(context.Context, int, bool, *int) error {
	panic("unexpected call")
}
func (f *fakeAuthHandlerService) GetRoles(context.Context) ([]domainauth.Role, error) {
	panic("unexpected call")
}
func (f *fakeAuthHandlerService) CreateRole(context.Context, string, string, []string, []int) (*domainauth.Role, error) {
	panic("unexpected call")
}
func (f *fakeAuthHandlerService) UpdateRole(context.Context, int, string, string, []string, []int) (*domainauth.Role, error) {
	panic("unexpected call")
}
func (f *fakeAuthHandlerService) GetAvailablePermissions() []domainauth.PermissionDescriptor {
	panic("unexpected call")
}

func TestAuthHandlerLoginUsesInjectedInterface(t *testing.T) {
	service := &fakeAuthHandlerService{
		loginResult: &domainauth.LoginResult{
			Success:               true,
			AccessToken:           "access-token",
			AccessTokenExpiresAt:  time.Now().Add(time.Hour),
			RefreshToken:          "refresh-token",
			RefreshTokenExpiresAt: time.Now().Add(24 * time.Hour),
			User: domainauth.User{
				ID:       1,
				Username: "tester",
			},
		},
	}
	handler := NewAuthHandler(service)

	req := httptest.NewRequest(http.MethodPost, "/api/login", strings.NewReader(`{"username":"tester","password":"secret"}`))
	recorder := httptest.NewRecorder()

	handler.Login(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", recorder.Code)
	}
	if service.loginUser != "tester" || service.loginPass != "secret" {
		t.Fatalf("expected injected service to receive login credentials")
	}
	if !strings.Contains(recorder.Body.String(), `"accessToken":"access-token"`) {
		t.Fatalf("expected response body to contain login result, got %s", recorder.Body.String())
	}
}

func TestAuthHandlerLoginReturnsUnauthorizedForInvalidCredentials(t *testing.T) {
	service := &fakeAuthHandlerService{loginErr: authservice.ErrInvalidCredentials}
	handler := NewAuthHandler(service)

	req := httptest.NewRequest(http.MethodPost, "/api/login", strings.NewReader(`{"username":"tester","password":"bad"}`))
	recorder := httptest.NewRecorder()

	handler.Login(recorder, req)

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", recorder.Code)
	}
}

func TestAuthHandlerLoginReturnsInternalServerErrorForUnexpectedFailure(t *testing.T) {
	service := &fakeAuthHandlerService{loginErr: errors.New("database locked")}
	handler := NewAuthHandler(service)

	req := httptest.NewRequest(http.MethodPost, "/api/login", strings.NewReader(`{"username":"tester","password":"secret"}`))
	recorder := httptest.NewRecorder()

	handler.Login(recorder, req)

	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", recorder.Code)
	}
}

func TestAuthHandlerRefreshReturnsUnauthorizedForInvalidRefreshToken(t *testing.T) {
	service := &fakeAuthHandlerService{refreshErr: authservice.ErrInvalidRefresh}
	handler := NewAuthHandler(service)

	req := httptest.NewRequest(http.MethodPost, "/api/auth/refresh", strings.NewReader(`{"refreshToken":"bad"}`))
	recorder := httptest.NewRecorder()

	handler.Refresh(recorder, req)

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", recorder.Code)
	}
}

func TestAuthHandlerRefreshReturnsInternalServerErrorForUnexpectedFailure(t *testing.T) {
	service := &fakeAuthHandlerService{refreshErr: errors.New("database locked")}
	handler := NewAuthHandler(service)

	req := httptest.NewRequest(http.MethodPost, "/api/auth/refresh", strings.NewReader(`{"refreshToken":"token"}`))
	recorder := httptest.NewRecorder()

	handler.Refresh(recorder, req)

	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", recorder.Code)
	}
}

func TestAuthHandlerMeReturnsInternalServerErrorForUnexpectedFailure(t *testing.T) {
	service := &fakeAuthHandlerService{
		currentUserErr: errors.New("database locked"),
	}
	handler := NewAuthHandler(service)

	req := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	req = req.WithContext(context.WithValue(req.Context(), middleware.IdentityKey, &domainauth.Identity{UserID: 1, AccessToken: "access-token"}))
	recorder := httptest.NewRecorder()

	handler.Me(recorder, req)

	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", recorder.Code)
	}
	if service.currentUserToken != "access-token" {
		t.Fatalf("expected CurrentUser to receive access token, got %q", service.currentUserToken)
	}
}

func TestAuthHandlerLogoutReturnsBadRequestForInvalidJSON(t *testing.T) {
	handler := NewAuthHandler(&fakeAuthHandlerService{})

	req := httptest.NewRequest(http.MethodPost, "/api/logout", strings.NewReader(`{`))
	recorder := httptest.NewRecorder()

	handler.Logout(recorder, req)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", recorder.Code)
	}
}

func TestAuthHandlerLogoutPropagatesServiceError(t *testing.T) {
	service := &fakeAuthHandlerService{logoutErr: errors.New("logout failed")}
	handler := NewAuthHandler(service)

	req := httptest.NewRequest(http.MethodPost, "/api/logout", strings.NewReader(`{"refreshToken":"refresh-token"}`))
	req.Header.Set("Authorization", "Bearer access-token")
	recorder := httptest.NewRecorder()

	handler.Logout(recorder, req)

	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", recorder.Code)
	}
	if service.logoutAccess != "access-token" || service.logoutRefresh != "refresh-token" {
		t.Fatalf("expected logout tokens to be forwarded, got access=%q refresh=%q", service.logoutAccess, service.logoutRefresh)
	}
}

func TestAuthHandlerLogoutAllPropagatesServiceError(t *testing.T) {
	service := &fakeAuthHandlerService{logoutAllErr: errors.New("logout all failed")}
	handler := NewAuthHandler(service)

	req := httptest.NewRequest(http.MethodPost, "/api/logout-all", nil)
	req = req.WithContext(context.WithValue(req.Context(), middleware.IdentityKey, &domainauth.Identity{UserID: 9}))
	recorder := httptest.NewRecorder()

	handler.LogoutAll(recorder, req)

	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", recorder.Code)
	}
	if service.logoutAllUserID != 9 {
		t.Fatalf("expected LogoutAll to receive user id 9, got %d", service.logoutAllUserID)
	}
}

func TestAuthHandlerUpdateUserReturnsStructuredBadRequestForInvalidUserID(t *testing.T) {
	handler := NewAuthHandler(&fakeAuthHandlerService{})

	req := httptest.NewRequest(http.MethodPut, "/api/accounts/users/not-a-number", strings.NewReader(`{"username":"tester"}`))
	recorder := httptest.NewRecorder()

	handler.UpdateUser(recorder, req)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", recorder.Code)
	}
	if !strings.Contains(recorder.Body.String(), `INVALID_USER_ID`) {
		t.Fatalf("expected invalid user id payload, got %s", recorder.Body.String())
	}
}
