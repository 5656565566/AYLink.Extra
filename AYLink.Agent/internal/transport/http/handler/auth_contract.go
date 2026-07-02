package handler

import domainauth "aylink-agent/internal/domain/auth"

type LoginResponse = domainauth.LoginResult

type LoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type RefreshRequest struct {
	RefreshToken string `json:"refreshToken"`
}

type CurrentUserResponse struct {
	User        *domainauth.User `json:"user"`
	Permissions []string         `json:"permissions"`
}

type LogoutRequest struct {
	RefreshToken string `json:"refreshToken"`
}

type ChangePasswordRequest struct {
	CurrentPassword string `json:"currentPassword"`
	NewPassword     string `json:"newPassword"`
}

type UsersResponse struct {
	Users                []domainauth.User                 `json:"users"`
	Roles                []domainauth.Role                 `json:"roles"`
	AvailablePermissions []domainauth.PermissionDescriptor `json:"availablePermissions"`
}

type CreateUserRequest struct {
	Username       string `json:"username"`
	Password       string `json:"password"`
	RoleIds        []int  `json:"roleIds"`
	DeviceGroupIds []int  `json:"deviceGroupIds"`
}

type UpdateUserRequest struct {
	Username       string `json:"username"`
	IsActive       *bool  `json:"isActive"`
	RoleIds        []int  `json:"roleIds"`
	DeviceGroupIds []int  `json:"deviceGroupIds"`
}

type UserResponse struct {
	Success bool             `json:"success"`
	User    *domainauth.User `json:"user"`
}

type ResetPasswordRequest struct {
	NewPassword string `json:"newPassword"`
}

type ResetPasswordResponse struct {
	Success  bool   `json:"success"`
	Password string `json:"password"`
}

type RolesResponse struct {
	Roles                []domainauth.Role                 `json:"roles"`
	AvailablePermissions []domainauth.PermissionDescriptor `json:"availablePermissions"`
}

type CreateRoleRequest struct {
	Name           string   `json:"name"`
	Description    string   `json:"description"`
	Permissions    []string `json:"permissions"`
	DeviceGroupIds []int    `json:"deviceGroupIds"`
}

type UpdateRoleRequest struct {
	Name           string   `json:"name"`
	Description    string   `json:"description"`
	Permissions    []string `json:"permissions"`
	DeviceGroupIds []int    `json:"deviceGroupIds"`
}

type RoleResponse struct {
	Success bool             `json:"success"`
	Role    *domainauth.Role `json:"role"`
}
