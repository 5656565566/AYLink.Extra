package webrtc

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"time"

	domainwebrtc "aylink-agent/internal/domain/webrtc"
)

const (
	webSessionTTL = 180 * time.Second
	// 配额由后端执行 前端的活跃音视频设置不能突破会话占用上限
	maxPagesPerLogin          = 8
	maxPagesPerUser           = 16
	maxSessionsPerLogin       = 64
	maxSessionsPerUser        = 128
	maxPageSlots              = 4096
	maxRegistrationsPerMinute = 128
)

var (
	ErrWebPageNotFound = errors.New("web page is invalid or expired")
	ErrWebSessionLimit = errors.New("cast session registration limit reached")
	ErrWebHeartbeat    = errors.New("invalid or stale web heartbeat")
)

type WebOwner struct {
	UserID         int
	LoginSessionID string
}

type WebPageOwner struct {
	WebOwner
	PageID    string
	DeviceIDs []string
}

type webSlot struct {
	SessionID string
	Closed    bool
}
type webPage struct {
	Owner             WebOwner
	Slots             []webSlot
	Sequence          uint64
	Bitmap            string
	AcknowledgedSlots int
	ExpiresAt         time.Time
}

type registrationWindow struct {
	StartedAt time.Time
	Count     int
}

func (s *Service) allowRegistrationLocked(userID int) bool {
	window := s.registrations[userID]
	if s.now().Sub(window.StartedAt) >= time.Minute {
		window = registrationWindow{StartedAt: s.now()}
	}
	if window.Count >= maxRegistrationsPerMinute {
		return false
	}
	window.Count++
	s.registrations[userID] = window
	return true
}

func (s *Service) RegisterWebPage(owner WebOwner) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cleanupLocked()
	if owner.UserID <= 0 || owner.LoginSessionID == "" {
		return "", ErrWebPageNotFound
	}
	userCount, loginCount := 0, 0
	for _, page := range s.webPages {
		if page.Owner.UserID == owner.UserID {
			userCount++
		}
		if page.Owner == owner {
			loginCount++
		}
	}
	if userCount >= maxPagesPerUser || loginCount >= maxPagesPerLogin || !s.allowRegistrationLocked(owner.UserID) {
		return "", ErrWebSessionLimit
	}
	marker := make([]byte, 16)
	if _, err := rand.Read(marker); err != nil {
		return "", err
	}
	id := base64.RawURLEncoding.EncodeToString(marker)
	s.webPages[id] = &webPage{Owner: owner, ExpiresAt: s.now().Add(webSessionTTL)}
	return id, nil
}

func (s *Service) reserveSessionLocked(input CreateTicketInput, sessionID string) (*int, error) {
	owner := WebOwner{input.UserID, input.LoginSessionID}
	page := s.webPages[input.PageID]
	if owner.UserID <= 0 || owner.LoginSessionID == "" || page == nil || page.Owner != owner {
		return nil, ErrWebPageNotFound
	}
	for index, slot := range page.Slots {
		if slot.SessionID == sessionID && !slot.Closed {
			return &index, nil
		}
	}
	if len(page.Slots) >= maxPageSlots {
		return nil, ErrWebSessionLimit
	}
	userCount, loginCount := 0, 0
	for _, lease := range s.sessionLeases {
		if lease.UserID == owner.UserID {
			userCount++
		}
		if lease.UserID == owner.UserID && lease.LoginSessionID == owner.LoginSessionID {
			loginCount++
		}
	}
	if _, exists := s.sessionLeases[sessionID]; !exists {
		if userCount >= maxSessionsPerUser || loginCount >= maxSessionsPerLogin || !s.allowRegistrationLocked(owner.UserID) {
			return nil, ErrWebSessionLimit
		}
		s.sessionLeases[sessionID] = domainwebrtc.SessionLease{SessionID: sessionID, DeviceID: input.DeviceID,
			UserID: owner.UserID, LoginSessionID: owner.LoginSessionID, WebPageID: input.PageID,
			UpdatedAt: s.now(), ExpiresAt: s.now().Add(webSessionTTL)}
	}
	index := len(page.Slots)
	page.Slots = append(page.Slots, webSlot{SessionID: sessionID})
	return &index, nil
}

// 位图前两个字节是已登记槽位数 避免旧心跳误释放刚分配、响应尚未到达前端的新槽位
func decodeWebBitmap(encoded string) (int, []byte, error) {
	if len(encoded) > base64.RawURLEncoding.EncodedLen(2+(maxPageSlots+7)/8) {
		return 0, nil, ErrWebHeartbeat
	}
	payload, err := base64.RawURLEncoding.Strict().DecodeString(encoded)
	if err != nil || len(payload) < 2 {
		return 0, nil, ErrWebHeartbeat
	}
	count := int(binary.LittleEndian.Uint16(payload[:2]))
	bits := payload[2:]
	if count > maxPageSlots || len(bits) != (count+7)/8 {
		return 0, nil, ErrWebHeartbeat
	}
	if count%8 != 0 && bits[len(bits)-1]>>(count%8) != 0 {
		return 0, nil, ErrWebHeartbeat
	}
	return count, bits, nil
}

func (s *Service) HeartbeatWebPage(owner WebOwner, id string, sequence uint64, bitmap string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cleanupLocked()
	page := s.webPages[id]
	if page == nil || page.Owner != owner {
		return ErrWebPageNotFound
	}
	if sequence == 0 || sequence > 9007199254740991 || sequence < page.Sequence {
		return ErrWebHeartbeat
	}
	if sequence == page.Sequence {
		if page.Bitmap != bitmap {
			return ErrWebHeartbeat
		}
		return nil // 重传仅确认 不让旧报文延长租约
	}
	if bitmap == "" {
		s.releasePageLocked(id)
		return nil
	}
	count, bits, err := decodeWebBitmap(bitmap)
	if err != nil || count > len(page.Slots) || count < page.AcknowledgedSlots {
		return ErrWebHeartbeat
	}
	for index := 0; index < count; index++ {
		if bits[index/8]&(1<<uint(index%8)) != 0 {
			slot := page.Slots[index]
			lease, ok := s.sessionLeases[slot.SessionID]
			if slot.Closed || !ok || lease.WebPageID != id {
				return ErrWebHeartbeat
			}
		}
	}
	page.Sequence, page.Bitmap, page.AcknowledgedSlots = sequence, bitmap, count
	page.ExpiresAt = s.now().Add(webSessionTTL)
	for index := 0; index < count; index++ {
		slot := page.Slots[index]
		if bits[index/8]&(1<<uint(index%8)) == 0 {
			if !slot.Closed {
				s.releaseSessionLocked(slot.SessionID)
			}
		} else {
			lease := s.sessionLeases[slot.SessionID]
			lease.UpdatedAt, lease.ExpiresAt = s.now(), page.ExpiresAt
			s.sessionLeases[slot.SessionID] = lease
		}
	}
	return nil
}

func (s *Service) releaseSessionLocked(id string) {
	lease, exists := s.sessionLeases[id]
	if exists {
		if page := s.webPages[lease.WebPageID]; page != nil {
			for index := range page.Slots {
				if page.Slots[index].SessionID == id {
					page.Slots[index].Closed = true
				}
			}
		}
		if control := s.controlLeases[lease.DeviceID]; control.SessionID == id {
			delete(s.controlLeases, lease.DeviceID)
		}
	}
	delete(s.sessionLeases, id)
	connection := s.signaling[id]
	delete(s.signaling, id)
	if connection != nil {
		go closeSignalingSession(connection)
	}
}

func (s *Service) releasePageLocked(id string) {
	page := s.webPages[id]
	if page == nil {
		return
	}
	for _, slot := range page.Slots {
		if !slot.Closed {
			s.releaseSessionLocked(slot.SessionID)
		}
	}
	delete(s.webPages, id)
}

func (s *Service) ReleaseWebPage(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.releasePageLocked(id)
}

func (s *Service) WebPageOwners() []WebPageOwner {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cleanupLocked()
	result := make([]WebPageOwner, 0, len(s.webPages))
	for id, page := range s.webPages {
		owner := WebPageOwner{WebOwner: page.Owner, PageID: id}
		for _, slot := range page.Slots {
			if lease, ok := s.sessionLeases[slot.SessionID]; ok && !slot.Closed {
				owner.DeviceIDs = append(owner.DeviceIDs, lease.DeviceID)
			}
		}
		result = append(result, owner)
	}
	return result
}

func (s *Service) StartTicket(ticket domainwebrtc.Ticket) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cleanupLocked()
	lease, ok := s.sessionLeases[ticket.SessionID]
	return ticket.UserID > 0 && ticket.LoginSessionID != "" && ticket.WebPageID != "" &&
		ok && lease.DeviceID == ticket.DeviceID && lease.UserID == ticket.UserID &&
		lease.LoginSessionID == ticket.LoginSessionID && lease.WebPageID == ticket.WebPageID
}
