package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"

	"aylink-agent/internal/app"
)

// @title AYLink Agent API
// @version 1.0
// @description AYLink Agent 的 HTTP API 文档。
// @BasePath /
// @securityDefinitions.apikey BearerAuth
// @in header
// @name Authorization
// @description 使用 Bearer 访问令牌，例如：Bearer {accessToken}
func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	application, err := app.New()
	if err != nil {
		panic(err)
	}

	if err := application.Run(ctx); err != nil {
		panic(err)
	}
}
