package handler

import (
	domainwebrtc "aylink-agent/internal/domain/webrtc"
	webrtcservice "aylink-agent/internal/service/webrtc"
)

type CreateTicketRequest = webrtcservice.CreateTicketInput

type CreateTicketResponse = webrtcservice.CreateTicketResult

type VideoStreamHealthResponse = domainwebrtc.VideoStreamHealthSnapshot

type SessionActionRequest struct {
	DeviceID  string `json:"deviceId"`
	SessionID string `json:"sessionId"`
}

type SessionActionResponse struct {
	Success bool `json:"success"`
}

type ClipboardWriteRequest struct {
	Text string `json:"text"`
}

type ClipboardResponse struct {
	Text   string `json:"text"`
	Cached bool   `json:"cached"`
}

type ClipboardWriteResponse struct {
	Success bool   `json:"success"`
	Text    string `json:"text"`
	Paste   bool   `json:"paste,omitempty"`
}
