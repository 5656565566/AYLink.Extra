package status

import (
	"context"
	"time"

	domainadb "aylink-agent/internal/domain/adb"
)

type Service struct {
	adb domainadb.Manager
}

type Response struct {
	Status    string             `json:"Status"`
	Mode      string             `json:"Mode"`
	Timestamp time.Time          `json:"Timestamp"`
	ADB       *ADBStatus         `json:"adb,omitempty"`
	Devices   []domainadb.Device `json:"devices,omitempty"`
}

type ADBStatus struct {
	ServerAddress string `json:"serverAddress"`
	Path          string `json:"path"`
	Source        string `json:"source"`
}

func NewService(adbManager domainadb.Manager) *Service {
	return &Service{adb: adbManager}
}

func (s *Service) Get(ctx context.Context) Response {
	response := Response{
		Status:    "OK",
		Mode:      "AYLink Agent (Go)",
		Timestamp: time.Now(),
	}

	if resolved, ok := s.adb.ResolvedBinary(); ok {
		response.ADB = &ADBStatus{
			ServerAddress: s.adb.ServerAddress(),
			Path:          resolved.Path,
			Source:        resolved.Source,
		}
	} else {
		response.ADB = &ADBStatus{
			ServerAddress: s.adb.ServerAddress(),
		}
	}

	devices, err := s.adb.Devices(ctx)
	if err == nil {
		response.Devices = devices
	}

	return response
}
