package handler

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	domainauth "aylink-agent/internal/domain/auth"
	webrtcservice "aylink-agent/internal/service/webrtc"
	"aylink-agent/internal/transport/http/middleware"
	"aylink-agent/internal/transport/rtc"

	pion "github.com/pion/webrtc/v4"
)

type DataPeerFactory interface {
	NewDataPeer(context.Context, webrtcservice.SettingsProvider) (*webrtcservice.DataPeer, error)
}

type DataTransportHandler struct {
	peers    DataPeerFactory
	settings SettingsService
	access   DeviceAccessService
	auth     middleware.AuthService
	dispatch http.Handler
}

func NewDataTransportHandler(peers DataPeerFactory, settings SettingsService, access DeviceAccessService, auth middleware.AuthService, dispatch http.Handler) *DataTransportHandler {
	return &DataTransportHandler{peers: peers, settings: settings, access: access, auth: auth, dispatch: dispatch}
}

func (h *DataTransportHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodPost {
		WriteMethodNotAllowed(w, "GET, POST")
		return
	}
	id, err := deviceIDFromPath(r.URL.Path)
	if err != nil {
		WriteError(w, 400, "INVALID_DEVICE_ID", "Errors.InvalidDeviceId", "无效的设备 ID")
		return
	}
	owner, ok := ensureDeviceAccess(w, r, h.access, id)
	if !ok {
		return
	}
	if owner == nil || !canUseDataTransport(owner) {
		WriteError(w, 403, "FORBIDDEN", "Errors.PermissionDenied", "Permission denied")
		return
	}
	if r.Method == http.MethodGet {
		config, err := h.settings.GetWebRtcNetworkSettings(r.Context())
		if err != nil {
			WriteError(w, 500, "RTC_CONFIGURATION_FAILED", "WebRTC.SignalHandleFailed", err.Error())
			return
		}
		WriteJSON(w, 200, config)
		return
	}
	var offer pion.SessionDescription
	r.Body = http.MaxBytesReader(w, r.Body, 128*1024)
	if err := decodeJSONBody(r, &offer); err != nil {
		WriteError(w, 400, "INVALID_OFFER", "Errors.InvalidJson", "Invalid RTC offer")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
	defer cancel()
	peer, err := h.peers.NewDataPeer(ctx, h.settings)
	if err != nil {
		WriteError(w, 500, "RTC_UNAVAILABLE", "WebRTC.SignalHandleFailed", err.Error())
		return
	}
	session := newDataTransportSession(peer.Connection, strconv.Itoa(id), h.authorizedDispatcher(owner.UserID))
	answer, err := peer.Answer(ctx, offer)
	if err != nil {
		session.close()
		WriteError(w, 400, "RTC_OFFER_FAILED", "WebRTC.SignalHandleFailed", err.Error())
		return
	}
	WriteJSON(w, 200, answer)
}

func canUseDataTransport(identity *domainauth.Identity) bool {
	for _, permission := range []string{"files.access", "terminal.access", "devices.control"} {
		if slices.Contains(identity.Permissions, permission) {
			return true
		}
	}
	return false
}

// 每次请求都重新校验访问令牌 再执行原有路由权限检查
// 建连时的认证不能替代后续请求的权限检查
func (h *DataTransportHandler) authorizedDispatcher(ownerID int) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		scheme, token, _ := strings.Cut(r.Header.Get("Authorization"), " ")
		if !strings.EqualFold(scheme, "Bearer") {
			token = ""
		}
		identity, err := h.auth.ValidateAccessToken(r.Context(), strings.TrimSpace(token))
		if err != nil || identity == nil {
			WriteError(w, 401, "UNAUTHORIZED", "Errors.Unauthorized", "Unauthorized")
			return
		}
		if identity.UserID != ownerID {
			WriteError(w, 403, "FORBIDDEN", "Errors.PermissionDenied", "Permission denied")
			return
		}
		h.dispatch.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), middleware.IdentityKey, identity)))
	})
}

type dataTransportSession struct {
	peer   *pion.PeerConnection
	ctx    context.Context
	cancel context.CancelFunc
	mu     sync.Mutex
	active int
	closed bool
	ready  bool
	idle   *time.Timer
}

func newDataTransportSession(peer *pion.PeerConnection, deviceID string, dispatch http.Handler) *dataTransportSession {
	ctx, cancel := context.WithCancel(context.Background())
	s := &dataTransportSession{peer: peer, ctx: ctx, cancel: cancel}
	s.idle = time.AfterFunc(20*time.Second, s.close)
	peer.OnConnectionStateChange(func(state pion.PeerConnectionState) {
		if state == pion.PeerConnectionStateFailed || state == pion.PeerConnectionStateClosed {
			s.close()
		}
	})
	peer.OnDataChannel(func(channel *pion.DataChannel) {
		if channel.Label() == "ready" {
			s.mu.Lock()
			if s.closed || s.ready {
				s.mu.Unlock()
				_ = channel.Close()
				return
			}
			s.ready = true
			s.mu.Unlock()
			channel.OnOpen(func() {
				if err := channel.SendText("ready"); err != nil {
					s.close()
					return
				}
				s.resetIdle()
			})
			return
		}
		s.mu.Lock()
		if s.closed || s.active >= 16 || !strings.HasPrefix(channel.Label(), "request-") {
			s.mu.Unlock()
			_ = channel.Close()
			return
		}
		s.active++
		s.idle.Stop()
		s.mu.Unlock()
		stream := rtc.NewStream(s.ctx, func(data []byte, text bool) error {
			if text {
				return channel.SendText(string(data))
			}
			return channel.Send(data)
		}, func() { _ = channel.Close() })
		channel.OnMessage(func(message pion.DataChannelMessage) {
			if err := stream.Receive(message.Data, message.IsString); err != nil {
				stream.Fail(err)
			}
		})
		channel.OnClose(func() {
			_ = stream.Close()
			s.mu.Lock()
			s.active--
			s.mu.Unlock()
			s.resetIdle()
		})
		channel.OnOpen(func() {
			go func() {
				defer func() {
					if recover() != nil {
						stream.Fail(errors.New("RTC request handler failed"))
					}
				}()
				rtc.ServeHTTP(stream, deviceID, dispatch)
			}()
		})
	})
	return s
}

func (s *dataTransportSession) resetIdle() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.closed && s.active == 0 {
		s.idle.Reset(time.Minute)
	}
}

func (s *dataTransportSession) close() {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return
	}
	s.closed = true
	s.idle.Stop()
	s.mu.Unlock()
	s.cancel()
	_ = s.peer.Close()
}
