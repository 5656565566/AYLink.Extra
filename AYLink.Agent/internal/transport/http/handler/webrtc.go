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

	domainscrcpy "aylink-agent/internal/domain/scrcpy"
	scrcpyservice "aylink-agent/internal/service/scrcpy"
	settingsservice "aylink-agent/internal/service/settings"
	webrtcservice "aylink-agent/internal/service/webrtc"

	"github.com/gorilla/websocket"
)

const runtimeJanitorInterval = 5 * time.Second

type WebRTCHandler struct {
	service  *webrtcservice.Service
	settings *settingsservice.Service
	scrcpy   *scrcpyservice.Service
	upgrader websocket.Upgrader

	runtimeMu sync.Mutex
	runtimes  map[string]*managedRuntime
}

type managedRuntime struct {
	deviceID    string
	signature   string
	sessionRefs map[string]int
	runtime     domainscrcpy.Runtime
	refCount    int
	starting    bool
	ready       chan struct{}
	startErr    error
	lastUsedAt  time.Time
}

func NewWebRTCHandler(service *webrtcservice.Service, settings *settingsservice.Service, scrcpy *scrcpyservice.Service) *WebRTCHandler {
	handler := &WebRTCHandler{
		service:  service,
		settings: settings,
		scrcpy:   scrcpy,
		runtimes: make(map[string]*managedRuntime),
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool { return true },
		},
	}
	go handler.runtimeJanitor()
	return handler
}

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
	payload.AppPackage = strings.TrimSpace(payload.AppPackage)
	payload.AppName = strings.TrimSpace(payload.AppName)

	result, err := h.service.CreateTicket(r.Context(), payload)
	if err != nil {
		if errors.Is(err, webrtcservice.ErrDeviceIDRequired) {
			WriteError(w, http.StatusBadRequest, "DEVICE_ID_REQUIRED", "WebRTC.DeviceIdRequired", "deviceId 不能为空")
			return
		}
		WriteError(w, http.StatusInternalServerError, "WEBRTC_TICKET_FAILED", "WebRTC.TicketFailed", "创建投屏凭据失败")
		return
	}

	WriteJSON(w, http.StatusOK, result)
}

func (h *WebRTCHandler) Heartbeat(w http.ResponseWriter, r *http.Request) {
	h.handleSessionAction(w, r, true)
}

func (h *WebRTCHandler) Release(w http.ResponseWriter, r *http.Request) {
	h.handleSessionAction(w, r, false)
}

func (h *WebRTCHandler) handleSessionAction(w http.ResponseWriter, r *http.Request, heartbeat bool) {
	if r.Method != http.MethodPost {
		WriteMethodNotAllowed(w, http.MethodPost)
		return
	}

	var payload struct {
		DeviceID  string `json:"deviceId"`
		SessionID string `json:"sessionId"`
	}
	if err := decodeJSONBody(r, &payload); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_JSON", "Errors.InvalidJson", "请求 JSON 无效")
		return
	}

	payload.DeviceID = strings.TrimSpace(payload.DeviceID)
	payload.SessionID = strings.TrimSpace(payload.SessionID)
	if heartbeat {
		success, err := h.service.TouchSession(r.Context(), payload.DeviceID, payload.SessionID)
		if err != nil {
			if errors.Is(err, webrtcservice.ErrSessionIDRequired) {
				WriteError(w, http.StatusBadRequest, "SESSION_ID_REQUIRED", "WebRTC.SessionIdRequired", "sessionId 不能为空")
				return
			}
			WriteError(w, http.StatusBadRequest, "DEVICE_ID_REQUIRED", "WebRTC.DeviceIdRequired", "deviceId 不能为空")
			return
		}
		WriteJSON(w, http.StatusOK, map[string]any{"success": success})
		return
	}

	if err := h.service.ReleaseSession(r.Context(), payload.DeviceID, payload.SessionID); err != nil {
		if errors.Is(err, webrtcservice.ErrSessionIDRequired) {
			WriteError(w, http.StatusBadRequest, "SESSION_ID_REQUIRED", "WebRTC.SessionIdRequired", "sessionId 不能为空")
			return
		}
		WriteError(w, http.StatusBadRequest, "DEVICE_ID_REQUIRED", "WebRTC.DeviceIdRequired", "deviceId 不能为空")
		return
	}
	if !h.service.HasActiveSessionLease(payload.DeviceID) && !h.hasRuntimeRefs(payload.DeviceID) {
		h.forceCloseRuntime(payload.DeviceID)
	}
	h.cleanupIdleRuntimes()
	WriteJSON(w, http.StatusOK, map[string]any{"success": true})
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

	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	h.service.MarkSessionStarted(ticket.DeviceID, ticket.SessionID)
	deviceID, err := strconv.Atoi(ticket.DeviceID)
	if err != nil {
		_ = conn.WriteJSON(map[string]any{
			"type":    "error",
			"message": "设备 ID 无效",
			"detail":  err.Error(),
		})
		_ = conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, "invalid device id"))
		return
	}

	options := scrcpyservice.WebRTCRuntimeOptions{
		AppPackage: ticket.AppPackage,
		AppName:    ticket.AppName,
		NewDisplay: ticket.NewDisplay,
	}
	runtime, created, err := h.acquireRuntime(r.Context(), ticket.DeviceID, ticket.SessionID, deviceID, options)
	if err != nil {
		_ = conn.WriteJSON(map[string]any{
			"type":    "error",
			"message": "启动 scrcpy 会话失败",
			"detail":  err.Error(),
		})
		_ = conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, "scrcpy start failed"))
		return
	}
	defer func() {
		h.releaseRuntime(ticket.DeviceID, ticket.SessionID)
		h.cleanupIdleRuntimes()
	}()

	if created {
		if packageName := strings.TrimSpace(ticket.AppPackage); packageName != "" {
			if err := h.launchProjectedApp(runtime, packageName); err != nil {
				_ = conn.WriteJSON(map[string]any{
					"type":    "error",
					"message": "启动投屏应用失败",
					"detail":  err.Error(),
				})
				_ = conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, "app launch failed"))
				return
			}
		}
	}

	if err := h.service.HandleSignalWebSocket(context.Background(), ticket.DeviceID, conn, h.settings, runtime); err != nil {
		_ = conn.WriteJSON(map[string]any{
			"type":    "error",
			"message": "WebRTC 信令处理失败",
			"detail":  err.Error(),
		})
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
				<-ready
				continue
			}

			if shareable && entry.runtime != nil && entry.signature == signature {
				entry.refCount++
				if sessionID != "" {
					if entry.sessionRefs == nil {
						entry.sessionRefs = make(map[string]int)
					}
					entry.sessionRefs[sessionID]++
				}
				entry.lastUsedAt = time.Now().UTC()
				h.runtimeMu.Unlock()
				return entry.runtime, false, nil
			}

			if entry.refCount == 0 {
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
			refCount:    1,
			starting:    true,
			ready:       make(chan struct{}),
			lastUsedAt:  time.Now().UTC(),
		}
		if sessionID != "" {
			entry.sessionRefs[sessionID] = 1
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

func (h *WebRTCHandler) releaseRuntime(deviceID string, sessionID string) {
	if deviceID == "" {
		return
	}

	h.runtimeMu.Lock()
	defer h.runtimeMu.Unlock()

	entry := h.runtimes[deviceID]
	if entry == nil {
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
		h.cleanupIdleRuntimes()
	}
}

func (h *WebRTCHandler) cleanupIdleRuntimes() {
	var stale []*managedRuntime

	h.runtimeMu.Lock()
	for key, entry := range h.runtimes {
		if entry == nil || entry.starting || entry.refCount > 0 || entry.runtime == nil {
			continue
		}
		if h.service.HasActiveSessionLease(key) {
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

func (h *WebRTCHandler) hasRuntimeRefs(deviceID string) bool {
	if deviceID == "" {
		return false
	}

	h.runtimeMu.Lock()
	defer h.runtimeMu.Unlock()

	entry := h.runtimes[deviceID]
	return entry != nil && entry.refCount > 0
}

func (h *WebRTCHandler) forceCloseRuntime(deviceID string) {
	if deviceID == "" {
		return
	}

	h.runtimeMu.Lock()
	entry := h.runtimes[deviceID]
	if entry != nil {
		delete(h.runtimes, deviceID)
	}
	h.runtimeMu.Unlock()

	if entry != nil && entry.runtime != nil {
		_ = entry.runtime.Close()
	}
}

func buildRuntimeSignature(deviceID string, options scrcpyservice.WebRTCRuntimeOptions) string {
	return strings.Join([]string{
		strings.TrimSpace(deviceID),
		strings.TrimSpace(options.AppPackage),
		fmt.Sprintf("%t", options.NewDisplay),
	}, "|")
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
