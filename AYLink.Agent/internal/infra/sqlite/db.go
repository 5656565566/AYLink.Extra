package sqlite

import (
	"database/sql"
	"time"

	_ "modernc.org/sqlite"
)

func Open(path string) (*sql.DB, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}

	if err := initialize(db); err != nil {
		db.Close()
		return nil, err
	}

	return db, nil
}

func initialize(db *sql.DB) error {
	queries := []string{
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
		{"ui_language", "zh-CN", "UI language locale"},
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

	return nil
}
