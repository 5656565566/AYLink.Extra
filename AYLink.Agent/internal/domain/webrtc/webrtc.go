package webrtc

import "time"

type Ticket struct {
	Value      string
	SessionID  string
	DeviceID   string
	AppPackage string
	AppName    string
	NewDisplay bool
	ExpiresAt  time.Time
}

type SessionLease struct {
	SessionID string
	DeviceID  string
	ExpiresAt time.Time
	UpdatedAt time.Time
}
