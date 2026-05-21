package device

import "time"

type Device struct {
	ID        int       `json:"Id"`
	Name      string    `json:"Name"`
	Serial    string    `json:"Serial"`
	IPAddress *string   `json:"IpAddress"`
	Port      *int      `json:"Port"`
	Status    string    `json:"Status"`
	LastSeen  time.Time `json:"LastSeen"`
	CreatedAt time.Time `json:"CreatedAt"`
	UpdatedAt time.Time `json:"UpdatedAt"`
}
