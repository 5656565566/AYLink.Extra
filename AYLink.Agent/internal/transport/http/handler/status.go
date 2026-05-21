package handler

import (
	"net/http"

	statusservice "aylink-agent/internal/service/status"
)

type StatusHandler struct {
	service *statusservice.Service
}

func NewStatusHandler(service *statusservice.Service) *StatusHandler {
	return &StatusHandler{service: service}
}

func (h *StatusHandler) Get(w http.ResponseWriter, r *http.Request) {
	WriteJSON(w, http.StatusOK, h.service.Get(r.Context()))
}
