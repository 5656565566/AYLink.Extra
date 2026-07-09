package handler

import (
	domaindevice "aylink-agent/internal/domain/device"
	domainscrcpy "aylink-agent/internal/domain/scrcpy"
	appservice "aylink-agent/internal/service/app"
	deviceservice "aylink-agent/internal/service/device"
	fileservice "aylink-agent/internal/service/file"
)

type Device = domaindevice.Device

type CreateDeviceRequest = deviceservice.CreateInput

type DeviceSettingsProfile = domaindevice.SettingsProfile

type ScrcpyAppInfo = domainscrcpy.AppInfo

type AppInfoResponse = appservice.AppInfoResult

type FileListResponse = fileservice.ListResult

type RenameDeviceRequest struct {
	Name string `json:"Name"`
}

type AppPackageRequest struct {
	PackageName string `json:"packageName"`
}

type FilePathRequest struct {
	Path string `json:"path"`
}

type FileDownloadTicketResponse struct {
	Ticket    string `json:"ticket"`
	URL       string `json:"url"`
	ExpiresAt string `json:"expiresAt"`
}

type RenameFileRequest struct {
	Path    string `json:"path"`
	NewName string `json:"newName"`
}

type DeviceGroupsResponse struct {
	Groups []domaindevice.GroupSummary `json:"groups"`
}

type SaveDeviceGroupsRequest struct {
	GroupIDs []int `json:"groupIds"`
}

type SaveDeviceGroupsResponse struct {
	Success bool                        `json:"success"`
	Groups  []domaindevice.GroupSummary `json:"groups"`
}
