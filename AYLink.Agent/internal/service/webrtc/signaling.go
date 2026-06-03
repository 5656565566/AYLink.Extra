package webrtc

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	domainscrcpy "aylink-agent/internal/domain/scrcpy"
	domainsettings "aylink-agent/internal/domain/settings"

	"github.com/gorilla/websocket"
	"github.com/pion/ice/v4"
	"github.com/pion/interceptor"
	"github.com/pion/interceptor/pkg/nack"
	pion "github.com/pion/webrtc/v4"
)

type SettingsProvider interface {
	GetWebRtcNetworkSettings(ctx context.Context) (domainsettings.WebRtcNetworkSettings, error)
}

const (
	nackResponderCachePackets = 2048
)

func (s *Service) HandleSignalWebSocket(ctx context.Context, deviceID string, sessionID string, conn *websocket.Conn, settings SettingsProvider, runtime domainscrcpy.Runtime) error {
	session, err := s.getOrCreateSignalingSession(ctx, deviceID, sessionID, settings, runtime)
	if err != nil {
		return err
	}

	previousConn := session.attachConn(conn)
	if previousConn != nil && previousConn != conn {
		_ = previousConn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, "replaced by a newer signaling connection"))
		_ = previousConn.Close()
	}
	defer session.detachConn(conn)

	for {
		select {
		case <-ctx.Done():
			return nil
		default:
		}

		_, data, err := conn.ReadMessage()
		if err != nil {
			if s.debugWebRTC {
				s.logger.Debug("webrtc signaling websocket read ended",
					"sessionId", sessionID,
					"peerState", session.getPeerState().String(),
					"err", err,
				)
			}
			session.detachConn(conn)
			if s.HasSessionLease(deviceID, sessionID) {
				session.startDetachedMonitor()
				return nil
			}
			s.removeSignalingSession(sessionID, session)
			closeSignalingSession(session)
			if websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
				return nil
			}
			return err
		}

		var envelope map[string]any
		if err := json.Unmarshal(data, &envelope); err != nil {
			continue
		}

		switch {
		case isSessionDescriptionEnvelope(envelope):
			if s.debugWebRTC {
				s.logger.Debug("webrtc received session description", "type", envelope["type"], "sessionId", sessionID)
			}
			if err := s.handleSessionDescription(session.peerConnection, envelope, session.writeJSON, session.rewriteCandidates); err != nil {
				return err
			}
		case isCandidateEnvelope(envelope):
			if s.debugWebRTC {
				s.logger.Debug("webrtc received remote candidate", "candidate", envelope["candidate"], "sessionId", sessionID)
			}
			if err := s.handleCandidate(session.peerConnection, envelope); err != nil && !errors.Is(err, pion.ErrNoRemoteDescription) {
				return err
			}
		}
	}
}

func (s *Service) getOrCreateSignalingSession(ctx context.Context, deviceID string, sessionID string, settings SettingsProvider, runtime domainscrcpy.Runtime) (*signalingSession, error) {
	s.mu.Lock()
	existing := s.signaling[sessionID]
	s.mu.Unlock()

	if existing != nil {
		if existing.deviceID != deviceID {
			return nil, fmt.Errorf("signaling session %s belongs to another device", sessionID)
		}
		return existing, nil
	}

	debugWebRTC := s.debugWebRTC
	api, config, rewriteCandidates, err := s.buildPeerConfiguration(ctx, settings)
	if err != nil {
		return nil, err
	}
	if debugWebRTC {
		s.logger.Debug("webrtc configuration prepared",
			"iceServers", len(config.ICEServers),
			"transportPolicy", config.ICETransportPolicy.String(),
			"candidateRewrite", rewriteCandidates != nil,
			"sessionId", sessionID,
		)
	}

	peerConnection, err := api.NewPeerConnection(config)
	if err != nil {
		return nil, err
	}

	if err := s.attachScrcpyVideo(peerConnection, runtime); err != nil {
		_ = peerConnection.Close()
		return nil, err
	}
	_ = s.attachScrcpyAudio(peerConnection, runtime)
	s.bindScrcpyControl(peerConnection, deviceID, sessionID, runtime)

	session := &signalingSession{
		service:           s,
		deviceID:          deviceID,
		sessionID:         sessionID,
		runtime:           runtime,
		peerConnection:    peerConnection,
		rewriteCandidates: rewriteCandidates,
		currentPeerState:  pion.PeerConnectionStateNew,
	}

	peerConnection.OnICECandidate(func(candidate *pion.ICECandidate) {
		if candidate == nil {
			return
		}

		payload := candidate.ToJSON()
		if debugWebRTC {
			s.logger.Debug("webrtc local candidate", "candidate", payload.Candidate, "sdpMid", payload.SDPMid, "sdpMLineIndex", payload.SDPMLineIndex, "sessionId", sessionID)
		}
		payloads := []pion.ICECandidateInit{payload}
		if rewriteCandidates != nil {
			payloads = rewriteCandidates(payload)
		}
		for _, rewrittenPayload := range payloads {
			if debugWebRTC {
				s.logger.Debug("webrtc local candidate rewritten", "candidate", rewrittenPayload.Candidate, "sessionId", sessionID)
			}
			_ = session.writeJSON(rewrittenPayload)
		}
	})

	peerConnection.OnConnectionStateChange(func(state pion.PeerConnectionState) {
		session.setPeerState(state)
		if debugWebRTC {
			s.logger.Debug("webrtc peer connection state changed", "state", state.String(), "sessionId", sessionID)
		}
		if state == pion.PeerConnectionStateFailed || state == pion.PeerConnectionStateClosed {
			s.removeSignalingSession(sessionID, session)
			closeSignalingSession(session)
		}
	})
	peerConnection.OnICEConnectionStateChange(func(state pion.ICEConnectionState) {
		if debugWebRTC {
			s.logger.Debug("webrtc ice connection state changed", "state", state.String(), "sessionId", sessionID)
		}
	})
	peerConnection.OnSignalingStateChange(func(state pion.SignalingState) {
		if debugWebRTC {
			s.logger.Debug("webrtc signaling state changed", "state", state.String(), "sessionId", sessionID)
		}
	})

	s.mu.Lock()
	if current := s.signaling[sessionID]; current != nil {
		s.mu.Unlock()
		_ = peerConnection.Close()
		return current, nil
	}
	s.signaling[sessionID] = session
	s.mu.Unlock()
	return session, nil
}

func (s *Service) buildPeerConfiguration(ctx context.Context, settings SettingsProvider) (*pion.API, pion.Configuration, func(pion.ICECandidateInit) []pion.ICECandidateInit, error) {
	networkSettings, err := settings.GetWebRtcNetworkSettings(ctx)
	if err != nil {
		return nil, pion.Configuration{}, nil, err
	}

	config := pion.Configuration{}
	if networkSettings.IceTransportPolicy == "relay" {
		config.ICETransportPolicy = pion.ICETransportPolicyRelay
	}

	for _, server := range networkSettings.IceServers {
		iceServer := pion.ICEServer{
			URLs: server.Urls,
		}
		if server.Username != nil {
			iceServer.Username = *server.Username
		}
		if server.Credential != nil {
			iceServer.Credential = *server.Credential
		}
		config.ICEServers = append(config.ICEServers, iceServer)
	}

	var settingEngine pion.SettingEngine
	var rewriteCandidates func(pion.ICECandidateInit) []pion.ICECandidateInit

	if networkSettings.SinglePortMuxEnabled && networkSettings.SinglePortMuxBindPort != nil {
		udpMux, err := s.getOrCreateUDPMux(*networkSettings.SinglePortMuxBindPort)
		if err != nil {
			return nil, pion.Configuration{}, nil, err
		}
		settingEngine.SetICEUDPMux(udpMux)
	}

	if !networkSettings.SinglePortMuxEnabled && networkSettings.HostCandidatePortMin != nil && networkSettings.HostCandidatePortMax != nil {
		if err := settingEngine.SetEphemeralUDPPortRange(uint16(*networkSettings.HostCandidatePortMin), uint16(*networkSettings.HostCandidatePortMax)); err != nil {
			return nil, pion.Configuration{}, nil, err
		}
	}

	overrideIPs := make([]string, 0, len(networkSettings.HostCandidateOverrideIPs))
	for _, ip := range networkSettings.HostCandidateOverrideIPs {
		trimmed := strings.TrimSpace(ip)
		if trimmed == "" {
			continue
		}
		overrideIPs = append(overrideIPs, trimmed)
	}
	publishPort := 0
	if networkSettings.SinglePortMuxPublishPort != nil {
		publishPort = *networkSettings.SinglePortMuxPublishPort
	}
	rewriteCandidates = buildCandidateRewriter(networkSettings.HostCandidateOverrideEnabled, overrideIPs, publishPort)

	mediaEngine := &pion.MediaEngine{}
	if err := mediaEngine.RegisterDefaultCodecs(); err != nil {
		return nil, pion.Configuration{}, nil, err
	}
	interceptorRegistry := &interceptor.Registry{}
	if err := pion.RegisterDefaultInterceptorsWithOptions(
		mediaEngine,
		interceptorRegistry,
		pion.WithNackResponderOptions(nack.ResponderSize(nackResponderCachePackets)),
	); err != nil {
		return nil, pion.Configuration{}, nil, err
	}

	return pion.NewAPI(
		pion.WithSettingEngine(settingEngine),
		pion.WithMediaEngine(mediaEngine),
		pion.WithInterceptorRegistry(interceptorRegistry),
	), config, rewriteCandidates, nil
}

func (s *Service) handleSessionDescription(peerConnection *pion.PeerConnection, envelope map[string]any, writeJSON func(any) error, rewriteCandidates func(pion.ICECandidateInit) []pion.ICECandidateInit) error {
	rawType, _ := envelope["type"].(string)
	rawSDP, _ := envelope["sdp"].(string)
	if rawType == "" || rawSDP == "" {
		return nil
	}

	if rawType != "offer" {
		return nil
	}

	if err := peerConnection.SetRemoteDescription(pion.SessionDescription{
		Type: pion.SDPTypeOffer,
		SDP:  rawSDP,
	}); err != nil {
		return err
	}
	if s.debugWebRTC {
		s.logger.Debug("webrtc remote description set", "type", rawType, "sdpLength", len(rawSDP))
	}

	answer, err := peerConnection.CreateAnswer(nil)
	if err != nil {
		return err
	}

	gatherComplete := pion.GatheringCompletePromise(peerConnection)
	if err := peerConnection.SetLocalDescription(answer); err != nil {
		return err
	}

	select {
	case <-gatherComplete:
	case <-time.After(2 * time.Second):
	}

	localDescription := peerConnection.LocalDescription()
	if localDescription == nil {
		return errors.New("local description is nil")
	}

	if rewriteCandidates != nil {
		rewritten := *localDescription
		rewritten.SDP = rewriteSessionDescriptionCandidates(rewritten.SDP, rewriteCandidates)
		localDescription = &rewritten
	}
	if s.debugWebRTC {
		s.logger.Debug("webrtc local description ready", "type", localDescription.Type.String(), "sdpLength", len(localDescription.SDP))
	}

	return writeJSON(localDescription)
}

func (s *Service) handleCandidate(peerConnection *pion.PeerConnection, envelope map[string]any) error {
	candidateText, ok := envelope["candidate"].(string)
	if !ok || candidateText == "" {
		return nil
	}

	candidate := pion.ICECandidateInit{
		Candidate: candidateText,
	}
	if value, ok := envelope["sdpMid"].(string); ok {
		candidate.SDPMid = &value
	}
	if value, ok := envelope["sdpMLineIndex"].(float64); ok {
		index := uint16(value)
		candidate.SDPMLineIndex = &index
	}

	return peerConnection.AddICECandidate(candidate)
}

func isSessionDescriptionEnvelope(envelope map[string]any) bool {
	_, hasType := envelope["type"]
	_, hasSDP := envelope["sdp"]
	return hasType && hasSDP
}

func isCandidateEnvelope(envelope map[string]any) bool {
	_, hasCandidate := envelope["candidate"]
	return hasCandidate
}

func (s *Service) getOrCreateUDPMux(bindPort int) (ice.UDPMux, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if mux, ok := s.udpMuxes[bindPort]; ok {
		return mux, nil
	}

	mux, err := ice.NewMultiUDPMuxFromPort(bindPort)
	if err != nil {
		return nil, fmt.Errorf("create ICE UDPMux on port %d: %w", bindPort, err)
	}

	s.udpMuxes[bindPort] = mux
	return mux, nil
}

func rewriteSessionDescriptionCandidates(sdp string, rewrite func(pion.ICECandidateInit) []pion.ICECandidateInit) string {
	lines := strings.Split(sdp, "\n")
	rewrittenLines := make([]string, 0, len(lines))
	for index, line := range lines {
		_ = index
		trimmed := strings.TrimRight(line, "\r")
		if !strings.HasPrefix(trimmed, "a=candidate:") {
			rewrittenLines = append(rewrittenLines, line)
			continue
		}

		candidate := strings.TrimPrefix(trimmed, "a=")
		rewrittenCandidates := rewrite(pion.ICECandidateInit{Candidate: candidate})
		if len(rewrittenCandidates) == 0 {
			continue
		}
		for _, rewritten := range rewrittenCandidates {
			if rewritten.Candidate == "" {
				continue
			}
			suffix := ""
			if strings.HasSuffix(line, "\r") {
				suffix = "\r"
			}
			rewrittenLines = append(rewrittenLines, "a="+rewritten.Candidate+suffix)
		}
	}

	return strings.Join(rewrittenLines, "\n")
}

func buildCandidateRewriter(enabled bool, externalHosts []string, publishPort int) func(pion.ICECandidateInit) []pion.ICECandidateInit {
	normalizedHosts := make([]string, 0, len(externalHosts))
	seen := map[string]struct{}{}
	for _, host := range externalHosts {
		trimmed := strings.TrimSpace(host)
		if trimmed == "" {
			continue
		}
		key := strings.ToLower(trimmed)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		normalizedHosts = append(normalizedHosts, trimmed)
	}

	if !enabled && (publishPort < 1 || publishPort > 65535) {
		return nil
	}

	return func(candidate pion.ICECandidateInit) []pion.ICECandidateInit {
		parts := strings.Fields(candidate.Candidate)
		if len(parts) < 8 || !strings.EqualFold(parts[6], "typ") {
			if enabled && len(normalizedHosts) > 0 {
				return nil
			}
			return []pion.ICECandidateInit{candidate}
		}

		candidateType := strings.ToLower(parts[7])
		if candidateType != "host" {
			if enabled && len(normalizedHosts) > 0 {
				return nil
			}
			return []pion.ICECandidateInit{candidate}
		}

		targetPort := parts[5]
		if publishPort >= 1 && publishPort <= 65535 {
			targetPort = fmt.Sprintf("%d", publishPort)
		}

		if !enabled || len(normalizedHosts) == 0 {
			rewritten := candidate
			parts[5] = targetPort
			rewritten.Candidate = strings.Join(parts, " ")
			return []pion.ICECandidateInit{rewritten}
		}

		results := make([]pion.ICECandidateInit, 0, len(normalizedHosts))
		for _, host := range normalizedHosts {
			rewritten := candidate
			rewrittenParts := append([]string(nil), parts...)
			rewrittenParts[4] = host
			rewrittenParts[5] = targetPort
			rewritten.Candidate = strings.Join(rewrittenParts, " ")
			results = append(results, rewritten)
		}
		return results
	}
}
