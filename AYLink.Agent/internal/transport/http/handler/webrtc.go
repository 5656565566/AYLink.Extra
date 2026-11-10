package handler

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	domainauth "aylink-agent/internal/domain/auth"
	domainscrcpy "aylink-agent/internal/domain/scrcpy"
	authservice "aylink-agent/internal/service/auth"
	deviceservice "aylink-agent/internal/service/device"
	scrcpyservice "aylink-agent/internal/service/scrcpy"
	webrtcservice "aylink-agent/internal/service/webrtc"

	"github.com/gorilla/websocket"
)

const runtimeJanitorInterval = 5 * time.Second

type WebRTCHandler struct {
	loginSessions LoginSessionValidator
	service       WebRTCService
	settings      SettingsService
	scrcpy        ScrcpyService
	access        DeviceAccessService
	upgrader      websocket.Upgrader

	runtimeMu sync.Mutex
	runtimes  map[string]*managedRuntime
}

type managedRuntime struct {
	deviceID    string
	signature   string
	sessionRefs map[string]int
	// 即使活动引用归零 sessionIDs 仍记录持有该运行时的会话租约
	sessionIDs map[string]struct{}
	runtime    domainscrcpy.Runtime
	refCount   int
	starting   bool
	ready      chan struct{}
	startErr   error
	lastUsedAt time.Time
}

type SignalErrorPayload struct {
	Type       string `json:"type"`
	Code       string `json:"code,omitempty"`
	MessageKey string `json:"messageKey,omitempty"`
	Message    string `json:"message"`
	Detail     string `json:"detail,omitempty"`
	Retryable  bool   `json:"retryable,omitempty"`
}

func NewWebRTCHandler(service WebRTCService, settings SettingsService, scrcpy ScrcpyService, access DeviceAccessService, loginSessions LoginSessionValidator) *WebRTCHandler {
	handler := &WebRTCHandler{
		loginSessions: loginSessions,
		service:       service,
		settings:      settings,
		scrcpy:        scrcpy,
		access:        access,
		runtimes:      make(map[string]*managedRuntime),
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool { return true },
		},
	}
	go handler.runtimeJanitor()
	return handler
}

// CreateTicket 创建 WebRTC 信令票据
// @Summary 创建 WebRTC 信令票据
// @Description 创建一次性 WebRTC 信令票据，用于后续建立投屏信令 WebSocket。
// @Tags 投屏
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param body body CreateTicketRequest true "投屏票据参数"
// @Success 200 {object} CreateTicketResponse
// @Failure 400 {object} ErrorResponse
// @Failure 401 {object} ErrorResponse
// @Failure 403 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/webrtc-ticket [post]
func (h *WebRTCHandler) CreateTicket(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteMethodNotAllowed(w, http.MethodPost)
		return
	}

	var payload webrtcservice.CreateTicketInput
	if err := decodeJSONBody(r, &payload); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_JSON", "Errors.InvalidJson", "请求 JSON 无效")
		return
	}

	payload.DeviceID = strings.TrimSpace(payload.DeviceID)
	payload.SessionID = strings.TrimSpace(payload.SessionID)
	payload.AppPackage = strings.TrimSpace(payload.AppPackage)
	payload.AppName = strings.TrimSpace(payload.AppName)
	if payload.DeviceID != "" {
		deviceID, err := strconv.Atoi(payload.DeviceID)
		if err != nil {
			WriteError(w, http.StatusBadRequest, "INVALID_DEVICE_ID", "Errors.InvalidDeviceId", "无效的设备 ID")
			return
		}
		if _, ok := ensureDeviceAccess(w, r, h.access, deviceID); !ok {
			return
		}
	}

	var result webrtcservice.CreateTicketResult
	var err error
	if payload.PageID == "" {
		WriteError(w, http.StatusBadRequest, "CAST_PAGE_REQUIRED", "WebRTC.SessionIdRequired", "必须先登记投屏客户端")
		return
	}
	err = h.withWebIdentity(r, func(identity *domainauth.Identity) error {
		if err := h.checkWebDevice(r.Context(), identity, payload.DeviceID); err != nil {
			return err
		}
		payload.UserID, payload.LoginSessionID = identity.UserID, identity.LoginSessionID
		result, err = h.service.CreateTicket(r.Context(), payload)
		return err
	})
	if err != nil {
		if h.writeWebSessionError(w, err) {
			return
		}
		if errors.Is(err, webrtcservice.ErrDeviceIDRequired) {
			WriteError(w, http.StatusBadRequest, "DEVICE_ID_REQUIRED", "WebRTC.DeviceIdRequired", "deviceId 不能为空")
			return
		}
		if errors.Is(err, webrtcservice.ErrSessionNotFound) {
			WriteError(w, http.StatusBadRequest, "SESSION_NOT_FOUND", "WebRTC.SessionIdRequired", "sessionId 无效或已过期")
			return
		}
		WriteError(w, http.StatusInternalServerError, "WEBRTC_TICKET_FAILED", "WebRTC.TicketFailed", "创建投屏凭据失败")
		return
	}

	WriteJSON(w, http.StatusOK, result)
}

// Heartbeat 刷新投屏会话
// @Summary 刷新投屏会话
// @Description 使用客户端标记、递增序号和完整位图续租；空位图释放客户端的全部投屏会话。
// @Tags 投屏
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param body body SessionActionRequest true "会话参数"
// @Success 200 {object} SessionActionResponse
// @Failure 400 {object} ErrorResponse
// @Failure 401 {object} ErrorResponse
// @Failure 403 {object} ErrorResponse
// @Router /api/scrcpy-sessions/heartbeat [post]
func (h *WebRTCHandler) Heartbeat(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteMethodNotAllowed(w, http.MethodPost)
		return
	}
	var payload SessionActionRequest
	if err := decodeJSONBody(r, &payload); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_JSON", "Errors.InvalidJson", "请求 JSON 无效")
		return
	}
	if payload.PageID == "" || payload.Sequence == 0 || payload.Bitmap == nil {
		WriteError(w, http.StatusBadRequest, "CAST_HEARTBEAT_REQUIRED", "Errors.InvalidJson", "投屏心跳必须包含 p、v 和 b")
		return
	}
	err := h.withWebIdentity(r, func(identity *domainauth.Identity) error {
		return h.service.HeartbeatWebPage(webrtcservice.WebOwner{UserID: identity.UserID, LoginSessionID: identity.LoginSessionID}, payload.PageID, payload.Sequence, *payload.Bitmap)
	})
	if err != nil {
		if !h.writeWebSessionError(w, err) {
			WriteError(w, http.StatusInternalServerError, "CAST_HEARTBEAT_FAILED", "WebRTC.TicketFailed", "投屏心跳处理失败")
		}
		return
	}
	h.cleanupIdleRuntimes()
	WriteJSON(w, http.StatusOK, SessionActionResponse{Success: true})
}

// VideoHealth 获取视频流健康状态
// @Summary 获取视频流健康状态
// @Description 返回指定投屏会话的视频流健康快照。
// @Tags 投屏
// @Produce json
// @Security BearerAuth
// @Param deviceId query string true "设备 ID"
// @Param sessionId query string true "会话 ID"
// @Success 200 {object} VideoStreamHealthResponse
// @Failure 400 {object} ErrorResponse
// @Failure 401 {object} ErrorResponse
// @Failure 403 {object} ErrorResponse
// @Failure 404 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/scrcpy-sessions/video-health [get]
func (h *WebRTCHandler) VideoHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteMethodNotAllowed(w, http.MethodGet)
		return
	}

	deviceID := strings.TrimSpace(r.URL.Query().Get("deviceId"))
	sessionID := strings.TrimSpace(r.URL.Query().Get("sessionId"))
	if deviceID == "" {
		WriteError(w, http.StatusBadRequest, "DEVICE_ID_REQUIRED", "WebRTC.DeviceIdRequired", "deviceId 不能为空")
		return
	}
	if sessionID == "" {
		WriteError(w, http.StatusBadRequest, "SESSION_ID_REQUIRED", "WebRTC.SessionIdRequired", "sessionId 不能为空")
		return
	}

	parsedDeviceID, err := strconv.Atoi(deviceID)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_DEVICE_ID", "Errors.InvalidDeviceId", "无效的设备 ID")
		return
	}
	if _, ok := ensureDeviceAccess(w, r, h.access, parsedDeviceID); !ok {
		return
	}
	if !h.service.HasSessionLease(deviceID, sessionID) {
		WriteError(w, http.StatusNotFound, "SESSION_NOT_FOUND", "WebRTC.SessionIdRequired", "sessionId 无效或已过期")
		return
	}

	snapshot, err := h.service.GetVideoStreamHealthSnapshot(sessionID)
	if err != nil {
		if errors.Is(err, webrtcservice.ErrSessionIDRequired) {
			WriteError(w, http.StatusBadRequest, "SESSION_ID_REQUIRED", "WebRTC.SessionIdRequired", "sessionId 不能为空")
			return
		}
		if errors.Is(err, webrtcservice.ErrSessionNotFound) {
			WriteError(w, http.StatusNotFound, "SESSION_NOT_FOUND", "WebRTC.SessionIdRequired", "sessionId 无效或已过期")
			return
		}
		WriteError(w, http.StatusInternalServerError, "VIDEO_HEALTH_FAILED", "WebRTC.VideoHealthFailed", "读取视频流状态失败")
		return
	}

	WriteJSON(w, http.StatusOK, snapshot)
}

// GetClipboard 读取远端剪贴板
// @Summary 读取远端剪贴板
// @Description 读取指定设备当前投屏会话的远端剪贴板文本。
// @Tags 剪贴板
// @Produce json
// @Security BearerAuth
// @Param id path int true "设备 ID"
// @Success 200 {object} ClipboardResponse
// @Failure 400 {object} ErrorResponse
// @Failure 401 {object} ErrorResponse
// @Failure 403 {object} ErrorResponse
// @Failure 409 {object} ErrorResponse
// @Failure 502 {object} ErrorResponse
// @Router /api/devices/{id}/clipboard [get]
func (h *WebRTCHandler) GetClipboard(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteMethodNotAllowed(w, http.MethodGet)
		return
	}

	deviceID, err := deviceIDFromPath(r.URL.Path)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_DEVICE_ID", "Errors.InvalidDeviceId", "无效的设备 ID")
		return
	}
	if _, ok := ensureDeviceAccess(w, r, h.access, deviceID); !ok {
		return
	}

	runtime, release, err := h.borrowRuntime(strconv.Itoa(deviceID))
	if err != nil {
		WriteError(w, http.StatusConflict, "SCRCPY_RUNTIME_UNAVAILABLE", "Devices.RuntimeUnavailable", "当前设备没有可用的投屏会话")
		return
	}
	defer release()

	if cachedText, ok := runtime.GetClipboardCached(); ok {
		WriteJSON(w, http.StatusOK, ClipboardResponse{
			Text:   cachedText,
			Cached: true,
		})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 1200*time.Millisecond)
	defer cancel()

	text, err := runtime.GetClipboard(ctx)
	if err != nil {
		if cachedText, ok := runtime.GetClipboardCached(); ok {
			WriteJSON(w, http.StatusOK, ClipboardResponse{
				Text:   cachedText,
				Cached: true,
			})
			return
		}

		WriteError(w, http.StatusBadGateway, "DEVICE_CLIPBOARD_READ_FAILED", "Devices.ClipboardReadFailed", "读取远端剪贴板失败")
		return
	}

	WriteJSON(w, http.StatusOK, ClipboardResponse{
		Text:   text,
		Cached: false,
	})
}

// SetClipboard 写入远端剪贴板
// @Summary 写入远端剪贴板
// @Description PUT 同步远端剪贴板文本，POST 同步并触发远端粘贴。
// @Tags 剪贴板
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "设备 ID"
// @Param body body ClipboardWriteRequest true "剪贴板文本"
// @Success 200 {object} ClipboardWriteResponse
// @Failure 400 {object} ErrorResponse
// @Failure 401 {object} ErrorResponse
// @Failure 403 {object} ErrorResponse
// @Failure 409 {object} ErrorResponse
// @Failure 502 {object} ErrorResponse
// @Router /api/devices/{id}/clipboard [put]
// @Router /api/devices/{id}/clipboard [post]
func (h *WebRTCHandler) SetClipboard(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut && r.Method != http.MethodPost {
		WriteMethodNotAllowed(w, http.MethodPut+", "+http.MethodPost)
		return
	}

	deviceID, err := deviceIDFromPath(r.URL.Path)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_DEVICE_ID", "Errors.InvalidDeviceId", "无效的设备 ID")
		return
	}
	if _, ok := ensureDeviceAccess(w, r, h.access, deviceID); !ok {
		return
	}

	var payload ClipboardWriteRequest
	if err := decodeJSONBody(r, &payload); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_JSON", "Errors.InvalidJson", "请求 JSON 无效")
		return
	}

	runtime, release, err := h.borrowRuntime(strconv.Itoa(deviceID))
	if err != nil {
		WriteError(w, http.StatusConflict, "SCRCPY_RUNTIME_UNAVAILABLE", "Devices.RuntimeUnavailable", "当前设备没有可用的投屏会话")
		return
	}
	defer release()

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	if r.Method == http.MethodPost {
		if err := runtime.PasteClipboard(ctx, payload.Text); err != nil {
			WriteError(w, http.StatusBadGateway, "DEVICE_CLIPBOARD_PASTE_FAILED", "Devices.ClipboardPasteFailed", "远端粘贴失败")
			return
		}
		WriteJSON(w, http.StatusOK, ClipboardWriteResponse{
			Success: true,
			Text:    payload.Text,
			Paste:   true,
		})
		return
	}

	if err := runtime.SetClipboard(ctx, payload.Text); err != nil {
		WriteError(w, http.StatusBadGateway, "DEVICE_CLIPBOARD_WRITE_FAILED", "Devices.ClipboardWriteFailed", "同步远端剪贴板失败")
		return
	}

	WriteJSON(w, http.StatusOK, ClipboardWriteResponse{
		Success: true,
		Text:    payload.Text,
	})
}

func (h *WebRTCHandler) ServeSignalWS(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteMethodNotAllowed(w, http.MethodGet)
		return
	}

	ticketValue := strings.TrimSpace(r.URL.Query().Get("ticket"))
	ticket, err := h.service.ConsumeTicket(r.Context(), ticketValue)
	if err != nil {
		status := http.StatusUnauthorized
		if !errors.Is(err, webrtcservice.ErrTicketNotFound) {
			status = http.StatusInternalServerError
		}
		WriteError(w, status, "WEBRTC_TICKET_INVALID", "WebRTC.InvalidTicket", "投屏凭据无效或已过期")
		return
	}

	if h.loginSessions == nil {
		h.writeWebSessionError(w, authservice.ErrUnauthorized)
		return
	}
	err = h.loginSessions.WithLoginSession(r.Context(), ticket.UserID, ticket.LoginSessionID, func(identity *domainauth.Identity) error {
		if err := h.checkWebDevice(r.Context(), identity, ticket.DeviceID); err != nil {
			return err
		}
		if !h.service.StartTicket(ticket) {
			return webrtcservice.ErrSessionNotFound
		}
		return nil
	})
	if err != nil {
		WriteError(w, http.StatusUnauthorized, "WEBRTC_TICKET_INVALID", "WebRTC.InvalidTicket", "投屏凭据已失效")
		return
	}
	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	if ticket.NewPeerConnection {
		h.service.ReplaceSignalingSession(ticket.SessionID)
	}
	deviceID, err := strconv.Atoi(ticket.DeviceID)
	if err != nil {
		writeSignalError(conn, "INVALID_DEVICE_ID", "WebRTC.InvalidDeviceId", "设备 ID 无效", err, false)
		_ = conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, "invalid device id"))
		return
	}

	options := scrcpyservice.WebRTCRuntimeOptions{
		AppPackage:       ticket.AppPackage,
		AppName:          ticket.AppName,
		NewDisplay:       ticket.NewDisplay,
		NewDisplayWidth:  ticket.NewDisplayWidth,
		NewDisplayHeight: ticket.NewDisplayHeight,
		NewDisplayDPI:    ticket.NewDisplayDPI,
	}
	runtime, created, err := h.acquireRuntime(r.Context(), ticket.DeviceID, ticket.SessionID, deviceID, options)
	if err != nil {
		code, messageKey, message := signalScrcpyStartError(err)
		writeSignalError(conn, code, messageKey, message, err, false)
		_ = conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, "scrcpy start failed"))
		return
	}
	defer func() {
		h.releaseRuntime(ticket.DeviceID, ticket.SessionID, runtime)
		h.cleanupIdleRuntimes()
	}()

	if created {
		if packageName := strings.TrimSpace(ticket.AppPackage); packageName != "" {
			if err := h.launchProjectedApp(runtime, packageName); err != nil {
				writeSignalError(conn, "PROJECTED_APP_LAUNCH_FAILED", "WebRTC.ProjectedAppLaunchFailed", "启动投屏应用失败", err, false)
				_ = conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, "app launch failed"))
				return
			}
		}
	}

	if err := h.service.HandleSignalWebSocket(r.Context(), ticket.DeviceID, ticket.SessionID, conn, h.settings, runtime); err != nil {
		writeSignalError(conn, "SIGNAL_HANDLE_FAILED", "WebRTC.SignalHandleFailed", "WebRTC 信令处理失败", err, true)
	}
}

func (h *WebRTCHandler) acquireRuntime(
	ctx context.Context,
	deviceKey string,
	sessionID string,
	deviceID int,
	options scrcpyservice.WebRTCRuntimeOptions,
) (domainscrcpy.Runtime, bool, error) {
	signature := buildRuntimeSignature(deviceKey, options)
	shareable := isRuntimeShareable(options)

	for {
		h.runtimeMu.Lock()
		entry := h.runtimes[deviceKey]
		if entry != nil {
			if entry.starting {
				ready := entry.ready
				h.runtimeMu.Unlock()
				select {
				case <-ready:
				case <-ctx.Done():
					return nil, false, ctx.Err()
				}
				continue
			}

			if entry.runtime != nil && entry.runtime.GetSourceHealth().RuntimeClosed {
				delete(h.runtimes, deviceKey)
				runtime := entry.runtime
				h.runtimeMu.Unlock()
				_ = runtime.Close()
				continue
			}

			if entry.runtime != nil && sessionID != "" && entry.signature == signature && entry.sessionRefs[sessionID] > 0 {
				entry.refCount++
				entry.sessionRefs[sessionID]++
				entry.sessionIDs[sessionID] = struct{}{}
				entry.lastUsedAt = time.Now().UTC()
				h.runtimeMu.Unlock()
				return entry.runtime, false, nil
			}

			if shareable && entry.runtime != nil && entry.refCount > 0 && entry.signature == signature {
				entry.refCount++
				if sessionID != "" {
					if entry.sessionRefs == nil {
						entry.sessionRefs = make(map[string]int)
					}
					entry.sessionRefs[sessionID]++
					entry.sessionIDs[sessionID] = struct{}{}
				}
				entry.lastUsedAt = time.Now().UTC()
				h.runtimeMu.Unlock()
				return entry.runtime, false, nil
			}

			_, belongsToCachedRuntime := entry.sessionIDs[sessionID]
			if entry.runtime != nil && sessionID != "" && entry.refCount == 0 && entry.signature == signature && belongsToCachedRuntime && h.service.HasSessionLease(deviceKey, sessionID) {
				entry.refCount++
				if entry.sessionRefs == nil {
					entry.sessionRefs = make(map[string]int)
				}
				entry.sessionRefs[sessionID]++
				entry.sessionIDs[sessionID] = struct{}{}
				entry.lastUsedAt = time.Now().UTC()
				h.runtimeMu.Unlock()
				return entry.runtime, false, nil
			}

			if entry.refCount == 0 {
				if h.runtimeHasLease(entry) {
					h.runtimeMu.Unlock()
					return nil, false, fmt.Errorf("runtime for device %s is busy", deviceKey)
				}
				delete(h.runtimes, deviceKey)
				runtime := entry.runtime
				h.runtimeMu.Unlock()
				if runtime != nil {
					_ = runtime.Close()
				}
				continue
			}

			h.runtimeMu.Unlock()
			return nil, false, fmt.Errorf("runtime for device %s is busy", deviceKey)
		}

		entry = &managedRuntime{
			deviceID:    deviceKey,
			signature:   signature,
			sessionRefs: map[string]int{},
			sessionIDs:  map[string]struct{}{},
			refCount:    1,
			starting:    true,
			ready:       make(chan struct{}),
			lastUsedAt:  time.Now().UTC(),
		}
		if sessionID != "" {
			entry.sessionRefs[sessionID] = 1
			entry.sessionIDs[sessionID] = struct{}{}
		}
		h.runtimes[deviceKey] = entry
		h.runtimeMu.Unlock()

		runtime, err := h.scrcpy.StartRuntimeForWebRTC(ctx, deviceID, options)

		h.runtimeMu.Lock()
		if err != nil {
			delete(h.runtimes, deviceKey)
			entry.startErr = err
			entry.starting = false
			close(entry.ready)
			h.runtimeMu.Unlock()
			return nil, false, err
		}

		entry.runtime = runtime
		entry.starting = false
		entry.lastUsedAt = time.Now().UTC()
		close(entry.ready)
		h.runtimeMu.Unlock()
		return runtime, true, nil
	}
}

func (h *WebRTCHandler) releaseRuntime(deviceID string, sessionID string, runtime domainscrcpy.Runtime) {
	if deviceID == "" {
		return
	}

	h.runtimeMu.Lock()
	defer h.runtimeMu.Unlock()

	entry := h.runtimes[deviceID]
	if entry == nil || entry.runtime != runtime {
		return
	}
	if sessionID != "" {
		if entry.sessionRefs == nil || entry.sessionRefs[sessionID] == 0 {
			return
		}
		entry.sessionRefs[sessionID]--
		if entry.sessionRefs[sessionID] <= 0 {
			delete(entry.sessionRefs, sessionID)
		}
	}
	if entry.refCount > 0 {
		entry.refCount--
	}
	if entry.refCount == 0 {
		entry.sessionRefs = make(map[string]int)
	}
	entry.lastUsedAt = time.Now().UTC()
}

func (h *WebRTCHandler) runtimeJanitor() {
	ticker := time.NewTicker(runtimeJanitorInterval)
	defer ticker.Stop()

	for range ticker.C {
		h.CleanupWebSessions(context.Background())
		h.cleanupIdleRuntimes()
	}
}

func (h *WebRTCHandler) borrowRuntime(deviceID string) (domainscrcpy.Runtime, func(), error) {
	if deviceID == "" {
		return nil, func() {}, errors.New("device id is required")
	}

	for {
		h.runtimeMu.Lock()
		entry := h.runtimes[deviceID]
		if entry == nil {
			h.runtimeMu.Unlock()
			return nil, func() {}, errors.New("runtime not found")
		}
		if entry.starting {
			ready := entry.ready
			h.runtimeMu.Unlock()
			<-ready
			continue
		}
		if entry.runtime == nil {
			h.runtimeMu.Unlock()
			return nil, func() {}, errors.New("runtime not ready")
		}

		entry.refCount++
		entry.lastUsedAt = time.Now().UTC()
		h.runtimeMu.Unlock()

		released := false
		return entry.runtime, func() {
			if released {
				return
			}
			released = true

			h.runtimeMu.Lock()
			defer h.runtimeMu.Unlock()

			current := h.runtimes[deviceID]
			if current == nil || current != entry {
				return
			}
			if current.refCount > 0 {
				current.refCount--
			}
			current.lastUsedAt = time.Now().UTC()
		}, nil
	}
}

func (h *WebRTCHandler) cleanupIdleRuntimes() {
	var stale []*managedRuntime

	h.runtimeMu.Lock()
	for key, entry := range h.runtimes {
		if entry == nil || entry.starting || entry.refCount > 0 || entry.runtime == nil {
			continue
		}
		if h.runtimeHasLease(entry) {
			entry.lastUsedAt = time.Now().UTC()
			continue
		}
		delete(h.runtimes, key)
		stale = append(stale, entry)
	}
	h.runtimeMu.Unlock()

	for _, entry := range stale {
		_ = entry.runtime.Close()
	}
}

func buildRuntimeSignature(deviceID string, options scrcpyservice.WebRTCRuntimeOptions) string {
	return strings.Join([]string{
		strings.TrimSpace(deviceID),
		strings.TrimSpace(options.AppPackage),
		fmt.Sprintf("%t", options.NewDisplay),
		fmt.Sprintf("%d", derefInt(options.NewDisplayWidth)),
		fmt.Sprintf("%d", derefInt(options.NewDisplayHeight)),
		fmt.Sprintf("%d", derefInt(options.NewDisplayDPI)),
	}, "|")
}

func derefInt(value *int) int {
	if value == nil {
		return 0
	}
	return *value
}

func isRuntimeShareable(options scrcpyservice.WebRTCRuntimeOptions) bool {
	return !options.NewDisplay
}

func (h *WebRTCHandler) launchProjectedApp(runtime domainscrcpy.Runtime, packageName string) error {
	control := domainscrcpy.BuildStartAppControl(packageName)
	if err := runtime.SendControl(control); err != nil {
		return err
	}
	return nil
}

func writeSignalError(
	conn *websocket.Conn,
	code string,
	messageKey string,
	message string,
	err error,
	retryable bool,
) {
	if conn == nil {
		return
	}

	payload := SignalErrorPayload{
		Type:       "error",
		Code:       code,
		MessageKey: messageKey,
		Message:    message,
		Retryable:  retryable,
	}
	if err != nil {
		payload.Detail = err.Error()
	}

	_ = conn.WriteJSON(payload)
}

func signalScrcpyStartError(err error) (string, string, string) {
	switch {
	case errors.Is(err, deviceservice.ErrDeviceOffline):
		return "DEVICE_OFFLINE", "Devices.Offline", "设备已断开，请稍后重试"
	case errors.Is(err, scrcpyservice.ErrDeviceNotFound):
		return "DEVICE_NOT_FOUND", "Devices.NotFound", "设备不存在"
	case errors.Is(err, scrcpyservice.ErrDeviceSerialMissing):
		return "DEVICE_SERIAL_REQUIRED", "Devices.SerialRequired", "设备序列号不能为空"
	case errors.Is(err, scrcpyservice.ErrServerUnavailable):
		return "SCRCPY_SERVER_UNAVAILABLE", "Scrcpy.ServerUnavailable", "scrcpy-server 文件不可用"
	default:
		return "SCRCPY_START_FAILED", "WebRTC.ScrcpyStartFailed", "启动 scrcpy 会话失败"
	}
}
