package auth

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	domainauth "aylink-agent/internal/domain/auth"
)

type stubLogger struct{}

func (stubLogger) Debug(string, ...any) {}
func (stubLogger) Info(string, ...any)  {}
func (stubLogger) Warn(string, ...any)  {}
func (stubLogger) Error(string, ...any) {}

type fakeRepository struct {
	userRecord            *domainauth.UserRecord
	roleRecord            *domainauth.Role
	userByUsername        *domainauth.UserRecord
	roleSummaries         []domainauth.RoleSummary
	permissions           []string
	loginResultUser       *domainauth.UserRecord
	refreshTokenRecord    *domainauth.TokenRecord
	refreshTokenUser      *domainauth.UserRecord
	accessTokenUser       *domainauth.UserRecord
	accessTokenExpiresAt  time.Time
	cleanupCalled         bool
	createSessionCalled   bool
	lastSessionPair       domainauth.TokenPair
	lastSessionUser       domainauth.UserRecord
	revokedTokenID        int
	revokedTokenHash      string
	deletedAccessHash     string
	touchedAccessHash     string
	updatePasswordCalled  bool
	updatedPasswordHash   string
	updatedPasswordSalt   string
	revokeAllCalled       bool
	deleteAllAccessCalled bool
	createUserCalled      bool
	updateUserCalled      bool
	updateUserIsActive    bool
	updateUserRoleIDs     []int
	revokeAllErr          error
	deleteAllAccessErr    error
	deleteAccessErr       error
	revokeByHashErr       error
}

func mustCreateSalt(t *testing.T) string {
	t.Helper()

	salt, err := createSalt()
	if err != nil {
		t.Fatalf("createSalt() error = %v", err)
	}
	return salt
}

func (f *fakeRepository) GetUserByUsername(context.Context, string) (*domainauth.UserRecord, error) {
	return f.userByUsername, nil
}

func (f *fakeRepository) GetUserByID(context.Context, int) (*domainauth.UserRecord, error) {
	return f.userRecord, nil
}

func (f *fakeRepository) ListUsers(context.Context) ([]domainauth.User, error) { return nil, nil }

func (f *fakeRepository) CreateUser(_ context.Context, username, passwordHash, passwordSalt string, roleIds []int) (*domainauth.User, error) {
	f.createUserCalled = true
	return &domainauth.User{Username: username}, nil
}

func (f *fakeRepository) UpdateUser(_ context.Context, userID int, username string, isActive bool, roleIds []int) (*domainauth.User, error) {
	f.updateUserCalled = true
	f.updateUserIsActive = isActive
	f.updateUserRoleIDs = append([]int(nil), roleIds...)
	return &domainauth.User{ID: userID, Username: username, IsActive: isActive}, nil
}

func (f *fakeRepository) UpdateUserPassword(_ context.Context, userID int, passwordHash, passwordSalt string) error {
	if userID <= 0 {
		return errors.New("invalid user id")
	}
	f.updatePasswordCalled = true
	f.updatedPasswordHash = passwordHash
	f.updatedPasswordSalt = passwordSalt
	return nil
}

func (f *fakeRepository) ListRoles(context.Context) ([]domainauth.Role, error) { return nil, nil }
func (f *fakeRepository) GetRoleByName(context.Context, string) (*domainauth.Role, error) {
	return f.roleRecord, nil
}
func (f *fakeRepository) GetRoleByID(context.Context, int) (*domainauth.Role, error) {
	return f.roleRecord, nil
}
func (f *fakeRepository) CreateRole(context.Context, string, string, []string) (*domainauth.Role, error) {
	return nil, nil
}
func (f *fakeRepository) UpdateRole(context.Context, int, string, string, []string) (*domainauth.Role, error) {
	return nil, nil
}
func (f *fakeRepository) GetRefreshToken(context.Context, string) (*domainauth.TokenRecord, *domainauth.UserRecord, error) {
	return f.refreshTokenRecord, f.refreshTokenUser, nil
}
func (f *fakeRepository) GetAccessTokenIdentity(context.Context, string) (*domainauth.UserRecord, time.Time, error) {
	return f.accessTokenUser, f.accessTokenExpiresAt, nil
}
func (f *fakeRepository) GetRoleSummariesForUser(context.Context, int) ([]domainauth.RoleSummary, error) {
	return f.roleSummaries, nil
}
func (f *fakeRepository) GetPermissionsForUser(context.Context, int) ([]string, error) {
	return f.permissions, nil
}
func (f *fakeRepository) CreateSession(_ context.Context, user domainauth.UserRecord, pair domainauth.TokenPair) error {
	f.createSessionCalled = true
	f.lastSessionUser = user
	f.lastSessionPair = pair
	return nil
}
func (f *fakeRepository) RevokeRefreshToken(_ context.Context, tokenID int, _ time.Time) error {
	f.revokedTokenID = tokenID
	return nil
}
func (f *fakeRepository) RevokeRefreshTokenByHash(_ context.Context, tokenHash string, _ time.Time) error {
	f.revokedTokenHash = tokenHash
	return f.revokeByHashErr
}
func (f *fakeRepository) RevokeAllRefreshTokensForUser(context.Context, int) error {
	f.revokeAllCalled = true
	return f.revokeAllErr
}
func (f *fakeRepository) DeleteAccessTokenByHash(_ context.Context, tokenHash string) error {
	f.deletedAccessHash = tokenHash
	return f.deleteAccessErr
}
func (f *fakeRepository) DeleteAllAccessTokensForUser(context.Context, int) error {
	f.deleteAllAccessCalled = true
	return f.deleteAllAccessErr
}
func (f *fakeRepository) TouchAccessToken(_ context.Context, tokenHash string, _ time.Time) error {
	f.touchedAccessHash = tokenHash
	return nil
}
func (f *fakeRepository) CleanupExpiredTokens(context.Context, time.Time) error {
	f.cleanupCalled = true
	return nil
}

func TestCreateUserRejectsEmptyPassword(t *testing.T) {
	repo := &fakeRepository{}
	service := NewService(repo, stubLogger{})

	_, err := service.CreateUser(context.Background(), "tester", "   ", []int{1})
	if !errors.Is(err, ErrPasswordEmpty) {
		t.Fatalf("expected ErrPasswordEmpty, got %v", err)
	}
	if repo.createUserCalled {
		t.Fatal("expected repository CreateUser not to be called")
	}
}

func TestChangeOwnPasswordRejectsEmptyNewPassword(t *testing.T) {
	salt := mustCreateSalt(t)
	repo := &fakeRepository{
		userRecord: &domainauth.UserRecord{
			ID:           1,
			Username:     "tester",
			PasswordSalt: salt,
			PasswordHash: hashPassword("old-password", salt),
			IsActive:     true,
		},
	}
	service := NewService(repo, stubLogger{})

	err := service.ChangeOwnPassword(context.Background(), 1, "old-password", "   ")
	if !errors.Is(err, ErrPasswordEmpty) {
		t.Fatalf("expected ErrPasswordEmpty, got %v", err)
	}
	if repo.updatePasswordCalled {
		t.Fatal("expected password update not to be called")
	}
}

func TestChangeOwnPasswordUpdatesPasswordAndRevokesSessions(t *testing.T) {
	salt := mustCreateSalt(t)
	repo := &fakeRepository{
		userRecord: &domainauth.UserRecord{
			ID:           1,
			Username:     "tester",
			PasswordSalt: salt,
			PasswordHash: hashPassword("old-password", salt),
			IsActive:     true,
		},
	}
	service := NewService(repo, stubLogger{})

	err := service.ChangeOwnPassword(context.Background(), 1, "old-password", "new-password")
	if err != nil {
		t.Fatalf("expected nil error, got %v", err)
	}
	if !repo.updatePasswordCalled {
		t.Fatal("expected password update to be called")
	}
	if repo.updatedPasswordHash == "" || repo.updatedPasswordSalt == "" {
		t.Fatal("expected updated password hash and salt to be persisted")
	}
	if !verifyPassword("new-password", repo.updatedPasswordSalt, repo.updatedPasswordHash) {
		t.Fatal("expected stored hash to match new password")
	}
	if !repo.revokeAllCalled || !repo.deleteAllAccessCalled {
		t.Fatal("expected all sessions to be revoked after password change")
	}
}

func TestLoginReturnsInvalidCredentialsForInactiveUser(t *testing.T) {
	salt := mustCreateSalt(t)
	repo := &fakeRepository{
		userByUsername: &domainauth.UserRecord{
			ID:           1,
			Username:     "tester",
			PasswordSalt: salt,
			PasswordHash: hashPassword("secret", salt),
			IsActive:     false,
		},
	}
	service := NewService(repo, stubLogger{})

	_, err := service.Login(context.Background(), "tester", "secret")
	if !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("expected ErrInvalidCredentials, got %v", err)
	}
}

func TestLoginCreatesSessionForValidUser(t *testing.T) {
	salt := mustCreateSalt(t)
	repo := &fakeRepository{
		userByUsername: &domainauth.UserRecord{
			ID:           42,
			Username:     "tester",
			PasswordSalt: salt,
			PasswordHash: hashPassword("secret", salt),
			IsActive:     true,
		},
		userRecord: &domainauth.UserRecord{
			ID:       42,
			Username: "tester",
			IsActive: true,
		},
		roleSummaries: []domainauth.RoleSummary{{ID: 1, Name: "Administrator"}},
		permissions:   []string{"devices.view"},
	}
	service := NewService(repo, stubLogger{})

	result, err := service.Login(context.Background(), "tester", "secret")
	if err != nil {
		t.Fatalf("expected nil error, got %v", err)
	}
	if result == nil || !result.Success {
		t.Fatalf("expected successful login result, got %+v", result)
	}
	if !repo.createSessionCalled {
		t.Fatal("expected CreateSession to be called")
	}
	if repo.lastSessionUser.ID != 42 {
		t.Fatalf("expected session user id 42, got %d", repo.lastSessionUser.ID)
	}
	if repo.lastSessionPair.AccessToken == "" || repo.lastSessionPair.RefreshToken == "" {
		t.Fatal("expected generated token pair")
	}
}

func TestRefreshRevokesOldTokenAndCreatesNewSession(t *testing.T) {
	expiresAt := time.Now().UTC().Add(time.Hour)
	repo := &fakeRepository{
		refreshTokenRecord: &domainauth.TokenRecord{
			ID:        55,
			UserID:    7,
			ExpiresAt: expiresAt,
		},
		refreshTokenUser: &domainauth.UserRecord{
			ID:       7,
			Username: "tester",
			IsActive: true,
		},
		userRecord: &domainauth.UserRecord{
			ID:       7,
			Username: "tester",
			IsActive: true,
		},
		roleSummaries: []domainauth.RoleSummary{{ID: 1, Name: "Administrator"}},
		permissions:   []string{"devices.view"},
	}
	service := NewService(repo, stubLogger{})

	result, err := service.Refresh(context.Background(), "refresh-token")
	if err != nil {
		t.Fatalf("expected nil error, got %v", err)
	}
	if result == nil || !result.Success {
		t.Fatalf("expected successful refresh result, got %+v", result)
	}
	if !repo.cleanupCalled {
		t.Fatal("expected CleanupExpiredTokens to be called")
	}
	if repo.revokedTokenID != 55 {
		t.Fatalf("expected old refresh token id 55 to be revoked, got %d", repo.revokedTokenID)
	}
	if !repo.createSessionCalled {
		t.Fatal("expected CreateSession to be called for rotated token pair")
	}
}

func TestValidateAccessTokenTouchesTokenAndLoadsPermissions(t *testing.T) {
	repo := &fakeRepository{
		accessTokenUser: &domainauth.UserRecord{
			ID:       9,
			Username: "tester",
			IsActive: true,
		},
		accessTokenExpiresAt: time.Now().UTC().Add(time.Hour),
		permissions:          []string{"devices.view", "devices.control"},
	}
	service := NewService(repo, stubLogger{})

	identity, err := service.ValidateAccessToken(context.Background(), "access-token")
	if err != nil {
		t.Fatalf("expected nil error, got %v", err)
	}
	if identity == nil || identity.UserID != 9 {
		t.Fatalf("expected identity for user 9, got %+v", identity)
	}
	if repo.touchedAccessHash != hashToken("access-token") {
		t.Fatalf("expected access token hash to be touched, got %s", repo.touchedAccessHash)
	}
	if len(identity.Permissions) != 2 {
		t.Fatalf("expected 2 permissions, got %+v", identity.Permissions)
	}
}

func TestUpdateUserRejectsDisablingCurrentUser(t *testing.T) {
	repo := &fakeRepository{}
	service := NewService(repo, stubLogger{})
	currentUserID := 3

	_, err := service.UpdateUser(context.Background(), 3, "tester", false, []int{1}, &currentUserID)
	if err == nil || !strings.Contains(err.Error(), "currently signed in") {
		t.Fatalf("expected self-disable error, got %v", err)
	}
	if repo.updateUserCalled {
		t.Fatal("expected repository UpdateUser not to be called")
	}
}

func TestSetUserActiveStateUsesExistingRoles(t *testing.T) {
	repo := &fakeRepository{
		userRecord: &domainauth.UserRecord{
			ID:       5,
			Username: "tester",
			IsActive: true,
		},
		roleSummaries: []domainauth.RoleSummary{
			{ID: 10, Name: "RoleA"},
			{ID: 20, Name: "RoleB"},
		},
	}
	service := NewService(repo, stubLogger{})

	if err := service.SetUserActiveState(context.Background(), 5, false, nil); err != nil {
		t.Fatalf("expected nil error, got %v", err)
	}
	if !repo.updateUserCalled {
		t.Fatal("expected UpdateUser to be called")
	}
	if repo.updateUserIsActive {
		t.Fatal("expected UpdateUser to disable the user")
	}
	if len(repo.updateUserRoleIDs) != 2 || repo.updateUserRoleIDs[0] != 10 || repo.updateUserRoleIDs[1] != 20 {
		t.Fatalf("expected existing role IDs to be preserved, got %+v", repo.updateUserRoleIDs)
	}
	if !repo.revokeAllCalled || !repo.deleteAllAccessCalled {
		t.Fatal("expected sessions to be revoked when disabling user")
	}
}

func TestResetPasswordReturnsLogoutError(t *testing.T) {
	repo := &fakeRepository{
		revokeAllErr: errors.New("revoke failed"),
	}
	service := NewService(repo, stubLogger{})

	password, err := service.ResetPassword(context.Background(), 7, "new-password")
	if err == nil || err.Error() != "revoke failed" {
		t.Fatalf("expected revoke failed error, got %v", err)
	}
	if password != "" {
		t.Fatalf("expected empty password on logout failure, got %q", password)
	}
	if !repo.updatePasswordCalled {
		t.Fatal("expected password to be updated before logout attempt")
	}
}

func TestChangeOwnPasswordReturnsLogoutError(t *testing.T) {
	salt := mustCreateSalt(t)
	repo := &fakeRepository{
		userRecord: &domainauth.UserRecord{
			ID:           1,
			Username:     "tester",
			PasswordSalt: salt,
			PasswordHash: hashPassword("old-password", salt),
			IsActive:     true,
		},
		revokeAllErr: errors.New("revoke failed"),
	}
	service := NewService(repo, stubLogger{})

	err := service.ChangeOwnPassword(context.Background(), 1, "old-password", "new-password")
	if err == nil || err.Error() != "revoke failed" {
		t.Fatalf("expected revoke failed error, got %v", err)
	}
}

func TestValidatePermissionsNormalizesAndRejectsInvalidValues(t *testing.T) {
	perms, err := validatePermissions([]string{" DEVICES.VIEW ", "devices.view", "terminal.access"})
	if err != nil {
		t.Fatalf("expected nil error, got %v", err)
	}
	if len(perms) != 2 || perms[0] != "devices.view" || perms[1] != "terminal.access" {
		t.Fatalf("expected normalized unique permissions, got %+v", perms)
	}

	_, err = validatePermissions([]string{"devices.view", "not.real"})
	if err == nil {
		t.Fatal("expected invalid permissions error")
	}
}

func TestLogoutDeletesAndRevokesProvidedTokens(t *testing.T) {
	repo := &fakeRepository{}
	service := NewService(repo, stubLogger{})

	if err := service.Logout(context.Background(), "access-token", "refresh-token"); err != nil {
		t.Fatalf("expected nil error, got %v", err)
	}
	if repo.deletedAccessHash != hashToken("access-token") {
		t.Fatalf("expected deleted access hash %s, got %s", hashToken("access-token"), repo.deletedAccessHash)
	}
	if repo.revokedTokenHash != hashToken("refresh-token") {
		t.Fatalf("expected revoked refresh hash %s, got %s", hashToken("refresh-token"), repo.revokedTokenHash)
	}
}
