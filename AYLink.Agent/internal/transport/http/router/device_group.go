package router

import (
	"net/http"
	"strings"

	"aylink-agent/internal/transport/http/handler"
)

func registerDeviceGroupRoutes(mux *http.ServeMux, handlers routeHandlers, guards routeGuards) {
	mux.Handle("/api/device-groups/options", guards.authMiddleware(guards.requireDevicesView(http.HandlerFunc(handlers.deviceGroup.ListOptions))))

	mux.Handle("/api/device-groups", guards.authMiddleware(guards.requireAccountsManage(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			handlers.deviceGroup.List(w, r)
		case http.MethodPost:
			handlers.deviceGroup.Create(w, r)
		default:
			handler.WriteMethodNotAllowed(w, http.MethodGet+", "+http.MethodPost)
		}
	}))))

	mux.Handle("/api/device-groups/", guards.authMiddleware(guards.requireAccountsManage(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.TrimSpace(strings.TrimPrefix(r.URL.Path, "/api/device-groups/")) == "" {
			handler.WriteMethodNotAllowed(w, http.MethodGet+", "+http.MethodPost)
			return
		}

		switch r.Method {
		case http.MethodPut:
			handlers.deviceGroup.Update(w, r)
		case http.MethodDelete:
			handlers.deviceGroup.Delete(w, r)
		default:
			handler.WriteMethodNotAllowed(w, http.MethodPut+", "+http.MethodDelete)
		}
	}))))
}
