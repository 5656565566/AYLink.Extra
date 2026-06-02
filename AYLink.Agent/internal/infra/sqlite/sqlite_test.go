package sqlite

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
	"time"

	domainauth "aylink-agent/internal/domain/auth"
	domaindevice "aylink-agent/internal/domain/device"
)

func newTestDB(t *testing.T) *sql.DB {
	t.Helper()

	dbPath := filepath.Join(t.TempDir(), "sqlite-test.db")
	db, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})
	return db
}

func countRows(t *testing.T, db *sql.DB, query string, args ...any) int {
	t.Helper()

	var count int
	if err := db.QueryRow(query, args...).Scan(&count); err != nil {
		t.Fatalf("countRows(%q) error = %v", query, err)
	}
	return count
}

func TestInitializeSeedsDefaultsIdempotently(t *testing.T) {
	db := newTestDB(t)

	if err := initialize(db); err != nil {
		t.Fatalf("initialize() error = %v", err)
	}

	if got := countRows(t, db, `SELECT COUNT(*) FROM Permissions`); got != 11 {
		t.Fatalf("expected 11 permissions, got %d", got)
	}
	if got := countRows(t, db, `SELECT COUNT(*) FROM Roles WHERE Name = 'Administrator'`); got != 1 {
		t.Fatalf("expected single Administrator role, got %d", got)
	}

	var adminRoleID int
	if err := db.QueryRow(`SELECT Id FROM Roles WHERE Name = 'Administrator'`).Scan(&adminRoleID); err != nil {
		t.Fatalf("query Administrator role id error = %v", err)
	}
	if got := countRows(t, db, `SELECT COUNT(*) FROM RolePermissions WHERE RoleId = ?`, adminRoleID); got != 11 {
		t.Fatalf("expected 11 admin role permissions, got %d", got)
	}

	if got := countRows(t, db, `SELECT COUNT(*) FROM Settings WHERE Key = 'webrtc_network_config'`); got != 1 {
		t.Fatalf("expected seeded webrtc_network_config, got %d rows", got)
	}
}

func TestAuthRepositoryCreateUserLoadsRolesAndPermissions(t *testing.T) {
	db := newTestDB(t)
	repo := NewAuthRepository(db)
	ctx := context.Background()

	adminRole, err := repo.GetRoleByName(ctx, "Administrator")
	if err != nil {
		t.Fatalf("GetRoleByName() error = %v", err)
	}
	if adminRole == nil {
		t.Fatal("expected Administrator role to exist")
	}

	user, err := repo.CreateUser(ctx, "tester", "hash", "salt", []int{adminRole.ID}, nil)
	if err != nil {
		t.Fatalf("CreateUser() error = %v", err)
	}
	if user == nil {
		t.Fatal("expected created user")
	}
	if user.Username != "tester" {
		t.Fatalf("expected username tester, got %s", user.Username)
	}
	if len(user.Roles) != 1 || user.Roles[0].Name != "Administrator" {
		t.Fatalf("expected Administrator role, got %+v", user.Roles)
	}
	if len(user.Permissions) != 11 {
		t.Fatalf("expected 11 permissions, got %d", len(user.Permissions))
	}
}

func TestAuthRepositoryGetUserByUsernameIsCaseInsensitive(t *testing.T) {
	db := newTestDB(t)
	repo := NewAuthRepository(db)
	ctx := context.Background()

	adminRole, err := repo.GetRoleByName(ctx, "Administrator")
	if err != nil {
		t.Fatalf("GetRoleByName() error = %v", err)
	}
	if _, err := repo.CreateUser(ctx, "CaseUser", "hash", "salt", []int{adminRole.ID}, nil); err != nil {
		t.Fatalf("CreateUser() error = %v", err)
	}

	lowerUser, err := repo.GetUserByUsername(ctx, "caseuser")
	if err != nil {
		t.Fatalf("GetUserByUsername(caseuser) error = %v", err)
	}
	if lowerUser == nil || lowerUser.Username != "CaseUser" {
		t.Fatalf("expected case-insensitive username lookup, got %+v", lowerUser)
	}

	upperUser, err := repo.GetUserByUsername(ctx, "CASEUSER")
	if err != nil {
		t.Fatalf("GetUserByUsername(CASEUSER) error = %v", err)
	}
	if upperUser == nil || upperUser.Username != "CaseUser" {
		t.Fatalf("expected case-insensitive username lookup, got %+v", upperUser)
	}
}

func TestAuthRepositoryUpdateUserReplacesRolesAndPermissions(t *testing.T) {
	db := newTestDB(t)
	repo := NewAuthRepository(db)
	ctx := context.Background()

	adminRole, err := repo.GetRoleByName(ctx, "Administrator")
	if err != nil {
		t.Fatalf("GetRoleByName(Administrator) error = %v", err)
	}
	limitedRole, err := repo.CreateRole(ctx, "Device Viewer", "View-only device access", []string{"devices.view"}, nil)
	if err != nil {
		t.Fatalf("CreateRole() error = %v", err)
	}

	user, err := repo.CreateUser(ctx, "role-user", "hash", "salt", []int{adminRole.ID}, nil)
	if err != nil {
		t.Fatalf("CreateUser() error = %v", err)
	}

	updated, err := repo.UpdateUser(ctx, user.ID, "role-user-updated", true, []int{limitedRole.ID}, nil)
	if err != nil {
		t.Fatalf("UpdateUser() error = %v", err)
	}
	if updated == nil {
		t.Fatal("expected updated user")
	}
	if updated.Username != "role-user-updated" {
		t.Fatalf("expected updated username, got %s", updated.Username)
	}
	if len(updated.Roles) != 1 || updated.Roles[0].Name != "Device Viewer" {
		t.Fatalf("expected single Device Viewer role, got %+v", updated.Roles)
	}
	if len(updated.Permissions) != 1 || updated.Permissions[0] != "devices.view" {
		t.Fatalf("expected only devices.view permission, got %+v", updated.Permissions)
	}
}

func TestAuthRepositoryCreateSessionAndCleanupExpiredTokens(t *testing.T) {
	db := newTestDB(t)
	repo := NewAuthRepository(db)
	ctx := context.Background()

	adminRole, err := repo.GetRoleByName(ctx, "Administrator")
	if err != nil {
		t.Fatalf("GetRoleByName() error = %v", err)
	}
	createdUser, err := repo.CreateUser(ctx, "session-user", "hash", "salt", []int{adminRole.ID}, nil)
	if err != nil {
		t.Fatalf("CreateUser() error = %v", err)
	}

	record, err := repo.GetUserByID(ctx, createdUser.ID)
	if err != nil {
		t.Fatalf("GetUserByID() error = %v", err)
	}
	if record == nil {
		t.Fatal("expected created user record")
	}

	expiredPair := domainauth.TokenPair{
		AccessToken:           "expired-access",
		AccessTokenExpiresAt:  time.Now().UTC().Add(-time.Hour),
		RefreshToken:          "expired-refresh",
		RefreshTokenExpiresAt: time.Now().UTC().Add(-time.Hour),
	}
	if err := repo.CreateSession(ctx, *record, expiredPair); err != nil {
		t.Fatalf("CreateSession() error = %v", err)
	}

	if got := countRows(t, db, `SELECT COUNT(*) FROM AccessTokens`); got != 1 {
		t.Fatalf("expected 1 access token before cleanup, got %d", got)
	}
	if got := countRows(t, db, `SELECT COUNT(*) FROM RefreshTokens`); got != 1 {
		t.Fatalf("expected 1 refresh token before cleanup, got %d", got)
	}

	if err := repo.CleanupExpiredTokens(ctx, time.Now().UTC()); err != nil {
		t.Fatalf("CleanupExpiredTokens() error = %v", err)
	}

	if got := countRows(t, db, `SELECT COUNT(*) FROM AccessTokens`); got != 0 {
		t.Fatalf("expected 0 access tokens after cleanup, got %d", got)
	}
	if got := countRows(t, db, `SELECT COUNT(*) FROM RefreshTokens`); got != 0 {
		t.Fatalf("expected 0 refresh tokens after cleanup, got %d", got)
	}
}

func TestAuthRepositoryTokenRevocationAndDeletion(t *testing.T) {
	db := newTestDB(t)
	repo := NewAuthRepository(db)
	ctx := context.Background()

	adminRole, err := repo.GetRoleByName(ctx, "Administrator")
	if err != nil {
		t.Fatalf("GetRoleByName() error = %v", err)
	}
	user, err := repo.CreateUser(ctx, "token-user", "hash", "salt", []int{adminRole.ID}, nil)
	if err != nil {
		t.Fatalf("CreateUser() error = %v", err)
	}
	record, err := repo.GetUserByID(ctx, user.ID)
	if err != nil {
		t.Fatalf("GetUserByID() error = %v", err)
	}

	pair := domainauth.TokenPair{
		AccessToken:           "live-access-token",
		AccessTokenExpiresAt:  time.Now().UTC().Add(time.Hour),
		RefreshToken:          "live-refresh-token",
		RefreshTokenExpiresAt: time.Now().UTC().Add(time.Hour),
	}
	if err := repo.CreateSession(ctx, *record, pair); err != nil {
		t.Fatalf("CreateSession() error = %v", err)
	}

	refreshRecord, _, err := repo.GetRefreshToken(ctx, hashToken(pair.RefreshToken))
	if err != nil {
		t.Fatalf("GetRefreshToken() error = %v", err)
	}
	if refreshRecord == nil {
		t.Fatal("expected refresh token record")
	}

	revokedAt := time.Now().UTC()
	if err := repo.RevokeRefreshToken(ctx, refreshRecord.ID, revokedAt); err != nil {
		t.Fatalf("RevokeRefreshToken() error = %v", err)
	}
	revokedRecord, _, err := repo.GetRefreshToken(ctx, hashToken(pair.RefreshToken))
	if err != nil {
		t.Fatalf("GetRefreshToken() after revoke error = %v", err)
	}
	if revokedRecord == nil || revokedRecord.RevokedAt == nil {
		t.Fatalf("expected revoked refresh token, got %+v", revokedRecord)
	}

	if err := repo.DeleteAccessTokenByHash(ctx, hashToken(pair.AccessToken)); err != nil {
		t.Fatalf("DeleteAccessTokenByHash() error = %v", err)
	}
	accessIdentity, _, err := repo.GetAccessTokenIdentity(ctx, hashToken(pair.AccessToken))
	if err != nil {
		t.Fatalf("GetAccessTokenIdentity() after delete error = %v", err)
	}
	if accessIdentity != nil {
		t.Fatalf("expected deleted access token to be absent, got %+v", accessIdentity)
	}
}

func TestAuthRepositoryRevokeAndDeleteAllTokensForUser(t *testing.T) {
	db := newTestDB(t)
	repo := NewAuthRepository(db)
	ctx := context.Background()

	adminRole, err := repo.GetRoleByName(ctx, "Administrator")
	if err != nil {
		t.Fatalf("GetRoleByName() error = %v", err)
	}
	user, err := repo.CreateUser(ctx, "all-token-user", "hash", "salt", []int{adminRole.ID}, nil)
	if err != nil {
		t.Fatalf("CreateUser() error = %v", err)
	}
	record, err := repo.GetUserByID(ctx, user.ID)
	if err != nil {
		t.Fatalf("GetUserByID() error = %v", err)
	}

	for index := range 2 {
		pair := domainauth.TokenPair{
			AccessToken:           "access-token-" + string(rune('A'+index)),
			AccessTokenExpiresAt:  time.Now().UTC().Add(time.Hour),
			RefreshToken:          "refresh-token-" + string(rune('A'+index)),
			RefreshTokenExpiresAt: time.Now().UTC().Add(time.Hour),
		}
		if err := repo.CreateSession(ctx, *record, pair); err != nil {
			t.Fatalf("CreateSession() #%d error = %v", index, err)
		}
	}

	if got := countRows(t, db, `SELECT COUNT(*) FROM AccessTokens WHERE UserId = ?`, user.ID); got != 2 {
		t.Fatalf("expected 2 access tokens before delete-all, got %d", got)
	}
	if got := countRows(t, db, `SELECT COUNT(*) FROM RefreshTokens WHERE UserId = ? AND RevokedAt IS NULL`, user.ID); got != 2 {
		t.Fatalf("expected 2 active refresh tokens before revoke-all, got %d", got)
	}

	if err := repo.RevokeAllRefreshTokensForUser(ctx, user.ID); err != nil {
		t.Fatalf("RevokeAllRefreshTokensForUser() error = %v", err)
	}
	if err := repo.DeleteAllAccessTokensForUser(ctx, user.ID); err != nil {
		t.Fatalf("DeleteAllAccessTokensForUser() error = %v", err)
	}

	if got := countRows(t, db, `SELECT COUNT(*) FROM AccessTokens WHERE UserId = ?`, user.ID); got != 0 {
		t.Fatalf("expected 0 access tokens after delete-all, got %d", got)
	}
	if got := countRows(t, db, `SELECT COUNT(*) FROM RefreshTokens WHERE UserId = ? AND RevokedAt IS NULL`, user.ID); got != 0 {
		t.Fatalf("expected 0 active refresh tokens after revoke-all, got %d", got)
	}
}

func TestDeviceRepositoryInsertFindAndDelete(t *testing.T) {
	db := newTestDB(t)
	repo := NewDeviceRepository(db)
	ctx := context.Background()

	ip := "192.168.0.10"
	port := 5555
	now := time.Now().UTC()
	device := &domaindevice.Device{
		Name:      "Pixel",
		Serial:    "192.168.0.10:5555",
		IPAddress: &ip,
		Port:      &port,
		Status:    "online",
		LastSeen:  now,
		CreatedAt: now,
		UpdatedAt: now,
	}

	if err := repo.Insert(ctx, device); err != nil {
		t.Fatalf("Insert() error = %v", err)
	}
	if device.ID == 0 {
		t.Fatal("expected inserted device id to be assigned")
	}

	found, err := repo.FindBySerialOrAddress(ctx, device.Serial, device.IPAddress, device.Port)
	if err != nil {
		t.Fatalf("FindBySerialOrAddress() error = %v", err)
	}
	if found == nil || found.ID != device.ID {
		t.Fatalf("expected to find inserted device, got %+v", found)
	}

	if err := repo.Delete(ctx, device.ID); err != nil {
		t.Fatalf("Delete() error = %v", err)
	}
	deleted, err := repo.GetByID(ctx, device.ID)
	if err != nil {
		t.Fatalf("GetByID() after delete error = %v", err)
	}
	if deleted != nil {
		t.Fatalf("expected deleted device to be nil, got %+v", deleted)
	}
}

func TestDeviceSettingsRepositoryDefaultsAndRoundTrip(t *testing.T) {
	db := newTestDB(t)
	repo := NewDeviceSettingsRepository(db)
	ctx := context.Background()

	defaults, err := repo.GetBySerial(ctx, "missing-serial")
	if err != nil {
		t.Fatalf("GetBySerial() missing error = %v", err)
	}
	if defaults.VideoCodec != domaindevice.DefaultSettingsProfile().VideoCodec {
		t.Fatalf("expected default settings profile, got %+v", defaults)
	}

	profile := domaindevice.DefaultSettingsProfile()
	profile.VideoCodec = "h265"
	profile.Video = false

	saved, err := repo.SaveBySerial(ctx, "serial-1", profile)
	if err != nil {
		t.Fatalf("SaveBySerial() error = %v", err)
	}
	if saved.VideoCodec != "h265" {
		t.Fatalf("expected saved codec h265, got %s", saved.VideoCodec)
	}

	loaded, err := repo.GetBySerial(ctx, "serial-1")
	if err != nil {
		t.Fatalf("GetBySerial() loaded error = %v", err)
	}
	if loaded.VideoCodec != "h265" || loaded.Video != false {
		t.Fatalf("expected saved settings to round-trip, got %+v", loaded)
	}

	if err := repo.DeleteBySerial(ctx, "serial-1"); err != nil {
		t.Fatalf("DeleteBySerial() error = %v", err)
	}
	afterDelete, err := repo.GetBySerial(ctx, "serial-1")
	if err != nil {
		t.Fatalf("GetBySerial() after delete error = %v", err)
	}
	if afterDelete.VideoCodec != domaindevice.DefaultSettingsProfile().VideoCodec {
		t.Fatalf("expected defaults after delete, got %+v", afterDelete)
	}
}
