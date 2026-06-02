package handler

import (
	"net/http"

	domainauth "aylink-agent/internal/domain/auth"
)

func ensureDeviceAccess(w http.ResponseWriter, r *http.Request, access DeviceAccessService, deviceID int) (*domainauth.Identity, bool) {
	if access == nil {
		return getIdentity(r), true
	}

	identity := getIdentity(r)
	if identity == nil {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Errors.Unauthorized", "Unauthorized")
		return nil, false
	}

	allowed, err := access.CanAccessDevice(r.Context(), identity, deviceID)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "DEVICE_ACCESS_CHECK_FAILED", "Errors.PermissionDenied", "设备访问校验失败")
		return identity, false
	}
	if !allowed {
		WriteError(w, http.StatusNotFound, "DEVICE_NOT_FOUND", "Devices.NotFound", "设备不存在")
		return identity, false
	}
	return identity, true
}
