package devicegroup

import (
	"context"
	"testing"

	domaindevice "aylink-agent/internal/domain/device"
)

type fakeRepository struct {
	groupByID   *domaindevice.Group
	groupByName *domaindevice.Group
}

func (f *fakeRepository) List(context.Context) ([]domaindevice.Group, error) {
	return nil, nil
}

func (f *fakeRepository) ListOptions(context.Context, string) ([]domaindevice.GroupSummary, error) {
	return nil, nil
}

func (f *fakeRepository) ListOptionsForUser(context.Context, int, string) ([]domaindevice.GroupSummary, error) {
	return nil, nil
}

func (f *fakeRepository) GetByID(context.Context, int) (*domaindevice.Group, error) {
	return f.groupByID, nil
}

func (f *fakeRepository) GetByName(context.Context, string) (*domaindevice.Group, error) {
	return f.groupByName, nil
}

func (f *fakeRepository) Create(context.Context, string, string) (*domaindevice.Group, error) {
	return nil, nil
}

func (f *fakeRepository) Update(context.Context, int, string, string) (*domaindevice.Group, error) {
	return &domaindevice.Group{}, nil
}

func (f *fakeRepository) Delete(context.Context, int) error {
	return nil
}

func (f *fakeRepository) GetGroupsForDevice(context.Context, int) ([]domaindevice.GroupSummary, error) {
	return nil, nil
}

func (f *fakeRepository) GetGroupsForDevices(context.Context, []int) (map[int][]domaindevice.GroupSummary, error) {
	return nil, nil
}

func (f *fakeRepository) SetGroupsForDevice(context.Context, int, []int) error {
	return nil
}

func TestUpdateRejectsInternalGroup(t *testing.T) {
	service := NewService(&fakeRepository{
		groupByID: &domaindevice.Group{ID: 1, Name: "所有设备", IsInternal: true},
	})

	_, err := service.Update(context.Background(), 1, "改名", "desc")
	if err != ErrGroupInternal {
		t.Fatalf("expected ErrGroupInternal, got %v", err)
	}
}

func TestDeleteRejectsInternalGroup(t *testing.T) {
	service := NewService(&fakeRepository{
		groupByID: &domaindevice.Group{ID: 1, Name: "所有设备", IsInternal: true},
	})

	err := service.Delete(context.Background(), 1)
	if err != ErrGroupInternal {
		t.Fatalf("expected ErrGroupInternal, got %v", err)
	}
}
