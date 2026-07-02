package handler

import (
	"net/http"
)

type StatusHandler struct {
	service StatusService
}

func NewStatusHandler(service StatusService) *StatusHandler {
	return &StatusHandler{service: service}
}

// Get 获取 Agent 状态
// @Summary 获取 Agent 状态
// @Description 返回 Agent 运行状态、ADB 状态和当前设备列表。
// @Tags 状态
// @Produce json
// @Success 200 {object} AgentStatusResponse
// @Router /api/status [get]
func (h *StatusHandler) Get(w http.ResponseWriter, r *http.Request) {
	WriteJSON(w, http.StatusOK, h.service.Get(r.Context()))
}
