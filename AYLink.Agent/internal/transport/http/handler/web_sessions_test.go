package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	domainauth "aylink-agent/internal/domain/auth"
	"aylink-agent/internal/infra/sqlite"
	authservice "aylink-agent/internal/service/auth"
	webrtcservice "aylink-agent/internal/service/webrtc"
	"aylink-agent/internal/transport/http/middleware"
)

func TestWebPageLoginBindingRotationAndLogoutCleanup(t *testing.T) {
	ctx := context.Background()
	db, err := sqlite.Open(filepath.Join(t.TempDir(), "sessions.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	repo := sqlite.NewAuthRepository(db)
	auth := authservice.NewService(repo, nil)
	role, err := repo.GetRoleByName(ctx, "Administrator")
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"alice", "bob"} {
		if _, err := auth.CreateUser(ctx, name, "test-password", []int{role.ID}, nil); err != nil {
			t.Fatal(err)
		}
	}
	login := func(name string) *domainauth.LoginResult {
		result, err := auth.Login(ctx, name, "test-password")
		if err != nil {
			t.Fatal(err)
		}
		return result
	}
	alice, anotherAlice, bob := login("alice"), login("alice"), login("bob")
	identity := func(token string) *domainauth.Identity {
		result, err := auth.ValidateAccessToken(ctx, token)
		if err != nil {
			t.Fatal(err)
		}
		return result
	}
	a, aa, b := identity(alice.AccessToken), identity(anotherAlice.AccessToken), identity(bob.AccessToken)
	service := webrtcservice.NewService(nil)
	h := NewWebRTCHandler(service, &fakeSettingsService{}, &fakeScrcpyRuntimeService{}, nil, auth)
	auth.SetSessionCleanupHook(h.CleanupWebSessions)
	call := func(handler http.HandlerFunc, actor *domainauth.Identity, payload any) *httptest.ResponseRecorder {
		data, _ := json.Marshal(payload)
		r := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(data))
		r = r.WithContext(context.WithValue(r.Context(), middleware.IdentityKey, actor))
		w := httptest.NewRecorder()
		handler(w, r)
		return w
	}
	register := func(actor *domainauth.Identity) string {
		w := call(h.RegisterWebPage, actor, nil)
		if w.Code != 200 {
			t.Fatalf("register status=%d", w.Code)
		}
		var result struct {
			Page string `json:"p"`
		}
		_ = json.Unmarshal(w.Body.Bytes(), &result)
		return result.Page
	}
	p, otherPage := register(a), register(aa)
	create := func(actor *domainauth.Identity, page, device string) webrtcservice.CreateTicketResult {
		w := call(h.CreateTicket, actor, map[string]any{"deviceId": device, "pageId": page, "newDisplay": true})
		if w.Code != 200 {
			t.Fatalf("ticket status=%d", w.Code)
		}
		var result webrtcservice.CreateTicketResult
		_ = json.Unmarshal(w.Body.Bytes(), &result)
		return result
	}
	first, second := create(a, p, "1"), create(aa, otherPage, "2")
	beat := map[string]any{"p": p, "v": 1, "b": "AQAB"} // 一个槽位 bit 0 存活。
	if w := call(h.Heartbeat, a, beat); w.Code != 200 {
		t.Fatalf("heartbeat status=%d", w.Code)
	}
	for _, actor := range []*domainauth.Identity{aa, b} {
		if w := call(h.Heartbeat, actor, beat); w.Code != 404 {
			t.Fatalf("foreign heartbeat status=%d", w.Code)
		}
		if w := call(h.CreateTicket, actor, map[string]string{"deviceId": "1", "pageId": p}); w.Code != 404 {
			t.Fatalf("foreign ticket status=%d", w.Code)
		}
	}
	rotated, err := auth.Refresh(ctx, alice.RefreshToken)
	if err != nil {
		t.Fatal(err)
	}
	current := identity(rotated.AccessToken)
	if current.LoginSessionID == "" || current.LoginSessionID != a.LoginSessionID || current.LoginSessionID == aa.LoginSessionID {
		t.Fatal("token refresh changed login ownership")
	}
	beat["v"] = 2
	if w := call(h.Heartbeat, current, beat); w.Code != 200 {
		t.Fatalf("refreshed heartbeat status=%d", w.Code)
	}
	if _, err := auth.Refresh(ctx, alice.RefreshToken); err == nil {
		t.Fatal("consumed refresh token was reused")
	}
	oldRuntime, otherRuntime := &fakeHandlerScrcpyRuntime{}, &fakeHandlerScrcpyRuntime{}
	h.runtimes["1"] = &managedRuntime{deviceID: "1", runtime: oldRuntime, sessionIDs: map[string]struct{}{first.SessionID: {}}}
	h.runtimes["2"] = &managedRuntime{deviceID: "2", runtime: otherRuntime, sessionIDs: map[string]struct{}{second.SessionID: {}}}
	if err := auth.Logout(ctx, rotated.AccessToken, rotated.RefreshToken); err != nil {
		t.Fatal(err)
	}
	if service.HasSessionLease("1", first.SessionID) || !oldRuntime.closed {
		t.Fatal("logout leaked an unwatched application runtime")
	}
	if !service.HasSessionLease("2", second.SessionID) || otherRuntime.closed {
		t.Fatal("logout released another login's runtime")
	}
	beat["v"] = 3
	if w := call(h.Heartbeat, current, beat); w.Code != 401 {
		t.Fatalf("late request after logout status=%d", w.Code)
	}
	if _, err := auth.ValidateAccessToken(ctx, alice.AccessToken); err == nil {
		t.Fatal("old access token survived family logout")
	}
	if _, err := db.Exec(`UPDATE RefreshTokens SET ExpiresAt = ? WHERE SessionId = ?`, time.Now().Add(-time.Minute).UTC().Format(time.RFC3339Nano), aa.LoginSessionID); err != nil {
		t.Fatal(err)
	}
	h.CleanupWebSessions(ctx)
	if service.HasSessionLease("2", second.SessionID) || !otherRuntime.closed {
		t.Fatal("expired login leaked its application runtime")
	}
	bobPage := register(b)
	third := create(b, bobPage, "3")
	disabledRuntime := &fakeHandlerScrcpyRuntime{}
	h.runtimes["3"] = &managedRuntime{deviceID: "3", runtime: disabledRuntime, sessionIDs: map[string]struct{}{third.SessionID: {}}}
	if err := auth.SetUserActiveState(ctx, b.UserID, false, nil); err != nil {
		t.Fatal(err)
	}
	if service.HasSessionLease("3", third.SessionID) || !disabledRuntime.closed {
		t.Fatal("disabling an account leaked its application runtime")
	}
}

func TestLegacyTokensAcquireStableSessionOnRefresh(t *testing.T) {
	ctx := context.Background()
	db, err := sqlite.Open(filepath.Join(t.TempDir(), "legacy.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	repo := sqlite.NewAuthRepository(db)
	auth := authservice.NewService(repo, nil)
	role, err := repo.GetRoleByName(ctx, "Administrator")
	if err != nil {
		t.Fatal(err)
	}
	user, err := auth.CreateUser(ctx, "legacy", "test-password", []int{role.ID}, nil)
	if err != nil {
		t.Fatal(err)
	}
	record, err := repo.GetUserByID(ctx, user.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := repo.CreateSession(ctx, *record, domainauth.TokenPair{AccessToken: "old-access", RefreshToken: "old-refresh",
		AccessTokenExpiresAt: time.Now().Add(time.Minute), RefreshTokenExpiresAt: time.Now().Add(time.Hour)}); err != nil {
		t.Fatal(err)
	}
	old, err := auth.ValidateAccessToken(ctx, "old-access")
	if err != nil || old.LoginSessionID != "" {
		t.Fatal("legacy token stopped working")
	}
	service := webrtcservice.NewService(nil)
	h := NewWebRTCHandler(service, &fakeSettingsService{}, &fakeScrcpyRuntimeService{}, nil, auth)
	register := func(actor *domainauth.Identity) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodPost, "/api/scrcpy-sessions/page", nil)
		r = r.WithContext(context.WithValue(r.Context(), middleware.IdentityKey, actor))
		w := httptest.NewRecorder()
		h.RegisterWebPage(w, r)
		return w
	}
	if w := register(old); w.Code != http.StatusUnauthorized || !bytes.Contains(w.Body.Bytes(), []byte("LOGIN_SESSION_REQUIRED")) {
		t.Fatalf("old login did not request credential refresh: %d", w.Code)
	}
	result, err := auth.Refresh(ctx, "old-refresh")
	if err != nil {
		t.Fatal(err)
	}
	current, err := auth.ValidateAccessToken(ctx, result.AccessToken)
	if err != nil || current.LoginSessionID == "" {
		t.Fatal("refresh did not establish stable ownership")
	}
	w := register(current)
	if w.Code != http.StatusOK {
		t.Fatalf("refreshed login could not register: %d", w.Code)
	}
	var page struct {
		ID string `json:"p"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	ticket, err := service.CreateTicket(ctx, webrtcservice.CreateTicketInput{PageID: page.ID, DeviceID: "1", UserID: current.UserID, LoginSessionID: current.LoginSessionID})
	if err != nil {
		t.Fatal(err)
	}
	if err := service.HeartbeatWebPage(webrtcservice.WebOwner{UserID: current.UserID, LoginSessionID: current.LoginSessionID}, page.ID, 1, "AQAB"); err != nil || !service.HasSessionLease("1", ticket.SessionID) {
		t.Fatal("heartbeat after first credential refresh failed", err)
	}
	service.ReleaseWebPage(page.ID)
}
