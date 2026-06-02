package handler

import (
	"encoding/json"
	"io"
	"net/http"
)

type ErrorResponse struct {
	Error ErrorPayload `json:"error"`
}

type ErrorPayload struct {
	Code       string `json:"code"`
	MessageKey string `json:"messageKey,omitempty"`
	Message    string `json:"message"`
}

func WriteJSON(w http.ResponseWriter, statusCode int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)

	encoder := json.NewEncoder(w)
	encoder.SetEscapeHTML(false)
	_ = encoder.Encode(payload)
}

func WriteError(w http.ResponseWriter, statusCode int, code, messageKey, message string) {
	WriteJSON(w, statusCode, ErrorResponse{
		Error: ErrorPayload{
			Code:       code,
			MessageKey: messageKey,
			Message:    message,
		},
	})
}

func WriteInvalidJSON(w http.ResponseWriter) {
	WriteError(w, http.StatusBadRequest, "INVALID_JSON", "Errors.InvalidJson", "请求 JSON 无效")
}

func WriteUnauthorized(w http.ResponseWriter) {
	WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Errors.Unauthorized", "Unauthorized")
}

func WriteInternalServerError(w http.ResponseWriter, code, messageKey, message string) {
	WriteError(w, http.StatusInternalServerError, code, messageKey, message)
}

func WriteMethodNotAllowed(w http.ResponseWriter, allowedMethod string) {
	w.Header().Set("Allow", allowedMethod)
	WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "Errors.MethodNotAllowed", "请求方法不被允许")
}

func decodeJSONBody(r *http.Request, target any) error {
	defer func() {
		if r.Body != nil {
			_ = r.Body.Close()
		}
	}()

	if r.Body == nil {
		return io.EOF
	}

	return json.NewDecoder(r.Body).Decode(target)
}
