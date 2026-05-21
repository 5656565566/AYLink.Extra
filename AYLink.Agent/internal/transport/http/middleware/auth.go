package middleware

import (
	"context"
	"encoding/json"
	"net/http"
	"slices"
	"strings"

	domainauth "aylink-agent/internal/domain/auth"
)

// IdentityKey 作为上下文的键 存储用户认证凭据
type contextKey string

const IdentityKey = contextKey("identity")

type AuthService interface {
	ValidateAccessToken(ctx context.Context, accessToken string) (*domainauth.Identity, error)
}

func Auth(authService AuthService) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token := extractBearerToken(r)
			if token == "" {
				writeUnauthorized(w)
				return
			}

			identity, err := authService.ValidateAccessToken(r.Context(), token)
			if err != nil || identity == nil {
				writeUnauthorized(w)
				return
			}

			// 把凭证添加到上下文
			ctx := context.WithValue(r.Context(), IdentityKey, identity)
			r = r.WithContext(ctx)

			next.ServeHTTP(w, r)
		})
	}
}

func RequirePermission(permission string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			identity, ok := r.Context().Value(IdentityKey).(*domainauth.Identity)
			if !ok || identity == nil {
				writeUnauthorized(w)
				return
			}
			if permission != "" && !slices.Contains(identity.Permissions, permission) {
				writeForbidden(w)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func writeUnauthorized(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	// 输出于与应用匹配一致格式的 payload
	payload := map[string]any{
		"error": map[string]string{
			"code":       "UNAUTHORIZED",
			"messageKey": "Errors.Unauthorized",
			"message":    "Unauthorized",
		},
	}
	_ = json.NewEncoder(w).Encode(payload)
}

func writeForbidden(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusForbidden)
	payload := map[string]any{
		"error": map[string]string{
			"code":       "FORBIDDEN",
			"messageKey": "Errors.PermissionDenied",
			"message":    "Permission denied",
		},
	}
	_ = json.NewEncoder(w).Encode(payload)
}

func extractBearerToken(r *http.Request) string {
	authHeader := r.Header.Get("Authorization")
	if strings.HasPrefix(strings.ToLower(authHeader), "bearer ") {
		return strings.TrimSpace(authHeader[7:])
	}
	return strings.TrimSpace(r.URL.Query().Get("token"))
}
