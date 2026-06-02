package sqlite

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	domainauth "aylink-agent/internal/domain/auth"
	domaindevice "aylink-agent/internal/domain/device"
)

type AuthRepository struct {
	db *sql.DB
}

type rowScanner interface {
	Scan(dest ...any) error
}

func NewAuthRepository(db *sql.DB) *AuthRepository {
	return &AuthRepository{db: db}
}

func (r *AuthRepository) GetUserByUsername(ctx context.Context, username string) (*domainauth.UserRecord, error) {
	row := r.db.QueryRowContext(ctx, `
		SELECT Id, Username, PasswordHash, PasswordSalt, IsActive, CreatedAt, UpdatedAt, LastLoginAt
		FROM Users
		WHERE lower(Username) = lower(?)`, strings.TrimSpace(username))
	return scanUser(row)
}

func (r *AuthRepository) GetUserByID(ctx context.Context, userID int) (*domainauth.UserRecord, error) {
	row := r.db.QueryRowContext(ctx, `
		SELECT Id, Username, PasswordHash, PasswordSalt, IsActive, CreatedAt, UpdatedAt, LastLoginAt
		FROM Users
		WHERE Id = ?`, userID)
	return scanUser(row)
}

func (r *AuthRepository) ListUsers(ctx context.Context) ([]domainauth.User, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT Id, Username, PasswordHash, PasswordSalt, IsActive, CreatedAt, UpdatedAt, LastLoginAt
		FROM Users
		ORDER BY Username COLLATE NOCASE`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	records := make([]*domainauth.UserRecord, 0)
	for rows.Next() {
		record, err := scanUserRecord(rows)
		if err != nil {
			return nil, err
		}
		records = append(records, record)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}

	users := make([]domainauth.User, 0, len(records))
	for _, record := range records {
		user, err := r.hydrateUser(ctx, record)
		if err != nil {
			return nil, err
		}
		users = append(users, *user)
	}
	return users, nil
}

func (r *AuthRepository) CreateUser(ctx context.Context, username, passwordHash, passwordSalt string, roleIds []int, deviceGroupIDs []int) (*domainauth.User, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var existingUsers int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM Users`).Scan(&existingUsers); err != nil {
		return nil, err
	}

	now := time.Now().UTC().Format(time.RFC3339Nano)
	res, err := tx.ExecContext(ctx, `
		INSERT INTO Users (Username, PasswordHash, PasswordSalt, IsActive, CreatedAt, UpdatedAt)
		VALUES (?, ?, ?, 1, ?, ?)`, username, passwordHash, passwordSalt, now, now)
	if err != nil {
		return nil, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return nil, err
	}
	userId := int(id)

	for _, roleId := range roleIds {
		if _, err := tx.ExecContext(ctx, `INSERT INTO UserRoles (UserId, RoleId) VALUES (?, ?)`, userId, roleId); err != nil {
			return nil, err
		}
	}

	normalizedGroupIDs := normalizeIntIDs(deviceGroupIDs)
	if existingUsers == 0 {
		hasAdministratorRole := false
		for _, roleID := range roleIds {
			var roleName string
			if err := tx.QueryRowContext(ctx, `SELECT Name FROM Roles WHERE Id = ?`, roleID).Scan(&roleName); err != nil {
				return nil, err
			}
			if strings.EqualFold(roleName, "Administrator") {
				hasAdministratorRole = true
				break
			}
		}
		if !hasAdministratorRole {
			goto assignUserGroups
		}

		var internalGroupID int
		err := tx.QueryRowContext(ctx, `
			SELECT Id
			FROM DeviceGroups
			WHERE lower(Name) = lower(?)
			ORDER BY Id
			LIMIT 1`, internalAllDevicesGroupName).Scan(&internalGroupID)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return nil, err
		}
		if internalGroupID != 0 {
			normalizedGroupIDs = append(normalizedGroupIDs, internalGroupID)
			normalizedGroupIDs = normalizeIntIDs(normalizedGroupIDs)
		}
	}

assignUserGroups:
	for _, groupID := range normalizedGroupIDs {
		if _, err := tx.ExecContext(ctx, `INSERT INTO UserDeviceGroups (UserId, GroupId) VALUES (?, ?)`, userId, groupID); err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return r.loadUserByID(ctx, userId)
}

func (r *AuthRepository) UpdateUser(ctx context.Context, userID int, username string, isActive bool, roleIds []int, deviceGroupIDs []int) (*domainauth.User, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := tx.ExecContext(ctx, `
		UPDATE Users
		SET Username = ?, IsActive = ?, UpdatedAt = ?
		WHERE Id = ?`, username, isActive, now, userID); err != nil {
		return nil, err
	}

	if _, err := tx.ExecContext(ctx, `DELETE FROM UserRoles WHERE UserId = ?`, userID); err != nil {
		return nil, err
	}
	for _, roleId := range roleIds {
		if _, err := tx.ExecContext(ctx, `INSERT INTO UserRoles (UserId, RoleId) VALUES (?, ?)`, userID, roleId); err != nil {
			return nil, err
		}
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM UserDeviceGroups WHERE UserId = ?`, userID); err != nil {
		return nil, err
	}
	for _, groupID := range normalizeIntIDs(deviceGroupIDs) {
		if _, err := tx.ExecContext(ctx, `INSERT INTO UserDeviceGroups (UserId, GroupId) VALUES (?, ?)`, userID, groupID); err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return r.loadUserByID(ctx, userID)
}

func (r *AuthRepository) DeleteUser(ctx context.Context, userID int) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	queries := []string{
		`DELETE FROM UserDeviceGroups WHERE UserId = ?`,
		`DELETE FROM UserRoles WHERE UserId = ?`,
		`DELETE FROM RefreshTokens WHERE UserId = ?`,
		`DELETE FROM AccessTokens WHERE UserId = ?`,
		`DELETE FROM Users WHERE Id = ?`,
	}

	for _, query := range queries {
		if _, err := tx.ExecContext(ctx, query, userID); err != nil {
			return err
		}
	}

	return tx.Commit()
}

func (r *AuthRepository) UpdateUserPassword(ctx context.Context, userID int, passwordHash, passwordSalt string) error {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	_, err := r.db.ExecContext(ctx, `
		UPDATE Users
		SET PasswordHash = ?, PasswordSalt = ?, UpdatedAt = ?
		WHERE Id = ?`, passwordHash, passwordSalt, now, userID)
	return err
}

func (r *AuthRepository) ListRoles(ctx context.Context) ([]domainauth.Role, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT Id, Name, Description, IsInternal
		FROM Roles
		ORDER BY Name COLLATE NOCASE`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	baseRoles := make([]*domainauth.Role, 0)
	for rows.Next() {
		role, err := scanRole(rows)
		if err != nil {
			return nil, err
		}
		baseRoles = append(baseRoles, role)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}

	roles := make([]domainauth.Role, 0, len(baseRoles))
	for _, role := range baseRoles {
		hydratedRole, err := r.hydrateRole(ctx, role)
		if err != nil {
			return nil, err
		}
		roles = append(roles, *hydratedRole)
	}
	return roles, nil
}

func (r *AuthRepository) GetRoleByName(ctx context.Context, name string) (*domainauth.Role, error) {
	row := r.db.QueryRowContext(ctx, `
		SELECT Id, Name, Description, IsInternal
		FROM Roles
		WHERE lower(Name) = lower(?)`, strings.TrimSpace(name))
	role, err := scanRole(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return r.hydrateRole(ctx, role)
}

func (r *AuthRepository) GetRoleByID(ctx context.Context, id int) (*domainauth.Role, error) {
	row := r.db.QueryRowContext(ctx, `
		SELECT Id, Name, Description, IsInternal
		FROM Roles
		WHERE Id = ?`, id)
	role, err := scanRole(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return r.hydrateRole(ctx, role)
}

func (r *AuthRepository) CreateRole(ctx context.Context, name, description string, permissions []string, deviceGroupIDs []int) (*domainauth.Role, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	res, err := tx.ExecContext(ctx, `INSERT INTO Roles (Name, Description, IsInternal) VALUES (?, ?, 0)`, name, description)
	if err != nil {
		return nil, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return nil, err
	}
	roleId := int(id)

	for _, code := range permissions {
		var permId int
		if err := tx.QueryRowContext(ctx, `SELECT Id FROM Permissions WHERE Code = ?`, code).Scan(&permId); err != nil {
			return nil, err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO RolePermissions (RoleId, PermissionId) VALUES (?, ?)`, roleId, permId); err != nil {
			return nil, err
		}
	}
	for _, groupID := range normalizeIntIDs(deviceGroupIDs) {
		if _, err := tx.ExecContext(ctx, `INSERT INTO RoleDeviceGroups (RoleId, GroupId) VALUES (?, ?)`, roleId, groupID); err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return r.GetRoleByID(ctx, roleId)
}

func (r *AuthRepository) UpdateRole(ctx context.Context, roleID int, name, description string, permissions []string, deviceGroupIDs []int) (*domainauth.Role, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `UPDATE Roles SET Name = ?, Description = ? WHERE Id = ?`, name, description, roleID); err != nil {
		return nil, err
	}

	if _, err := tx.ExecContext(ctx, `DELETE FROM RolePermissions WHERE RoleId = ?`, roleID); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM RoleDeviceGroups WHERE RoleId = ?`, roleID); err != nil {
		return nil, err
	}

	for _, code := range permissions {
		var permId int
		if err := tx.QueryRowContext(ctx, `SELECT Id FROM Permissions WHERE Code = ?`, code).Scan(&permId); err != nil {
			return nil, err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO RolePermissions (RoleId, PermissionId) VALUES (?, ?)`, roleID, permId); err != nil {
			return nil, err
		}
	}
	for _, groupID := range normalizeIntIDs(deviceGroupIDs) {
		if _, err := tx.ExecContext(ctx, `INSERT INTO RoleDeviceGroups (RoleId, GroupId) VALUES (?, ?)`, roleID, groupID); err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return r.GetRoleByID(ctx, roleID)
}

func (r *AuthRepository) getPermissionsForRole(ctx context.Context, roleID int) ([]string, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT p.Code
		FROM Permissions p
		INNER JOIN RolePermissions rp ON rp.PermissionId = p.Id
		WHERE rp.RoleId = ?
		ORDER BY p.Code COLLATE NOCASE`, roleID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	permissions := make([]string, 0)
	for rows.Next() {
		var code string
		if err := rows.Scan(&code); err != nil {
			return nil, err
		}
		permissions = append(permissions, code)
	}
	return permissions, rows.Err()
}

func (r *AuthRepository) GetRefreshToken(ctx context.Context, tokenHash string) (*domainauth.TokenRecord, *domainauth.UserRecord, error) {
	row := r.db.QueryRowContext(ctx, `
		SELECT rt.Id, rt.UserId, rt.ExpiresAt, rt.RevokedAt,
		       u.Id, u.Username, u.PasswordHash, u.PasswordSalt, u.IsActive, u.CreatedAt, u.UpdatedAt, u.LastLoginAt
		FROM RefreshTokens rt
		INNER JOIN Users u ON u.Id = rt.UserId
		WHERE rt.TokenHash = ?`, tokenHash)

	var token domainauth.TokenRecord
	var tokenExpires string
	var revoked sql.NullString
	var user domainauth.UserRecord
	var created, updated string
	var lastLogin sql.NullString

	err := row.Scan(
		&token.ID, &token.UserID, &tokenExpires, &revoked,
		&user.ID, &user.Username, &user.PasswordHash, &user.PasswordSalt, &user.IsActive, &created, &updated, &lastLogin,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil, nil
		}
		return nil, nil, err
	}

	token.ExpiresAt = parseTime(tokenExpires)
	if revoked.Valid {
		value := parseTime(revoked.String)
		token.RevokedAt = &value
	}
	user.CreatedAt = parseTime(created)
	user.UpdatedAt = parseTime(updated)
	if lastLogin.Valid {
		value := parseTime(lastLogin.String)
		user.LastLoginAt = &value
	}
	return &token, &user, nil
}

func (r *AuthRepository) GetAccessTokenIdentity(ctx context.Context, tokenHash string) (*domainauth.UserRecord, time.Time, error) {
	row := r.db.QueryRowContext(ctx, `
		SELECT at.ExpiresAt,
		       u.Id, u.Username, u.PasswordHash, u.PasswordSalt, u.IsActive, u.CreatedAt, u.UpdatedAt, u.LastLoginAt
		FROM AccessTokens at
		INNER JOIN Users u ON u.Id = at.UserId
		WHERE at.TokenHash = ?`, tokenHash)

	var expires string
	var user domainauth.UserRecord
	var created, updated string
	var lastLogin sql.NullString
	err := row.Scan(&expires, &user.ID, &user.Username, &user.PasswordHash, &user.PasswordSalt, &user.IsActive, &created, &updated, &lastLogin)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, time.Time{}, nil
		}
		return nil, time.Time{}, err
	}

	user.CreatedAt = parseTime(created)
	user.UpdatedAt = parseTime(updated)
	if lastLogin.Valid {
		value := parseTime(lastLogin.String)
		user.LastLoginAt = &value
	}
	return &user, parseTime(expires), nil
}

func (r *AuthRepository) GetRoleSummariesForUser(ctx context.Context, userID int) ([]domainauth.RoleSummary, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT r.Id, r.Name, r.Description
		FROM Roles r
		INNER JOIN UserRoles ur ON ur.RoleId = r.Id
		WHERE ur.UserId = ?
		ORDER BY r.Name COLLATE NOCASE`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	roles := make([]domainauth.RoleSummary, 0)
	for rows.Next() {
		var role domainauth.RoleSummary
		var description sql.NullString
		if err := rows.Scan(&role.ID, &role.Name, &description); err != nil {
			return nil, err
		}
		role.Description = description.String
		roles = append(roles, role)
	}
	return roles, rows.Err()
}

func (r *AuthRepository) GetPermissionsForUser(ctx context.Context, userID int) ([]string, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT DISTINCT p.Code
		FROM Permissions p
		INNER JOIN RolePermissions rp ON rp.PermissionId = p.Id
		INNER JOIN UserRoles ur ON ur.RoleId = rp.RoleId
		WHERE ur.UserId = ?
		ORDER BY p.Code COLLATE NOCASE`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	permissions := make([]string, 0)
	for rows.Next() {
		var code string
		if err := rows.Scan(&code); err != nil {
			return nil, err
		}
		permissions = append(permissions, code)
	}
	return permissions, rows.Err()
}

func (r *AuthRepository) IsUserAdministrator(ctx context.Context, userID int) (bool, error) {
	row := r.db.QueryRowContext(ctx, `
		SELECT 1
		FROM UserRoles ur
		INNER JOIN Roles r ON r.Id = ur.RoleId
		WHERE ur.UserId = ? AND lower(r.Name) = lower(?)
		LIMIT 1`, userID, "Administrator")

	var marker int
	if err := row.Scan(&marker); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

func (r *AuthRepository) GetDirectDeviceGroupsForUser(ctx context.Context, userID int) ([]domaindevice.GroupSummary, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT g.Id, g.Name, g.Description, COUNT(DISTINCT gd.DeviceId) AS DeviceCount, g.IsInternal
		FROM DeviceGroups g
		INNER JOIN UserDeviceGroups ug ON ug.GroupId = g.Id
		LEFT JOIN DeviceGroupDevices gd ON gd.GroupId = g.Id
		WHERE ug.UserId = ?
		GROUP BY g.Id, g.Name, g.Description, g.IsInternal
		ORDER BY g.Name COLLATE NOCASE, g.Id`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanGroupSummaries(rows)
}

func (r *AuthRepository) GetEffectiveDeviceGroupsForUser(ctx context.Context, userID int) ([]domaindevice.GroupSummary, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT g.Id, g.Name, g.Description, COUNT(DISTINCT gd.DeviceId) AS DeviceCount, g.IsInternal
		FROM DeviceGroups g
		LEFT JOIN DeviceGroupDevices gd ON gd.GroupId = g.Id
		WHERE g.Id IN (
			SELECT GroupId FROM UserDeviceGroups WHERE UserId = ?
			UNION
			SELECT rdg.GroupId
			FROM RoleDeviceGroups rdg
			INNER JOIN UserRoles ur ON ur.RoleId = rdg.RoleId
			WHERE ur.UserId = ?
		)
		GROUP BY g.Id, g.Name, g.Description, g.IsInternal
		ORDER BY g.Name COLLATE NOCASE, g.Id`, userID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanGroupSummaries(rows)
}

func (r *AuthRepository) GetDeviceGroupsForRole(ctx context.Context, roleID int) ([]domaindevice.GroupSummary, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT g.Id, g.Name, g.Description, COUNT(DISTINCT gd.DeviceId) AS DeviceCount, g.IsInternal
		FROM DeviceGroups g
		INNER JOIN RoleDeviceGroups rg ON rg.GroupId = g.Id
		LEFT JOIN DeviceGroupDevices gd ON gd.GroupId = g.Id
		WHERE rg.RoleId = ?
		GROUP BY g.Id, g.Name, g.Description, g.IsInternal
		ORDER BY g.Name COLLATE NOCASE, g.Id`, roleID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanGroupSummaries(rows)
}

func (r *AuthRepository) GetDeviceGroupsByIDs(ctx context.Context, ids []int) ([]domaindevice.GroupSummary, error) {
	normalizedIDs := normalizeIntIDs(ids)
	if len(normalizedIDs) == 0 {
		return []domaindevice.GroupSummary{}, nil
	}

	query := `
		SELECT g.Id, g.Name, g.Description, COUNT(DISTINCT gd.DeviceId) AS DeviceCount, g.IsInternal
		FROM DeviceGroups g
		LEFT JOIN DeviceGroupDevices gd ON gd.GroupId = g.Id
		WHERE g.Id IN (` + strings.TrimSuffix(strings.Repeat("?,", len(normalizedIDs)), ",") + `)
		GROUP BY g.Id, g.Name, g.Description, g.IsInternal
		ORDER BY g.Name COLLATE NOCASE, g.Id`
	args := make([]any, 0, len(normalizedIDs))
	for _, id := range normalizedIDs {
		args = append(args, id)
	}

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanGroupSummaries(rows)
}

func (r *AuthRepository) SetDirectDeviceGroupsForUser(ctx context.Context, userID int, groupIDs []int) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `DELETE FROM UserDeviceGroups WHERE UserId = ?`, userID); err != nil {
		return err
	}
	for _, groupID := range normalizeIntIDs(groupIDs) {
		if _, err := tx.ExecContext(ctx, `INSERT INTO UserDeviceGroups (UserId, GroupId) VALUES (?, ?)`, userID, groupID); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (r *AuthRepository) SetDeviceGroupsForRole(ctx context.Context, roleID int, groupIDs []int) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `DELETE FROM RoleDeviceGroups WHERE RoleId = ?`, roleID); err != nil {
		return err
	}
	for _, groupID := range normalizeIntIDs(groupIDs) {
		if _, err := tx.ExecContext(ctx, `INSERT INTO RoleDeviceGroups (RoleId, GroupId) VALUES (?, ?)`, roleID, groupID); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (r *AuthRepository) CountAccessibleDevicesForUser(ctx context.Context, userID int) (int, error) {
	row := r.db.QueryRowContext(ctx, `
		WITH UserGroups AS (
			SELECT GroupId FROM UserDeviceGroups WHERE UserId = ?
			UNION
			SELECT rdg.GroupId
			FROM RoleDeviceGroups rdg
			INNER JOIN UserRoles ur ON ur.RoleId = rdg.RoleId
			WHERE ur.UserId = ?
		)
		SELECT COUNT(*)
		FROM (
			SELECT d.Id
			FROM Devices d
			LEFT JOIN DeviceGroupDevices gd ON gd.DeviceId = d.Id
			LEFT JOIN UserGroups ug ON ug.GroupId = gd.GroupId
			GROUP BY d.Id
			HAVING COUNT(ug.GroupId) > 0
		)`, userID, userID)

	var count int
	if err := row.Scan(&count); err != nil {
		return 0, err
	}
	return count, nil
}

func (r *AuthRepository) CreateSession(ctx context.Context, user domainauth.UserRecord, pair domainauth.TokenPair) error {
	now := time.Now().UTC()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO AccessTokens (UserId, TokenHash, ExpiresAt, CreatedAt, LastSeenAt)
		VALUES (?, ?, ?, ?, ?)`,
		user.ID, hashToken(pair.AccessToken), pair.AccessTokenExpiresAt.Format(time.RFC3339Nano), now.Format(time.RFC3339Nano), now.Format(time.RFC3339Nano)); err != nil {
		return err
	}

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO RefreshTokens (UserId, TokenHash, ExpiresAt, CreatedAt, LastUsedAt)
		VALUES (?, ?, ?, ?, ?)`,
		user.ID, hashToken(pair.RefreshToken), pair.RefreshTokenExpiresAt.Format(time.RFC3339Nano), now.Format(time.RFC3339Nano), now.Format(time.RFC3339Nano)); err != nil {
		return err
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE Users
		SET LastLoginAt = ?, UpdatedAt = ?
		WHERE Id = ?`,
		now.Format(time.RFC3339Nano), now.Format(time.RFC3339Nano), user.ID); err != nil {
		return err
	}

	return tx.Commit()
}

func (r *AuthRepository) RevokeRefreshToken(ctx context.Context, tokenID int, revokedAt time.Time) error {
	_, err := r.db.ExecContext(ctx, `UPDATE RefreshTokens SET RevokedAt = ? WHERE Id = ?`, revokedAt.Format(time.RFC3339Nano), tokenID)
	return err
}

func (r *AuthRepository) RevokeRefreshTokenByHash(ctx context.Context, tokenHash string, revokedAt time.Time) error {
	_, err := r.db.ExecContext(ctx, `UPDATE RefreshTokens SET RevokedAt = ? WHERE TokenHash = ? AND RevokedAt IS NULL`, revokedAt.Format(time.RFC3339Nano), tokenHash)
	return err
}

func (r *AuthRepository) RevokeAllRefreshTokensForUser(ctx context.Context, userID int) error {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	_, err := r.db.ExecContext(ctx, `UPDATE RefreshTokens SET RevokedAt = ? WHERE UserId = ? AND RevokedAt IS NULL`, now, userID)
	return err
}

func (r *AuthRepository) DeleteAccessTokenByHash(ctx context.Context, tokenHash string) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM AccessTokens WHERE TokenHash = ?`, tokenHash)
	return err
}

func (r *AuthRepository) DeleteAllAccessTokensForUser(ctx context.Context, userID int) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM AccessTokens WHERE UserId = ?`, userID)
	return err
}

func (r *AuthRepository) TouchAccessToken(ctx context.Context, tokenHash string, seenAt time.Time) error {
	_, err := r.db.ExecContext(ctx, `UPDATE AccessTokens SET LastSeenAt = ? WHERE TokenHash = ?`, seenAt.Format(time.RFC3339Nano), tokenHash)
	return err
}

func (r *AuthRepository) CleanupExpiredTokens(ctx context.Context, now time.Time) error {
	nowValue := now.Format(time.RFC3339Nano)
	if _, err := r.db.ExecContext(ctx, `DELETE FROM AccessTokens WHERE ExpiresAt <= ?`, nowValue); err != nil {
		return err
	}
	_, err := r.db.ExecContext(ctx, `DELETE FROM RefreshTokens WHERE ExpiresAt <= ? OR RevokedAt IS NOT NULL`, nowValue)
	return err
}

func scanUser(row *sql.Row) (*domainauth.UserRecord, error) {
	user, err := scanUserRecord(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return user, nil
}

func (r *AuthRepository) loadUserByID(ctx context.Context, userID int) (*domainauth.User, error) {
	record, err := r.GetUserByID(ctx, userID)
	if err != nil || record == nil {
		return nil, err
	}
	return r.hydrateUser(ctx, record)
}

func (r *AuthRepository) hydrateUser(ctx context.Context, record *domainauth.UserRecord) (*domainauth.User, error) {
	roles, err := r.GetRoleSummariesForUser(ctx, record.ID)
	if err != nil {
		return nil, err
	}
	permissions, err := r.GetPermissionsForUser(ctx, record.ID)
	if err != nil {
		return nil, err
	}
	directGroups, err := r.GetDirectDeviceGroupsForUser(ctx, record.ID)
	if err != nil {
		return nil, err
	}
	effectiveGroups, err := r.GetEffectiveDeviceGroupsForUser(ctx, record.ID)
	if err != nil {
		return nil, err
	}
	deviceCount, err := r.CountAccessibleDevicesForUser(ctx, record.ID)
	if err != nil {
		return nil, err
	}

	return &domainauth.User{
		ID:                        record.ID,
		Username:                  record.Username,
		IsActive:                  record.IsActive,
		CreatedAt:                 record.CreatedAt,
		UpdatedAt:                 record.UpdatedAt,
		LastLoginAt:               record.LastLoginAt,
		Roles:                     roles,
		Permissions:               permissions,
		DirectDeviceGroups:        directGroups,
		EffectiveDeviceGroups:     effectiveGroups,
		EffectiveDeviceGroupCount: len(effectiveGroups),
		EffectiveDeviceCount:      deviceCount,
	}, nil
}

func (r *AuthRepository) hydrateRole(ctx context.Context, role *domainauth.Role) (*domainauth.Role, error) {
	permissions, err := r.getPermissionsForRole(ctx, role.ID)
	if err != nil {
		return nil, err
	}
	deviceGroups, err := r.GetDeviceGroupsForRole(ctx, role.ID)
	if err != nil {
		return nil, err
	}

	return &domainauth.Role{
		ID:           role.ID,
		Name:         role.Name,
		Description:  role.Description,
		IsInternal:   role.IsInternal,
		Permissions:  permissions,
		DeviceGroups: deviceGroups,
	}, nil
}

func scanUserRecord(row rowScanner) (*domainauth.UserRecord, error) {
	var user domainauth.UserRecord
	var created, updated string
	var lastLogin sql.NullString
	err := row.Scan(&user.ID, &user.Username, &user.PasswordHash, &user.PasswordSalt, &user.IsActive, &created, &updated, &lastLogin)
	if err != nil {
		return nil, err
	}
	user.CreatedAt = parseTime(created)
	user.UpdatedAt = parseTime(updated)
	if lastLogin.Valid {
		value := parseTime(lastLogin.String)
		user.LastLoginAt = &value
	}
	return &user, nil
}

func scanRole(row rowScanner) (*domainauth.Role, error) {
	var role domainauth.Role
	var description sql.NullString
	if err := row.Scan(&role.ID, &role.Name, &description, &role.IsInternal); err != nil {
		return nil, err
	}
	role.Description = description.String
	return &role, nil
}

func parseTime(value string) time.Time {
	parsed, _ := time.Parse(time.RFC3339Nano, value)
	return parsed
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return strings.ToUpper(hex.EncodeToString(sum[:]))
}

func scanGroupSummaries(rows *sql.Rows) ([]domaindevice.GroupSummary, error) {
	items := make([]domaindevice.GroupSummary, 0)
	for rows.Next() {
		summary, err := scanGroupSummary(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, summary)
	}
	return items, rows.Err()
}
