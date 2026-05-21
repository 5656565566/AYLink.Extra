package terminal

import (
	"context"
	"errors"
	"strings"

	domainadb "aylink-agent/internal/domain/adb"
	domaindevice "aylink-agent/internal/domain/device"
)

var (
	ErrADBUnavailable = errors.New("adb unavailable")
	ErrDeviceNotFound = errors.New("device not found")
	ErrDeviceOffline  = errors.New("device offline")
	ErrSerialRequired = errors.New("device serial required")
)

type DeviceRepository interface {
	GetByID(ctx context.Context, id int) (*domaindevice.Device, error)
}

type Service struct {
	devices DeviceRepository
	adb     domainadb.Manager
}

type Session struct {
	session domainadb.ShellSession
	serial  string
}

func NewService(devices DeviceRepository, adb domainadb.Manager) *Service {
	return &Service{
		devices: devices,
		adb:     adb,
	}
}

func (s *Service) Start(ctx context.Context, deviceID int) (*Session, error) {
	binary, ok := s.adb.ResolvedBinary()
	if !ok || strings.TrimSpace(binary.Path) == "" {
		return nil, ErrADBUnavailable
	}

	device, err := s.devices.GetByID(ctx, deviceID)
	if err != nil {
		return nil, err
	}
	if device == nil {
		return nil, ErrDeviceNotFound
	}

	serial := strings.TrimSpace(device.Serial)
	if serial == "" {
		return nil, ErrSerialRequired
	}

	online, err := s.isOnline(ctx, serial)
	if err != nil {
		return nil, err
	}
	if !online {
		return nil, ErrDeviceOffline
	}

	shellSession, err := s.adb.OpenShellSession(ctx, serial)
	if err != nil {
		return nil, err
	}

	return &Session{
		session: shellSession,
		serial:  serial,
	}, nil
}

func (s *Service) isOnline(ctx context.Context, serial string) (bool, error) {
	devices, err := s.adb.Devices(ctx)
	if err != nil {
		return false, err
	}

	for _, device := range devices {
		if strings.EqualFold(strings.TrimSpace(device.Serial), serial) {
			return strings.EqualFold(strings.TrimSpace(device.State), "device") ||
				strings.EqualFold(strings.TrimSpace(device.State), "online"), nil
		}
	}

	return false, nil
}

func (s *Session) ReadPacket() (domainadb.ShellPacket, error) {
	return s.session.ReadPacket()
}

func (s *Session) WriteInput(data string) error {
	return s.session.WriteInput(data)
}

func (s *Session) Resize(cols, rows int) error {
	return s.session.Resize(cols, rows)
}

func (s *Session) CloseInput() error {
	return s.session.CloseStdin()
}

func (s *Session) Close() error {
	return s.session.Close()
}

func (s *Session) Serial() string {
	return s.serial
}
