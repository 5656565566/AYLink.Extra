package sqlite

import (
	"context"
	"database/sql"
	"time"

	domaindevice "aylink-agent/internal/domain/device"
)

type DeviceRepository struct {
	db *sql.DB
}

func NewDeviceRepository(db *sql.DB) *DeviceRepository {
	return &DeviceRepository{db: db}
}

func (r *DeviceRepository) List(ctx context.Context) ([]domaindevice.Device, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT Id, Name, Serial, IpAddress, Port, Status, LastSeen, CreatedAt, UpdatedAt
		FROM Devices
		ORDER BY Name COLLATE NOCASE, Id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	devices := make([]domaindevice.Device, 0)
	for rows.Next() {
		device, err := scanDevice(rows)
		if err != nil {
			return nil, err
		}
		devices = append(devices, device)
	}
	return devices, rows.Err()
}

func (r *DeviceRepository) GetByID(ctx context.Context, id int) (*domaindevice.Device, error) {
	row := r.db.QueryRowContext(ctx, `
		SELECT Id, Name, Serial, IpAddress, Port, Status, LastSeen, CreatedAt, UpdatedAt
		FROM Devices
		WHERE Id = ?`, id)

	device, err := scanDevice(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &device, nil
}

func (r *DeviceRepository) FindBySerialOrAddress(ctx context.Context, serial string, ip *string, port *int) (*domaindevice.Device, error) {
	row := r.db.QueryRowContext(ctx, `
		SELECT Id, Name, Serial, IpAddress, Port, Status, LastSeen, CreatedAt, UpdatedAt
		FROM Devices
		WHERE Serial = ?
		   OR (IpAddress = ? AND Port IS ?)
		LIMIT 1`,
		serial, nullableStringValue(ip), nullableIntValue(port))

	device, err := scanDevice(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &device, nil
}

func (r *DeviceRepository) Insert(ctx context.Context, device *domaindevice.Device) error {
	result, err := r.db.ExecContext(ctx, `
		INSERT INTO Devices (Name, Serial, IpAddress, Port, Status, LastSeen, CreatedAt, UpdatedAt)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		device.Name,
		device.Serial,
		nullableStringValue(device.IPAddress),
		nullableIntValue(device.Port),
		device.Status,
		device.LastSeen.Format(time.RFC3339Nano),
		device.CreatedAt.Format(time.RFC3339Nano),
		device.UpdatedAt.Format(time.RFC3339Nano),
	)
	if err != nil {
		return err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return err
	}
	device.ID = int(id)
	return nil
}

func (r *DeviceRepository) Update(ctx context.Context, device *domaindevice.Device) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE Devices
		SET Name = ?, Serial = ?, IpAddress = ?, Port = ?, Status = ?, LastSeen = ?, UpdatedAt = ?
		WHERE Id = ?`,
		device.Name,
		device.Serial,
		nullableStringValue(device.IPAddress),
		nullableIntValue(device.Port),
		device.Status,
		device.LastSeen.Format(time.RFC3339Nano),
		device.UpdatedAt.Format(time.RFC3339Nano),
		device.ID,
	)
	return err
}

func (r *DeviceRepository) Delete(ctx context.Context, id int) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM Devices WHERE Id = ?`, id)
	return err
}

type scanner interface {
	Scan(dest ...any) error
}

func scanDevice(s scanner) (domaindevice.Device, error) {
	var device domaindevice.Device
	var ip sql.NullString
	var port sql.NullInt64
	var lastSeen, createdAt, updatedAt string
	err := s.Scan(&device.ID, &device.Name, &device.Serial, &ip, &port, &device.Status, &lastSeen, &createdAt, &updatedAt)
	if err != nil {
		return domaindevice.Device{}, err
	}
	if ip.Valid {
		device.IPAddress = &ip.String
	}
	if port.Valid {
		value := int(port.Int64)
		device.Port = &value
	}
	device.LastSeen = parseTime(lastSeen)
	device.CreatedAt = parseTime(createdAt)
	device.UpdatedAt = parseTime(updatedAt)
	return device, nil
}

func nullableStringValue(value *string) any {
	if value == nil || *value == "" {
		return nil
	}
	return *value
}

func nullableIntValue(value *int) any {
	if value == nil {
		return nil
	}
	return *value
}
