package auth

import (
	"context"
	"time"

	domainauth "aylink-agent/internal/domain/auth"
)

func (s *Service) SetSessionCleanupHook(hook func(context.Context)) {
	s.onSessionsChanged = hook
}

func (s *Service) notifySessionsChanged(ctx context.Context) {
	if s.onSessionsChanged != nil {
		s.onSessionsChanged(context.WithoutCancel(ctx))
	}
}

func (s *Service) ValidateLoginSession(ctx context.Context, sessionID string) (*domainauth.Identity, error) {
	user, expires, err := s.repo.GetLoginSession(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	if user == nil || !user.IsActive || !expires.After(time.Now().UTC()) {
		return nil, ErrUnauthorized
	}
	permissions, err := s.repo.GetPermissionsForUser(ctx, user.ID)
	if err != nil {
		return nil, err
	}
	admin, err := s.repo.IsUserAdministrator(ctx, user.ID)
	if err != nil {
		return nil, err
	}
	return &domainauth.Identity{UserID: user.ID, Username: user.Username, LoginSessionID: sessionID,
		Permissions: permissions, IsAdministrator: admin}, nil
}

// 与注销和令牌轮换串行 已撤销的登录不能通过迟到请求重新登记或续租
func (s *Service) WithLoginSession(ctx context.Context, userID int, sessionID string, action func(*domainauth.Identity) error) error {
	s.sessionMu.Lock()
	defer s.sessionMu.Unlock()
	identity, err := s.ValidateLoginSession(ctx, sessionID)
	if err != nil {
		return err
	}
	if identity.UserID != userID {
		return ErrUnauthorized
	}
	return action(identity)
}
