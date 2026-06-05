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

func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteMethodNotAllowed(w, http.MethodPost)
		return
	}

	var payload struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}

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

func (h *AuthHandler) Refresh(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteMethodNotAllowed(w, http.MethodPost)
		return
	}

	var payload struct {
		RefreshToken string `json:"refreshToken"`
	}

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

	WriteJSON(w, http.StatusOK, map[string]any{
		"user":        user,
		"permissions": user.Permissions,
	})
}

func (h *AuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteMethodNotAllowed(w, http.MethodPost)
		return
	}

	var payload struct {
		RefreshToken string `json:"refreshToken"`
	}

	if err := decodeOptionalJSONBody(r, &payload); err != nil {
		WriteInvalidJSON(w)
		return
	}
	accessToken := extractBearerToken(r)

	if err := h.service.Logout(r.Context(), accessToken, payload.RefreshToken); err != nil {
		WriteError(w, http.StatusInternalServerError, "LOGOUT_FAILED", "Errors.LogoutFailed", "退出登录失败")
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{
		"success": true,
	})
}

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

	var payload struct {
		CurrentPassword string `json:"currentPassword"`
		NewPassword     string `json:"newPassword"`
	}

	if err := decodeJSONBody(r, &payload); err != nil {
		WriteInvalidJSON(w)
		return
	}

	if err := h.service.ChangeOwnPassword(r.Context(), identity.UserID, payload.CurrentPassword, payload.NewPassword); err != nil {
		writeAuthServiceError(w, err, http.StatusBadRequest, "CHANGE_PASSWORD_FAILED")
		return
	}

	WriteJSON(w, http.StatusOK, map[string]bool{"success": true})
}

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
	WriteJSON(w, http.StatusOK, map[string]bool{"success": true})
}

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

	WriteJSON(w, http.StatusOK, map[string]any{
		"users":                users,
		"roles":                roles,
		"availablePermissions": availablePermissions,
	})
}

func (h *AuthHandler) CreateUser(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteMethodNotAllowed(w, http.MethodPost)
		return
	}

	var payload struct {
		Username       string `json:"username"`
		Password       string `json:"password"`
		RoleIds        []int  `json:"roleIds"`
		DeviceGroupIds []int  `json:"deviceGroupIds"`
	}

	if err := decodeJSONBody(r, &payload); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_JSON", "Errors.InvalidJson", "请求 JSON 无效")
		return
	}

	user, err := h.service.CreateUser(r.Context(), payload.Username, payload.Password, payload.RoleIds, payload.DeviceGroupIds)
	if err != nil {
		writeAuthServiceError(w, err, http.StatusBadRequest, "CREATE_USER_FAILED")
		return
	}

	WriteJSON(w, http.StatusOK, map[string]any{"success": true, "user": user})
}

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

	var payload struct {
		Username       string `json:"username"`
		IsActive       *bool  `json:"isActive"`
		RoleIds        []int  `json:"roleIds"`
		DeviceGroupIds []int  `json:"deviceGroupIds"`
	}

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

	WriteJSON(w, http.StatusOK, map[string]any{"success": true, "user": user})
}

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

	var payload struct {
		NewPassword string `json:"newPassword"`
	}
	if err := decodeJSONBody(r, &payload); err != nil {
		WriteInvalidJSON(w)
		return
	}

	password, err := h.service.ResetPassword(r.Context(), userID, payload.NewPassword)
	if err != nil {
		writeAuthServiceError(w, err, http.StatusBadRequest, "RESET_PASSWORD_FAILED")
		return
	}

	WriteJSON(w, http.StatusOK, map[string]any{"success": true, "password": password})
}

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

	WriteJSON(w, http.StatusOK, map[string]any{"success": true})
}

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

	WriteJSON(w, http.StatusOK, map[string]any{
		"roles":                roles,
		"availablePermissions": availablePermissions,
	})
}

func (h *AuthHandler) CreateRole(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteMethodNotAllowed(w, http.MethodPost)
		return
	}

	var payload struct {
		Name           string   `json:"name"`
		Description    string   `json:"description"`
		Permissions    []string `json:"permissions"`
		DeviceGroupIds []int    `json:"deviceGroupIds"`
	}

	if err := decodeJSONBody(r, &payload); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_JSON", "Errors.InvalidJson", "请求 JSON 无效")
		return
	}

	role, err := h.service.CreateRole(r.Context(), payload.Name, payload.Description, payload.Permissions, payload.DeviceGroupIds)
	if err != nil {
		writeAuthServiceError(w, err, http.StatusBadRequest, "CREATE_ROLE_FAILED")
		return
	}

	WriteJSON(w, http.StatusOK, map[string]any{"success": true, "role": role})
}

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

	var payload struct {
		Name           string   `json:"name"`
		Description    string   `json:"description"`
		Permissions    []string `json:"permissions"`
		DeviceGroupIds []int    `json:"deviceGroupIds"`
	}

	if err := decodeJSONBody(r, &payload); err != nil {
		WriteInvalidJSON(w)
		return
	}

	role, err := h.service.UpdateRole(r.Context(), roleID, payload.Name, payload.Description, payload.Permissions, payload.DeviceGroupIds)
	if err != nil {
		writeAuthServiceError(w, err, http.StatusBadRequest, "UPDATE_ROLE_FAILED")
		return
	}

	WriteJSON(w, http.StatusOK, map[string]any{"success": true, "role": role})
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
