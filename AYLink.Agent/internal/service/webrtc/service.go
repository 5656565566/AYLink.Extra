package webrtc

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"sync"
	"time"

	domainwebrtc "aylink-agent/internal/domain/webrtc"
	"aylink-agent/internal/infra/logging"

	"github.com/pion/ice/v4"
)

var (
	ErrDeviceIDRequired = errors.New("device id required")
	ErrSessionIDRequired = errors.New("session id required")
	ErrTicketNotFound   = errors.New("ticket not found")
)

type Service struct {
	logger        logging.Logger
	debugWebRTC   bool
	mu            sync.Mutex
	tickets       map[string]domainwebrtc.Ticket
	sessionLeases map[string]domainwebrtc.SessionLease
	udpMuxes      map[int]ice.UDPMux
	ticketTTL     time.Duration
	leaseTTL      time.Duration
	now           func() time.Time
}

type CreateTicketInput struct {
	DeviceID   string `json:"deviceId"`
	AppPackage string `json:"appPackage"`
	AppName    string `json:"appName"`
	NewDisplay bool   `json:"newDisplay"`
}

type CreateTicketResult struct {
	Ticket           string `json:"ticket"`
	SessionID        string `json:"sessionId"`
	ExpiresInSeconds int    `json:"expiresInSeconds"`
}

func NewService(logger logging.Logger) *Service {
	return &Service{
		logger:        logger,
		debugWebRTC:   logging.FeatureEnabled("WEBRTC"),
		tickets:       make(map[string]domainwebrtc.Ticket),
		sessionLeases: make(map[string]domainwebrtc.SessionLease),
		udpMuxes:      make(map[int]ice.UDPMux),
		ticketTTL:     60 * time.Second,
		leaseTTL:      45 * time.Second,
		now:           func() time.Time { return time.Now().UTC() },
	}
}

func (s *Service) CreateTicket(_ context.Context, input CreateTicketInput) (CreateTicketResult, error) {
	if input.DeviceID == "" {
		return CreateTicketResult{}, ErrDeviceIDRequired
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	s.cleanupLocked()
	value, err := randomHex(16)
	if err != nil {
		return CreateTicketResult{}, err
	}

	ticket := domainwebrtc.Ticket{
		Value:      value,
		SessionID:  value,
		DeviceID:   input.DeviceID,
		AppPackage: input.AppPackage,
		AppName:    input.AppName,
		NewDisplay: input.NewDisplay,
		ExpiresAt:  s.now().Add(s.ticketTTL),
	}
	s.tickets[value] = ticket

	return CreateTicketResult{
		Ticket:           value,
		SessionID:        value,
		ExpiresInSeconds: int(s.ticketTTL.Seconds()),
	}, nil
}

func (s *Service) ConsumeTicket(_ context.Context, value string) (domainwebrtc.Ticket, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.cleanupLocked()
	ticket, ok := s.tickets[value]
	if !ok {
		return domainwebrtc.Ticket{}, ErrTicketNotFound
	}
	delete(s.tickets, value)
	return ticket, nil
}

func (s *Service) TouchSession(_ context.Context, deviceID string, sessionID string) (bool, error) {
	if deviceID == "" {
		return false, ErrDeviceIDRequired
	}
	if sessionID == "" {
		return false, ErrSessionIDRequired
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	s.cleanupLocked()
	now := s.now()
	lease, ok := s.sessionLeases[sessionID]
	if !ok || lease.DeviceID != deviceID {
		return false, nil
	}
	lease.UpdatedAt = now
	lease.ExpiresAt = now.Add(s.leaseTTL)
	s.sessionLeases[sessionID] = lease
	return true, nil
}

func (s *Service) ReleaseSession(_ context.Context, deviceID string, sessionID string) error {
	if deviceID == "" {
		return ErrDeviceIDRequired
	}
	if sessionID == "" {
		return ErrSessionIDRequired
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	lease, ok := s.sessionLeases[sessionID]
	if ok && lease.DeviceID == deviceID {
		delete(s.sessionLeases, sessionID)
	}
	return nil
}

func (s *Service) MarkSessionStarted(deviceID string, sessionID string) {
	if deviceID == "" || sessionID == "" {
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	s.sessionLeases[sessionID] = domainwebrtc.SessionLease{
		SessionID: sessionID,
		DeviceID:  deviceID,
		UpdatedAt: now,
		ExpiresAt: now.Add(s.leaseTTL),
	}
}

func (s *Service) HasActiveSessionLease(deviceID string) bool {
	if deviceID == "" {
		return false
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	s.cleanupLocked()
	for _, lease := range s.sessionLeases {
		if lease.DeviceID == deviceID && lease.ExpiresAt.After(s.now()) {
			return true
		}
	}
	return false
}

func (s *Service) cleanupLocked() {
	now := s.now()
	for key, ticket := range s.tickets {
		if !ticket.ExpiresAt.After(now) {
			delete(s.tickets, key)
		}
	}
	for key, lease := range s.sessionLeases {
		if !lease.ExpiresAt.After(now) {
			delete(s.sessionLeases, key)
		}
	}
}

func randomHex(bytesLen int) (string, error) {
	buffer := make([]byte, bytesLen)
	if _, err := rand.Read(buffer); err != nil {
		return "", err
	}
	return hex.EncodeToString(buffer), nil
}
