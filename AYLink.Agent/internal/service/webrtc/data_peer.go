package webrtc

import (
	"context"
	"errors"

	pion "github.com/pion/webrtc/v4"
)

// DataPeer 与投屏共用 ICE 配置和 UDP 多路复用器
// 不依赖 scrcpy 运行时或投屏会话租约
type DataPeer struct {
	Connection *pion.PeerConnection
	rewrite    func(pion.ICECandidateInit) []pion.ICECandidateInit
}

func (s *Service) NewDataPeer(ctx context.Context, settings SettingsProvider) (*DataPeer, error) {
	api, config, rewrite, err := s.buildPeerConfiguration(ctx, settings)
	if err != nil {
		return nil, err
	}
	connection, err := api.NewPeerConnection(config)
	if err != nil {
		return nil, err
	}
	return &DataPeer{Connection: connection, rewrite: rewrite}, nil
}

func (p *DataPeer) Answer(ctx context.Context, offer pion.SessionDescription) (*pion.SessionDescription, error) {
	if offer.Type != pion.SDPTypeOffer {
		return nil, errors.New("expected RTC offer")
	}
	if err := p.Connection.SetRemoteDescription(offer); err != nil {
		return nil, err
	}
	answer, err := p.Connection.CreateAnswer(nil)
	if err != nil {
		return nil, err
	}
	gathered := pion.GatheringCompletePromise(p.Connection)
	if err := p.Connection.SetLocalDescription(answer); err != nil {
		return nil, err
	}
	select {
	case <-gathered:
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	local := p.Connection.LocalDescription()
	if local == nil {
		return nil, errors.New("RTC answer unavailable")
	}
	result := *local
	if p.rewrite != nil {
		result.SDP = rewriteSessionDescriptionCandidates(result.SDP, p.rewrite)
	}
	return &result, nil
}
