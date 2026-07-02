package handler

import (
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	domainauth "aylink-agent/internal/domain/auth"
	authservice "aylink-agent/internal/service/auth"
	"aylink-agent/internal/transport/http/middleware"
)

type AuthHandler struct {
	service AuthService
}

func NewAuthHandler(service AuthService) *AuthHandler {
	return &AuthHandler{service: service}
}

// Login 用户登录
// @Summary 用户登录
// @Description 使用用户名和密码登录，返回访问令牌、刷新令牌、当前用户和权限。
// @Tags 认证
// @Accept json
// @Produce json
// @Param body body LoginRequest true "登录参数"
// @Success 200 {object} LoginResponse
// @Failure 400 {object} ErrorResponse
// @Failure 401 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/login [post]
func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteMethodNotAllowed(w, http.MethodPost)
		return
	}

	var payload LoginRequest

	if err := decodeJSONBody(r, &payload); err != nil {
		WriteInvalidJSON(w)
		return
	}

	result, err := h.service.Login(r.Context(), payload.Username, payload.Password)
	if err != nil {
		writeLoginError(w, err)
		return
	}

	WriteJSON(w, http.StatusOK, result)
}

// Refresh 刷新登录状态
// @Summary 刷新登录状态
// @Description 使用刷新令牌获取新的访问令牌和刷新令牌。
// @Tags 认证
// @Accept json
// @Produce json
// @Param body body RefreshRequest true "刷新令牌"
// @Success 200 {object} LoginResponse
// @Failure 400 {object} ErrorResponse
// @Failure 401 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/auth/refresh [post]
func (h *AuthHandler) Refresh(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteMethodNotAllowed(w, http.MethodPost)
		return
	}

	var payload RefreshRequest

	if err := decodeJSONBody(r, &payload); err != nil {
		WriteInvalidJSON(w)
		return
	}

	result, err := h.service.Refresh(r.Context(), payload.RefreshToken)
	if err != nil {
		writeRefreshError(w, err)
		return
	}

	WriteJSON(w, http.StatusOK, result)
}

// Me 获取当前用户
// @Summary 获取当前用户
// @Description 返回当前访问令牌对应的用户信息和权限列表。
// @Tags 认证
// @Produce json
// @Security BearerAuth
// @Success 200 {object} CurrentUserResponse
// @Failure 401 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/auth/me [get]
func (h *AuthHandler) Me(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteMethodNotAllowed(w, http.MethodGet)
		return
	}

	identity := getIdentity(r)
	if identity == nil {
		WriteUnauthorized(w)
		return
	}

	user, err := h.service.CurrentUser(r.Context(), identity.AccessToken)
	if err != nil {
		writeCurrentUserError(w, err)
		return
	}

	WriteJSON(w, http.StatusOK, CurrentUserResponse{
		User:        user,
		Permissions: user.Permissions,
	})
}

// Logout 退出登录
// @Summary 退出登录
// @Description 注销当前访问令牌，并可同时撤销指定刷新令牌。
// @Tags 认证
// @Accept json
// @Produce json
// @Param body body LogoutRequest false "退出登录参数"
// @Success 200 {object} SuccessResponse
// @Failure 400 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/logout [post]
func (h *AuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteMethodNotAllowed(w, http.MethodPost)
		return
	}

	var payload LogoutRequest

	if err := decodeOptionalJSONBody(r, &payload); err != nil {
		WriteInvalidJSON(w)
		return
	}
	accessToken := extractBearerToken(r)

	if err := h.service.Logout(r.Context(), accessToken, payload.RefreshToken); err != nil {
		WriteError(w, http.StatusInternalServerError, "LOGOUT_FAILED", "Errors.LogoutFailed", "退出登录失败")
		return
	}
	WriteJSON(w, http.StatusOK, SuccessResponse{Success: true})
}

// ChangePassword 修改当前用户密码
// @Summary 修改当前用户密码
// @Description 修改当前登录用户自己的密码。
// @Tags 认证
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param body body ChangePasswordRequest true "密码参数"
// @Success 200 {object} SuccessResponse
// @Failure 400 {object} ErrorResponse
// @Failure 401 {object} ErrorResponse
// @Failure 403 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/auth/change-password [post]
func (h *AuthHandler) ChangePassword(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteMethodNotAllowed(w, http.MethodPost)
		return
	}

	identity := getIdentity(r)
	if identity == nil {
		WriteUnauthorized(w)
		return
	}

	var payload ChangePasswordRequest

	if err := decodeJSONBody(r, &payload); err != nil {
		WriteInvalidJSON(w)
		return
	}

	if err := h.service.ChangeOwnPassword(r.Context(), identity.UserID, payload.CurrentPassword, payload.NewPassword); err != nil {
		writeAuthServiceError(w, err, http.StatusBadRequest, "CHANGE_PASSWORD_FAILED")
		return
	}

	WriteJSON(w, http.StatusOK, SuccessResponse{Success: true})
}

// LogoutAll 退出全部会话
// @Summary 退出全部会话
// @Description 撤销当前用户的全部登录会话。
// @Tags 认证
// @Produce json
// @Security BearerAuth
// @Success 200 {object} SuccessResponse
// @Failure 401 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/logout-all [post]
func (h *AuthHandler) LogoutAll(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteMethodNotAllowed(w, http.MethodPost)
		return
	}

	identity := getIdentity(r)
	if identity == nil {
		WriteUnauthorized(w)
		return
	}

	if err := h.service.LogoutAll(r.Context(), identity.UserID); err != nil {
		WriteError(w, http.StatusInternalServerError, "LOGOUT_ALL_FAILED", "Errors.LogoutAllFailed", "退出全部会话失败")
		return
	}
	WriteJSON(w, http.StatusOK, SuccessResponse{Success: true})
}

// GetUsers 获取用户列表
// @Summary 获取用户列表
// @Description 返回用户、角色和可用权限，用于账户管理页面。
// @Tags 账户管理
// @Produce json
// @Security BearerAuth
// @Success 200 {object} UsersResponse
// @Failure 401 {object} ErrorResponse
// @Failure 403 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/accounts/users [get]
func (h *AuthHandler) GetUsers(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteMethodNotAllowed(w, http.MethodGet)
		return
	}

	users, err := h.service.GetUsers(r.Context())
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "ACCOUNT_DATA_LOAD_FAILED", "Errors.AccountDataLoadFailed", "加载账户数据失败")
		return
	}
	if users == nil {
		users = make([]domainauth.User, 0)
	}

	roles, err := h.service.GetRoles(r.Context())
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "ACCOUNT_DATA_LOAD_FAILED", "Errors.AccountDataLoadFailed", "加载账户数据失败")
		return
	}
	if roles == nil {
		roles = make([]domainauth.Role, 0)
	}

	availablePermissions := h.service.GetAvailablePermissions()
	if availablePermissions == nil {
		availablePermissions = make([]domainauth.PermissionDescriptor, 0)
	}

	WriteJSON(w, http.StatusOK, UsersResponse{
		Users:                users,
		Roles:                roles,
		AvailablePermissions: availablePermissions,
	})
}

// CreateUser 创建用户
// @Summary 创建用户
// @Description 创建一个新用户，并设置角色和可访问设备分组。
// @Tags 账户管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param body body CreateUserRequest true "用户参数"
// @Success 200 {object} UserResponse
// @Failure 400 {object} ErrorResponse
// @Failure 401 {object} ErrorResponse
// @Failure 403 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/accounts/users [post]
func (h *AuthHandler) CreateUser(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteMethodNotAllowed(w, http.MethodPost)
		return
	}

	var payload CreateUserRequest

	if err := decodeJSONBody(r, &payload); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_JSON", "Errors.InvalidJson", "请求 JSON 无效")
		return
	}

	user, err := h.service.CreateUser(r.Context(), payload.Username, payload.Password, payload.RoleIds, payload.DeviceGroupIds)
	if err != nil {
		writeAuthServiceError(w, err, http.StatusBadRequest, "CREATE_USER_FAILED")
		return
	}

	WriteJSON(w, http.StatusOK, UserResponse{Success: true, User: user})
}

// UpdateUser 更新用户
// @Summary 更新用户
// @Description 更新用户名称、启用状态、角色和可访问设备分组。
// @Tags 账户管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "用户 ID"
// @Param body body UpdateUserRequest true "用户参数"
// @Success 200 {object} UserResponse
// @Failure 400 {object} ErrorResponse
// @Failure 401 {object} ErrorResponse
// @Failure 403 {object} ErrorResponse
// @Failure 404 {object} ErrorResponse
// @Failure 409 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/accounts/users/{id} [put]
func (h *AuthHandler) UpdateUser(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		WriteMethodNotAllowed(w, http.MethodPut)
		return
	}

	userID, err := idFromPath(r.URL.Path, "/api/accounts/users/")
	if err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_USER_ID", "Errors.InvalidUserId", "无效的用户 ID")
		return
	}

	var payload UpdateUserRequest

	if err := decodeJSONBody(r, &payload); err != nil {
		WriteInvalidJSON(w)
		return
	}

	isActive := true
	if payload.IsActive != nil {
		isActive = *payload.IsActive
	}

	var actingUserID *int
	if identity := getIdentity(r); identity != nil {
		actingUserID = &identity.UserID
	}

	user, err := h.service.UpdateUser(r.Context(), userID, payload.Username, isActive, payload.RoleIds, payload.DeviceGroupIds, actingUserID)
	if err != nil {
		writeAuthServiceError(w, err, http.StatusBadRequest, "UPDATE_USER_FAILED")
		return
	}

	WriteJSON(w, http.StatusOK, UserResponse{Success: true, User: user})
}

// DeleteUser 删除用户
// @Summary 删除用户
// @Description 删除指定用户。
// @Tags 账户管理
// @Produce json
// @Security BearerAuth
// @Param id path int true "用户 ID"
// @Success 204 "删除成功"
// @Failure 400 {object} ErrorResponse
// @Failure 401 {object} ErrorResponse
// @Failure 403 {object} ErrorResponse
// @Failure 404 {object} ErrorResponse
// @Failure 409 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/accounts/users/{id} [delete]
func (h *AuthHandler) DeleteUser(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		WriteMethodNotAllowed(w, http.MethodDelete)
		return
	}

	userID, err := idFromPath(r.URL.Path, "/api/accounts/users/")
	if err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_USER_ID", "Errors.InvalidUserId", "无效的用户 ID")
		return
	}

	var actingUserID *int
	if identity := getIdentity(r); identity != nil {
		actingUserID = &identity.UserID
	}

	if err := h.service.DeleteUser(r.Context(), userID, actingUserID); err != nil {
		writeAuthServiceError(w, err, http.StatusBadRequest, "DELETE_USER_FAILED")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// ResetPassword 重置用户密码
// @Summary 重置用户密码
// @Description 重置指定用户密码，并返回最终密码。
// @Tags 账户管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "用户 ID"
// @Param body body ResetPasswordRequest true "密码参数"
// @Success 200 {object} ResetPasswordResponse
// @Failure 400 {object} ErrorResponse
// @Failure 401 {object} ErrorResponse
// @Failure 403 {object} ErrorResponse
// @Failure 404 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/accounts/users/{id}/reset-password [post]
func (h *AuthHandler) ResetPassword(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteMethodNotAllowed(w, http.MethodPost)
		return
	}

	// Route: /api/accounts/users/{id}/reset-password
	parts := strings.Split(r.URL.Path, "/")
	if len(parts) < 5 {
		WriteError(w, http.StatusBadRequest, "INVALID_USER_ID", "Errors.InvalidUserId", "无效的用户 ID")
		return
	}
	userID, err := strconv.Atoi(parts[4])
	if err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_USER_ID", "Errors.InvalidUserId", "无效的用户 ID")
		return
	}

	var payload ResetPasswordRequest
	if err := decodeJSONBody(r, &payload); err != nil {
		WriteInvalidJSON(w)
		return
	}

	password, err := h.service.ResetPassword(r.Context(), userID, payload.NewPassword)
	if err != nil {
		writeAuthServiceError(w, err, http.StatusBadRequest, "RESET_PASSWORD_FAILED")
		return
	}

	WriteJSON(w, http.StatusOK, ResetPasswordResponse{Success: true, Password: password})
}

// SetUserActive 设置用户启用状态
// @Summary 设置用户启用状态
// @Description 启用或禁用指定用户。
// @Tags 账户管理
// @Produce json
// @Security BearerAuth
// @Param id path int true "用户 ID"
// @Success 200 {object} SuccessResponse
// @Failure 400 {object} ErrorResponse
// @Failure 401 {object} ErrorResponse
// @Failure 403 {object} ErrorResponse
// @Failure 404 {object} ErrorResponse
// @Failure 409 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/accounts/users/{id}/activate [post]
// @Router /api/accounts/users/{id}/deactivate [post]
func (h *AuthHandler) SetUserActive(w http.ResponseWriter, r *http.Request, isActive bool) {
	if r.Method != http.MethodPost {
		WriteMethodNotAllowed(w, http.MethodPost)
		return
	}

	parts := strings.Split(r.URL.Path, "/")
	if len(parts) < 5 {
		WriteError(w, http.StatusBadRequest, "INVALID_USER_ID", "Errors.InvalidUserId", "无效的用户 ID")
		return
	}
	userID, err := strconv.Atoi(parts[4])
	if err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_USER_ID", "Errors.InvalidUserId", "无效的用户 ID")
		return
	}

	var actingUserID *int
	if identity := getIdentity(r); identity != nil {
		actingUserID = &identity.UserID
	}

	if err := h.service.SetUserActiveState(r.Context(), userID, isActive, actingUserID); err != nil {
		writeAuthServiceError(w, err, http.StatusBadRequest, "SET_ACTIVE_FAILED")
		return
	}

	WriteJSON(w, http.StatusOK, SuccessResponse{Success: true})
}

// GetRoles 获取角色列表
// @Summary 获取角色列表
// @Description 返回角色和可用权限，用于账户管理页面。
// @Tags 账户管理
// @Produce json
// @Security BearerAuth
// @Success 200 {object} RolesResponse
// @Failure 401 {object} ErrorResponse
// @Failure 403 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/accounts/roles [get]
func (h *AuthHandler) GetRoles(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteMethodNotAllowed(w, http.MethodGet)
		return
	}

	roles, err := h.service.GetRoles(r.Context())
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "ACCOUNT_DATA_LOAD_FAILED", "Errors.AccountDataLoadFailed", "加载账户数据失败")
		return
	}
	if roles == nil {
		roles = make([]domainauth.Role, 0)
	}

	availablePermissions := h.service.GetAvailablePermissions()
	if availablePermissions == nil {
		availablePermissions = make([]domainauth.PermissionDescriptor, 0)
	}

	WriteJSON(w, http.StatusOK, RolesResponse{
		Roles:                roles,
		AvailablePermissions: availablePermissions,
	})
}

// CreateRole 创建角色
// @Summary 创建角色
// @Description 创建角色并设置权限和可访问设备分组。
// @Tags 账户管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param body body CreateRoleRequest true "角色参数"
// @Success 200 {object} RoleResponse
// @Failure 400 {object} ErrorResponse
// @Failure 401 {object} ErrorResponse
// @Failure 403 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/accounts/roles [post]
func (h *AuthHandler) CreateRole(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteMethodNotAllowed(w, http.MethodPost)
		return
	}

	var payload CreateRoleRequest

	if err := decodeJSONBody(r, &payload); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_JSON", "Errors.InvalidJson", "请求 JSON 无效")
		return
	}

	role, err := h.service.CreateRole(r.Context(), payload.Name, payload.Description, payload.Permissions, payload.DeviceGroupIds)
	if err != nil {
		writeAuthServiceError(w, err, http.StatusBadRequest, "CREATE_ROLE_FAILED")
		return
	}

	WriteJSON(w, http.StatusOK, RoleResponse{Success: true, Role: role})
}

// UpdateRole 更新角色
// @Summary 更新角色
// @Description 更新角色名称、说明、权限和可访问设备分组。
// @Tags 账户管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "角色 ID"
// @Param body body UpdateRoleRequest true "角色参数"
// @Success 200 {object} RoleResponse
// @Failure 400 {object} ErrorResponse
// @Failure 401 {object} ErrorResponse
// @Failure 403 {object} ErrorResponse
// @Failure 404 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/accounts/roles/{id} [put]
func (h *AuthHandler) UpdateRole(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		WriteMethodNotAllowed(w, http.MethodPut)
		return
	}

	roleID, err := idFromPath(r.URL.Path, "/api/accounts/roles/")
	if err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_ROLE_ID", "Errors.InvalidRoleId", "无效的角色 ID")
		return
	}

	var payload UpdateRoleRequest

	if err := decodeJSONBody(r, &payload); err != nil {
		WriteInvalidJSON(w)
		return
	}

	role, err := h.service.UpdateRole(r.Context(), roleID, payload.Name, payload.Description, payload.Permissions, payload.DeviceGroupIds)
	if err != nil {
		writeAuthServiceError(w, err, http.StatusBadRequest, "UPDATE_ROLE_FAILED")
		return
	}

	WriteJSON(w, http.StatusOK, RoleResponse{Success: true, Role: role})
}

func getIdentity(r *http.Request) *domainauth.Identity {
	identity, ok := r.Context().Value(middleware.IdentityKey).(*domainauth.Identity)
	if !ok {
		return nil
	}
	return identity
}

func extractBearerToken(r *http.Request) string {
	authHeader := r.Header.Get("Authorization")
	if strings.HasPrefix(strings.ToLower(authHeader), "bearer ") {
		return strings.TrimSpace(authHeader[7:])
	}
	return strings.TrimSpace(r.URL.Query().Get("token"))
}

func idFromPath(path, prefix string) (int, error) {
	value := strings.TrimPrefix(path, prefix)
	if index := strings.IndexByte(value, '/'); index >= 0 {
		value = value[:index]
	}
	return strconv.Atoi(value)
}

func decodeOptionalJSONBody(r *http.Request, target any) error {
	if r == nil || r.Body == nil || r.Body == http.NoBody {
		return nil
	}

	err := decodeJSONBody(r, target)
	if errors.Is(err, io.EOF) {
		return nil
	}
	return err
}

func writeAuthServiceError(
	w http.ResponseWriter,
	err error,
	statusCode int,
	code string,
) {
	switch {
	case errors.Is(err, authservice.ErrInvalidPermissions):
		WriteError(w, statusCode, code, "Errors.InvalidPermissions", "包含无效的权限项")
	case errors.Is(err, authservice.ErrUsernameRequired):
		WriteError(w, statusCode, code, "Errors.UsernameRequired", "用户名不能为空")
	case errors.Is(err, authservice.ErrPasswordEmpty):
		WriteError(w, statusCode, code, "Errors.PasswordRequired", "密码不能为空")
	case errors.Is(err, authservice.ErrUsernameExists):
		WriteError(w, statusCode, code, "Errors.UsernameExists", "用户名已存在")
	case errors.Is(err, authservice.ErrCurrentUserLocked):
		WriteError(w, http.StatusConflict, code, "Errors.CurrentUserDisableForbidden", "不能禁用当前登录账号")
	case errors.Is(err, authservice.ErrCurrentUserDelete):
		WriteError(w, http.StatusConflict, code, "Errors.CurrentUserDeleteForbidden", "不能删除当前登录账号")
	case errors.Is(err, authservice.ErrLastSystemOwner):
		WriteError(w, http.StatusConflict, code, "Errors.LastSystemOwnerRequired", "至少需要保留一个启用中的系统所有者")
	case errors.Is(err, authservice.ErrUserNotFound):
		WriteError(w, http.StatusNotFound, code, "Errors.UserNotFound", "用户不存在")
	case errors.Is(err, authservice.ErrCurrentPassword):
		WriteError(w, statusCode, code, "Errors.CurrentPasswordIncorrect", "当前密码不正确")
	case errors.Is(err, authservice.ErrRoleNameRequired):
		WriteError(w, statusCode, code, "Errors.RoleNameRequired", "角色名称不能为空")
	case errors.Is(err, authservice.ErrRoleExists):
		WriteError(w, statusCode, code, "Errors.RoleExists", "角色名称已存在")
	case errors.Is(err, authservice.ErrRoleNotFound):
		WriteError(w, http.StatusNotFound, code, "Errors.RoleNotFound", "角色不存在")
	case errors.Is(err, authservice.ErrInvalidCredentials), errors.Is(err, authservice.ErrInvalidRefresh), errors.Is(err, authservice.ErrUnauthorized):
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Errors.Unauthorized", "Unauthorized")
	default:
		WriteError(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Errors.InternalServerError", "服务器内部错误")
	}
}

func writeLoginError(w http.ResponseWriter, err error) {
	if errors.Is(err, authservice.ErrInvalidCredentials) {
		WriteError(w, http.StatusUnauthorized, "INVALID_CREDENTIALS", "LoginPage.InvalidCredentials", "用户名或密码错误")
		return
	}

	WriteError(w, http.StatusInternalServerError, "LOGIN_FAILED", "Errors.LoginFailed", "登录失败")
}

func writeRefreshError(w http.ResponseWriter, err error) {
	if errors.Is(err, authservice.ErrInvalidRefresh) {
		WriteError(w, http.StatusUnauthorized, "INVALID_REFRESH_TOKEN", "Errors.InvalidRefreshToken", "Invalid refresh token")
		return
	}

	WriteError(w, http.StatusInternalServerError, "REFRESH_FAILED", "Errors.RefreshFailed", "刷新登录状态失败")
}

func writeCurrentUserError(w http.ResponseWriter, err error) {
	if errors.Is(err, authservice.ErrUnauthorized) {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Errors.Unauthorized", "Unauthorized")
		return
	}

	WriteError(w, http.StatusInternalServerError, "CURRENT_USER_FAILED", "Errors.CurrentUserFailed", "加载当前登录用户失败")
}
