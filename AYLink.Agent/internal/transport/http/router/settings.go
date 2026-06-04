package router

import (
	"net/http"

	"aylink-agent/internal/transport/http/handler"
)

func registerSettingsRoutes(mux *http.ServeMux, handlers routeHandlers, guards routeGuards) {
	mux.HandleFunc("/api/i18n/languages", handlers.i18n.Languages)
	mux.HandleFunc("/api/i18n/", handlers.i18n.Locale)

	mux.Handle("/api/settings/language", guards.authMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			guards.requireSettingsView(http.HandlerFunc(handlers.i18n.GetServerLanguage)).ServeHTTP(w, r)
		case http.MethodPut:
			guards.requireSettingsManage(http.HandlerFunc(handlers.i18n.SetServerLanguage)).ServeHTTP(w, r)
		default:
			handler.WriteMethodNotAllowed(w, http.MethodGet+", "+http.MethodPut)
		}
	})))

	mux.Handle("/api/settings/webrtc-network", guards.authMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			guards.requireSettingsView(http.HandlerFunc(handlers.settings.GetWebRtcNetwork)).ServeHTTP(w, r)
		case http.MethodPut:
			guards.requireSettingsManage(http.HandlerFunc(handlers.settings.SaveWebRtcNetwork)).ServeHTTP(w, r)
		default:
			handler.WriteMethodNotAllowed(w, http.MethodGet+", "+http.MethodPut)
		}
	})))

	mux.Handle("/api/control/webrtc-network", guards.authMiddleware(guards.requireDevicesControl(http.HandlerFunc(handlers.settings.GetWebRtcNetwork))))
}
