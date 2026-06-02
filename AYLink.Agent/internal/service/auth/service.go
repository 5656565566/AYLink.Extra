package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	domainauth "aylink-agent/internal/domain/auth"
	"aylink-agent/internal/infra/logging"

	"golang.org/x/crypto/pbkdf2"
)

const (
	passwordIterations = 120_000
	passwordHashSize   = 32
	passwordSaltSize   = 16
	accessTokenTTL     = 15 * time.Minute
	refreshTokenTTL    = 14 * 24 * time.Hour
)

var (
	ErrInvalidCredentials = errors.New("invalid credentials")
	ErrInvalidRefresh     = errors.New("invalid refresh token")
	ErrUnauthorized       = errors.New("unauthorized")
	ErrUsernameExists     = errors.New("username already exists")
	ErrRoleExists         = errors.New("role already exists")
	ErrPasswordEmpty      = errors.New("password is required")
	ErrUsernameRequired   = errors.New("username is required")
	ErrCurrentUserLocked  = errors.New("You cannot disable the account that is currently signed in")
	ErrUserNotFound       = errors.New("user not found")
	ErrCurrentPassword    = errors.New("Current password is incorrect")
	ErrRoleNameRequired   = errors.New("role name is required")
	ErrRoleNotFound       = errors.New("role not found")
)

var AllPermissions = []string{
	"dashboard.view",
	"devices.view",
	"devices.manage",
	"devices.control",
	"files.access",
	"terminal.access",
	"settings.view",
	"settings.manage",
	"accounts.view",
	"accounts.manage",
	"accounts.change-password",
}

type Service struct {
	repo   domainauth.Repository
	logger logging.Logger
}

func NewService(repo domainauth.Repository, logger logging.Logger) *Service {
	return &Service{repo: repo, logger: logger}
}

func (s *Service) EnsureBootstrapAdmin(ctx context.Context) error {
	users, err := s.repo.ListUsers(ctx)
	if err != nil {
		return err
	}
	if len(users) > 0 {
		return nil
	}

	username := "admin"
	password, err := generateToken(24) // 生成初始随机密码
	if err != nil {
		return err
	}
	salt, err := createSalt()
	if err != nil {
		return err
	}
	hash := hashPassword(password, salt)

	// 需要 Administrator 角色的 ID
	role, err := s.repo.GetRoleByName(ctx, "Administrator")
	if err != nil {
		return err
	}
	if role == nil {
		return errors.New("Administrator role missing during bootstrap")
	}

	_, err = s.repo.CreateUser(ctx, username, hash, salt, []int{role.ID}, nil)
	if err != nil {
		return err
	}

	fmt.Println("================================================================")
	fmt.Println("AYLink initial administrator account created.")
	fmt.Printf("Username: %s\n", username)
	fmt.Printf("Password: %s\n", password)
	fmt.Println("Please sign in and change or reset this password as soon as possible.")
	fmt.Println("================================================================")

	return nil
}

func (s *Service) Login(ctx context.Context, username, password string) (*domainauth.LoginResult, error) {
	user, err := s.repo.GetUserByUsername(ctx, username)
	if err != nil {
		return nil, err
	}
	if user == nil || !user.IsActive || !verifyPassword(password, user.PasswordSalt, user.PasswordHash) {
		return nil, ErrInvalidCredentials
	}
	return s.createLoginResult(ctx, *user)
}

func (s *Service) Refresh(ctx context.Context, refreshToken string) (*domainauth.LoginResult, error) {
	if strings.TrimSpace(refreshToken) == "" {
		return nil, ErrInvalidRefresh
	}
	if err := s.repo.CleanupExpiredTokens(ctx, time.Now().UTC()); err != nil {
		return nil, err
	}

	tokenRecord, user, err := s.repo.GetRefreshToken(ctx, hashToken(refreshToken))
	if err != nil {
		return nil, err
	}
	if tokenRecord == nil || user == nil || tokenRecord.RevokedAt != nil || !tokenRecord.ExpiresAt.After(time.Now().UTC()) || !user.IsActive {
		return nil, ErrInvalidRefresh
	}
	if err := s.repo.RevokeRefreshToken(ctx, tokenRecord.ID, time.Now().UTC()); err != nil {
		return nil, err
	}
	return s.createLoginResult(ctx, *user)
}

func (s *Service) CurrentUser(ctx context.Context, accessToken string) (*domainauth.User, error) {
	identity, err := s.ValidateAccessToken(ctx, accessToken)
	if err != nil {
		return nil, err
	}
	user, err := s.buildUser(ctx, identity.UserID)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, ErrUnauthorized
	}
	return user, nil
}

func (s *Service) ValidateAccessToken(ctx context.Context, accessToken string) (*domainauth.Identity, error) {
	if strings.TrimSpace(accessToken) == "" {
		return nil, ErrUnauthorized
	}
	if err := s.repo.CleanupExpiredTokens(ctx, time.Now().UTC()); err != nil {
		return nil, err
	}

	user, expiresAt, err := s.repo.GetAccessTokenIdentity(ctx, hashToken(accessToken))
	if err != nil {
		return nil, err
	}
	if user == nil || !expiresAt.After(time.Now().UTC()) || !user.IsActive {
		return nil, ErrUnauthorized
	}

	permissions, err := s.repo.GetPermissionsForUser(ctx, user.ID)
	if err != nil {
		return nil, err
	}
	isAdministrator, err := s.repo.IsUserAdministrator(ctx, user.ID)
	if err != nil {
		return nil, err
	}
	if err := s.repo.TouchAccessToken(ctx, hashToken(accessToken), time.Now().UTC()); err != nil {
		return nil, err
	}
	return &domainauth.Identity{
		UserID:               user.ID,
		Username:             user.Username,
		Permissions:          permissions,
		IsAdministrator:      isAdministrator,
		AccessToken:          accessToken,
		AccessTokenExpiresAt: expiresAt,
	}, nil
}

func (s *Service) Logout(ctx context.Context, accessToken, refreshToken string) error {
	if token := strings.TrimSpace(accessToken); token != "" {
		if err := s.repo.DeleteAccessTokenByHash(ctx, hashToken(token)); err != nil {
			return err
		}
	}
	if token := strings.TrimSpace(refreshToken); token != "" {
		if err := s.repo.RevokeRefreshTokenByHash(ctx, hashToken(token), time.Now().UTC()); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) LogoutAll(ctx context.Context, userID int) error {
	if err := s.repo.RevokeAllRefreshTokensForUser(ctx, userID); err != nil {
		return err
	}
	return s.repo.DeleteAllAccessTokensForUser(ctx, userID)
}

func (s *Service) GetUsers(ctx context.Context) ([]domainauth.User, error) {
	return s.repo.ListUsers(ctx)
}

func (s *Service) CreateUser(ctx context.Context, username, password string, roleIds []int, deviceGroupIDs []int) (*domainauth.User, error) {
	if strings.TrimSpace(username) == "" {
		return nil, ErrUsernameRequired
	}
	if strings.TrimSpace(password) == "" {
		return nil, ErrPasswordEmpty
	}

	existing, err := s.repo.GetUserByUsername(ctx, username)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return nil, ErrUsernameExists
	}

	salt, err := createSalt()
	if err != nil {
		return nil, err
	}
	hash := hashPassword(password, salt)

	return s.repo.CreateUser(ctx, strings.TrimSpace(username), hash, salt, normalizeIds(roleIds), normalizeIds(deviceGroupIDs))
}

func (s *Service) UpdateUser(ctx context.Context, userID int, username string, isActive bool, roleIds []int, deviceGroupIDs []int, actingUserID *int) (*domainauth.User, error) {
	if actingUserID != nil && *actingUserID == userID && !isActive {
		return nil, ErrCurrentUserLocked
	}

	trimmedUsername := strings.TrimSpace(username)
	existing, err := s.repo.GetUserByUsername(ctx, trimmedUsername)
	if err != nil {
		return nil, err
	}
	if existing != nil && existing.ID != userID {
		return nil, ErrUsernameExists
	}

	user, err := s.repo.UpdateUser(ctx, userID, trimmedUsername, isActive, normalizeIds(roleIds), normalizeIds(deviceGroupIDs))
	if err != nil {
		return nil, err
	}

	if !isActive {
		if err := s.LogoutAll(ctx, userID); err != nil {
			return nil, err
		}
	}

	return user, nil
}

func (s *Service) ResetPassword(ctx context.Context, userID int, newPassword string) (string, error) {
	password := strings.TrimSpace(newPassword)
	var err error
	if password == "" {
		password, err = generateToken(24)
		if err != nil {
			return "", err
		}
	}
	salt, err := createSalt()
	if err != nil {
		return "", err
	}
	hash := hashPassword(password, salt)

	if err := s.repo.UpdateUserPassword(ctx, userID, hash, salt); err != nil {
		return "", err
	}

	if err := s.LogoutAll(ctx, userID); err != nil {
		return "", err
	}
	return password, nil
}

func (s *Service) ChangeOwnPassword(ctx context.Context, userID int, currentPassword, newPassword string) error {
	user, err := s.repo.GetUserByID(ctx, userID)
	if err != nil {
		return err
	}
	if user == nil {
		return ErrUserNotFound
	}

	if !verifyPassword(currentPassword, user.PasswordSalt, user.PasswordHash) {
		return ErrCurrentPassword
	}

	trimmedNewPassword := strings.TrimSpace(newPassword)
	if trimmedNewPassword == "" {
		return ErrPasswordEmpty
	}

	salt, err := createSalt()
	if err != nil {
		return err
	}
	hash := hashPassword(trimmedNewPassword, salt)

	if err := s.repo.UpdateUserPassword(ctx, userID, hash, salt); err != nil {
		return err
	}

	return s.LogoutAll(ctx, userID)
}

func (s *Service) SetUserActiveState(ctx context.Context, userID int, isActive bool, actingUserID *int) error {
	if actingUserID != nil && *actingUserID == userID && !isActive {
		return ErrCurrentUserLocked
	}

	user, err := s.repo.GetUserByID(ctx, userID)
	if err != nil {
		return err
	}
	if user == nil {
		return ErrUserNotFound
	}

	// 通过保持角色不变复用 UpdateUser 从而去设置 Active 状态
	roles, err := s.repo.GetRoleSummariesForUser(ctx, userID)
	if err != nil {
		return err
	}
	var roleIds []int
	for _, r := range roles {
		roleIds = append(roleIds, r.ID)
	}

	directGroupSummaries, err := s.repo.GetDirectDeviceGroupsForUser(ctx, userID)
	if err != nil {
		return err
	}
	directGroupIDs := make([]int, 0, len(directGroupSummaries))
	for _, group := range directGroupSummaries {
		directGroupIDs = append(directGroupIDs, group.ID)
	}

	_, err = s.repo.UpdateUser(ctx, userID, user.Username, isActive, roleIds, directGroupIDs)
	if err == nil && !isActive {
		err = s.LogoutAll(ctx, userID)
	}

	return err
}

func (s *Service) GetRoles(ctx context.Context) ([]domainauth.Role, error) {
	return s.repo.ListRoles(ctx)
}

func (s *Service) CreateRole(ctx context.Context, name, description string, permissions []string, deviceGroupIDs []int) (*domainauth.Role, error) {
	trimmedName := strings.TrimSpace(name)
	if trimmedName == "" {
		return nil, ErrRoleNameRequired
	}

	existing, err := s.repo.GetRoleByName(ctx, trimmedName)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return nil, ErrRoleExists
	}

	normalizedPerms, err := validatePermissions(permissions)
	if err != nil {
		return nil, err
	}

	return s.repo.CreateRole(ctx, trimmedName, strings.TrimSpace(description), normalizedPerms, normalizeIds(deviceGroupIDs))
}

func (s *Service) UpdateRole(ctx context.Context, roleID int, name, description string, permissions []string, deviceGroupIDs []int) (*domainauth.Role, error) {
	trimmedName := strings.TrimSpace(name)
	if trimmedName == "" {
		return nil, ErrRoleNameRequired
	}

	existingNameCheck, err := s.repo.GetRoleByName(ctx, trimmedName)
	if err != nil {
		return nil, err
	}
	if existingNameCheck != nil && existingNameCheck.ID != roleID {
		return nil, ErrRoleExists
	}

	existingRole, err := s.repo.GetRoleByID(ctx, roleID)
	if err != nil {
		return nil, err
	}
	if existingRole == nil {
		return nil, ErrRoleNotFound
	}

	var normalizedPerms []string
	if existingRole.IsInternal {
		normalizedPerms = existingRole.Permissions
	} else {
		normalizedPerms, err = validatePermissions(permissions)
		if err != nil {
			return nil, err
		}
	}

	return s.repo.UpdateRole(ctx, roleID, trimmedName, strings.TrimSpace(description), normalizedPerms, normalizeIds(deviceGroupIDs))
}

func (s *Service) GetAvailablePermissions() []domainauth.PermissionDescriptor {
	result := make([]domainauth.PermissionDescriptor, 0)
	for _, code := range AllPermissions {
		result = append(result, domainauth.PermissionDescriptor{
			Code:        code,
			Description: describePermission(code),
		})
	}
	return result
}

func (s *Service) createLoginResult(ctx context.Context, user domainauth.UserRecord) (*domainauth.LoginResult, error) {
	now := time.Now().UTC()
	accessToken, err := generateToken(32)
	if err != nil {
		return nil, err
	}
	refreshToken, err := generateToken(48)
	if err != nil {
		return nil, err
	}
	pair := domainauth.TokenPair{
		AccessToken:           accessToken,
		AccessTokenExpiresAt:  now.Add(accessTokenTTL),
		RefreshToken:          refreshToken,
		RefreshTokenExpiresAt: now.Add(refreshTokenTTL),
	}
	if err := s.repo.CreateSession(ctx, user, pair); err != nil {
		return nil, err
	}

	currentUser, err := s.buildUser(ctx, user.ID)
	if err != nil {
		return nil, err
	}
	if currentUser == nil {
		return nil, ErrUnauthorized
	}
	return &domainauth.LoginResult{
		Success:               true,
		AccessToken:           pair.AccessToken,
		AccessTokenExpiresAt:  pair.AccessTokenExpiresAt,
		RefreshToken:          pair.RefreshToken,
		RefreshTokenExpiresAt: pair.RefreshTokenExpiresAt,
		User:                  *currentUser,
		Permissions:           currentUser.Permissions,
	}, nil
}

func (s *Service) buildUser(ctx context.Context, userID int) (*domainauth.User, error) {
	record, err := s.repo.GetUserByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if record == nil {
		return nil, nil
	}
	roles, err := s.repo.GetRoleSummariesForUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	permissions, err := s.repo.GetPermissionsForUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	directGroups, err := s.repo.GetDirectDeviceGroupsForUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	effectiveGroups, err := s.repo.GetEffectiveDeviceGroupsForUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	deviceCount, err := s.repo.CountAccessibleDevicesForUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	return &domainauth.User{
		ID:                        record.ID,
		Username:                  record.Username,
		IsActive:                  record.IsActive,
		LastLoginAt:               record.LastLoginAt,
		Roles:                     roles,
		Permissions:               permissions,
		DirectDeviceGroups:        directGroups,
		EffectiveDeviceGroups:     effectiveGroups,
		EffectiveDeviceGroupCount: len(effectiveGroups),
		EffectiveDeviceCount:      deviceCount,
	}, nil
}

func verifyPassword(password, salt, expectedHash string) bool {
	saltBytes, err := base64.StdEncoding.DecodeString(salt)
	if err != nil {
		return false
	}
	hashBytes := pbkdf2.Key([]byte(password), saltBytes, passwordIterations, passwordHashSize, sha256.New)
	actual := base64.StdEncoding.EncodeToString(hashBytes)
	return subtle.ConstantTimeCompare([]byte(actual), []byte(expectedHash)) == 1
}

func generateToken(length int) (string, error) {
	bytes := make([]byte, length)
	if _, err := rand.Read(bytes); err != nil {
		return "", fmt.Errorf("generate token entropy: %w", err)
	}
	return strings.TrimRight(base64.StdEncoding.EncodeToString(bytes), "="), nil
}

func createSalt() (string, error) {
	bytes := make([]byte, passwordSaltSize)
	if _, err := rand.Read(bytes); err != nil {
		return "", fmt.Errorf("generate password salt entropy: %w", err)
	}
	return base64.StdEncoding.EncodeToString(bytes), nil
}

func hashPassword(password, salt string) string {
	saltBytes, _ := base64.StdEncoding.DecodeString(salt)
	hashBytes := pbkdf2.Key([]byte(password), saltBytes, passwordIterations, passwordHashSize, sha256.New)
	return base64.StdEncoding.EncodeToString(hashBytes)
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return strings.ToUpper(hex.EncodeToString(sum[:]))
}

func normalizeIds(ids []int) []int {
	seen := map[int]bool{}
	result := make([]int, 0)
	for _, id := range ids {
		if !seen[id] {
			seen[id] = true
			result = append(result, id)
		}
	}
	return result
}

func validatePermissions(permissions []string) ([]string, error) {
	validMap := map[string]bool{}
	for _, p := range AllPermissions {
		validMap[strings.ToLower(p)] = true
	}

	seen := map[string]bool{}
	result := make([]string, 0)
	invalid := make([]string, 0)

	for _, p := range permissions {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}

		// 映射回原来的字符大小写
		var matchedCode string
		for _, v := range AllPermissions {
			if strings.EqualFold(v, p) {
				matchedCode = v
				break
			}
		}

		if matchedCode == "" {
			invalid = append(invalid, p)
		} else if !seen[matchedCode] {
			seen[matchedCode] = true
			result = append(result, matchedCode)
		}
	}

	if len(invalid) > 0 {
		return nil, errors.New("Invalid permissions: " + strings.Join(invalid, ", "))
	}
	return result, nil
}

func describePermission(code string) string {
	switch code {
	case "dashboard.view":
		return "View the main dashboard"
	case "devices.view":
		return "View devices and device status"
	case "devices.manage":
		return "Add, edit, and delete devices"
	case "devices.control":
		return "Run device control operations"
	case "files.access":
		return "Access device file manager"
	case "terminal.access":
		return "Open device terminal sessions"
	case "settings.view":
		return "View system settings"
	case "settings.manage":
		return "Modify system settings"
	case "accounts.view":
		return "View account and role data"
	case "accounts.manage":
		return "Manage users, roles, and passwords"
	case "accounts.change-password":
		return "Change the signed-in user's own password"
	}
	return code
}
