package middleware

import (
	"encoding/json"
	"net/http"
)

func Recover(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if recover() != nil {
				writeRecoverInternalServerError(w)
			}
		}()

		next.ServeHTTP(w, r)
	})
}

func writeRecoverInternalServerError(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusInternalServerError)
	payload := map[string]any{
		"error": map[string]string{
			"code":       "INTERNAL_SERVER_ERROR",
			"messageKey": "Errors.InternalServerError",
			"message":    "服务器内部错误",
		},
	}
	_ = json.NewEncoder(w).Encode(payload)
}
