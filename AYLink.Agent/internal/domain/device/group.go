package device

import "time"

type GroupSummary struct {
	ID          int    `json:"Id"`
	Name        string `json:"Name"`
	Description string `json:"Description,omitempty"`
	DeviceCount int    `json:"DeviceCount,omitempty"`
	IsInternal  bool   `json:"IsInternal,omitempty"`
}

type Group struct {
	ID          int       `json:"Id"`
	Name        string    `json:"Name"`
	Description string    `json:"Description"`
	DeviceCount int       `json:"DeviceCount"`
	RoleCount   int       `json:"RoleCount"`
	UserCount   int       `json:"UserCount"`
	IsInternal  bool      `json:"IsInternal"`
	CreatedAt   time.Time `json:"CreatedAt"`
	UpdatedAt   time.Time `json:"UpdatedAt"`
}
