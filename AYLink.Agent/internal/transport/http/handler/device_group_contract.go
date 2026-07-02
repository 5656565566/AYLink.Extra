package handler

import domaindevice "aylink-agent/internal/domain/device"

type DeviceGroupListResponse struct {
	Items []domaindevice.Group `json:"items"`
}

type DeviceGroupOptionsResponse struct {
	Items []domaindevice.GroupSummary `json:"items"`
}

type SaveDeviceGroupRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

type DeviceGroupResponse struct {
	Success bool                `json:"success"`
	Group   *domaindevice.Group `json:"group"`
}
