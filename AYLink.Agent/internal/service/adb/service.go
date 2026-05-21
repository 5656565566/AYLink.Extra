package adb

import (
	"context"

	domainadb "aylink-agent/internal/domain/adb"
)

type Service struct {
	manager domainadb.Manager
}

type StatusResponse struct {
	ServerAddress string                    `json:"serverAddress"`
	Binary        *domainadb.ResolvedBinary `json:"binary,omitempty"`
	Devices       []domainadb.Device        `json:"devices,omitempty"`
}

func NewService(manager domainadb.Manager) *Service {
	return &Service{manager: manager}
}

func (s *Service) Status(ctx context.Context) (StatusResponse, error) {
	response := StatusResponse{
		ServerAddress: s.manager.ServerAddress(),
	}

	if resolved, ok := s.manager.ResolvedBinary(); ok {
		response.Binary = &resolved
	}

	devices, err := s.manager.Devices(ctx)
	if err != nil {
		return response, err
	}

	response.Devices = devices
	return response, nil
}

func (s *Service) StartServer(ctx context.Context) error {
	return s.manager.StartServer(ctx)
}

func (s *Service) KillServer(ctx context.Context) error {
	return s.manager.KillServer(ctx)
}

func (s *Service) Pair(ctx context.Context, host string, port int, code string) (string, error) {
	return s.manager.PairDevice(ctx, host, port, code)
}
