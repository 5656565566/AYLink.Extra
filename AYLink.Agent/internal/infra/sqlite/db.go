package sqlite

import (
	"database/sql"
	"errors"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

const internalAllDevicesGroupName = "所有设备"

func Open(path string) (*sql.DB, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}

	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)

	if err := initialize(db); err != nil {
		db.Close()
		return nil, err
	}

	return db, nil
}

func initialize(db *sql.DB) error {
	queries := []string{
		`PRAGMA journal_mode = WAL`,
		`PRAGMA busy_timeout = 5000`,
		`PRAGMA synchronous = NORMAL`,
		`PRAGMA foreign_keys = ON`,
		`CREATE TABLE IF NOT EXISTS Devices (
			Id INTEGER PRIMARY KEY AUTOINCREMENT,
			Name TEXT NOT NULL,
			Serial TEXT NOT NULL,
			IpAddress TEXT,
			Port INTEGER,
			Status TEXT NOT NULL DEFAULT 'unknown',
			LastSeen TEXT NOT NULL,
			CreatedAt TEXT NOT NULL,
			UpdatedAt TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS AdbHistory (
			Id INTEGER PRIMARY KEY AUTOINCREMENT,
			DeviceId INTEGER NOT NULL,
			Action TEXT NOT NULL,
			Result TEXT,
			Details TEXT,
			Timestamp TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS Settings (
			Key TEXT PRIMARY KEY,
			Value TEXT NOT NULL,
			Description TEXT,
			UpdatedAt TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS DeviceSettings (
			DeviceSerial TEXT PRIMARY KEY,
			ConfigJson TEXT NOT NULL,
			UpdatedAt TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS Users (
			Id INTEGER PRIMARY KEY AUTOINCREMENT,
			Username TEXT NOT NULL UNIQUE,
			PasswordHash TEXT NOT NULL,
			PasswordSalt TEXT NOT NULL,
			IsActive INTEGER NOT NULL DEFAULT 1,
			CreatedAt TEXT NOT NULL,
			UpdatedAt TEXT NOT NULL,
			LastLoginAt TEXT
		)`,
		`CREATE TABLE IF NOT EXISTS Roles (
			Id INTEGER PRIMARY KEY AUTOINCREMENT,
			Name TEXT NOT NULL UNIQUE,
			Description TEXT,
			IsInternal INTEGER NOT NULL DEFAULT 0
		)`,
		`CREATE TABLE IF NOT EXISTS Permissions (
			Id INTEGER PRIMARY KEY AUTOINCREMENT,
			Code TEXT NOT NULL UNIQUE,
			Description TEXT
		)`,
		`CREATE TABLE IF NOT EXISTS UserRoles (
			UserId INTEGER NOT NULL,
			RoleId INTEGER NOT NULL,
			PRIMARY KEY (UserId, RoleId)
		)`,
		`CREATE TABLE IF NOT EXISTS RolePermissions (
			RoleId INTEGER NOT NULL,
			PermissionId INTEGER NOT NULL,
			PRIMARY KEY (RoleId, PermissionId)
		)`,
		`CREATE TABLE IF NOT EXISTS RefreshTokens (
			Id INTEGER PRIMARY KEY AUTOINCREMENT,
			UserId INTEGER NOT NULL,
			TokenHash TEXT NOT NULL UNIQUE,
			ExpiresAt TEXT NOT NULL,
			RevokedAt TEXT,
			CreatedAt TEXT NOT NULL,
			LastUsedAt TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS AccessTokens (
			Id INTEGER PRIMARY KEY AUTOINCREMENT,
			UserId INTEGER NOT NULL,
			TokenHash TEXT NOT NULL UNIQUE,
			ExpiresAt TEXT NOT NULL,
			CreatedAt TEXT NOT NULL,
			LastSeenAt TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS DeviceGroups (
			Id INTEGER PRIMARY KEY AUTOINCREMENT,
			Name TEXT NOT NULL UNIQUE,
			Description TEXT,
			IsInternal INTEGER NOT NULL DEFAULT 0,
			CreatedAt TEXT NOT NULL,
			UpdatedAt TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS DeviceGroupDevices (
			GroupId INTEGER NOT NULL,
			DeviceId INTEGER NOT NULL,
			PRIMARY KEY (GroupId, DeviceId)
		)`,
		`CREATE TABLE IF NOT EXISTS UserDeviceGroups (
			UserId INTEGER NOT NULL,
			GroupId INTEGER NOT NULL,
			PRIMARY KEY (UserId, GroupId)
		)`,
		`CREATE TABLE IF NOT EXISTS RoleDeviceGroups (
			RoleId INTEGER NOT NULL,
			GroupId INTEGER NOT NULL,
			PRIMARY KEY (RoleId, GroupId)
		)`,
	}

	for _, query := range queries {
		if _, err := db.Exec(query); err != nil {
			return err
		}
	}

	if err := ensureColumn(db, "DeviceGroups", "IsInternal", `ALTER TABLE DeviceGroups ADD COLUMN IsInternal INTEGER NOT NULL DEFAULT 0`); err != nil {
		return err
	}

	return seedDefaults(db)
}

func seedDefaults(db *sql.DB) error {
	now := time.Now().UTC().Format(time.RFC3339Nano)

	defaultSettings := []struct {
		Key         string
		Value       string
		Description string
	}{
		{"scrcpy_max_fps", "30", "Maximum FPS for scrcpy"},
		{"scrcpy_max_size", "1920", "Maximum scrcpy video dimension"},
		{"scrcpy_video_bitrate", "12000000", "scrcpy video bitrate in bps"},
		{"scrcpy_video_codec", "h264", "Video codec (h264/h265)"},
		{"webrtc_stun_server", "stun:stun.l.google.com:19302", "STUN server URL"},
		{"webrtc_network_config", `{"IceTransportPolicy":"all","IceServers":[{"Urls":["stun:stun.l.google.com:19302"]}],"HostCandidateOverrideEnabled":false,"SinglePortMuxEnabled":false}`, "Global WebRTC ICE network settings"},
		{"fallback_language", "zh-CN", "Default fallback language locale"},
	}

	for _, s := range defaultSettings {
		_, err := db.Exec(`INSERT OR IGNORE INTO Settings (Key, Value, Description, UpdatedAt) VALUES (?, ?, ?, ?)`, s.Key, s.Value, s.Description, now)
		if err != nil {
			return err
		}
	}

	permissions := []string{
		"dashboard.view",
		"devices.view",
		"devices.manage",
		"devices.control",
		"files.access",
		"terminal.access",
		"settings.view",
		"settings.manage",
		"accounts.view",
		"accounts.manage",
		"accounts.change-password",
	}

	for _, p := range permissions {
		_, err := db.Exec(`INSERT OR IGNORE INTO Permissions (Code, Description) VALUES (?, ?)`, p, p)
		if err != nil {
			return err
		}
	}

	_, err := db.Exec(`INSERT OR IGNORE INTO Roles (Name, Description, IsInternal) VALUES (?, ?, 1)`, "Administrator", "Full access to all AYLink features")
	if err != nil {
		return err
	}

	var adminRoleId int
	err = db.QueryRow(`SELECT Id FROM Roles WHERE Name = 'Administrator'`).Scan(&adminRoleId)
	if err != nil {
		return err
	}

	for _, p := range permissions {
		var permId int
		err := db.QueryRow(`SELECT Id FROM Permissions WHERE Code = ?`, p).Scan(&permId)
		if err != nil {
			return err
		}
		_, err = db.Exec(`INSERT OR IGNORE INTO RolePermissions (RoleId, PermissionId) VALUES (?, ?)`, adminRoleId, permId)
		if err != nil {
			return err
		}
	}

	if err := ensureInternalAllDevicesGroup(db, now); err != nil {
		return err
	}

	return nil
}

func ensureColumn(db *sql.DB, table string, column string, alterQuery string) error {
	rows, err := db.Query(`PRAGMA table_info(` + table + `)`)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var cid int
		var name string
		var dataType string
		var notNull int
		var defaultValue sql.NullString
		var pk int
		if err := rows.Scan(&cid, &name, &dataType, &notNull, &defaultValue, &pk); err != nil {
			return err
		}
		if strings.EqualFold(name, column) {
			return nil
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}

	_, err = db.Exec(alterQuery)
	return err
}

func ensureInternalAllDevicesGroup(db *sql.DB, now string) error {
	groupID, err := lookupInternalAllDevicesGroupID(db)
	if err != nil {
		return err
	}
	if groupID == 0 {
		result, err := db.Exec(`
			INSERT INTO DeviceGroups (Name, Description, IsInternal, CreatedAt, UpdatedAt)
			VALUES (?, ?, 1, ?, ?)`,
			internalAllDevicesGroupName,
			"系统内置全量设备范围组",
			now,
			now,
		)
		if err != nil {
			return err
		}
		lastInsertID, err := result.LastInsertId()
		if err != nil {
			return err
		}
		groupID = int(lastInsertID)
	} else {
		if _, err := db.Exec(`
			UPDATE DeviceGroups
			SET IsInternal = 1, UpdatedAt = ?
			WHERE Id = ? AND IsInternal <> 1`, now, groupID); err != nil {
			return err
		}
	}

	if _, err := db.Exec(`
		INSERT OR IGNORE INTO DeviceGroupDevices (GroupId, DeviceId)
		SELECT ?, d.Id
		FROM Devices d`, groupID); err != nil {
		return err
	}

	if _, err := db.Exec(`
		CREATE TRIGGER IF NOT EXISTS trg_devices_assign_internal_groups
		AFTER INSERT ON Devices
		BEGIN
			INSERT OR IGNORE INTO DeviceGroupDevices (GroupId, DeviceId)
			SELECT Id, NEW.Id
			FROM DeviceGroups
			WHERE IsInternal = 1;
		END`); err != nil {
		return err
	}

	if _, err := db.Exec(`
		INSERT OR IGNORE INTO Settings (Key, Value, Description, UpdatedAt)
		VALUES ('device_groups_internal_all_seeded', '0', 'Tracks the initial assignment of the internal all-devices group', ?)
	`, now); err != nil {
		return err
	}

	var seededValue string
	if err := db.QueryRow(`SELECT Value FROM Settings WHERE Key = 'device_groups_internal_all_seeded'`).Scan(&seededValue); err != nil {
		return err
	}
	if seededValue == "1" {
		return nil
	}

	if _, err := db.Exec(`
		INSERT OR IGNORE INTO UserDeviceGroups (UserId, GroupId)
		SELECT DISTINCT ur.UserId, ?
		FROM UserRoles ur
		INNER JOIN Roles r ON r.Id = ur.RoleId
		WHERE lower(r.Name) = lower('Administrator')`, groupID); err != nil {
		return err
	}

	_, err = db.Exec(`
		UPDATE Settings
		SET Value = '1', UpdatedAt = ?
		WHERE Key = 'device_groups_internal_all_seeded'`, now)
	return err
}

func lookupInternalAllDevicesGroupID(db *sql.DB) (int, error) {
	var groupID int
	err := db.QueryRow(`
		SELECT Id
		FROM DeviceGroups
		WHERE lower(Name) = lower(?)
		ORDER BY Id
		LIMIT 1`, internalAllDevicesGroupName).Scan(&groupID)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	return groupID, nil
}
