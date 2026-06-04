package router

import "net/http"

func registerStatusRoutes(mux *http.ServeMux, handlers routeHandlers, guards routeGuards) {
	mux.HandleFunc("/api/status", handlers.status.Get)
	mux.HandleFunc("/api/app/version", handlers.version.Get)
	mux.Handle("/api/adb/status", guards.authMiddleware(guards.requireDevicesManage(http.HandlerFunc(handlers.adb.Status))))
	mux.Handle("/api/adb/server/start", guards.authMiddleware(guards.requireDevicesManage(http.HandlerFunc(handlers.adb.StartServer))))
	mux.Handle("/api/adb/server/kill", guards.authMiddleware(guards.requireDevicesManage(http.HandlerFunc(handlers.adb.KillServer))))
	mux.Handle("/api/adb/pair", guards.authMiddleware(guards.requireDevicesManage(http.HandlerFunc(handlers.adb.Pair))))
}
