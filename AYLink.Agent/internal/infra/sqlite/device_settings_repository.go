package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"time"

	domaindevice "aylink-agent/internal/domain/device"
)

type DeviceSettingsRepository struct {
	db *sql.DB
}

func NewDeviceSettingsRepository(db *sql.DB) *DeviceSettingsRepository {
	return &DeviceSettingsRepository{db: db}
}

func (r *DeviceSettingsRepository) GetBySerial(ctx context.Context, serial string) (domaindevice.SettingsProfile, error) {
	row := r.db.QueryRowContext(ctx, `SELECT ConfigJson FROM DeviceSettings WHERE DeviceSerial = ?`, strings.TrimSpace(serial))
	var raw string
	if err := row.Scan(&raw); err != nil {
		if err == sql.ErrNoRows {
			return domaindevice.DefaultSettingsProfile(), nil
		}
		return domaindevice.SettingsProfile{}, err
	}

	if strings.TrimSpace(raw) == "" {
		return domaindevice.DefaultSettingsProfile(), nil
	}

	profile := domaindevice.DefaultSettingsProfile()
	if err := json.Unmarshal([]byte(raw), &profile); err != nil {
		return domaindevice.DefaultSettingsProfile(), nil
	}
	return profile, nil
}

func (r *DeviceSettingsRepository) SaveBySerial(ctx context.Context, serial string, profile domaindevice.SettingsProfile) (domaindevice.SettingsProfile, error) {
	raw, err := json.Marshal(profile)
	if err != nil {
		return domaindevice.SettingsProfile{}, err
	}

	_, err = r.db.ExecContext(ctx, `
		INSERT INTO DeviceSettings (DeviceSerial, ConfigJson, UpdatedAt)
		VALUES (?, ?, ?)
		ON CONFLICT(DeviceSerial) DO UPDATE SET
			ConfigJson = excluded.ConfigJson,
			UpdatedAt = excluded.UpdatedAt`,
		strings.TrimSpace(serial),
		string(raw),
		time.Now().UTC().Format(time.RFC3339Nano),
	)
	if err != nil {
		return domaindevice.SettingsProfile{}, err
	}

	return profile, nil
}

func (r *DeviceSettingsRepository) DeleteBySerial(ctx context.Context, serial string) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM DeviceSettings WHERE DeviceSerial = ?`, strings.TrimSpace(serial))
	return err
}
