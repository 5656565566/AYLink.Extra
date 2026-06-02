package device

import (
	"context"
	"errors"

	domainauth "aylink-agent/internal/domain/auth"
	domaindevice "aylink-agent/internal/domain/device"
)

var ErrDeviceAccessDenied = errors.New("device access denied")

type AccessRepository interface {
	ListAccessibleDeviceIDs(ctx context.Context, userID int) ([]int, error)
	CanUserAccessDevice(ctx context.Context, userID int, deviceID int) (bool, error)
}

type AccessService struct {
	repo AccessRepository
}

func NewAccessService(repo AccessRepository) *AccessService {
	return &AccessService{repo: repo}
}

func (s *AccessService) CanAccessDevice(ctx context.Context, identity *domainauth.Identity, deviceID int) (bool, error) {
	if identity == nil {
		return false, nil
	}
	if identity.IsAdministrator {
		return true, nil
	}
	return s.repo.CanUserAccessDevice(ctx, identity.UserID, deviceID)
}

func (s *AccessService) FilterDevices(ctx context.Context, identity *domainauth.Identity, devices []domaindevice.Device) ([]domaindevice.Device, error) {
	if identity == nil {
		return []domaindevice.Device{}, nil
	}
	if identity.IsAdministrator {
		return devices, nil
	}

	allowedIDs, err := s.repo.ListAccessibleDeviceIDs(ctx, identity.UserID)
	if err != nil {
		return nil, err
	}

	allowed := make(map[int]struct{}, len(allowedIDs))
	for _, id := range allowedIDs {
		allowed[id] = struct{}{}
	}

	filtered := make([]domaindevice.Device, 0, len(devices))
	for _, device := range devices {
		if _, ok := allowed[device.ID]; ok {
			filtered = append(filtered, device)
		}
	}
	return filtered, nil
}
