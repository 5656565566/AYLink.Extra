package devicegroup

import (
	"context"
	"errors"
	"strings"

	domaindevice "aylink-agent/internal/domain/device"
)

var (
	ErrGroupNameRequired = errors.New("group name is required")
	ErrGroupExists       = errors.New("group already exists")
	ErrGroupNotFound     = errors.New("group not found")
)

type Repository interface {
	List(ctx context.Context) ([]domaindevice.Group, error)
	ListOptions(ctx context.Context, keyword string) ([]domaindevice.GroupSummary, error)
	GetByID(ctx context.Context, id int) (*domaindevice.Group, error)
	GetByName(ctx context.Context, name string) (*domaindevice.Group, error)
	Create(ctx context.Context, name string, description string) (*domaindevice.Group, error)
	Update(ctx context.Context, id int, name string, description string) (*domaindevice.Group, error)
	Delete(ctx context.Context, id int) error
	GetGroupsForDevice(ctx context.Context, deviceID int) ([]domaindevice.GroupSummary, error)
	GetGroupsForDevices(ctx context.Context, deviceIDs []int) (map[int][]domaindevice.GroupSummary, error)
	SetGroupsForDevice(ctx context.Context, deviceID int, groupIDs []int) error
}

type Service struct {
	repo Repository
}

func NewService(repo Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) List(ctx context.Context) ([]domaindevice.Group, error) {
	return s.repo.List(ctx)
}

func (s *Service) ListOptions(ctx context.Context, keyword string) ([]domaindevice.GroupSummary, error) {
	return s.repo.ListOptions(ctx, keyword)
}

func (s *Service) GetByID(ctx context.Context, id int) (*domaindevice.Group, error) {
	return s.repo.GetByID(ctx, id)
}

func (s *Service) Create(ctx context.Context, name, description string) (*domaindevice.Group, error) {
	trimmedName := strings.TrimSpace(name)
	if trimmedName == "" {
		return nil, ErrGroupNameRequired
	}
	existing, err := s.repo.GetByName(ctx, trimmedName)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return nil, ErrGroupExists
	}
	return s.repo.Create(ctx, trimmedName, strings.TrimSpace(description))
}

func (s *Service) Update(ctx context.Context, id int, name, description string) (*domaindevice.Group, error) {
	trimmedName := strings.TrimSpace(name)
	if trimmedName == "" {
		return nil, ErrGroupNameRequired
	}
	existing, err := s.repo.GetByName(ctx, trimmedName)
	if err != nil {
		return nil, err
	}
	if existing != nil && existing.ID != id {
		return nil, ErrGroupExists
	}
	current, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if current == nil {
		return nil, ErrGroupNotFound
	}
	return s.repo.Update(ctx, id, trimmedName, strings.TrimSpace(description))
}

func (s *Service) Delete(ctx context.Context, id int) error {
	current, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return err
	}
	if current == nil {
		return ErrGroupNotFound
	}
	return s.repo.Delete(ctx, id)
}

func (s *Service) GetGroupsForDevice(ctx context.Context, deviceID int) ([]domaindevice.GroupSummary, error) {
	return s.repo.GetGroupsForDevice(ctx, deviceID)
}

func (s *Service) GetGroupsForDevices(ctx context.Context, deviceIDs []int) (map[int][]domaindevice.GroupSummary, error) {
	return s.repo.GetGroupsForDevices(ctx, deviceIDs)
}

func (s *Service) SetGroupsForDevice(ctx context.Context, deviceID int, groupIDs []int) error {
	return s.repo.SetGroupsForDevice(ctx, deviceID, groupIDs)
}
