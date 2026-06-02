package auth

import (
	"context"
	"errors"
	"testing"
	"time"
)

type maintenanceLogger struct {
	warnCount int
}

func (l *maintenanceLogger) Debug(string, ...any) {}
func (l *maintenanceLogger) Info(string, ...any)  {}
func (l *maintenanceLogger) Warn(string, ...any)  { l.warnCount++ }
func (l *maintenanceLogger) Error(string, ...any) {}

func TestTokenMaintenanceRunPerformsImmediateCleanup(t *testing.T) {
	repo := &fakeRepository{}
	logger := &maintenanceLogger{}
	maintenance := NewTokenMaintenance(repo, logger, time.Hour)
	maintenance.now = func() time.Time { return time.Unix(1710000000, 0).UTC() }

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	maintenance.Run(ctx)

	if !repo.cleanupCalled {
		t.Fatal("expected cleanup to run immediately")
	}
	if logger.warnCount != 0 {
		t.Fatalf("expected no warnings, got %d", logger.warnCount)
	}
}

func TestTokenMaintenanceRunLogsCleanupFailures(t *testing.T) {
	repo := &fakeRepository{cleanupErr: errors.New("database locked")}
	logger := &maintenanceLogger{}
	maintenance := NewTokenMaintenance(repo, logger, time.Hour)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	maintenance.Run(ctx)

	if !repo.cleanupCalled {
		t.Fatal("expected cleanup to run immediately")
	}
	if logger.warnCount != 1 {
		t.Fatalf("expected 1 warning, got %d", logger.warnCount)
	}
}
