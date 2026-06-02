package router

import (
	"database/sql"
	"io/fs"
	"net/http"

	"aylink-agent/internal/config"
	domainadb "aylink-agent/internal/domain/adb"
	"aylink-agent/internal/infra/logging"
	"aylink-agent/internal/infra/scrcpy"
	"aylink-agent/internal/infra/sqlite"
	adbservice "aylink-agent/internal/service/adb"
	appservice "aylink-agent/internal/service/app"
	authservice "aylink-agent/internal/service/auth"
	deviceservice "aylink-agent/internal/service/device"
	devicegroupservice "aylink-agent/internal/service/devicegroup"
	devicepreviewservice "aylink-agent/internal/service/devicepreview"
	fileservice "aylink-agent/internal/service/file"
	i18nservice "aylink-agent/internal/service/i18n"
	scrcpyservice "aylink-agent/internal/service/scrcpy"
	settingsservice "aylink-agent/internal/service/settings"
	statusservice "aylink-agent/internal/service/status"
	terminalservice "aylink-agent/internal/service/terminal"
	webrtcservice "aylink-agent/internal/service/webrtc"
	"aylink-agent/internal/transport/http/handler"
	"aylink-agent/internal/transport/http/middleware"
	"aylink-agent/internal/version"
)

type Dependencies struct {
	Config      config.Config
	Logger      logging.Logger
	ADB         domainadb.Manager
	DB          *sql.DB
	EmbeddedWWW fs.FS
	WWWRoot     string
}

type routeHandlers struct {
	status      *handler.StatusHandler
	version     *handler.VersionHandler
	adb         *handler.ADBHandler
	auth        *handler.AuthHandler
	device      *handler.DeviceHandler
	deviceGroup *handler.DeviceGroupHandler
	terminal    *handler.TerminalHandler
	settings    *handler.SettingsHandler
	webrtc      *handler.WebRTCHandler
	i18n        *handler.I18NHandler
}

type routeGuards struct {
	authMiddleware                func(http.Handler) http.Handler
	requireAccountsManage         func(http.Handler) http.Handler
	requireAccountsChangePassword func(http.Handler) http.Handler
	requireDevicesView            func(http.Handler) http.Handler
	requireDevicesManage          func(http.Handler) http.Handler
	requireDevicesControl         func(http.Handler) http.Handler
	requireFilesAccess            func(http.Handler) http.Handler
	requireTerminalAccess         func(http.Handler) http.Handler
	requireSettingsView           func(http.Handler) http.Handler
	requireSettingsManage         func(http.Handler) http.Handler
}

func New(deps Dependencies) http.Handler {
	mux := http.NewServeMux()
	statusHandler := handler.NewStatusHandler(statusservice.NewService(deps.ADB))
	versionHandler := handler.NewVersionHandler(version.AgentVersion, version.WebVersion, version.ReleaseTag)
	adbHandler := handler.NewADBHandler(adbservice.NewService(deps.ADB))
	authRepo := sqlite.NewAuthRepository(deps.DB)
	authService := authservice.NewService(authRepo, deps.Logger)
	authHandler := handler.NewAuthHandler(authService)

	deviceRepo := sqlite.NewDeviceRepository(deps.DB)
	deviceGroupRepo := sqlite.NewDeviceGroupRepository(deps.DB)
	deviceService := deviceservice.NewService(deviceRepo)
	deviceService.SetADBManager(deps.ADB) // 注入 adb manager
	deviceAccessService := deviceservice.NewAccessService(deviceGroupRepo)
	deviceGroupService := devicegroupservice.NewService(deviceGroupRepo)
	appService := appservice.NewService(deviceService, deps.ADB)
	fileService := fileservice.NewService(deviceService, deps.ADB)

	settingsRepo := deviceservice.NewSettingsService(deviceRepo, sqlite.NewDeviceSettingsRepository(deps.DB))
	previewService := devicepreviewservice.NewService(deviceService, deps.ADB)

	adbBinaryPath := deps.Config.ADB.Path
	if resolved, ok := deps.ADB.ResolvedBinary(); ok && resolved.Path != "" {
		adbBinaryPath = resolved.Path
	}

	scrcpyBackend := scrcpy.NewService(deps.Logger, deps.Config.ADB.ServerHost, deps.Config.ADB.ServerPort, adbBinaryPath, deps.Config.Scrcpy.ServerPath)
	scrcpyService := scrcpyservice.NewService(deviceRepo, settingsRepo, scrcpyBackend)

	deviceHandler := handler.NewDeviceHandler(
		deviceService,
		deviceAccessService,
		deviceGroupService,
		previewService,
		appService,
		fileService,
		settingsRepo,
		scrcpyService,
	)
	deviceGroupHandler := handler.NewDeviceGroupHandler(deviceGroupService)

	terminalHandler := handler.NewTerminalHandler(terminalservice.NewService(deviceRepo, deps.ADB), deviceAccessService)
	settingsService := settingsservice.NewService(deps.DB)
	webRtcHandler := handler.NewWebRTCHandler(webrtcservice.NewService(deps.Logger), settingsService, scrcpyService, deviceAccessService)
	i18nHandler := handler.NewI18NHandler(i18nservice.NewService(), settingsService)
	settingsHandler := handler.NewSettingsHandler(settingsService)

	authMiddleware := middleware.Auth(authService, deps.Logger)
	guards := newRouteGuards(authMiddleware)
	handlers := routeHandlers{
		status:      statusHandler,
		version:     versionHandler,
		adb:         adbHandler,
		auth:        authHandler,
		device:      deviceHandler,
		deviceGroup: deviceGroupHandler,
		terminal:    terminalHandler,
		settings:    settingsHandler,
		webrtc:      webRtcHandler,
		i18n:        i18nHandler,
	}

	registerStatusRoutes(mux, handlers)
	registerAuthRoutes(mux, handlers, guards)
	registerDeviceRoutes(mux, handlers, guards)
	registerDeviceGroupRoutes(mux, handlers, guards)
	registerSettingsRoutes(mux, handlers, guards)
	mux.Handle("/", handler.NewSPAHandler(deps.WWWRoot, deps.EmbeddedWWW, deps.Logger))

	return middleware.Logging(deps.Logger, middleware.Recover(mux))
}

func newRouteGuards(authMiddleware func(http.Handler) http.Handler) routeGuards {
	return routeGuards{
		authMiddleware:                authMiddleware,
		requireAccountsManage:         middleware.RequirePermission("accounts.manage"),
		requireAccountsChangePassword: middleware.RequirePermission("accounts.change-password"),
		requireDevicesView:            middleware.RequirePermission("devices.view"),
		requireDevicesManage:          middleware.RequirePermission("devices.manage"),
		requireDevicesControl:         middleware.RequirePermission("devices.control"),
		requireFilesAccess:            middleware.RequirePermission("files.access"),
		requireTerminalAccess:         middleware.RequirePermission("terminal.access"),
		requireSettingsView:           middleware.RequirePermission("settings.view"),
		requireSettingsManage:         middleware.RequirePermission("settings.manage"),
	}
}
