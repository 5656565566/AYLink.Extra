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

func (h *StatusHandler) Get(w http.ResponseWriter, r *http.Request) {
	WriteJSON(w, http.StatusOK, h.service.Get(r.Context()))
}
