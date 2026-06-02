package auth

import (
	"context"
	"time"

	domaindevice "aylink-agent/internal/domain/device"
)

type RoleSummary struct {
	ID          int    `json:"Id"`
	Name        string `json:"Name"`
	Description string `json:"Description"`
}

type User struct {
	ID                        int                         `json:"Id"`
	Username                  string                      `json:"Username"`
	IsActive                  bool                        `json:"IsActive"`
	CreatedAt                 time.Time                   `json:"CreatedAt"`
	UpdatedAt                 time.Time                   `json:"UpdatedAt"`
	LastLoginAt               *time.Time                  `json:"LastLoginAt"`
	Roles                     []RoleSummary               `json:"Roles"`
	Permissions               []string                    `json:"Permissions"`
	DirectDeviceGroups        []domaindevice.GroupSummary `json:"DirectDeviceGroups,omitempty"`
	EffectiveDeviceGroups     []domaindevice.GroupSummary `json:"EffectiveDeviceGroups,omitempty"`
	EffectiveDeviceCount      int                         `json:"EffectiveDeviceCount,omitempty"`
	EffectiveDeviceGroupCount int                         `json:"EffectiveDeviceGroupCount,omitempty"`
}

type Role struct {
	ID           int                         `json:"Id"`
	Name         string                      `json:"Name"`
	Description  string                      `json:"Description"`
	IsInternal   bool                        `json:"IsInternal"`
	Permissions  []string                    `json:"Permissions"`
	DeviceGroups []domaindevice.GroupSummary `json:"DeviceGroups,omitempty"`
}

type LoginResult struct {
	Success               bool      `json:"success"`
	AccessToken           string    `json:"accessToken"`
	AccessTokenExpiresAt  time.Time `json:"accessTokenExpiresAt"`
	RefreshToken          string    `json:"refreshToken"`
	RefreshTokenExpiresAt time.Time `json:"refreshTokenExpiresAt"`
	User                  User      `json:"user"`
	Permissions           []string  `json:"permissions"`
}

type Identity struct {
	UserID               int
	Username             string
	Permissions          []string
	IsAdministrator      bool
	AccessToken          string
	AccessTokenExpiresAt time.Time
}

type TokenRecord struct {
	ID        int
	UserID    int
	ExpiresAt time.Time
	RevokedAt *time.Time
}

type UserRecord struct {
	ID           int
	Username     string
	PasswordHash string
	PasswordSalt string
	IsActive     bool
	CreatedAt    time.Time
	UpdatedAt    time.Time
	LastLoginAt  *time.Time
}

type TokenPair struct {
	AccessToken           string
	AccessTokenExpiresAt  time.Time
	RefreshToken          string
	RefreshTokenExpiresAt time.Time
}

type PermissionDescriptor struct {
	Code        string `json:"Code"`
	Description string `json:"Description"`
}

type Repository interface {
	GetUserByUsername(ctx context.Context, username string) (*UserRecord, error)
	GetUserByID(ctx context.Context, userID int) (*UserRecord, error)
	ListUsers(ctx context.Context) ([]User, error)
	CreateUser(ctx context.Context, username, passwordHash, passwordSalt string, roleIds []int, deviceGroupIDs []int) (*User, error)
	UpdateUser(ctx context.Context, userID int, username string, isActive bool, roleIds []int, deviceGroupIDs []int) (*User, error)
	DeleteUser(ctx context.Context, userID int) error
	UpdateUserPassword(ctx context.Context, userID int, passwordHash, passwordSalt string) error

	ListRoles(ctx context.Context) ([]Role, error)
	GetRoleByName(ctx context.Context, name string) (*Role, error)
	GetRoleByID(ctx context.Context, id int) (*Role, error)
	CreateRole(ctx context.Context, name, description string, permissions []string, deviceGroupIDs []int) (*Role, error)
	UpdateRole(ctx context.Context, roleID int, name, description string, permissions []string, deviceGroupIDs []int) (*Role, error)

	GetRefreshToken(ctx context.Context, tokenHash string) (*TokenRecord, *UserRecord, error)
	GetAccessTokenIdentity(ctx context.Context, tokenHash string) (*UserRecord, time.Time, error)
	GetRoleSummariesForUser(ctx context.Context, userID int) ([]RoleSummary, error)
	GetPermissionsForUser(ctx context.Context, userID int) ([]string, error)
	IsUserAdministrator(ctx context.Context, userID int) (bool, error)
	GetDirectDeviceGroupsForUser(ctx context.Context, userID int) ([]domaindevice.GroupSummary, error)
	GetEffectiveDeviceGroupsForUser(ctx context.Context, userID int) ([]domaindevice.GroupSummary, error)
	GetDeviceGroupsForRole(ctx context.Context, roleID int) ([]domaindevice.GroupSummary, error)
	GetDeviceGroupsByIDs(ctx context.Context, ids []int) ([]domaindevice.GroupSummary, error)
	SetDirectDeviceGroupsForUser(ctx context.Context, userID int, groupIDs []int) error
	SetDeviceGroupsForRole(ctx context.Context, roleID int, groupIDs []int) error
	CountAccessibleDevicesForUser(ctx context.Context, userID int) (int, error)
	CreateSession(ctx context.Context, user UserRecord, pair TokenPair) error
	RevokeRefreshToken(ctx context.Context, tokenID int, revokedAt time.Time) error
	RevokeRefreshTokenByHash(ctx context.Context, tokenHash string, revokedAt time.Time) error
	RevokeAllRefreshTokensForUser(ctx context.Context, userID int) error
	DeleteAccessTokenByHash(ctx context.Context, tokenHash string) error
	DeleteAllAccessTokensForUser(ctx context.Context, userID int) error
	TouchAccessToken(ctx context.Context, tokenHash string, seenAt time.Time) error
	CleanupExpiredTokens(ctx context.Context, now time.Time) error
}
