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

func (h *ADBHandler) StartServer(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteMethodNotAllowed(w, http.MethodPost)
		return
	}

	if err := h.service.StartServer(r.Context()); err != nil {
		h.writeADBError(w, err)
		return
	}

	WriteJSON(w, http.StatusOK, map[string]any{
		"success": true,
	})
}

func (h *ADBHandler) KillServer(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteMethodNotAllowed(w, http.MethodPost)
		return
	}

	if err := h.service.KillServer(r.Context()); err != nil {
		h.writeADBError(w, err)
		return
	}

	WriteJSON(w, http.StatusOK, map[string]any{
		"success": true,
	})
}

func (h *ADBHandler) Pair(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteMethodNotAllowed(w, http.MethodPost)
		return
	}

	var payload struct {
		Host        string `json:"host"`
		PairingPort int    `json:"pairingPort"`
		PairingCode string `json:"pairingCode"`
	}

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
		WriteJSON(w, http.StatusBadRequest, map[string]any{
			"success": false,
			"error":   "Failed to pair device. Please check pairing code and port.",
		})
		return
	}

	WriteJSON(w, http.StatusOK, map[string]any{
		"success":     true,
		"host":        payload.Host,
		"pairingPort": payload.PairingPort,
	})
}

func (h *ADBHandler) writeADBError(w http.ResponseWriter, err error) {
	if errors.Is(err, adberrors.ErrBinaryNotFound) {
		WriteError(w, http.StatusServiceUnavailable, "ADB_BINARY_NOT_FOUND", "Errors.AdbBinaryNotFound", "未找到可用的 ADB 可执行文件")
		return
	}

	WriteError(w, http.StatusBadGateway, "ADB_COMMAND_FAILED", "Errors.AdbCommandFailed", "ADB 命令执行失败")
}
