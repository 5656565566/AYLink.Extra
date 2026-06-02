package auth

import (
	"context"
	"time"

	domainauth "aylink-agent/internal/domain/auth"
	"aylink-agent/internal/infra/logging"
)

const defaultTokenCleanupInterval = 30 * time.Minute

type TokenMaintenance struct {
	repo     domainauth.Repository
	logger   logging.Logger
	interval time.Duration
	now      func() time.Time
}

func NewTokenMaintenance(repo domainauth.Repository, logger logging.Logger, interval time.Duration) *TokenMaintenance {
	if interval <= 0 {
		interval = defaultTokenCleanupInterval
	}

	return &TokenMaintenance{
		repo:     repo,
		logger:   logger,
		interval: interval,
		now:      time.Now,
	}
}

func (m *TokenMaintenance) Run(ctx context.Context) {
	if m == nil || m.repo == nil {
		return
	}

	m.cleanupOnce(ctx)

	ticker := time.NewTicker(m.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			m.cleanupOnce(ctx)
		}
	}
}

func (m *TokenMaintenance) cleanupOnce(ctx context.Context) {
	if err := m.repo.CleanupExpiredTokens(ctx, m.now().UTC()); err != nil && m.logger != nil {
		m.logger.Warn("token maintenance cleanup failed", "error", err)
	}
}
