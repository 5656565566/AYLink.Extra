package device

import (
	"context"
	"errors"
	"testing"
	"time"

	domainadb "aylink-agent/internal/domain/adb"
	domaindevice "aylink-agent/internal/domain/device"
)

type fakeRepository struct {
	listResult   []domaindevice.Device
	listErr      error
	getByID      *domaindevice.Device
	getByIDErr   error
	updateErr    error
	updateCalled bool
}

func (f *fakeRepository) List(context.Context) ([]domaindevice.Device, error) {
	return f.listResult, f.listErr
}

func (f *fakeRepository) GetByID(context.Context, int) (*domaindevice.Device, error) {
	return f.getByID, f.getByIDErr
}

func (f *fakeRepository) FindBySerialOrAddress(context.Context, string, *string, *int) (*domaindevice.Device, error) {
	return nil, nil
}

func (f *fakeRepository) Insert(context.Context, *domaindevice.Device) error { return nil }

func (f *fakeRepository) Update(context.Context, *domaindevice.Device) error {
	f.updateCalled = true
	return f.updateErr
}

func (f *fakeRepository) Delete(context.Context, int) error { return nil }

type fakeADBManager struct {
	devices           []domainadb.Device
	devicesErr        error
	connectErr        error
	connectCalled     bool
	deviceDisplayName string
}

func (f *fakeADBManager) Devices(context.Context) ([]domainadb.Device, error) {
	return f.devices, f.devicesErr
}

func (f *fakeADBManager) PairDevice(context.Context, string, int, string) (string, error) {
	return "", nil
}

func (f *fakeADBManager) ConnectDevice(context.Context, string, int) error {
	f.connectCalled = true
	return f.connectErr
}

func (f *fakeADBManager) DeviceDisplayName(context.Context, string) (string, error) {
	if f.deviceDisplayName == "" {
		return "", errors.New("no display name")
	}
	return f.deviceDisplayName, nil
}

func TestParseSerialAddress(t *testing.T) {
	tests := []struct {
		name     string
		serial   string
		wantHost string
		wantPort int
		expectOK bool
	}{
		{name: "tcp serial", serial: "192.168.0.10:5555", wantHost: "192.168.0.10", wantPort: 5555, expectOK: true},
		{name: "trim host", serial: " 192.168.0.10 :5555", wantHost: "192.168.0.10", wantPort: 5555, expectOK: true},
		{name: "usb serial", serial: "emulator-5554", expectOK: false},
		{name: "invalid port", serial: "192.168.0.10:not-a-port", expectOK: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			host, port := parseSerialAddress(test.serial)
			if !test.expectOK {
				if host != nil || port != nil {
					t.Fatalf("expected parse failure, got host=%v port=%v", host, port)
				}
				return
			}
			if host == nil || port == nil {
				t.Fatalf("expected parse success")
			}
			if *host != test.wantHost || *port != test.wantPort {
				t.Fatalf("expected %s:%d, got %s:%d", test.wantHost, test.wantPort, *host, *port)
			}
		})
	}
}

func TestIsDefaultLikeDeviceName(t *testing.T) {
	tests := []struct {
		name     string
		current  string
		baseName string
		fallback string
		want     bool
	}{
		{name: "empty name", current: "", baseName: "Pixel", fallback: "serial", want: true},
		{name: "exact base name", current: "Pixel", baseName: "Pixel", fallback: "serial", want: true},
		{name: "generated suffix", current: "Pixel - 0420", baseName: "Pixel", fallback: "serial", want: true},
		{name: "custom name", current: "My Phone", baseName: "Pixel", fallback: "serial", want: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if actual := isDefaultLikeDeviceName(test.current, test.baseName, test.fallback); actual != test.want {
				t.Fatalf("expected %v, got %v", test.want, actual)
			}
		})
	}
}

func TestBuildDefaultDeviceNameIsStable(t *testing.T) {
	first := buildDefaultDeviceName("Pixel", "serial-1", "fallback")
	second := buildDefaultDeviceName("Pixel", "serial-1", "fallback")
	if first != second {
		t.Fatalf("expected deterministic default device name, got %q and %q", first, second)
	}
}

func TestResolveSerialForAccessReturnsUpdateErrorWhenStatusPersistFails(t *testing.T) {
	now := time.Now().UTC().Add(-time.Minute)
	repo := &fakeRepository{
		getByID: &domaindevice.Device{
			ID:        1,
			Name:      "Pixel",
			Serial:    "serial-1",
			Status:    "offline",
			LastSeen:  now,
			CreatedAt: now,
			UpdatedAt: now,
		},
		updateErr: errors.New("update failed"),
	}
	adb := &fakeADBManager{
		devices: []domainadb.Device{{Serial: "serial-1", State: "device"}},
	}
	service := NewService(repo)
	service.SetADBManager(adb)

	_, err := service.ResolveSerialForAccess(context.Background(), 1)
	if err == nil || err.Error() != "update failed" {
		t.Fatalf("expected update error, got %v", err)
	}
}

func TestCreateReturnsADBConnectError(t *testing.T) {
	repo := &fakeRepository{}
	adb := &fakeADBManager{connectErr: errors.New("connect failed")}
	service := NewService(repo)
	service.SetADBManager(adb)

	_, err := service.Create(context.Background(), CreateInput{Serial: "192.168.0.10:5555"})
	if err == nil || err.Error() != "adb connection failed: connect failed" {
		t.Fatalf("expected adb connect error, got %v", err)
	}
	if !adb.connectCalled {
		t.Fatal("expected ConnectDevice to be called")
	}
}

func TestListReturnsRepositoryUpdateErrorWhenOnlineStatePersistFails(t *testing.T) {
	now := time.Now().UTC().Add(-time.Minute)
	repo := &fakeRepository{
		listResult: []domaindevice.Device{{
			ID:        1,
			Name:      "Pixel",
			Serial:    "serial-1",
			Status:    "offline",
			LastSeen:  now,
			CreatedAt: now,
			UpdatedAt: now,
		}},
		updateErr: errors.New("update failed"),
	}
	adb := &fakeADBManager{
		devices: []domainadb.Device{{Serial: "serial-1", State: "device"}},
	}
	service := NewService(repo)
	service.SetADBManager(adb)

	_, err := service.List(context.Background())
	if err == nil || err.Error() != "update failed" {
		t.Fatalf("expected update error, got %v", err)
	}
}
