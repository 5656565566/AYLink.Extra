package logging

import (
	"log/slog"
	"os"
	"strings"
	"sync"
)

type Logger interface {
	Debug(msg string, args ...any)
	Info(msg string, args ...any)
	Warn(msg string, args ...any)
	Error(msg string, args ...any)
}

func New() Logger {
	level := new(slog.LevelVar)
	level.Set(resolveLogLevel())
	return slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{
		Level: level,
	}))
}

var featureFlagCache sync.Map

func FeatureEnabled(name string) bool {
	normalized := strings.TrimSpace(strings.ToUpper(name))
	if normalized == "" {
		return false
	}

	if value, ok := featureFlagCache.Load(normalized); ok {
		return value.(bool)
	}

	enabled := envBool("AYLINK_DEBUG") || envBool("AYLINK_DEBUG_"+normalized)
	featureFlagCache.Store(normalized, enabled)
	return enabled
}

func resolveLogLevel() slog.Level {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("AYLINK_LOG_LEVEL"))) {
	case "debug":
		return slog.LevelDebug
	case "warn", "warning":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		if envBool("AYLINK_DEBUG") {
			return slog.LevelDebug
		}
		return slog.LevelInfo
	}
}

func envBool(name string) bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(name))) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}
