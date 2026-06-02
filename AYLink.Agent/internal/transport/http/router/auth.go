package router

import (
	"net/http"
	"strings"

	"aylink-agent/internal/transport/http/handler"
)

func registerAuthRoutes(mux *http.ServeMux, handlers routeHandlers, guards routeGuards) {
	mux.HandleFunc("/api/login", handlers.auth.Login)
	mux.HandleFunc("/api/auth/refresh", handlers.auth.Refresh)
	mux.Handle("/api/auth/me", guards.authMiddleware(http.HandlerFunc(handlers.auth.Me)))
	mux.HandleFunc("/api/logout", handlers.auth.Logout)
	mux.Handle("/api/logout-all", guards.authMiddleware(http.HandlerFunc(handlers.auth.LogoutAll)))
	mux.Handle("/api/auth/change-password", guards.authMiddleware(guards.requireAccountsChangePassword(http.HandlerFunc(handlers.auth.ChangePassword))))

	mux.Handle("/api/accounts/users", guards.authMiddleware(guards.requireAccountsManage(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			handlers.auth.GetUsers(w, r)
		case http.MethodPost:
			handlers.auth.CreateUser(w, r)
		default:
			handler.WriteMethodNotAllowed(w, http.MethodGet+", "+http.MethodPost)
		}
	}))))

	mux.Handle("/api/accounts/users/", guards.authMiddleware(guards.requireAccountsManage(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/reset-password") {
			handlers.auth.ResetPassword(w, r)
			return
		}
		if strings.HasSuffix(r.URL.Path, "/activate") {
			handlers.auth.SetUserActive(w, r, true)
			return
		}
		if strings.HasSuffix(r.URL.Path, "/deactivate") {
			handlers.auth.SetUserActive(w, r, false)
			return
		}

		switch r.Method {
		case http.MethodPut:
			handlers.auth.UpdateUser(w, r)
		case http.MethodDelete:
			handlers.auth.DeleteUser(w, r)
		default:
			handler.WriteMethodNotAllowed(w, http.MethodPut+", "+http.MethodDelete+", "+http.MethodPost)
		}
	}))))

	mux.Handle("/api/accounts/roles", guards.authMiddleware(guards.requireAccountsManage(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			handlers.auth.GetRoles(w, r)
		case http.MethodPost:
			handlers.auth.CreateRole(w, r)
		default:
			handler.WriteMethodNotAllowed(w, http.MethodGet+", "+http.MethodPost)
		}
	}))))

	mux.Handle("/api/accounts/roles/", guards.authMiddleware(guards.requireAccountsManage(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodPut:
			handlers.auth.UpdateRole(w, r)
		default:
			handler.WriteMethodNotAllowed(w, http.MethodPut)
		}
	}))))
}
