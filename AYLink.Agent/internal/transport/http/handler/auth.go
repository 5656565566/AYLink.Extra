package handler

import (
	"net/http"
	"strconv"
	"strings"

	domainauth "aylink-agent/internal/domain/auth"
	authservice "aylink-agent/internal/service/auth"
	"aylink-agent/internal/transport/http/middleware"
)

type AuthHandler struct {
	service *authservice.Service
}

func NewAuthHandler(service *authservice.Service) *AuthHandler {
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
		WriteError(w, http.StatusUnauthorized, "INVALID_CREDENTIALS", "LoginPage.InvalidCredentials", "用户名或密码错误")
		return
	}

	result, err := h.service.Login(r.Context(), payload.Username, payload.Password)
	if err != nil {
		WriteError(w, http.StatusUnauthorized, "INVALID_CREDENTIALS", "LoginPage.InvalidCredentials", "用户名或密码错误")
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
		WriteError(w, http.StatusUnauthorized, "INVALID_REFRESH_TOKEN", "Errors.InvalidRefreshToken", "Invalid refresh token")
		return
	}

	result, err := h.service.Refresh(r.Context(), payload.RefreshToken)
	if err != nil {
		WriteError(w, http.StatusUnauthorized, "INVALID_REFRESH_TOKEN", "Errors.InvalidRefreshToken", "Invalid refresh token")
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
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Errors.Unauthorized", "Unauthorized")
		return
	}

	user, err := h.service.CurrentUser(r.Context(), identity.AccessToken)
	if err != nil {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Errors.Unauthorized", "Unauthorized")
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

	_ = decodeJSONBody(r, &payload)
	accessToken := extractBearerToken(r)

	_ = h.service.Logout(r.Context(), accessToken, payload.RefreshToken)
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
		w.WriteHeader(http.StatusUnauthorized)
		return
	}

	var payload struct {
		CurrentPassword string `json:"currentPassword"`
		NewPassword     string `json:"newPassword"`
	}

	if err := decodeJSONBody(r, &payload); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_JSON", "Errors.InvalidJson", "请求 JSON 无效")
		return
	}

	if err := h.service.ChangeOwnPassword(r.Context(), identity.UserID, payload.CurrentPassword, payload.NewPassword); err != nil {
		WriteError(w, http.StatusBadRequest, "CHANGE_PASSWORD_FAILED", "Errors.ChangePasswordFailed", err.Error())
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
		w.WriteHeader(http.StatusUnauthorized)
		return
	}

	_ = h.service.LogoutAll(r.Context(), identity.UserID)
	WriteJSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (h *AuthHandler) GetUsers(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteMethodNotAllowed(w, http.MethodGet)
		return
	}

	users, err := h.service.GetUsers(r.Context())
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "", err.Error())
		return
	}
	if users == nil {
		users = make([]domainauth.User, 0)
	}

	roles, err := h.service.GetRoles(r.Context())
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "", err.Error())
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
		Username string `json:"username"`
		Password string `json:"password"`
		RoleIds  []int  `json:"roleIds"`
	}

	if err := decodeJSONBody(r, &payload); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_JSON", "Errors.InvalidJson", "请求 JSON 无效")
		return
	}

	user, err := h.service.CreateUser(r.Context(), payload.Username, payload.Password, payload.RoleIds)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "CREATE_USER_FAILED", "Errors.CreateUserFailed", err.Error())
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
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	var payload struct {
		Username string `json:"username"`
		IsActive *bool  `json:"isActive"`
		RoleIds  []int  `json:"roleIds"`
	}

	if err := decodeJSONBody(r, &payload); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_JSON", "Errors.InvalidJson", "请求 JSON 无效")
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

	user, err := h.service.UpdateUser(r.Context(), userID, payload.Username, isActive, payload.RoleIds, actingUserID)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "UPDATE_USER_FAILED", "Errors.UpdateUserFailed", err.Error())
		return
	}

	WriteJSON(w, http.StatusOK, map[string]any{"success": true, "user": user})
}

func (h *AuthHandler) ResetPassword(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteMethodNotAllowed(w, http.MethodPost)
		return
	}

	// Route: /api/accounts/users/{id}/reset-password
	parts := strings.Split(r.URL.Path, "/")
	if len(parts) < 5 {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	userID, err := strconv.Atoi(parts[4])
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	var payload struct {
		NewPassword string `json:"newPassword"`
	}
	_ = decodeJSONBody(r, &payload) // 忽略 error 发生 密码为空将会随机生成

	password, err := h.service.ResetPassword(r.Context(), userID, payload.NewPassword)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "RESET_PASSWORD_FAILED", "Errors.ResetPasswordFailed", err.Error())
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
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	userID, err := strconv.Atoi(parts[4])
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	var actingUserID *int
	if identity := getIdentity(r); identity != nil {
		actingUserID = &identity.UserID
	}

	if err := h.service.SetUserActiveState(r.Context(), userID, isActive, actingUserID); err != nil {
		WriteError(w, http.StatusBadRequest, "SET_ACTIVE_FAILED", "Errors.SetActiveFailed", err.Error())
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
		WriteError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "", err.Error())
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
		Name        string   `json:"name"`
		Description string   `json:"description"`
		Permissions []string `json:"permissions"`
	}

	if err := decodeJSONBody(r, &payload); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_JSON", "Errors.InvalidJson", "请求 JSON 无效")
		return
	}

	role, err := h.service.CreateRole(r.Context(), payload.Name, payload.Description, payload.Permissions)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "CREATE_ROLE_FAILED", "Errors.CreateRoleFailed", err.Error())
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
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	var payload struct {
		Name        string   `json:"name"`
		Description string   `json:"description"`
		Permissions []string `json:"permissions"`
	}

	if err := decodeJSONBody(r, &payload); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_JSON", "Errors.InvalidJson", "请求 JSON 无效")
		return
	}

	role, err := h.service.UpdateRole(r.Context(), roleID, payload.Name, payload.Description, payload.Permissions)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "UPDATE_ROLE_FAILED", "Errors.UpdateRoleFailed", err.Error())
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
