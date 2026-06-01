package router

import "net/http"

func registerStatusRoutes(mux *http.ServeMux, handlers routeHandlers) {
	mux.HandleFunc("/api/status", handlers.status.Get)
	mux.HandleFunc("/api/app/version", handlers.version.Get)
	mux.HandleFunc("/api/adb/status", handlers.adb.Status)
	mux.HandleFunc("/api/adb/server/start", handlers.adb.StartServer)
	mux.HandleFunc("/api/adb/server/kill", handlers.adb.KillServer)
	mux.HandleFunc("/api/adb/pair", handlers.adb.Pair)
}
