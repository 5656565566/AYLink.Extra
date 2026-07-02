package handler

import (
	"errors"
	"net/http"

	adberrors "aylink-agent/internal/infra/adb"
)

type ADBHandler struct {
	service ADBService
}

func NewADBHandler(service ADBService) *ADBHandler {
	return &ADBHandler{service: service}
}

// Status 获取 ADB 状态
// @Summary 获取 ADB 状态
// @Description 返回 ADB 服务地址、已解析的 ADB 可执行文件和当前设备列表。
// @Tags ADB
// @Produce json
// @Security BearerAuth
// @Success 200 {object} ADBStatusResponse
// @Failure 401 {object} ErrorResponse
// @Failure 403 {object} ErrorResponse
// @Failure 502 {object} ErrorResponse
// @Failure 503 {object} ErrorResponse
// @Router /api/adb/status [get]
func (h *ADBHandler) Status(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteMethodNotAllowed(w, http.MethodGet)
		return
	}

	response, err := h.service.Status(r.Context())
	if err != nil {
		h.writeADBError(w, err)
		return
	}

	WriteJSON(w, http.StatusOK, response)
}

// StartServer 启动 ADB 服务
// @Summary 启动 ADB 服务
// @Description 启动本机 ADB server。
// @Tags ADB
// @Produce json
// @Security BearerAuth
// @Success 200 {object} SuccessResponse
// @Failure 401 {object} ErrorResponse
// @Failure 403 {object} ErrorResponse
// @Failure 502 {object} ErrorResponse
// @Failure 503 {object} ErrorResponse
// @Router /api/adb/server/start [post]
func (h *ADBHandler) StartServer(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteMethodNotAllowed(w, http.MethodPost)
		return
	}

	if err := h.service.StartServer(r.Context()); err != nil {
		h.writeADBError(w, err)
		return
	}

	WriteJSON(w, http.StatusOK, SuccessResponse{Success: true})
}

// KillServer 关闭 ADB 服务
// @Summary 关闭 ADB 服务
// @Description 关闭本机 ADB server。
// @Tags ADB
// @Produce json
// @Security BearerAuth
// @Success 200 {object} SuccessResponse
// @Failure 401 {object} ErrorResponse
// @Failure 403 {object} ErrorResponse
// @Failure 502 {object} ErrorResponse
// @Failure 503 {object} ErrorResponse
// @Router /api/adb/server/kill [post]
func (h *ADBHandler) KillServer(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteMethodNotAllowed(w, http.MethodPost)
		return
	}

	if err := h.service.KillServer(r.Context()); err != nil {
		h.writeADBError(w, err)
		return
	}

	WriteJSON(w, http.StatusOK, SuccessResponse{Success: true})
}

// Pair 配对无线调试设备
// @Summary 配对无线调试设备
// @Description 使用 Android 无线调试配对地址、端口和配对码完成 ADB 配对。
// @Tags ADB
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param body body ADBPairRequest true "配对参数"
// @Success 200 {object} ADBPairResponse
// @Failure 400 {object} ErrorResponse
// @Failure 401 {object} ErrorResponse
// @Failure 403 {object} ErrorResponse
// @Failure 502 {object} ErrorResponse
// @Failure 503 {object} ErrorResponse
// @Router /api/adb/pair [post]
func (h *ADBHandler) Pair(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteMethodNotAllowed(w, http.MethodPost)
		return
	}

	var payload ADBPairRequest

	if err := decodeJSONBody(r, &payload); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_JSON", "Errors.InvalidJson", "请求 JSON 无效")
		return
	}

	if payload.Host == "" || payload.PairingPort == 0 || payload.PairingCode == "" {
		WriteError(w, http.StatusBadRequest, "MISSING_FIELDS", "Errors.MissingFields", "host, pairingPort and pairingCode are required")
		return
	}

	if err := h.service.StartServer(r.Context()); err != nil {
		h.writeADBError(w, err)
		return
	}

	_, err := h.service.Pair(r.Context(), payload.Host, payload.PairingPort, payload.PairingCode)
	if err != nil {
		WriteJSON(w, http.StatusBadRequest, ADBPairFailureResponse{
			Success: false,
			Error:   "Failed to pair device. Please check pairing code and port.",
		})
		return
	}

	WriteJSON(w, http.StatusOK, ADBPairResponse{
		Success:     true,
		Host:        payload.Host,
		PairingPort: payload.PairingPort,
	})
}

func (h *ADBHandler) writeADBError(w http.ResponseWriter, err error) {
	if errors.Is(err, adberrors.ErrBinaryNotFound) {
		WriteError(w, http.StatusServiceUnavailable, "ADB_BINARY_NOT_FOUND", "Errors.AdbBinaryNotFound", "未找到可用的 ADB 可执行文件")
		return
	}

	WriteError(w, http.StatusBadGateway, "ADB_COMMAND_FAILED", "Errors.AdbCommandFailed", "ADB 命令执行失败")
}
