package handler

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"slices"
	"strconv"

	domainauth "aylink-agent/internal/domain/auth"
	authservice "aylink-agent/internal/service/auth"
	webrtcservice "aylink-agent/internal/service/webrtc"
)

var errLoginSessionRequired = errors.New("refresh credentials to establish a login session")

type LoginSessionValidator interface {
	ValidateLoginSession(context.Context, string) (*domainauth.Identity, error)
	WithLoginSession(context.Context, int, string, func(*domainauth.Identity) error) error
}

func (h *WebRTCHandler) checkWebDevice(ctx context.Context, identity *domainauth.Identity, deviceID string) error {
	if !slices.Contains(identity.Permissions, "devices.control") {
		return authservice.ErrUnauthorized
	}
	if h.access == nil {
		return nil
	}
	id, err := strconv.Atoi(deviceID)
	if err != nil {
		return authservice.ErrUnauthorized
	}
	allowed, err := h.access.CanAccessDevice(ctx, identity, id)
	if err != nil {
		return err
	}
	if !allowed {
		return authservice.ErrUnauthorized
	}
	return nil
}

func (h *WebRTCHandler) runtimeHasLease(entry *managedRuntime) bool {
	for sessionID := range entry.sessionIDs {
		if h.service.HasSessionLease(entry.deviceID, sessionID) {
			return true
		}
	}
	return false
}

func (h *WebRTCHandler) withWebIdentity(r *http.Request, action func(*domainauth.Identity) error) error {
	identity := getIdentity(r)
	if identity == nil || h.loginSessions == nil {
		return authservice.ErrUnauthorized
	}
	if identity.LoginSessionID == "" {
		return errLoginSessionRequired
	}
	return h.loginSessions.WithLoginSession(r.Context(), identity.UserID, identity.LoginSessionID, func(current *domainauth.Identity) error {
		if !slices.Contains(current.Permissions, "devices.control") {
			return authservice.ErrUnauthorized
		}
		return action(current)
	})
}

func (h *WebRTCHandler) RegisterWebPage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteMethodNotAllowed(w, http.MethodPost)
		return
	}
	var pageID string
	err := h.withWebIdentity(r, func(identity *domainauth.Identity) error {
		var err error
		pageID, err = h.service.RegisterWebPage(webrtcservice.WebOwner{UserID: identity.UserID, LoginSessionID: identity.LoginSessionID})
		return err
	})
	if err != nil {
		if !h.writeWebSessionError(w, err) {
			WriteError(w, http.StatusInternalServerError, "CAST_PAGE_FAILED", "WebRTC.TicketFailed", "登记投屏网页失败")
		}
		return
	}
	WriteJSON(w, http.StatusOK, map[string]string{"p": pageID})
}

func (h *WebRTCHandler) writeWebSessionError(w http.ResponseWriter, err error) bool {
	switch {
	case errors.Is(err, errLoginSessionRequired):
		WriteError(w, http.StatusUnauthorized, "LOGIN_SESSION_REQUIRED", "Errors.Unauthorized", "请刷新登录凭据后重试")
	case errors.Is(err, authservice.ErrUnauthorized):
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Errors.Unauthorized", "登录会话已失效")
	case errors.Is(err, webrtcservice.ErrWebPageNotFound):
		WriteError(w, http.StatusNotFound, "CAST_PAGE_NOT_FOUND", "WebRTC.SessionIdRequired", "投屏网页会话已失效")
	case errors.Is(err, webrtcservice.ErrWebHeartbeat):
		WriteError(w, http.StatusConflict, "CAST_HEARTBEAT_INVALID", "Errors.InvalidJson", "投屏心跳序号或位图无效")
	case errors.Is(err, webrtcservice.ErrWebSessionLimit):
		WriteError(w, http.StatusTooManyRequests, "CAST_SESSION_LIMIT", "Errors.PermissionDenied", "投屏会话数或登记频率已达服务端上限")
	default:
		return false
	}
	return true
}

func (h *WebRTCHandler) CleanupWebSessions(ctx context.Context) {
	if h.loginSessions == nil {
		return
	}
	for _, owner := range h.service.WebPageOwners() {
		identity, err := h.loginSessions.ValidateLoginSession(ctx, owner.LoginSessionID)
		invalid := errors.Is(err, authservice.ErrUnauthorized)
		if err != nil && !invalid {
			slog.Warn("投屏会话认证复核失败", "userId", owner.UserID, "error", err)
		}
		if err == nil {
			invalid = identity == nil || identity.UserID != owner.UserID || !slices.Contains(identity.Permissions, "devices.control")
			for _, deviceID := range owner.DeviceIDs {
				if invalid || h.access == nil {
					break
				}
				id, parseErr := strconv.Atoi(deviceID)
				if parseErr != nil {
					invalid = true
					break
				}
				allowed, accessErr := h.access.CanAccessDevice(ctx, identity, id)
				if accessErr != nil {
					slog.Warn("投屏设备权限复核失败", "userId", owner.UserID, "deviceId", deviceID, "error", accessErr)
				}
				if accessErr == nil && !allowed {
					invalid = true
					break
				}
			}
		}
		if invalid {
			h.service.ReleaseWebPage(owner.PageID)
		}
	}
	h.cleanupIdleRuntimes()
}
