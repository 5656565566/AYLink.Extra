package device

import (
	"context"
	"errors"
	"fmt"
	"hash/fnv"
	"strconv"
	"strings"
	"sync"
	"time"

	domainadb "aylink-agent/internal/domain/adb"
	domaindevice "aylink-agent/internal/domain/device"
	"aylink-agent/internal/infra/logging"
)

var (
	ErrDeviceNotFound      = errors.New("device not found")
	ErrDeviceNameEmpty     = errors.New("device name is required")
	ErrDeviceSerialEmpty   = errors.New("device serial is required")
	ErrDevicePayloadEmpty  = errors.New("device payload is invalid")
	ErrDeviceInvalidIPPort = errors.New("device does not have a valid IP and Port for network connection")
	ErrDeviceOffline       = errors.New("device offline")
	ErrDeviceMustBeOnline  = errors.New("device must be online before it can be added")
)

const autoReconnectInterval = 10 * time.Second

type Repository interface {
	List(ctx context.Context) ([]domaindevice.Device, error)
	GetByID(ctx context.Context, id int) (*domaindevice.Device, error)
	FindBySerialOrAddress(ctx context.Context, serial string, ip *string, port *int) (*domaindevice.Device, error)
	Insert(ctx context.Context, device *domaindevice.Device) error
	Update(ctx context.Context, device *domaindevice.Device) error
	Delete(ctx context.Context, id int) error
}

type ADBManager interface {
	Devices(ctx context.Context) ([]domainadb.Device, error)
	PairDevice(ctx context.Context, host string, port int, code string) (string, error)
	ConnectDevice(ctx context.Context, host string, port int) error
	DeviceDisplayName(ctx context.Context, serial string) (string, error)
}

type Service struct {
	repo            Repository
	adb             ADBManager
	logger          logging.Logger
	reconnectMu     sync.Mutex
	reconnectQueue  chan reconnectRequest
	reconnectingIDs map[int]struct{}
	reconnectOnce   sync.Once
}

type noopLogger struct{}

func (noopLogger) Debug(string, ...any) {}
func (noopLogger) Info(string, ...any)  {}
func (noopLogger) Warn(string, ...any)  {}
func (noopLogger) Error(string, ...any) {}

type reconnectRequest struct {
	Context context.Context
	ID      int
	Host    string
	Port    int
}

type CreateInput struct {
	Serial      string `json:"Serial"`
	Name        string `json:"Name"`
	PairingPort int    `json:"PairingPort"`
	PairingCode string `json:"PairingCode"`
}

func NewService(repo Repository) *Service {
	return &Service{
		repo:            repo,
		logger:          noopLogger{},
		reconnectQueue:  make(chan reconnectRequest, 64),
		reconnectingIDs: make(map[int]struct{}),
	}
}

func (s *Service) SetLogger(logger logging.Logger) {
	if logger == nil {
		s.logger = noopLogger{}
		return
	}
	s.logger = logger
}

func (s *Service) SetADBManager(adb ADBManager) {
	s.adb = adb
	if adb != nil {
		s.reconnectOnce.Do(func() {
			go s.reconnectWorker()
		})
	}
}

func (s *Service) List(ctx context.Context) ([]domaindevice.Device, error) {
	devices, err := s.repo.List(ctx)
	if err != nil {
		return nil, err
	}
	if s.adb == nil {
		return devices, nil
	}

	adbDevices, err := s.adb.Devices(ctx)
	if err != nil {
		return devices, nil
	}

	onlineSerials := make(map[string]struct{}, len(adbDevices))
	for _, adbDevice := range adbDevices {
		if isADBDeviceUsable(adbDevice.State) {
			onlineSerials[strings.TrimSpace(adbDevice.Serial)] = struct{}{}
		}
	}

	now := time.Now().UTC()
	for i := range devices {
		device := &devices[i]
		if s.syncDeviceStatusFromOnlineSerials(ctx, device, onlineSerials, now) {
			if err := s.repo.Update(ctx, device); err != nil {
				return nil, err
			}
			continue
		}

		if s.shouldAutoReconnect(device, now) {
			device.Status = "offline"
			device.UpdatedAt = now
			if err := s.repo.Update(ctx, device); err != nil {
				return nil, err
			}
			s.enqueueAutoReconnect(ctx, *device)
			continue
		}

		if !strings.EqualFold(device.Status, "offline") {
			device.Status = "offline"
			device.UpdatedAt = now
			if err := s.repo.Update(ctx, device); err != nil {
				return nil, err
			}
		}
	}

	return devices, nil
}

func (s *Service) GetByID(ctx context.Context, id int) (*domaindevice.Device, error) {
	device, err := s.repo.GetByID(ctx, id)
	if err != nil || device == nil {
		return device, err
	}
	if s.adb == nil {
		return device, nil
	}

	now := time.Now().UTC()
	if s.syncDeviceADBStatus(ctx, device, now) {
		if err := s.repo.Update(ctx, device); err != nil {
			return nil, err
		}
	}
	return device, nil
}

func (s *Service) syncDeviceADBStatus(ctx context.Context, device *domaindevice.Device, now time.Time) bool {
	if s.adb == nil || device == nil {
		return false
	}

	adbDevices, err := s.adb.Devices(ctx)
	if err != nil {
		return false
	}

	onlineSerials := make(map[string]struct{}, len(adbDevices))
	for _, adbDevice := range adbDevices {
		if isADBDeviceUsable(adbDevice.State) {
			onlineSerials[strings.TrimSpace(adbDevice.Serial)] = struct{}{}
		}
	}

	return s.syncDeviceStatusFromOnlineSerials(ctx, device, onlineSerials, now)
}

func (s *Service) syncDeviceStatusFromOnlineSerials(ctx context.Context, device *domaindevice.Device, onlineSerials map[string]struct{}, now time.Time) bool {
	serial := strings.TrimSpace(device.Serial)
	if _, ok := onlineSerials[serial]; !ok {
		return false
	}

	changed := false
	previousName := device.Name
	s.refreshDefaultLikeName(ctx, device, serial)
	if !strings.EqualFold(device.Status, "online") {
		device.Status = "online"
		device.LastSeen = now
		changed = true
	}
	if device.Name != previousName {
		changed = true
	}
	if changed {
		device.UpdatedAt = now
	}
	return changed
}

func (s *Service) ResolveSerialForAccess(ctx context.Context, id int) (string, error) {
	device, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return "", err
	}
	if device == nil {
		return "", ErrDeviceNotFound
	}

	serial := strings.TrimSpace(device.Serial)
	if serial == "" {
		return "", ErrDeviceSerialEmpty
	}
	if s.adb == nil {
		return serial, nil
	}

	if s.isADBDeviceOnline(ctx, serial) {
		if !strings.EqualFold(device.Status, "online") {
			now := time.Now().UTC()
			device.Status = "online"
			device.LastSeen = now
			device.UpdatedAt = now
			if err := s.repo.Update(ctx, device); err != nil {
				return "", err
			}
		}
		return serial, nil
	}

	now := time.Now().UTC()
	reconnected, err := s.tryAutoReconnect(ctx, device, now)
	if err != nil {
		return "", err
	}
	if reconnected {
		return serial, nil
	}

	if !strings.EqualFold(device.Status, "offline") {
		device.Status = "offline"
		device.UpdatedAt = now
		if err := s.repo.Update(ctx, device); err != nil {
			return "", err
		}
	}
	return "", ErrDeviceOffline
}

func (s *Service) Create(ctx context.Context, input CreateInput) (*domaindevice.Device, error) {
	serial := strings.TrimSpace(input.Serial)
	customName := strings.TrimSpace(input.Name)
	if serial == "" {
		return nil, ErrDeviceSerialEmpty
	}
	if s.adb == nil {
		return nil, ErrDeviceMustBeOnline
	}

	ip, port := parseSerialAddress(serial)
	if ip != nil && port != nil {
		host := strings.TrimSpace(*ip)
		if host != "" && input.PairingPort > 0 && strings.TrimSpace(input.PairingCode) != "" {
			if _, err := s.adb.PairDevice(ctx, host, input.PairingPort, strings.TrimSpace(input.PairingCode)); err != nil {
				return nil, err
			}
		}

		if err := s.adb.ConnectDevice(ctx, host, *port); err != nil {
			return nil, fmt.Errorf("adb connection failed: %w", err)
		}
	}

	if !s.isADBDeviceOnline(ctx, serial) {
		return nil, ErrDeviceMustBeOnline
	}

	existing, err := s.repo.FindBySerialOrAddress(ctx, serial, ip, port)
	if err != nil {
		return nil, err
	}

	now := time.Now().UTC()
	if existing != nil {
		existing.Serial = serial
		existing.IPAddress = ip
		existing.Port = port
		existing.Status = "online"
		existing.LastSeen = now
		existing.UpdatedAt = now
		if customName != "" {
			existing.Name = customName
		} else if isDefaultLikeDeviceName(existing.Name, existing.Serial, serial) {
			existing.Name = defaultDeviceName(serial)
		}
		if customName == "" {
			s.refreshDefaultLikeName(ctx, existing, serial)
		}
		if err := s.repo.Update(ctx, existing); err != nil {
			return nil, err
		}
		return existing, nil
	}

	device := &domaindevice.Device{
		Name:      defaultDeviceName(serial),
		Serial:    serial,
		IPAddress: ip,
		Port:      port,
		Status:    "online",
		LastSeen:  now,
		CreatedAt: now,
		UpdatedAt: now,
	}
	if customName != "" {
		device.Name = customName
	} else {
		s.refreshDefaultLikeName(ctx, device, serial)
	}
	if err := s.repo.Insert(ctx, device); err != nil {
		return nil, err
	}
	return device, nil
}

func (s *Service) Rename(ctx context.Context, id int, name string) (*domaindevice.Device, error) {
	trimmedName := strings.TrimSpace(name)
	if trimmedName == "" {
		return nil, ErrDeviceNameEmpty
	}

	device, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if device == nil {
		return nil, ErrDeviceNotFound
	}

	device.Name = trimmedName
	device.UpdatedAt = time.Now().UTC()
	if err := s.repo.Update(ctx, device); err != nil {
		return nil, err
	}

	return device, nil
}

func (s *Service) Delete(ctx context.Context, id int) error {
	device, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return err
	}
	if device == nil {
		return ErrDeviceNotFound
	}
	return s.repo.Delete(ctx, id)
}

func (s *Service) Connect(ctx context.Context, id int) (*domaindevice.Device, error) {
	device, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if device == nil {
		return nil, ErrDeviceNotFound
	}
	if device.IPAddress == nil || *device.IPAddress == "" || device.Port == nil {
		return nil, ErrDeviceInvalidIPPort
	}
	if s.adb == nil {
		return nil, errors.New("adb manager is not injected")
	}

	err = s.adb.ConnectDevice(ctx, *device.IPAddress, *device.Port)
	if err != nil {
		return nil, fmt.Errorf("adb connection failed: %w", err)
	}

	device.Status = "online"
	device.LastSeen = time.Now().UTC()
	device.UpdatedAt = time.Now().UTC()
	s.refreshDefaultLikeName(ctx, device, device.Serial)
	if err := s.repo.Update(ctx, device); err != nil {
		return nil, err
	}

	return device, nil
}

func parseSerialAddress(serial string) (*string, *int) {
	host, port, found := strings.Cut(serial, ":")
	if !found || host == "" || port == "" {
		return nil, nil
	}
	var portValue int
	if _, err := fmt.Sscanf(port, "%d", &portValue); err != nil {
		return nil, nil
	}
	host = strings.TrimSpace(host)
	return &host, &portValue
}

func defaultDeviceName(serial string) string {
	base := serial
	if host, _, found := strings.Cut(strings.TrimSpace(serial), ":"); found && host != "" {
		base = host
	}
	return buildDefaultDeviceName(base, serial, base)
}

func buildDefaultDeviceName(baseName, serial, fallback string) string {
	resolvedBaseName := firstNonEmptyTrimmed(baseName, fallback, "Unknown")
	hashSource := firstNonEmptyTrimmed(serial, fallback, resolvedBaseName)

	hasher := fnv.New32a()
	_, _ = hasher.Write([]byte(hashSource))
	suffix := hasher.Sum32() % 10000
	return fmt.Sprintf("%s - %04d", resolvedBaseName, suffix)
}

func isDefaultLikeDeviceName(currentName, baseName, fallback string) bool {
	trimmedCurrent := strings.TrimSpace(currentName)
	if trimmedCurrent == "" {
		return true
	}

	candidates := []string{
		strings.TrimSpace(baseName),
		strings.TrimSpace(fallback),
	}

	for _, candidate := range candidates {
		if candidate == "" {
			continue
		}

		if strings.EqualFold(trimmedCurrent, candidate) {
			return true
		}

		if strings.HasPrefix(strings.ToLower(trimmedCurrent), strings.ToLower(candidate+" - ")) && len(trimmedCurrent) == len(candidate)+7 {
			suffix := trimmedCurrent[len(candidate)+3:]
			if _, err := strconv.Atoi(suffix); err == nil {
				return true
			}
		}
	}

	return false
}

func firstNonEmptyTrimmed(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func (s *Service) shouldAutoReconnect(device *domaindevice.Device, now time.Time) bool {
	if device == nil || device.IPAddress == nil || device.Port == nil {
		return false
	}
	if strings.TrimSpace(*device.IPAddress) == "" || *device.Port <= 0 {
		return false
	}
	return now.Sub(device.UpdatedAt) >= autoReconnectInterval
}

func (s *Service) tryAutoReconnect(ctx context.Context, device *domaindevice.Device, now time.Time) (bool, error) {
	if s.adb == nil || !s.shouldAutoReconnect(device, now) {
		return false, nil
	}

	reconnectCtx, cancel := context.WithTimeout(ctx, 1500*time.Millisecond)
	err := s.adb.ConnectDevice(reconnectCtx, *device.IPAddress, *device.Port)
	cancel()
	if err != nil {
		return false, nil
	}

	device.Status = "online"
	device.LastSeen = now
	device.UpdatedAt = now
	if err := s.repo.Update(ctx, device); err != nil {
		return false, err
	}
	return true, nil
}

func (s *Service) enqueueAutoReconnect(ctx context.Context, device domaindevice.Device) {
	if s.adb == nil || device.IPAddress == nil || device.Port == nil {
		return
	}

	host := strings.TrimSpace(*device.IPAddress)
	if host == "" || *device.Port <= 0 {
		return
	}

	s.reconnectMu.Lock()
	if _, exists := s.reconnectingIDs[device.ID]; exists {
		s.reconnectMu.Unlock()
		return
	}
	s.reconnectingIDs[device.ID] = struct{}{}
	s.reconnectMu.Unlock()

	request := reconnectRequest{
		Context: ctx,
		ID:      device.ID,
		Host:    host,
		Port:    *device.Port,
	}

	select {
	case s.reconnectQueue <- request:
	default:
		s.finishReconnect(device.ID)
	}
}

func (s *Service) reconnectWorker() {
	for request := range s.reconnectQueue {
		s.processReconnect(request)
	}
}

func (s *Service) processReconnect(request reconnectRequest) {
	defer s.finishReconnect(request.ID)

	if s.adb == nil {
		return
	}

	baseCtx := request.Context
	if baseCtx == nil {
		baseCtx = context.TODO()
	}
	baseCtx = context.WithoutCancel(baseCtx)

	ctx, cancel := context.WithTimeout(baseCtx, 1500*time.Millisecond)
	err := s.adb.ConnectDevice(ctx, request.Host, request.Port)
	cancel()
	if err != nil {
		return
	}

	device, err := s.repo.GetByID(baseCtx, request.ID)
	if err != nil || device == nil {
		return
	}

	now := time.Now().UTC()
	device.Status = "online"
	device.LastSeen = now
	device.UpdatedAt = now
	s.refreshDefaultLikeName(baseCtx, device, device.Serial)
	if err := s.repo.Update(baseCtx, device); err != nil {
		s.logger.Warn("background reconnect persisted device state failed", "deviceID", request.ID, "serial", device.Serial, "err", err)
	}
}

func (s *Service) finishReconnect(deviceID int) {
	s.reconnectMu.Lock()
	delete(s.reconnectingIDs, deviceID)
	s.reconnectMu.Unlock()
}

func (s *Service) isADBDeviceOnline(ctx context.Context, serial string) bool {
	if s.adb == nil {
		return false
	}

	devices, err := s.adb.Devices(ctx)
	if err != nil {
		return false
	}

	for _, adbDevice := range devices {
		if strings.EqualFold(strings.TrimSpace(adbDevice.Serial), serial) &&
			isADBDeviceUsable(adbDevice.State) {
			return true
		}
	}
	return false
}

func isADBDeviceUsable(state string) bool {
	switch strings.ToLower(strings.TrimSpace(state)) {
	case "device", "online":
		return true
	default:
		return false
	}
}

func (s *Service) refreshDefaultLikeName(ctx context.Context, device *domaindevice.Device, serial string) {
	if s.adb == nil || device == nil {
		return
	}
	if !isDefaultLikeDeviceName(device.Name, device.Serial, serial) {
		return
	}

	displayName, err := s.adb.DeviceDisplayName(ctx, serial)
	if err != nil {
		return
	}

	device.Name = buildDefaultDeviceName(displayName, serial, serial)
}
