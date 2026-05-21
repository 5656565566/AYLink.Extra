package app

import (
	"context"
	"errors"
	"net/http"
	"time"

	webassets "aylink-agent"
	"aylink-agent/internal/config"
	"aylink-agent/internal/infra/adb"
	"aylink-agent/internal/infra/logging"
	"aylink-agent/internal/infra/sqlite"
	authservice "aylink-agent/internal/service/auth"
	deviceservice "aylink-agent/internal/service/device"
	httptransport "aylink-agent/internal/transport/http"
)

type App struct {
	config     config.Config
	logger     logging.Logger
	httpServer *http.Server
	auth       *authservice.Service
	devices    *deviceservice.Service
}

func New() (*App, error) {
	cfg, err := config.Load()
	if err != nil {
		return nil, err
	}

	logger := logging.New()
	db, err := sqlite.Open(cfg.DB.Path)
	if err != nil {
		return nil, err
	}
	embeddedWWW, err := webassets.EmbeddedWWW()
	if err != nil {
		return nil, err
	}
	adbManager := adb.NewManager(cfg.ADB, logger)

	// 在启动服务之前提供基础授权检查
	authRepo := sqlite.NewAuthRepository(db)
	authSvc := authservice.NewService(authRepo, logger)
	deviceRepo := sqlite.NewDeviceRepository(db)
	deviceSvc := deviceservice.NewService(deviceRepo)
	deviceSvc.SetADBManager(adbManager)

	router := httptransport.NewRouter(httptransport.Dependencies{
		Config:      cfg,
		Logger:      logger,
		ADB:         adbManager,
		DB:          db,
		EmbeddedWWW: embeddedWWW,
		WWWRoot:     config.DefaultWWWRoot(),
	})

	server := &http.Server{
		Addr:              cfg.HTTP.ListenAddr,
		Handler:           router,
		ReadHeaderTimeout: 5 * time.Second,
	}

	return &App{
		config:     cfg,
		logger:     logger,
		httpServer: server,
		auth:       authSvc,
		devices:    deviceSvc,
	}, nil
}

func (a *App) Run(ctx context.Context) error {
	// 在提供 web 页面服务前 确保具有系统管理员角色
	if err := a.auth.EnsureBootstrapAdmin(ctx); err != nil {
		a.logger.Warn("Failed to ensure bootstrap admin", "err", err)
	}

	errCh := make(chan error, 1)

	go func() {
		a.logger.Info("http server starting", "addr", a.config.HTTP.ListenAddr, "wwwRoot", config.DefaultWWWRoot())
		if err := a.httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
			return
		}

		errCh <- nil
	}()

	go a.runDeviceReconnectLoop(ctx)

	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		a.logger.Info("http server stopping")
		return a.httpServer.Shutdown(shutdownCtx)
	case err := <-errCh:
		return err
	}
}

func (a *App) runDeviceReconnectLoop(ctx context.Context) {
	if a.devices == nil {
		return
	}

	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if _, err := a.devices.List(ctx); err != nil {
				a.logger.Warn("background device reconnect pass failed", "err", err)
			}
		}
	}
}
