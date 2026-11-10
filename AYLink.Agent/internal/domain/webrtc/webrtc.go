package webrtc

import "time"

type Ticket struct {
	UserID            int
	LoginSessionID    string
	WebPageID         string
	Value             string
	SessionID         string
	DeviceID          string
	AppPackage        string
	AppName           string
	NewDisplay        bool
	NewPeerConnection bool
	NewDisplayWidth   *int
	NewDisplayHeight  *int
	NewDisplayDPI     *int
	ExpiresAt         time.Time
}

type SessionLease struct {
	UserID         int
	LoginSessionID string
	WebPageID      string
	SessionID      string
	DeviceID       string
	ExpiresAt      time.Time
	UpdatedAt      time.Time
}
