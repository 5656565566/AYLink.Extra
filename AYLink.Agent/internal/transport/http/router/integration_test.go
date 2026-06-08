package router

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"io"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"aylink-agent/internal/config"
	domainadb "aylink-agent/internal/domain/adb"
	domaindevice "aylink-agent/internal/domain/device"
	"aylink-agent/internal/infra/sqlite"
	authservice "aylink-agent/internal/service/auth"

	"testing/fstest"
)

type integrationLogger struct{}

func (integrationLogger) Debug(string, ...any) {}
func (integrationLogger) Info(string, ...any)  {}
func (integrationLogger) Warn(string, ...any)  {}
func (integrationLogger) Error(string, ...any) {}

type fakeADBManager struct{}

func (fakeADBManager) ResolvedBinary() (domainadb.ResolvedBinary, bool) {
	return domainadb.ResolvedBinary{}, false
}
func (fakeADBManager) Devices(context.Context) ([]domainadb.Device, error) {
	return []domainadb.Device{
		{Serial: "127.0.0.1:5555", State: "device"},
	}, nil
}
func (fakeADBManager) StartServer(context.Context) error { return nil }
func (fakeADBManager) KillServer(context.Context) error  { return nil }
func (fakeADBManager) ServerAddress() string             { return "127.0.0.1:5037" }
func (fakeADBManager) PairDevice(context.Context, string, int, string) (string, error) {
	return "", nil
}
func (fakeADBManager) ConnectDevice(context.Context, string, int) error          { return nil }
func (fakeADBManager) DeviceDisplayName(context.Context, string) (string, error) { return "", nil }
func (fakeADBManager) CaptureScreenshot(context.Context, string) (image.Image, error) {
	return image.NewRGBA(image.Rect(0, 0, 16, 16)), nil
}
func (fakeADBManager) RunCommand(context.Context, string, string) (string, error) { return "", nil }
func (fakeADBManager) ListDirectory(context.Context, string, string) ([]domainadb.DirectoryEntry, error) {
	return nil, nil
}
func (fakeADBManager) OpenRead(context.Context, string, string) (io.ReadCloser, error) {
	return io.NopCloser(strings.NewReader("")), nil
}
func (fakeADBManager) Push(context.Context, string, string, io.Reader, uint32) error { return nil }
func (fakeADBManager) RenamePath(context.Context, string, string, string) error      { return nil }
func (fakeADBManager) DeletePath(context.Context, string, string) error              { return nil }
func (fakeADBManager) OpenShellSession(context.Context, string) (domainadb.ShellSession, error) {
	return nil, nil
}

type integrationEnv struct {
	server          *httptest.Server
	client          *http.Client
	authSvc         *authservice.Service
	authRepo        *sqlite.AuthRepository
	deviceRepo      *sqlite.DeviceRepository
	deviceGroupRepo *sqlite.DeviceGroupRepository
}

type loginTokens struct {
	AccessToken  string
	RefreshToken string
}

func newIntegrationEnv(t *testing.T) *integrationEnv {
	t.Helper()

	dbPath := filepath.Join(t.TempDir(), "router-integration.db")
	db, err := sqlite.Open(dbPath)
	if err != nil {
		t.Fatalf("sqlite.Open() error = %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})

	authRepo := sqlite.NewAuthRepository(db)
	deviceRepo := sqlite.NewDeviceRepository(db)
	deviceGroupRepo := sqlite.NewDeviceGroupRepository(db)
	authSvc := authservice.NewService(authRepo, integrationLogger{})

	handler := New(Dependencies{
		Config: config.Config{
			ADB: config.ADBConfig{
				ServerHost: "127.0.0.1",
				ServerPort: 5037,
			},
		},
		Logger: integrationLogger{},
		ADB:    fakeADBManager{},
		DB:     db,
		EmbeddedWWW: fstest.MapFS{
			"index.html": &fstest.MapFile{Data: []byte("<html><body>ok</body></html>")},
		},
		WWWRoot: t.TempDir(),
	})

	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)

	return &integrationEnv{
		server:          server,
		client:          server.Client(),
		authSvc:         authSvc,
		authRepo:        authRepo,
		deviceRepo:      deviceRepo,
		deviceGroupRepo: deviceGroupRepo,
	}
}

func (e *integrationEnv) createAdminUser(t *testing.T, username, password string) {
	t.Helper()

	role, err := e.authRepo.GetRoleByName(context.Background(), "Administrator")
	if err != nil {
		t.Fatalf("GetRoleByName() error = %v", err)
	}
	if role == nil {
		t.Fatal("expected Administrator role to exist")
	}
	if _, err := e.authSvc.CreateUser(context.Background(), username, password, []int{role.ID}, nil); err != nil {
		t.Fatalf("CreateUser() error = %v", err)
	}
}

func (e *integrationEnv) createUserWithPermissions(t *testing.T, username, password string, permissions []string) {
	e.createUserWithPermissionsAndGroups(t, username, password, permissions, nil)
}

func (e *integrationEnv) createUserWithPermissionsAndGroups(t *testing.T, username, password string, permissions []string, deviceGroupIDs []int) {
	t.Helper()

	role, err := e.authSvc.CreateRole(context.Background(), username+"-role", "integration test role", permissions, nil)
	if err != nil {
		t.Fatalf("CreateRole() error = %v", err)
	}
	if _, err := e.authSvc.CreateUser(context.Background(), username, password, []int{role.ID}, deviceGroupIDs); err != nil {
		t.Fatalf("CreateUser() error = %v", err)
	}
}

func (e *integrationEnv) internalAllDevicesGroupID(t *testing.T) int {
	t.Helper()

	group, err := e.deviceGroupRepo.GetByName(context.Background(), "所有设备")
	if err != nil {
		t.Fatalf("GetByName(所有设备) error = %v", err)
	}
	if group == nil {
		t.Fatal("expected internal all-devices group")
	}
	return group.ID
}

func (e *integrationEnv) createDevice(t *testing.T, name, serial string) int {
	t.Helper()

	now := time.Now().UTC()
	device := &domaindevice.Device{
		Name:      name,
		Serial:    serial,
		Status:    "online",
		LastSeen:  now,
		CreatedAt: now,
		UpdatedAt: now,
	}
	if err := e.deviceRepo.Insert(context.Background(), device); err != nil {
		t.Fatalf("Insert() error = %v", err)
	}
	return device.ID
}

func (e *integrationEnv) login(t *testing.T, username, password string) loginTokens {
	t.Helper()

	statusCode, body := e.doJSON(t, http.MethodPost, "/api/login", "", map[string]any{
		"username": username,
		"password": password,
	})
	if statusCode != http.StatusOK {
		t.Fatalf("login status = %d, body = %s", statusCode, string(body))
	}

	var payload struct {
		AccessToken  string `json:"accessToken"`
		RefreshToken string `json:"refreshToken"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}
	if strings.TrimSpace(payload.AccessToken) == "" || strings.TrimSpace(payload.RefreshToken) == "" {
		t.Fatalf("expected token pair in body: %s", string(body))
	}
	return loginTokens{
		AccessToken:  payload.AccessToken,
		RefreshToken: payload.RefreshToken,
	}
}

func (e *integrationEnv) doJSON(t *testing.T, method, path, token string, payload any) (int, []byte) {
	t.Helper()

	var body io.Reader
	if payload != nil {
		data, err := json.Marshal(payload)
		if err != nil {
			t.Fatalf("json.Marshal() error = %v", err)
		}
		body = bytes.NewReader(data)
	}

	req, err := http.NewRequest(method, e.server.URL+path, body)
	if err != nil {
		t.Fatalf("http.NewRequest() error = %v", err)
	}
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if strings.TrimSpace(token) != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	resp, err := e.client.Do(req)
	if err != nil {
		t.Fatalf("client.Do() error = %v", err)
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("io.ReadAll() error = %v", err)
	}

	return resp.StatusCode, data
}

func TestHTTPProtectedSettingsLanguageRequiresAuth(t *testing.T) {
	env := newIntegrationEnv(t)

	statusCode, body := env.doJSON(t, http.MethodGet, "/api/settings/language", "", nil)
	if statusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", statusCode, string(body))
	}
}

func TestHTTPLoginAndMeFlow(t *testing.T) {
	env := newIntegrationEnv(t)
	env.createAdminUser(t, "admin-user", "secret")

	tokens := env.login(t, "admin-user", "secret")
	statusCode, body := env.doJSON(t, http.MethodGet, "/api/auth/me", tokens.AccessToken, nil)
	if statusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", statusCode, string(body))
	}
	if !bytes.Contains(body, []byte(`"Username":"admin-user"`)) {
		t.Fatalf("expected current user payload, got %s", string(body))
	}
	if !bytes.Contains(body, []byte(`"permissions"`)) {
		t.Fatalf("expected permissions payload, got %s", string(body))
	}
}

func TestHTTPSettingsLanguageRoundTrip(t *testing.T) {
	env := newIntegrationEnv(t)
	env.createAdminUser(t, "settings-admin", "secret")

	tokens := env.login(t, "settings-admin", "secret")

	statusCode, body := env.doJSON(t, http.MethodGet, "/api/settings/language", tokens.AccessToken, nil)
	if statusCode != http.StatusOK {
		t.Fatalf("expected initial GET 200, got %d: %s", statusCode, string(body))
	}
	if !bytes.Contains(body, []byte(`"locale":"zh-CN"`)) {
		t.Fatalf("expected default locale zh-CN, got %s", string(body))
	}

	statusCode, body = env.doJSON(t, http.MethodPut, "/api/settings/language", tokens.AccessToken, map[string]any{
		"locale": "en-US",
	})
	if statusCode != http.StatusOK {
		t.Fatalf("expected PUT 200, got %d: %s", statusCode, string(body))
	}

	statusCode, body = env.doJSON(t, http.MethodGet, "/api/settings/language", tokens.AccessToken, nil)
	if statusCode != http.StatusOK {
		t.Fatalf("expected second GET 200, got %d: %s", statusCode, string(body))
	}
	if !bytes.Contains(body, []byte(`"locale":"en-US"`)) {
		t.Fatalf("expected persisted locale en-US, got %s", string(body))
	}
}

func TestHTTPSettingsWebRtcRequiresManagePermissionForWrite(t *testing.T) {
	env := newIntegrationEnv(t)
	env.createUserWithPermissions(t, "viewer-user", "secret", []string{"settings.view"})

	tokens := env.login(t, "viewer-user", "secret")

	statusCode, body := env.doJSON(t, http.MethodGet, "/api/settings/webrtc-network", tokens.AccessToken, nil)
	if statusCode != http.StatusOK {
		t.Fatalf("expected GET 200, got %d: %s", statusCode, string(body))
	}

	statusCode, body = env.doJSON(t, http.MethodPut, "/api/settings/webrtc-network", tokens.AccessToken, map[string]any{
		"IceTransportPolicy": "relay",
		"IceServers":         []map[string]any{{"Urls": []string{"stun:example.org"}}},
	})
	if statusCode != http.StatusForbidden {
		t.Fatalf("expected PUT 403, got %d: %s", statusCode, string(body))
	}

	statusCode, body = env.doJSON(t, http.MethodPut, "/api/settings/language", tokens.AccessToken, map[string]any{
		"locale": "en-US",
	})
	if statusCode != http.StatusForbidden {
		t.Fatalf("expected language PUT 403, got %d: %s", statusCode, string(body))
	}
}

func TestHTTPSettingsWebRtcRoundTrip(t *testing.T) {
	env := newIntegrationEnv(t)
	env.createAdminUser(t, "webrtc-admin", "secret")

	tokens := env.login(t, "webrtc-admin", "secret")
	statusCode, body := env.doJSON(t, http.MethodPut, "/api/settings/webrtc-network", tokens.AccessToken, map[string]any{
		"IceTransportPolicy":           "relay",
		"FallbackLocale":               "en-US",
		"IceServers":                   []map[string]any{{"Urls": []string{"stun:example.org"}}},
		"HostCandidateOverrideEnabled": true,
		"HostCandidateOverrideIPs":     []string{"1.1.1.1"},
	})
	if statusCode != http.StatusOK {
		t.Fatalf("expected PUT 200, got %d: %s", statusCode, string(body))
	}

	statusCode, body = env.doJSON(t, http.MethodGet, "/api/settings/webrtc-network", tokens.AccessToken, nil)
	if statusCode != http.StatusOK {
		t.Fatalf("expected GET 200, got %d: %s", statusCode, string(body))
	}
	if !bytes.Contains(body, []byte(`"IceTransportPolicy":"relay"`)) {
		t.Fatalf("expected relay policy, got %s", string(body))
	}
	if !bytes.Contains(body, []byte(`"HostCandidateOverrideIPs":["1.1.1.1"]`)) {
		t.Fatalf("expected persisted host override IPs, got %s", string(body))
	}
	if !bytes.Contains(body, []byte(`"FallbackLocale":"en-US"`)) {
		t.Fatalf("expected persisted fallback locale en-US, got %s", string(body))
	}
}

func TestHTTPSettingsWebRtcRejectsUnsupportedFallbackLocale(t *testing.T) {
	env := newIntegrationEnv(t)
	env.createAdminUser(t, "webrtc-locale-admin", "secret")

	tokens := env.login(t, "webrtc-locale-admin", "secret")
	statusCode, body := env.doJSON(t, http.MethodPut, "/api/settings/webrtc-network", tokens.AccessToken, map[string]any{
		"IceTransportPolicy": "all",
		"FallbackLocale":     "fr-FR",
		"IceServers":         []map[string]any{{"Urls": []string{"stun:example.org"}}},
	})
	if statusCode != http.StatusBadRequest {
		t.Fatalf("expected PUT 400, got %d: %s", statusCode, string(body))
	}
}

func TestHTTPSettingsManagementEndpointsLoadForAdmin(t *testing.T) {
	env := newIntegrationEnv(t)
	env.createAdminUser(t, "settings-page-admin", "secret")
	env.createDevice(t, "Settings Device", "settings-device-1")

	tokens := env.login(t, "settings-page-admin", "secret")

	endpoints := []string{
		"/api/settings/language",
		"/api/settings/webrtc-network",
		"/api/devices",
		"/api/accounts/users",
		"/api/accounts/roles",
		"/api/device-groups",
	}

	for _, endpoint := range endpoints {
		statusCode, body := env.doJSON(t, http.MethodGet, endpoint, tokens.AccessToken, nil)
		if statusCode != http.StatusOK {
			t.Fatalf("expected GET %s to return 200, got %d: %s", endpoint, statusCode, string(body))
		}
	}
}

func TestHTTPSettingsManagementEndpointsEnforcePermissions(t *testing.T) {
	env := newIntegrationEnv(t)
	env.createUserWithPermissions(t, "settings-page-user", "secret", []string{"settings.view", "devices.view"})
	env.createDevice(t, "Visible Device", "visible-device-1")

	tokens := env.login(t, "settings-page-user", "secret")

	statusCode, body := env.doJSON(t, http.MethodGet, "/api/settings/language", tokens.AccessToken, nil)
	if statusCode != http.StatusOK {
		t.Fatalf("expected settings language GET 200, got %d: %s", statusCode, string(body))
	}

	statusCode, body = env.doJSON(t, http.MethodGet, "/api/settings/webrtc-network", tokens.AccessToken, nil)
	if statusCode != http.StatusOK {
		t.Fatalf("expected webrtc settings GET 200, got %d: %s", statusCode, string(body))
	}

	statusCode, body = env.doJSON(t, http.MethodGet, "/api/devices", tokens.AccessToken, nil)
	if statusCode != http.StatusOK {
		t.Fatalf("expected devices GET 200, got %d: %s", statusCode, string(body))
	}

	for _, endpoint := range []string{"/api/accounts/users", "/api/accounts/roles", "/api/device-groups"} {
		statusCode, body = env.doJSON(t, http.MethodGet, endpoint, tokens.AccessToken, nil)
		if statusCode != http.StatusForbidden {
			t.Fatalf("expected GET %s to return 403, got %d: %s", endpoint, statusCode, string(body))
		}
	}
}

func TestHTTPDeviceGroupOptionsOnlyExposeAssignedGroups(t *testing.T) {
	env := newIntegrationEnv(t)

	visibleGroup, err := env.deviceGroupRepo.Create(context.Background(), "Visible Group", "Assigned to scoped user")
	if err != nil {
		t.Fatalf("Create(visible group) error = %v", err)
	}
	if _, err := env.deviceGroupRepo.Create(context.Background(), "Hidden Group", "Should not leak"); err != nil {
		t.Fatalf("Create(hidden group) error = %v", err)
	}

	env.createUserWithPermissionsAndGroups(t, "scoped-options-user", "secret", []string{"devices.view"}, []int{visibleGroup.ID})
	tokens := env.login(t, "scoped-options-user", "secret")

	statusCode, body := env.doJSON(t, http.MethodGet, "/api/device-groups/options", tokens.AccessToken, nil)
	if statusCode != http.StatusOK {
		t.Fatalf("expected GET /api/device-groups/options 200, got %d: %s", statusCode, string(body))
	}
	if !bytes.Contains(body, []byte(`"Name":"Visible Group"`)) {
		t.Fatalf("expected assigned group to be visible, got %s", string(body))
	}
	if bytes.Contains(body, []byte(`"Name":"Hidden Group"`)) {
		t.Fatalf("expected unassigned group to stay hidden, got %s", string(body))
	}
}

func TestHTTPDeleteUserRejectsRemovingLastSystemOwner(t *testing.T) {
	env := newIntegrationEnv(t)
	env.createAdminUser(t, "owner-user", "secret")
	env.createUserWithPermissions(t, "account-manager", "secret", []string{"accounts.manage"})

	managerTokens := env.login(t, "account-manager", "secret")
	ownerUser, err := env.authRepo.GetUserByUsername(context.Background(), "owner-user")
	if err != nil {
		t.Fatalf("GetUserByUsername(owner-user) error = %v", err)
	}
	if ownerUser == nil {
		t.Fatal("expected owner-user to exist")
	}

	statusCode, body := env.doJSON(t, http.MethodDelete, "/api/accounts/users/"+strconv.Itoa(ownerUser.ID), managerTokens.AccessToken, nil)
	if statusCode != http.StatusConflict {
		t.Fatalf("expected DELETE last system owner to return 409, got %d: %s", statusCode, string(body))
	}
	if !bytes.Contains(body, []byte(`"code":"DELETE_USER_FAILED"`)) {
		t.Fatalf("expected DELETE_USER_FAILED error body, got %s", string(body))
	}
}

func TestHTTPRefreshRotatesTokensAndAllowsAuthenticatedAccess(t *testing.T) {
	env := newIntegrationEnv(t)
	env.createAdminUser(t, "refresh-admin", "secret")

	tokens := env.login(t, "refresh-admin", "secret")
	statusCode, body := env.doJSON(t, http.MethodPost, "/api/auth/refresh", "", map[string]any{
		"refreshToken": tokens.RefreshToken,
	})
	if statusCode != http.StatusOK {
		t.Fatalf("expected refresh 200, got %d: %s", statusCode, string(body))
	}

	var refreshed struct {
		AccessToken  string `json:"accessToken"`
		RefreshToken string `json:"refreshToken"`
	}
	if err := json.Unmarshal(body, &refreshed); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}
	if refreshed.AccessToken == "" || refreshed.RefreshToken == "" {
		t.Fatalf("expected rotated token pair, got %s", string(body))
	}
	if refreshed.AccessToken == tokens.AccessToken || refreshed.RefreshToken == tokens.RefreshToken {
		t.Fatalf("expected token rotation, old=%+v new=%+v", tokens, refreshed)
	}

	statusCode, body = env.doJSON(t, http.MethodGet, "/api/auth/me", refreshed.AccessToken, nil)
	if statusCode != http.StatusOK {
		t.Fatalf("expected refreshed access token to work, got %d: %s", statusCode, string(body))
	}
}

func TestHTTPLogoutRevokesAccessToken(t *testing.T) {
	env := newIntegrationEnv(t)
	env.createAdminUser(t, "logout-admin", "secret")

	tokens := env.login(t, "logout-admin", "secret")
	statusCode, body := env.doJSON(t, http.MethodPost, "/api/logout", tokens.AccessToken, map[string]any{
		"refreshToken": tokens.RefreshToken,
	})
	if statusCode != http.StatusOK {
		t.Fatalf("expected logout 200, got %d: %s", statusCode, string(body))
	}

	statusCode, body = env.doJSON(t, http.MethodGet, "/api/auth/me", tokens.AccessToken, nil)
	if statusCode != http.StatusUnauthorized {
		t.Fatalf("expected logged out access token to be rejected, got %d: %s", statusCode, string(body))
	}
}

func TestHTTPAccountsUsersRequiresManagePermission(t *testing.T) {
	env := newIntegrationEnv(t)
	env.createUserWithPermissions(t, "accounts-viewer", "secret", []string{"accounts.view"})

	tokens := env.login(t, "accounts-viewer", "secret")
	statusCode, body := env.doJSON(t, http.MethodGet, "/api/accounts/users", tokens.AccessToken, nil)
	if statusCode != http.StatusForbidden {
		t.Fatalf("expected accounts users GET to require manage permission, got %d: %s", statusCode, string(body))
	}
}

func TestHTTPAccountsUsersListAndCreateFlow(t *testing.T) {
	env := newIntegrationEnv(t)
	env.createAdminUser(t, "accounts-admin", "secret")

	tokens := env.login(t, "accounts-admin", "secret")
	statusCode, body := env.doJSON(t, http.MethodGet, "/api/accounts/users", tokens.AccessToken, nil)
	if statusCode != http.StatusOK {
		t.Fatalf("expected initial users GET 200, got %d: %s", statusCode, string(body))
	}
	if !bytes.Contains(body, []byte(`"users"`)) || !bytes.Contains(body, []byte(`"roles"`)) {
		t.Fatalf("expected users and roles payload, got %s", string(body))
	}

	role, err := env.authRepo.GetRoleByName(context.Background(), "Administrator")
	if err != nil {
		t.Fatalf("GetRoleByName() error = %v", err)
	}
	if role == nil {
		t.Fatal("expected Administrator role to exist")
	}

	statusCode, body = env.doJSON(t, http.MethodPost, "/api/accounts/users", tokens.AccessToken, map[string]any{
		"username": "created-user",
		"password": "secret",
		"roleIds":  []int{role.ID},
	})
	if statusCode != http.StatusOK {
		t.Fatalf("expected create user 200, got %d: %s", statusCode, string(body))
	}
	if !bytes.Contains(body, []byte(`"success":true`)) {
		t.Fatalf("expected create success payload, got %s", string(body))
	}

	statusCode, body = env.doJSON(t, http.MethodGet, "/api/accounts/users", tokens.AccessToken, nil)
	if statusCode != http.StatusOK {
		t.Fatalf("expected second users GET 200, got %d: %s", statusCode, string(body))
	}
	if !bytes.Contains(body, []byte(`"Username":"created-user"`)) {
		t.Fatalf("expected created user in list, got %s", string(body))
	}
}

func TestHTTPDevicesListRequiresViewPermission(t *testing.T) {
	env := newIntegrationEnv(t)
	env.createUserWithPermissions(t, "devices-settings-user", "secret", []string{"settings.view"})

	tokens := env.login(t, "devices-settings-user", "secret")
	statusCode, body := env.doJSON(t, http.MethodGet, "/api/devices", tokens.AccessToken, nil)
	if statusCode != http.StatusForbidden {
		t.Fatalf("expected devices GET to require devices.view, got %d: %s", statusCode, string(body))
	}
}

func TestHTTPADBStatusRequiresAuth(t *testing.T) {
	env := newIntegrationEnv(t)

	statusCode, body := env.doJSON(t, http.MethodGet, "/api/adb/status", "", nil)
	if statusCode != http.StatusUnauthorized {
		t.Fatalf("expected adb status GET to require auth, got %d: %s", statusCode, string(body))
	}
}

func TestHTTPADBEndpointsRequireDevicesManagePermission(t *testing.T) {
	env := newIntegrationEnv(t)
	env.createUserWithPermissionsAndGroups(t, "adb-viewer", "secret", []string{"devices.view"}, []int{env.internalAllDevicesGroupID(t)})

	tokens := env.login(t, "adb-viewer", "secret")

	for _, testCase := range []struct {
		method  string
		path    string
		payload any
	}{
		{method: http.MethodGet, path: "/api/adb/status"},
		{method: http.MethodPost, path: "/api/adb/server/start"},
		{method: http.MethodPost, path: "/api/adb/server/kill"},
		{
			method: http.MethodPost,
			path:   "/api/adb/pair",
			payload: map[string]any{
				"host":        "127.0.0.1",
				"pairingPort": 5555,
				"pairingCode": "123456",
			},
		},
	} {
		statusCode, body := env.doJSON(t, testCase.method, testCase.path, tokens.AccessToken, testCase.payload)
		if statusCode != http.StatusForbidden {
			t.Fatalf("expected %s %s to require devices.manage, got %d: %s", testCase.method, testCase.path, statusCode, string(body))
		}
	}
}

func TestHTTPADBEndpointsAllowDevicesManagePermission(t *testing.T) {
	env := newIntegrationEnv(t)
	env.createUserWithPermissions(t, "adb-manager", "secret", []string{"devices.manage"})

	tokens := env.login(t, "adb-manager", "secret")

	statusCode, body := env.doJSON(t, http.MethodGet, "/api/adb/status", tokens.AccessToken, nil)
	if statusCode != http.StatusOK {
		t.Fatalf("expected adb status GET 200, got %d: %s", statusCode, string(body))
	}
	if !bytes.Contains(body, []byte(`"serverAddress":"127.0.0.1:5037"`)) {
		t.Fatalf("expected adb status payload, got %s", string(body))
	}

	for _, path := range []string{"/api/adb/server/start", "/api/adb/server/kill"} {
		statusCode, body = env.doJSON(t, http.MethodPost, path, tokens.AccessToken, nil)
		if statusCode != http.StatusOK {
			t.Fatalf("expected POST %s 200, got %d: %s", path, statusCode, string(body))
		}
	}

	statusCode, body = env.doJSON(t, http.MethodPost, "/api/adb/pair", tokens.AccessToken, map[string]any{
		"host":        "127.0.0.1",
		"pairingPort": 5555,
		"pairingCode": "123456",
	})
	if statusCode != http.StatusOK {
		t.Fatalf("expected adb pair POST 200, got %d: %s", statusCode, string(body))
	}
}

func TestHTTPDevicesListReturnsInsertedDevices(t *testing.T) {
	env := newIntegrationEnv(t)
	env.createUserWithPermissionsAndGroups(t, "devices-viewer", "secret", []string{"devices.view"}, []int{env.internalAllDevicesGroupID(t)})
	env.createDevice(t, "Pixel", "serial-1")

	tokens := env.login(t, "devices-viewer", "secret")
	statusCode, body := env.doJSON(t, http.MethodGet, "/api/devices", tokens.AccessToken, nil)
	if statusCode != http.StatusOK {
		t.Fatalf("expected devices GET 200, got %d: %s", statusCode, string(body))
	}
	if !bytes.Contains(body, []byte(`"Name":"Pixel"`)) {
		t.Fatalf("expected device list payload, got %s", string(body))
	}
}

func TestHTTPDevicePreviewRequiresViewPermission(t *testing.T) {
	env := newIntegrationEnv(t)
	deviceID := env.createDevice(t, "Preview Device", "serial-preview-no-view")
	env.createUserWithPermissions(t, "devices-preview-blocked", "secret", []string{"settings.view"})

	tokens := env.login(t, "devices-preview-blocked", "secret")
	statusCode, body := env.doJSON(t, http.MethodGet, "/api/devices/"+strconv.Itoa(deviceID)+"/preview", tokens.AccessToken, nil)
	if statusCode != http.StatusForbidden {
		t.Fatalf("expected preview GET to require devices.view, got %d: %s", statusCode, string(body))
	}
}

func TestHTTPDevicePreviewAllowsViewPermission(t *testing.T) {
	env := newIntegrationEnv(t)
	deviceID := env.createDevice(t, "Preview Device", "127.0.0.1:5555")
	env.createUserWithPermissionsAndGroups(t, "devices-preview-viewer", "secret", []string{"devices.view"}, []int{env.internalAllDevicesGroupID(t)})

	tokens := env.login(t, "devices-preview-viewer", "secret")
	statusCode, body := env.doJSON(t, http.MethodGet, "/api/devices/"+strconv.Itoa(deviceID)+"/preview", tokens.AccessToken, nil)
	if statusCode != http.StatusOK {
		t.Fatalf("expected preview GET 200, got %d: %s", statusCode, string(body))
	}
	if len(body) == 0 {
		t.Fatal("expected preview image payload")
	}
}

func TestHTTPDevicesCreateRejectsMissingSerial(t *testing.T) {
	env := newIntegrationEnv(t)
	env.createUserWithPermissions(t, "devices-manager", "secret", []string{"devices.manage"})

	tokens := env.login(t, "devices-manager", "secret")
	statusCode, body := env.doJSON(t, http.MethodPost, "/api/devices", tokens.AccessToken, map[string]any{
		"Name": "No Serial",
	})
	if statusCode != http.StatusBadRequest {
		t.Fatalf("expected create without serial 400, got %d: %s", statusCode, string(body))
	}
	if !bytes.Contains(body, []byte(`DEVICE_SERIAL_REQUIRED`)) {
		t.Fatalf("expected serial required error, got %s", string(body))
	}
}

func TestHTTPDevicesDeleteReturnsNotFound(t *testing.T) {
	env := newIntegrationEnv(t)
	env.createUserWithPermissions(t, "devices-delete-manager", "secret", []string{"devices.manage"})

	tokens := env.login(t, "devices-delete-manager", "secret")
	statusCode, body := env.doJSON(t, http.MethodDelete, "/api/devices/9999", tokens.AccessToken, nil)
	if statusCode != http.StatusNotFound {
		t.Fatalf("expected delete missing device 404, got %d: %s", statusCode, string(body))
	}
}

func TestHTTPUnknownAPIRouteReturnsJSON(t *testing.T) {
	env := newIntegrationEnv(t)

	response, err := env.client.Get(env.server.URL + "/api/not-registered")
	if err != nil {
		t.Fatalf("GET unknown api route error = %v", err)
	}
	defer response.Body.Close()

	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("ReadAll() error = %v", err)
	}
	if response.StatusCode != http.StatusNotFound {
		t.Fatalf("expected unknown api 404, got %d: %s", response.StatusCode, string(body))
	}
	if contentType := response.Header.Get("Content-Type"); !strings.Contains(contentType, "application/json") {
		t.Fatalf("expected json content type, got %q: %s", contentType, string(body))
	}
	if !bytes.Contains(body, []byte(`API_ROUTE_NOT_FOUND`)) {
		t.Fatalf("expected api route not found payload, got %s", string(body))
	}
}

func TestHTTPDeviceSettingsRoundTrip(t *testing.T) {
	env := newIntegrationEnv(t)
	env.createUserWithPermissionsAndGroups(t, "devices-settings-manager", "secret", []string{"devices.control", "devices.manage"}, []int{env.internalAllDevicesGroupID(t)})
	deviceID := env.createDevice(t, "Pixel", "serial-settings")

	tokens := env.login(t, "devices-settings-manager", "secret")

	statusCode, body := env.doJSON(t, http.MethodGet, "/api/devices/"+strconv.Itoa(deviceID)+"/settings", tokens.AccessToken, nil)
	if statusCode != http.StatusOK {
		t.Fatalf("expected initial settings GET 200, got %d: %s", statusCode, string(body))
	}
	if !bytes.Contains(body, []byte(`"VideoCodec":"h264"`)) {
		t.Fatalf("expected default settings payload, got %s", string(body))
	}

	statusCode, body = env.doJSON(t, http.MethodPut, "/api/devices/"+strconv.Itoa(deviceID)+"/settings", tokens.AccessToken, map[string]any{
		"VideoCodec":  "h265",
		"AudioCodec":  "aac",
		"StayAwake":   true,
		"NewDisplay":  "1280x720",
		"AudioDup":    true,
		"ShowTouches": true,
		"VideoSource": "camera",
		"AudioSource": "mic",
	})
	if statusCode != http.StatusOK {
		t.Fatalf("expected settings PUT 200, got %d: %s", statusCode, string(body))
	}
	if !bytes.Contains(body, []byte(`"VideoCodec":"h265"`)) {
		t.Fatalf("expected saved settings payload, got %s", string(body))
	}

	statusCode, body = env.doJSON(t, http.MethodGet, "/api/devices/"+strconv.Itoa(deviceID)+"/settings", tokens.AccessToken, nil)
	if statusCode != http.StatusOK {
		t.Fatalf("expected second settings GET 200, got %d: %s", statusCode, string(body))
	}
	if !bytes.Contains(body, []byte(`"VideoCodec":"h265"`)) || !bytes.Contains(body, []byte(`"StayAwake":true`)) {
		t.Fatalf("expected persisted device settings, got %s", string(body))
	}

	statusCode, body = env.doJSON(t, http.MethodDelete, "/api/devices/"+strconv.Itoa(deviceID)+"/settings", tokens.AccessToken, nil)
	if statusCode != http.StatusOK {
		t.Fatalf("expected settings reset DELETE 200, got %d: %s", statusCode, string(body))
	}
	if !bytes.Contains(body, []byte(`"VideoCodec":"h264"`)) {
		t.Fatalf("expected reset default settings payload, got %s", string(body))
	}
}

var _ fs.FS = fstest.MapFS{}
