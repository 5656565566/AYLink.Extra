package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"time"

	domainauth "aylink-agent/internal/domain/auth"
)

func (r *AuthRepository) GetAccessTokenSessionID(ctx context.Context, tokenHash string) (string, error) {
	var id string
	err := r.db.QueryRowContext(ctx, `SELECT SessionId FROM AccessTokens WHERE TokenHash = ?`, tokenHash).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return id, err
}

func (r *AuthRepository) GetLoginSession(ctx context.Context, sessionID string) (*domainauth.UserRecord, time.Time, error) {
	if sessionID == "" {
		return nil, time.Time{}, nil
	}
	var userID int
	var expires string
	err := r.db.QueryRowContext(ctx, `SELECT UserId, ExpiresAt FROM RefreshTokens
		WHERE SessionId = ? AND RevokedAt IS NULL AND ExpiresAt > ? ORDER BY Id DESC LIMIT 1`,
		sessionID, time.Now().UTC().Format(time.RFC3339Nano)).Scan(&userID, &expires)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, time.Time{}, nil
	}
	if err != nil {
		return nil, time.Time{}, err
	}
	user, err := r.GetUserByID(ctx, userID)
	return user, parseTime(expires), err
}
