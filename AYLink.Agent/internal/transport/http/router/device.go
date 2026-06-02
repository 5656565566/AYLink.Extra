package router

import (
	"net/http"
	"strings"

	"aylink-agent/internal/transport/http/handler"
)

type deviceRouteKind int

const (
	deviceRouteUnknown deviceRouteKind = iota
	deviceRouteConnect
	deviceRouteTerminalWS
	deviceRouteRename
	deviceRouteSettings
	deviceRouteGroups
	deviceRouteEncoders
	deviceRouteClipboard
	deviceRouteApps
	deviceRouteAppLaunch
	deviceRouteAppDownload
	deviceRouteAppUninstall
	deviceRouteAppInfo
	deviceRouteAppInstall
	deviceRouteFilesList
	deviceRouteFilesDownload
	deviceRouteFilesRename
	deviceRouteFilesDelete
)

func registerDeviceRoutes(mux *http.ServeMux, handlers routeHandlers, guards routeGuards) {
	mux.Handle("/api/webrtc-ticket", guards.authMiddleware(guards.requireDevicesControl(http.HandlerFunc(handlers.webrtc.CreateTicket))))
	mux.Handle("/api/scrcpy-sessions/heartbeat", guards.authMiddleware(guards.requireDevicesControl(http.HandlerFunc(handlers.webrtc.Heartbeat))))
	mux.Handle("/api/scrcpy-sessions/release", guards.authMiddleware(guards.requireDevicesControl(http.HandlerFunc(handlers.webrtc.Release))))
	mux.HandleFunc("/webrtc", handlers.webrtc.ServeSignalWS)

	mux.Handle("/api/devices/", guards.authMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		handleDeviceResourceRoute(w, r, handlers, guards)
	})))

	mux.Handle("/api/devices", guards.authMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		handleDeviceCollectionRoute(w, r, handlers, guards)
	})))
}

func handleDeviceCollectionRoute(w http.ResponseWriter, r *http.Request, handlers routeHandlers, guards routeGuards) {
	switch r.Method {
	case http.MethodGet:
		guards.requireDevicesView(http.HandlerFunc(handlers.device.List)).ServeHTTP(w, r)
	case http.MethodPost:
		guards.requireDevicesManage(http.HandlerFunc(handlers.device.Create)).ServeHTTP(w, r)
	default:
		handler.WriteMethodNotAllowed(w, http.MethodGet+", "+http.MethodPost)
	}
}

func handleDeviceResourceRoute(w http.ResponseWriter, r *http.Request, handlers routeHandlers, guards routeGuards) {
	if r.URL.Path == "/api/devices/" {
		handler.WriteMethodNotAllowed(w, http.MethodGet+", "+http.MethodPost)
		return
	}

	switch classifyDeviceRoute(r.URL.Path) {
	case deviceRouteTerminalWS:
		guards.requireTerminalAccess(http.HandlerFunc(handlers.terminal.ServeWS)).ServeHTTP(w, r)
	case deviceRouteConnect:
		guards.requireDevicesControl(http.HandlerFunc(handlers.device.Connect)).ServeHTTP(w, r)
	case deviceRouteRename:
		guards.requireDevicesManage(http.HandlerFunc(handlers.device.Rename)).ServeHTTP(w, r)
	case deviceRouteSettings:
		handleDeviceSettingsRoute(w, r, handlers, guards)
	case deviceRouteGroups:
		guards.requireDevicesManage(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch r.Method {
			case http.MethodGet:
				handlers.device.GetGroups(w, r)
			case http.MethodPut:
				handlers.device.SaveGroups(w, r)
			default:
				handler.WriteMethodNotAllowed(w, http.MethodGet+", "+http.MethodPut)
			}
		})).ServeHTTP(w, r)
	case deviceRouteEncoders:
		guards.requireDevicesControl(http.HandlerFunc(handlers.device.ListEncoders)).ServeHTTP(w, r)
	case deviceRouteClipboard:
		handleDeviceClipboardRoute(w, r, handlers, guards)
	case deviceRouteApps:
		guards.requireDevicesControl(http.HandlerFunc(handlers.device.ListApps)).ServeHTTP(w, r)
	case deviceRouteAppLaunch:
		guards.requireDevicesControl(http.HandlerFunc(handlers.device.LaunchApp)).ServeHTTP(w, r)
	case deviceRouteAppDownload:
		guards.requireDevicesControl(http.HandlerFunc(handlers.device.DownloadApp)).ServeHTTP(w, r)
	case deviceRouteAppUninstall:
		guards.requireDevicesControl(http.HandlerFunc(handlers.device.UninstallApp)).ServeHTTP(w, r)
	case deviceRouteAppInfo:
		guards.requireDevicesControl(http.HandlerFunc(handlers.device.AppInfo)).ServeHTTP(w, r)
	case deviceRouteAppInstall:
		guards.requireDevicesControl(http.HandlerFunc(handlers.device.InstallApp)).ServeHTTP(w, r)
	case deviceRouteFilesList:
		guards.requireFilesAccess(http.HandlerFunc(handlers.device.ListFiles)).ServeHTTP(w, r)
	case deviceRouteFilesDownload:
		guards.requireFilesAccess(http.HandlerFunc(handlers.device.DownloadFile)).ServeHTTP(w, r)
	case deviceRouteFilesRename:
		guards.requireFilesAccess(http.HandlerFunc(handlers.device.RenameFile)).ServeHTTP(w, r)
	case deviceRouteFilesDelete:
		guards.requireFilesAccess(http.HandlerFunc(handlers.device.DeleteFile)).ServeHTTP(w, r)
	default:
		handleUnknownDeviceRoute(w, r, handlers, guards)
	}
}

func handleDeviceSettingsRoute(w http.ResponseWriter, r *http.Request, handlers routeHandlers, guards routeGuards) {
	switch r.Method {
	case http.MethodGet:
		guards.requireDevicesControl(http.HandlerFunc(handlers.device.GetSettings)).ServeHTTP(w, r)
	case http.MethodPut:
		guards.requireDevicesManage(http.HandlerFunc(handlers.device.SaveSettings)).ServeHTTP(w, r)
	case http.MethodDelete:
		guards.requireDevicesManage(http.HandlerFunc(handlers.device.ResetSettings)).ServeHTTP(w, r)
	default:
		handler.WriteMethodNotAllowed(w, http.MethodGet+", "+http.MethodPut+", "+http.MethodDelete)
	}
}

func handleDeviceClipboardRoute(w http.ResponseWriter, r *http.Request, handlers routeHandlers, guards routeGuards) {
	guards.requireDevicesControl(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			handlers.webrtc.GetClipboard(w, r)
		case http.MethodPut, http.MethodPost:
			handlers.webrtc.SetClipboard(w, r)
		default:
			handler.WriteMethodNotAllowed(w, http.MethodGet+", "+http.MethodPut+", "+http.MethodPost)
		}
	})).ServeHTTP(w, r)
}

func handleUnknownDeviceRoute(w http.ResponseWriter, r *http.Request, handlers routeHandlers, guards routeGuards) {
	if r.Method == http.MethodDelete {
		guards.requireDevicesManage(http.HandlerFunc(handlers.device.Delete)).ServeHTTP(w, r)
		return
	}

	handler.WriteMethodNotAllowed(w, http.MethodDelete)
}

func classifyDeviceRoute(path string) deviceRouteKind {
	switch {
	case isDeviceConnectPath(path):
		return deviceRouteConnect
	case strings.HasSuffix(path, "/terminal/ws"):
		return deviceRouteTerminalWS
	case strings.HasSuffix(path, "/rename"):
		return deviceRouteRename
	case strings.HasSuffix(path, "/settings"):
		return deviceRouteSettings
	case strings.HasSuffix(path, "/groups"):
		return deviceRouteGroups
	case strings.HasSuffix(path, "/encoders"):
		return deviceRouteEncoders
	case strings.HasSuffix(path, "/clipboard"):
		return deviceRouteClipboard
	case strings.HasSuffix(path, "/apps/launch"):
		return deviceRouteAppLaunch
	case strings.HasSuffix(path, "/apps/download"):
		return deviceRouteAppDownload
	case strings.HasSuffix(path, "/apps/uninstall"):
		return deviceRouteAppUninstall
	case strings.HasSuffix(path, "/apps/info"):
		return deviceRouteAppInfo
	case strings.HasSuffix(path, "/apps/install"):
		return deviceRouteAppInstall
	case strings.HasSuffix(path, "/apps"):
		return deviceRouteApps
	case strings.HasSuffix(path, "/files/list"):
		return deviceRouteFilesList
	case strings.HasSuffix(path, "/files/download"):
		return deviceRouteFilesDownload
	case strings.HasSuffix(path, "/files/rename"):
		return deviceRouteFilesRename
	case strings.HasSuffix(path, "/files/delete"):
		return deviceRouteFilesDelete
	default:
		return deviceRouteUnknown
	}
}

func isDeviceConnectPath(path string) bool {
	const prefix = "/api/devices/connect/"
	if !strings.HasPrefix(path, prefix) {
		return false
	}
	return len(path) > len(prefix)
}
