package http

import (
	"database/sql"
	"io/fs"
	"net/http"
	"strings"

	"aylink-agent/internal/config"
	domainadb "aylink-agent/internal/domain/adb"
	"aylink-agent/internal/infra/logging"
	"aylink-agent/internal/infra/scrcpy"
	"aylink-agent/internal/infra/sqlite"
	adbservice "aylink-agent/internal/service/adb"
	appservice "aylink-agent/internal/service/app"
	authservice "aylink-agent/internal/service/auth"
	deviceservice "aylink-agent/internal/service/device"
	fileservice "aylink-agent/internal/service/file"
	i18nservice "aylink-agent/internal/service/i18n"
	scrcpyservice "aylink-agent/internal/service/scrcpy"
	settingsservice "aylink-agent/internal/service/settings"
	statusservice "aylink-agent/internal/service/status"
	terminalservice "aylink-agent/internal/service/terminal"
	webrtcservice "aylink-agent/internal/service/webrtc"
	"aylink-agent/internal/transport/http/handler"
	"aylink-agent/internal/transport/http/middleware"
)

type Dependencies struct {
	Config      config.Config
	Logger      logging.Logger
	ADB         domainadb.Manager
	DB          *sql.DB
	EmbeddedWWW fs.FS
	WWWRoot     string
}

func NewRouter(deps Dependencies) http.Handler {
	mux := http.NewServeMux()
	statusHandler := handler.NewStatusHandler(statusservice.NewService(deps.ADB))
	adbHandler := handler.NewADBHandler(adbservice.NewService(deps.ADB))
	authRepo := sqlite.NewAuthRepository(deps.DB)
	authService := authservice.NewService(authRepo, deps.Logger)
	authHandler := handler.NewAuthHandler(authService)

	deviceRepo := sqlite.NewDeviceRepository(deps.DB)
	deviceService := deviceservice.NewService(deviceRepo)
	deviceService.SetADBManager(deps.ADB) // 注入 adb manager
	appService := appservice.NewService(deviceService, deps.ADB)
	fileService := fileservice.NewService(deviceService, deps.ADB)

	settingsRepo := deviceservice.NewSettingsService(deviceRepo, sqlite.NewDeviceSettingsRepository(deps.DB))

	adbBinaryPath := deps.Config.ADB.Path
	if resolved, ok := deps.ADB.ResolvedBinary(); ok && resolved.Path != "" {
		adbBinaryPath = resolved.Path
	}

	scrcpyBackend := scrcpy.NewService(deps.Logger, deps.Config.ADB.ServerHost, deps.Config.ADB.ServerPort, adbBinaryPath, deps.Config.Scrcpy.ServerPath)
	scrcpyService := scrcpyservice.NewService(deviceRepo, settingsRepo, scrcpyBackend)

	deviceHandler := handler.NewDeviceHandler(
		deviceService,
		appService,
		fileService,
		settingsRepo,
		scrcpyService,
	)

	terminalHandler := handler.NewTerminalHandler(terminalservice.NewService(deviceRepo, deps.ADB))
	settingsService := settingsservice.NewService(deps.DB)
	webRtcHandler := handler.NewWebRTCHandler(webrtcservice.NewService(deps.Logger), settingsService, scrcpyService)
	i18nHandler := handler.NewI18NHandler(i18nservice.NewService(), settingsService)
	settingsHandler := handler.NewSettingsHandler(settingsService)

	mux.HandleFunc("/api/status", statusHandler.Get)
	mux.HandleFunc("/api/adb/status", adbHandler.Status)
	mux.HandleFunc("/api/adb/server/start", adbHandler.StartServer)
	mux.HandleFunc("/api/adb/server/kill", adbHandler.KillServer)
	mux.HandleFunc("/api/adb/pair", adbHandler.Pair)

	mux.HandleFunc("/api/login", authHandler.Login)
	mux.HandleFunc("/api/auth/refresh", authHandler.Refresh)

	// 为以下路由确保上下文授权
	authMiddleware := middleware.Auth(authService)
	requireAccountsManage := middleware.RequirePermission("accounts.manage")
	requireAccountsChangePassword := middleware.RequirePermission("accounts.change-password")
	requireDevicesView := middleware.RequirePermission("devices.view")
	requireDevicesManage := middleware.RequirePermission("devices.manage")
	requireDevicesControl := middleware.RequirePermission("devices.control")
	requireFilesAccess := middleware.RequirePermission("files.access")
	requireTerminalAccess := middleware.RequirePermission("terminal.access")
	requireSettingsView := middleware.RequirePermission("settings.view")
	requireSettingsManage := middleware.RequirePermission("settings.manage")

	mux.Handle("/api/auth/me", authMiddleware(http.HandlerFunc(authHandler.Me)))
	mux.HandleFunc("/api/logout", authHandler.Logout)
	mux.Handle("/api/logout-all", authMiddleware(http.HandlerFunc(authHandler.LogoutAll)))
	mux.Handle("/api/auth/change-password", authMiddleware(requireAccountsChangePassword(http.HandlerFunc(authHandler.ChangePassword))))

	mux.Handle("/api/accounts/users", authMiddleware(requireAccountsManage(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			authHandler.GetUsers(w, r)
		case http.MethodPost:
			authHandler.CreateUser(w, r)
		default:
			handler.WriteMethodNotAllowed(w, http.MethodGet+", "+http.MethodPost)
		}
	}))))

	mux.Handle("/api/accounts/users/", authMiddleware(requireAccountsManage(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/reset-password") {
			authHandler.ResetPassword(w, r)
			return
		}
		if strings.HasSuffix(r.URL.Path, "/activate") {
			authHandler.SetUserActive(w, r, true)
			return
		}
		if strings.HasSuffix(r.URL.Path, "/deactivate") {
			authHandler.SetUserActive(w, r, false)
			return
		}

		switch r.Method {
		case http.MethodPut:
			authHandler.UpdateUser(w, r)
		default:
			handler.WriteMethodNotAllowed(w, http.MethodPut+", "+http.MethodPost)
		}
	}))))

	mux.Handle("/api/accounts/roles", authMiddleware(requireAccountsManage(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			authHandler.GetRoles(w, r)
		case http.MethodPost:
			authHandler.CreateRole(w, r)
		default:
			handler.WriteMethodNotAllowed(w, http.MethodGet+", "+http.MethodPost)
		}
	}))))

	mux.Handle("/api/accounts/roles/", authMiddleware(requireAccountsManage(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodPut:
			authHandler.UpdateRole(w, r)
		default:
			handler.WriteMethodNotAllowed(w, http.MethodPut)
		}
	}))))

	mux.Handle("/api/webrtc-ticket", authMiddleware(requireDevicesControl(http.HandlerFunc(webRtcHandler.CreateTicket))))
	mux.Handle("/api/scrcpy-sessions/heartbeat", authMiddleware(requireDevicesControl(http.HandlerFunc(webRtcHandler.Heartbeat))))
	mux.Handle("/api/scrcpy-sessions/release", authMiddleware(requireDevicesControl(http.HandlerFunc(webRtcHandler.Release))))
	mux.HandleFunc("/webrtc", webRtcHandler.ServeSignalWS)

	mux.Handle("/api/devices/", authMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/terminal/ws") {
			requireTerminalAccess(http.HandlerFunc(terminalHandler.ServeWS)).ServeHTTP(w, r)
			return
		}
		if strings.Contains(r.URL.Path, "/connect/") {
			requireDevicesControl(http.HandlerFunc(deviceHandler.Connect)).ServeHTTP(w, r)
			return
		}
		if r.URL.Path == "/api/devices/" {
			handler.WriteMethodNotAllowed(w, http.MethodGet+", "+http.MethodPost)
			return
		}
		switch {
		case strings.HasSuffix(r.URL.Path, "/apps/launch"):
			requireDevicesControl(http.HandlerFunc(deviceHandler.LaunchApp)).ServeHTTP(w, r)
			return
		case strings.HasSuffix(r.URL.Path, "/apps/download"):
			requireDevicesControl(http.HandlerFunc(deviceHandler.DownloadApp)).ServeHTTP(w, r)
			return
		case strings.HasSuffix(r.URL.Path, "/apps/uninstall"):
			requireDevicesControl(http.HandlerFunc(deviceHandler.UninstallApp)).ServeHTTP(w, r)
			return
		case strings.HasSuffix(r.URL.Path, "/apps/info"):
			requireDevicesControl(http.HandlerFunc(deviceHandler.AppInfo)).ServeHTTP(w, r)
			return
		case strings.HasSuffix(r.URL.Path, "/apps/install"):
			requireDevicesControl(http.HandlerFunc(deviceHandler.InstallApp)).ServeHTTP(w, r)
			return
		case strings.HasSuffix(r.URL.Path, "/settings"):
			switch r.Method {
			case http.MethodGet:
				requireDevicesControl(http.HandlerFunc(deviceHandler.GetSettings)).ServeHTTP(w, r)
			case http.MethodPut:
				requireDevicesManage(http.HandlerFunc(deviceHandler.SaveSettings)).ServeHTTP(w, r)
			case http.MethodDelete:
				requireDevicesManage(http.HandlerFunc(deviceHandler.ResetSettings)).ServeHTTP(w, r)
			default:
				handler.WriteMethodNotAllowed(w, http.MethodGet+", "+http.MethodPut+", "+http.MethodDelete)
			}
			return
		case strings.HasSuffix(r.URL.Path, "/encoders"):
			requireDevicesControl(http.HandlerFunc(deviceHandler.ListEncoders)).ServeHTTP(w, r)
			return
		case strings.HasSuffix(r.URL.Path, "/apps"):
			requireDevicesControl(http.HandlerFunc(deviceHandler.ListApps)).ServeHTTP(w, r)
			return
		case strings.HasSuffix(r.URL.Path, "/files/list"):
			requireFilesAccess(http.HandlerFunc(deviceHandler.ListFiles)).ServeHTTP(w, r)
			return
		case strings.HasSuffix(r.URL.Path, "/files/download"):
			requireFilesAccess(http.HandlerFunc(deviceHandler.DownloadFile)).ServeHTTP(w, r)
			return
		case strings.HasSuffix(r.URL.Path, "/files/rename"):
			requireFilesAccess(http.HandlerFunc(deviceHandler.RenameFile)).ServeHTTP(w, r)
			return
		case strings.HasSuffix(r.URL.Path, "/files/delete"):
			requireFilesAccess(http.HandlerFunc(deviceHandler.DeleteFile)).ServeHTTP(w, r)
			return
		case r.Method == http.MethodDelete:
			requireDevicesManage(http.HandlerFunc(deviceHandler.Delete)).ServeHTTP(w, r)
			return
		default:
			handler.WriteMethodNotAllowed(w, http.MethodDelete)
		}
	})))

	mux.Handle("/api/devices", authMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			requireDevicesView(http.HandlerFunc(deviceHandler.List)).ServeHTTP(w, r)
		case http.MethodPost:
			requireDevicesManage(http.HandlerFunc(deviceHandler.Create)).ServeHTTP(w, r)
		default:
			handler.WriteMethodNotAllowed(w, http.MethodGet+", "+http.MethodPost)
		}
	})))

	mux.HandleFunc("/api/i18n/languages", i18nHandler.Languages)
	mux.HandleFunc("/api/i18n/", i18nHandler.Locale)

	mux.Handle("/api/settings/language", authMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			i18nHandler.GetServerLanguage(w, r)
		case http.MethodPut:
			i18nHandler.SetServerLanguage(w, r)
		default:
			handler.WriteMethodNotAllowed(w, http.MethodGet+", "+http.MethodPut)
		}
	})))

	mux.Handle("/api/settings/webrtc-network", authMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			requireSettingsView(http.HandlerFunc(settingsHandler.GetWebRtcNetwork)).ServeHTTP(w, r)
		case http.MethodPut:
			requireSettingsManage(http.HandlerFunc(settingsHandler.SaveWebRtcNetwork)).ServeHTTP(w, r)
		default:
			handler.WriteMethodNotAllowed(w, http.MethodGet+", "+http.MethodPut)
		}
	})))

	mux.Handle("/api/control/webrtc-network", authMiddleware(requireDevicesControl(http.HandlerFunc(settingsHandler.GetWebRtcNetwork))))
	mux.Handle("/", handler.NewSPAHandler(deps.WWWRoot, deps.EmbeddedWWW, deps.Logger))

	return middleware.Logging(deps.Logger, middleware.Recover(mux))
}
