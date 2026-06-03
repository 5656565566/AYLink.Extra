package webrtc

import (
	"context"
	"sync"
	"time"

	domainscrcpy "aylink-agent/internal/domain/scrcpy"

	"github.com/gorilla/websocket"
	pion "github.com/pion/webrtc/v4"
)

type signalingSession struct {
	service           *Service
	deviceID          string
	sessionID         string
	runtime           domainscrcpy.Runtime
	peerConnection    *pion.PeerConnection
	rewriteCandidates func(pion.ICECandidateInit) []pion.ICECandidateInit

	mu                  sync.Mutex
	conn                *websocket.Conn
	writeMu             sync.Mutex
	closed              bool
	detachedMonitorStop context.CancelFunc
	detachedMonitorSeq  uint64
	currentPeerState    pion.PeerConnectionState
}

func (s *signalingSession) setPeerState(state pion.PeerConnectionState) {
	s.mu.Lock()
	s.currentPeerState = state
	s.mu.Unlock()
}

func (s *signalingSession) getPeerState() pion.PeerConnectionState {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.currentPeerState
}

func (s *signalingSession) attachConn(conn *websocket.Conn) *websocket.Conn {
	if conn == nil {
		return nil
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if s.detachedMonitorStop != nil {
		s.detachedMonitorStop()
		s.detachedMonitorStop = nil
	}
	if s.closed {
		return conn
	}

	previous := s.conn
	s.conn = conn
	return previous
}

func (s *signalingSession) detachConn(conn *websocket.Conn) {
	s.mu.Lock()
	if s.conn == conn {
		s.conn = nil
	}
	s.mu.Unlock()
}

func (s *signalingSession) hasConn(conn *websocket.Conn) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.conn == conn
}

func (s *signalingSession) writeJSON(payload any) error {
	s.mu.Lock()
	if s.closed || s.conn == nil {
		s.mu.Unlock()
		return nil
	}
	conn := s.conn
	s.mu.Unlock()

	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	return conn.WriteJSON(payload)
}

func (s *signalingSession) startDetachedMonitor() {
	s.mu.Lock()
	if s.closed || s.detachedMonitorStop != nil {
		s.mu.Unlock()
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	s.detachedMonitorSeq++
	monitorSeq := s.detachedMonitorSeq
	s.detachedMonitorStop = cancel
	s.mu.Unlock()

	go func() {
		ticker := time.NewTicker(500 * time.Millisecond)
		defer ticker.Stop()
		defer func() {
			s.mu.Lock()
			if s.detachedMonitorSeq == monitorSeq {
				s.detachedMonitorStop = nil
			}
			s.mu.Unlock()
		}()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if s.hasConn(nil) {
					return
				}
				if !s.service.HasSessionLease(s.deviceID, s.sessionID) {
					s.service.removeSignalingSession(s.sessionID, s)
					closeSignalingSession(s)
					return
				}

				state := s.getPeerState()
				if state == pion.PeerConnectionStateFailed || state == pion.PeerConnectionStateClosed {
					s.service.removeSignalingSession(s.sessionID, s)
					closeSignalingSession(s)
					return
				}
			}
		}
	}()
}

func closeSignalingSession(session *signalingSession) {
	if session == nil {
		return
	}

	session.mu.Lock()
	if session.closed {
		session.mu.Unlock()
		return
	}
	session.closed = true
	if session.detachedMonitorStop != nil {
		session.detachedMonitorStop()
		session.detachedMonitorStop = nil
	}
	conn := session.conn
	session.conn = nil
	peerConnection := session.peerConnection
	session.mu.Unlock()

	if conn != nil {
		_ = conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, "peer connection closed"))
		_ = conn.Close()
	}
	if peerConnection != nil {
		_ = peerConnection.Close()
	}
}
