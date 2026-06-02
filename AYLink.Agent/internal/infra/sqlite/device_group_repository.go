package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	domaindevice "aylink-agent/internal/domain/device"
)

type DeviceGroupRepository struct {
	db *sql.DB
}

func NewDeviceGroupRepository(db *sql.DB) *DeviceGroupRepository {
	return &DeviceGroupRepository{db: db}
}

func (r *DeviceGroupRepository) List(ctx context.Context) ([]domaindevice.Group, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT g.Id, g.Name, g.Description, g.IsInternal, g.CreatedAt, g.UpdatedAt,
		       COUNT(DISTINCT gd.DeviceId) AS DeviceCount,
		       COUNT(DISTINCT rg.RoleId) AS RoleCount,
		       COUNT(DISTINCT ug.UserId) AS UserCount
		FROM DeviceGroups g
		LEFT JOIN DeviceGroupDevices gd ON gd.GroupId = g.Id
		LEFT JOIN RoleDeviceGroups rg ON rg.GroupId = g.Id
		LEFT JOIN UserDeviceGroups ug ON ug.GroupId = g.Id
		GROUP BY g.Id, g.Name, g.Description, g.IsInternal, g.CreatedAt, g.UpdatedAt
		ORDER BY g.IsInternal DESC, g.Name COLLATE NOCASE, g.Id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]domaindevice.Group, 0)
	for rows.Next() {
		group, err := scanDeviceGroup(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, group)
	}
	return items, rows.Err()
}

func (r *DeviceGroupRepository) ListOptions(ctx context.Context, keyword string) ([]domaindevice.GroupSummary, error) {
	query := `
		SELECT g.Id, g.Name, g.Description, COUNT(DISTINCT gd.DeviceId) AS DeviceCount, g.IsInternal
		FROM DeviceGroups g
		LEFT JOIN DeviceGroupDevices gd ON gd.GroupId = g.Id
		WHERE g.IsInternal = 0`
	args := make([]any, 0, 2)

	trimmedKeyword := strings.TrimSpace(keyword)
	if trimmedKeyword != "" {
		query += ` AND lower(g.Name) LIKE lower(?)`
		args = append(args, "%"+trimmedKeyword+"%")
	}

	query += `
		GROUP BY g.Id, g.Name, g.Description, g.IsInternal
		ORDER BY g.Name COLLATE NOCASE, g.Id`

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

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

func (r *DeviceGroupRepository) ListOptionsForUser(ctx context.Context, userID int, keyword string) ([]domaindevice.GroupSummary, error) {
	query := `
		WITH UserGroups AS (
			SELECT GroupId FROM UserDeviceGroups WHERE UserId = ?
			UNION
			SELECT rdg.GroupId
			FROM RoleDeviceGroups rdg
			INNER JOIN UserRoles ur ON ur.RoleId = rdg.RoleId
			WHERE ur.UserId = ?
		)
		SELECT g.Id, g.Name, g.Description, COUNT(DISTINCT gd.DeviceId) AS DeviceCount, g.IsInternal
		FROM DeviceGroups g
		LEFT JOIN DeviceGroupDevices gd ON gd.GroupId = g.Id
		WHERE g.IsInternal = 0
		  AND g.Id IN (SELECT GroupId FROM UserGroups)`
	args := []any{userID, userID}

	trimmedKeyword := strings.TrimSpace(keyword)
	if trimmedKeyword != "" {
		query += ` AND lower(g.Name) LIKE lower(?)`
		args = append(args, "%"+trimmedKeyword+"%")
	}

	query += `
		GROUP BY g.Id, g.Name, g.Description, g.IsInternal
		ORDER BY g.Name COLLATE NOCASE, g.Id`

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

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

func (r *DeviceGroupRepository) GetByID(ctx context.Context, id int) (*domaindevice.Group, error) {
	row := r.db.QueryRowContext(ctx, `
		SELECT g.Id, g.Name, g.Description, g.IsInternal, g.CreatedAt, g.UpdatedAt,
		       COUNT(DISTINCT gd.DeviceId) AS DeviceCount,
		       COUNT(DISTINCT rg.RoleId) AS RoleCount,
		       COUNT(DISTINCT ug.UserId) AS UserCount
		FROM DeviceGroups g
		LEFT JOIN DeviceGroupDevices gd ON gd.GroupId = g.Id
		LEFT JOIN RoleDeviceGroups rg ON rg.GroupId = g.Id
		LEFT JOIN UserDeviceGroups ug ON ug.GroupId = g.Id
		WHERE g.Id = ?
		GROUP BY g.Id, g.Name, g.Description, g.IsInternal, g.CreatedAt, g.UpdatedAt`, id)

	group, err := scanDeviceGroup(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &group, nil
}

func (r *DeviceGroupRepository) GetByName(ctx context.Context, name string) (*domaindevice.Group, error) {
	row := r.db.QueryRowContext(ctx, `
		SELECT g.Id, g.Name, g.Description, g.IsInternal, g.CreatedAt, g.UpdatedAt,
		       COUNT(DISTINCT gd.DeviceId) AS DeviceCount,
		       COUNT(DISTINCT rg.RoleId) AS RoleCount,
		       COUNT(DISTINCT ug.UserId) AS UserCount
		FROM DeviceGroups g
		LEFT JOIN DeviceGroupDevices gd ON gd.GroupId = g.Id
		LEFT JOIN RoleDeviceGroups rg ON rg.GroupId = g.Id
		LEFT JOIN UserDeviceGroups ug ON ug.GroupId = g.Id
		WHERE lower(g.Name) = lower(?)
		GROUP BY g.Id, g.Name, g.Description, g.IsInternal, g.CreatedAt, g.UpdatedAt`, strings.TrimSpace(name))

	group, err := scanDeviceGroup(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &group, nil
}

func (r *DeviceGroupRepository) Create(ctx context.Context, name string, description string) (*domaindevice.Group, error) {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	result, err := r.db.ExecContext(ctx, `
		INSERT INTO DeviceGroups (Name, Description, IsInternal, CreatedAt, UpdatedAt)
		VALUES (?, ?, 0, ?, ?)`,
		strings.TrimSpace(name),
		strings.TrimSpace(description),
		now,
		now,
	)
	if err != nil {
		return nil, err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return nil, err
	}
	return r.GetByID(ctx, int(id))
}

func (r *DeviceGroupRepository) Update(ctx context.Context, id int, name string, description string) (*domaindevice.Group, error) {
	_, err := r.db.ExecContext(ctx, `
		UPDATE DeviceGroups
		SET Name = ?, Description = ?, UpdatedAt = ?
		WHERE Id = ? AND IsInternal = 0`,
		strings.TrimSpace(name),
		strings.TrimSpace(description),
		time.Now().UTC().Format(time.RFC3339Nano),
		id,
	)
	if err != nil {
		return nil, err
	}
	return r.GetByID(ctx, id)
}

func (r *DeviceGroupRepository) Delete(ctx context.Context, id int) error {
	group, err := r.GetByID(ctx, id)
	if err != nil {
		return err
	}
	if group != nil && group.IsInternal {
		return nil
	}

	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	queries := []string{
		`DELETE FROM DeviceGroupDevices WHERE GroupId = ?`,
		`DELETE FROM UserDeviceGroups WHERE GroupId = ?`,
		`DELETE FROM RoleDeviceGroups WHERE GroupId = ?`,
		`DELETE FROM DeviceGroups WHERE Id = ?`,
	}
	for _, query := range queries {
		if _, err := tx.ExecContext(ctx, query, id); err != nil {
			return err
		}
	}

	return tx.Commit()
}

func (r *DeviceGroupRepository) GetGroupsForDevice(ctx context.Context, deviceID int) ([]domaindevice.GroupSummary, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT g.Id, g.Name, g.Description, COUNT(DISTINCT gd2.DeviceId) AS DeviceCount, g.IsInternal
		FROM DeviceGroups g
		INNER JOIN DeviceGroupDevices gd ON gd.GroupId = g.Id
		LEFT JOIN DeviceGroupDevices gd2 ON gd2.GroupId = g.Id
		WHERE gd.DeviceId = ? AND g.IsInternal = 0
		GROUP BY g.Id, g.Name, g.Description, g.IsInternal
		ORDER BY g.Name COLLATE NOCASE, g.Id`, deviceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

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

func (r *DeviceGroupRepository) GetGroupsForDevices(ctx context.Context, deviceIDs []int) (map[int][]domaindevice.GroupSummary, error) {
	result := make(map[int][]domaindevice.GroupSummary)
	for _, deviceID := range deviceIDs {
		groups, err := r.GetGroupsForDevice(ctx, deviceID)
		if err != nil {
			return nil, err
		}
		result[deviceID] = groups
	}
	return result, nil
}

func (r *DeviceGroupRepository) SetGroupsForDevice(ctx context.Context, deviceID int, groupIDs []int) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `
		DELETE FROM DeviceGroupDevices
		WHERE DeviceId = ?
		  AND GroupId NOT IN (SELECT Id FROM DeviceGroups WHERE IsInternal = 1)`, deviceID); err != nil {
		return err
	}

	for _, groupID := range normalizeIntIDs(groupIDs) {
		if _, err := tx.ExecContext(ctx, `
			INSERT OR IGNORE INTO DeviceGroupDevices (GroupId, DeviceId)
			SELECT Id, ?
			FROM DeviceGroups
			WHERE Id = ? AND IsInternal = 0`, deviceID, groupID); err != nil {
			return err
		}
	}

	if _, err := tx.ExecContext(ctx, `
		INSERT OR IGNORE INTO DeviceGroupDevices (GroupId, DeviceId)
		SELECT Id, ?
		FROM DeviceGroups
		WHERE IsInternal = 1`, deviceID); err != nil {
		return err
	}

	return tx.Commit()
}

func (r *DeviceGroupRepository) ListAccessibleDeviceIDs(ctx context.Context, userID int) ([]int, error) {
	rows, err := r.db.QueryContext(ctx, `
		WITH UserGroups AS (
			SELECT GroupId FROM UserDeviceGroups WHERE UserId = ?
			UNION
			SELECT rdg.GroupId
			FROM RoleDeviceGroups rdg
			INNER JOIN UserRoles ur ON ur.RoleId = rdg.RoleId
			WHERE ur.UserId = ?
		)
		SELECT d.Id
		FROM Devices d
		LEFT JOIN DeviceGroupDevices gd ON gd.DeviceId = d.Id
		LEFT JOIN UserGroups ug ON ug.GroupId = gd.GroupId
		GROUP BY d.Id
		HAVING COUNT(ug.GroupId) > 0
		ORDER BY d.Id`, userID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	ids := make([]int, 0)
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func (r *DeviceGroupRepository) CanUserAccessDevice(ctx context.Context, userID int, deviceID int) (bool, error) {
	row := r.db.QueryRowContext(ctx, `
		WITH UserGroups AS (
			SELECT GroupId FROM UserDeviceGroups WHERE UserId = ?
			UNION
			SELECT rdg.GroupId
			FROM RoleDeviceGroups rdg
			INNER JOIN UserRoles ur ON ur.RoleId = rdg.RoleId
			WHERE ur.UserId = ?
		)
		SELECT 1
		FROM Devices d
		LEFT JOIN DeviceGroupDevices gd ON gd.DeviceId = d.Id
		LEFT JOIN UserGroups ug ON ug.GroupId = gd.GroupId
		WHERE d.Id = ?
		GROUP BY d.Id
		HAVING COUNT(ug.GroupId) > 0
		LIMIT 1`, userID, userID, deviceID)

	var marker int
	if err := row.Scan(&marker); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

func (r *DeviceGroupRepository) IsUserAdministrator(ctx context.Context, userID int) (bool, error) {
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

func scanGroupSummary(s scanner) (domaindevice.GroupSummary, error) {
	var summary domaindevice.GroupSummary
	var description sql.NullString
	if err := s.Scan(&summary.ID, &summary.Name, &description, &summary.DeviceCount, &summary.IsInternal); err != nil {
		return domaindevice.GroupSummary{}, err
	}
	summary.Description = description.String
	return summary, nil
}

func scanDeviceGroup(s scanner) (domaindevice.Group, error) {
	var group domaindevice.Group
	var description sql.NullString
	var createdAt, updatedAt string
	if err := s.Scan(
		&group.ID,
		&group.Name,
		&description,
		&group.IsInternal,
		&createdAt,
		&updatedAt,
		&group.DeviceCount,
		&group.RoleCount,
		&group.UserCount,
	); err != nil {
		return domaindevice.Group{}, err
	}
	group.Description = description.String
	group.CreatedAt = parseTime(createdAt)
	group.UpdatedAt = parseTime(updatedAt)
	return group, nil
}

func normalizeIntIDs(ids []int) []int {
	seen := map[int]bool{}
	result := make([]int, 0, len(ids))
	for _, id := range ids {
		if id <= 0 || seen[id] {
			continue
		}
		seen[id] = true
		result = append(result, id)
	}
	return result
}
