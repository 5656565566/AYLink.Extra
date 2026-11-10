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
	ErrDeviceIDRequired  = errors.New("device id required")
	ErrSessionIDRequired = errors.New("session id required")
	ErrSessionNotFound   = errors.New("session not found")
	ErrTicketNotFound    = errors.New("ticket not found")
)

type Service struct {
	logger        logging.Logger
	debugWebRTC   bool
	mu            sync.Mutex
	tickets       map[string]domainwebrtc.Ticket
	sessionLeases map[string]domainwebrtc.SessionLease
	controlLeases map[string]controlLease
	signaling     map[string]*signalingSession
	udpMuxes      map[int]ice.UDPMux
	ticketTTL     time.Duration
	now           func() time.Time
	webPages      map[string]*webPage
	registrations map[int]registrationWindow
}

type controlLease struct {
	DeviceID  string
	SessionID string
	ExpiresAt time.Time
}

const controlLeaseTTL = 1500 * time.Millisecond

type CreateTicketInput struct {
	PageID            string `json:"pageId,omitempty"`
	UserID            int    `json:"-"`
	LoginSessionID    string `json:"-"`
	DeviceID          string `json:"deviceId"`
	SessionID         string `json:"sessionId"`
	AppPackage        string `json:"appPackage"`
	AppName           string `json:"appName"`
	NewDisplay        bool   `json:"newDisplay"`
	NewPeerConnection bool   `json:"newPeerConnection"`
	NewDisplayWidth   *int   `json:"newDisplayWidth"`
	NewDisplayHeight  *int   `json:"newDisplayHeight"`
	NewDisplayDPI     *int   `json:"newDisplayDpi"`
}

type CreateTicketResult struct {
	Slot             *int   `json:"slot,omitempty"`
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
		controlLeases: make(map[string]controlLease),
		signaling:     make(map[string]*signalingSession),
		udpMuxes:      make(map[int]ice.UDPMux),
		ticketTTL:     60 * time.Second,
		webPages:      make(map[string]*webPage),
		registrations: make(map[int]registrationWindow),
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

	sessionID := value
	if input.SessionID != "" {
		lease, ok := s.sessionLeases[input.SessionID]
		if !ok || lease.DeviceID != input.DeviceID || !lease.ExpiresAt.After(s.now()) {
			return CreateTicketResult{}, ErrSessionNotFound
		}
		if lease.UserID != input.UserID || lease.LoginSessionID != input.LoginSessionID || lease.WebPageID != input.PageID {
			return CreateTicketResult{}, ErrSessionNotFound
		}
		sessionID = input.SessionID
	}
	slot, err := s.reserveSessionLocked(input, sessionID)
	if err != nil {
		return CreateTicketResult{}, err
	}

	ticket := domainwebrtc.Ticket{
		UserID:            input.UserID,
		LoginSessionID:    input.LoginSessionID,
		WebPageID:         input.PageID,
		Value:             value,
		SessionID:         sessionID,
		DeviceID:          input.DeviceID,
		AppPackage:        input.AppPackage,
		AppName:           input.AppName,
		NewDisplay:        input.NewDisplay,
		NewPeerConnection: input.NewPeerConnection,
		NewDisplayWidth:   normalizeNewDisplayDimension(input.NewDisplayWidth),
		NewDisplayHeight:  normalizeNewDisplayDimension(input.NewDisplayHeight),
		NewDisplayDPI:     normalizeNewDisplayDPI(input.NewDisplayDPI),
		ExpiresAt:         s.now().Add(s.ticketTTL),
	}
	s.tickets[value] = ticket

	return CreateTicketResult{
		Slot:             slot,
		Ticket:           value,
		SessionID:        sessionID,
		ExpiresInSeconds: int(s.ticketTTL.Seconds()),
	}, nil
}

// ReplaceSignalingSession 关闭原有信令会话及服务端 PeerConnection
// 供浏览器为已有的 scrcpy 会话租约重新发起连接
func (s *Service) ReplaceSignalingSession(sessionID string) {
	if sessionID == "" {
		return
	}

	s.mu.Lock()
	session := s.signaling[sessionID]
	delete(s.signaling, sessionID)
	s.mu.Unlock()
	closeSignalingSession(session)
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

func (s *Service) HasSessionLease(deviceID string, sessionID string) bool {
	if deviceID == "" || sessionID == "" {
		return false
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	s.cleanupLocked()
	lease, ok := s.sessionLeases[sessionID]
	return ok && lease.DeviceID == deviceID && lease.ExpiresAt.After(s.now())
}

func (s *Service) TryAcquireControl(deviceID string, sessionID string) bool {
	if deviceID == "" || sessionID == "" {
		return false
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	s.cleanupLocked()
	now := s.now()
	lease, ok := s.controlLeases[deviceID]
	if !ok || !lease.ExpiresAt.After(now) || lease.SessionID == sessionID {
		s.controlLeases[deviceID] = controlLease{
			DeviceID:  deviceID,
			SessionID: sessionID,
			ExpiresAt: now.Add(controlLeaseTTL),
		}
		return true
	}

	return false
}

func (s *Service) cleanupLocked() {
	now := s.now()
	for id, page := range s.webPages {
		if !page.ExpiresAt.After(now) {
			s.releasePageLocked(id)
		}
	}
	for key, ticket := range s.tickets {
		if !ticket.ExpiresAt.After(now) {
			delete(s.tickets, key)
		}
	}
	for key, lease := range s.sessionLeases {
		if !lease.ExpiresAt.After(now) {
			s.releaseSessionLocked(key)
		}
	}
	for key, lease := range s.controlLeases {
		if !lease.ExpiresAt.After(now) {
			delete(s.controlLeases, key)
		}
	}
	for userID, window := range s.registrations {
		if now.Sub(window.StartedAt) >= time.Minute {
			delete(s.registrations, userID)
		}
	}
}

func (s *Service) removeSignalingSession(sessionID string, session *signalingSession) {
	if sessionID == "" || session == nil {
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	current := s.signaling[sessionID]
	if current == session {
		delete(s.signaling, sessionID)
	}
}

func randomHex(bytesLen int) (string, error) {
	buffer := make([]byte, bytesLen)
	if _, err := rand.Read(buffer); err != nil {
		return "", err
	}
	return hex.EncodeToString(buffer), nil
}

func normalizeNewDisplayDPI(value *int) *int {
	if value == nil {
		return nil
	}

	dpi := *value
	if dpi < 72 || dpi > 960 {
		return nil
	}

	return &dpi
}

func normalizeNewDisplayDimension(value *int) *int {
	if value == nil {
		return nil
	}

	dimension := *value
	if dimension < 240 || dimension > 8192 {
		return nil
	}

	return &dimension
}
