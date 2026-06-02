package handler

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	domaindevice "aylink-agent/internal/domain/device"
	devicegroupservice "aylink-agent/internal/service/devicegroup"
)

type DeviceGroupHandler struct {
	service DeviceGroupService
}

func NewDeviceGroupHandler(service DeviceGroupService) *DeviceGroupHandler {
	return &DeviceGroupHandler{service: service}
}

func (h *DeviceGroupHandler) List(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteMethodNotAllowed(w, http.MethodGet)
		return
	}

	keyword := strings.TrimSpace(r.URL.Query().Get("keyword"))
	items, err := h.service.List(r.Context())
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "DEVICE_GROUPS_LIST_FAILED", "Errors.DevicesListFailed", "加载设备分组失败")
		return
	}
	if keyword != "" {
		filtered := make([]domaindevice.Group, 0, len(items))
		for _, item := range items {
			if strings.Contains(strings.ToLower(item.Name), strings.ToLower(keyword)) {
				filtered = append(filtered, item)
			}
		}
		WriteJSON(w, http.StatusOK, map[string]any{"items": filtered})
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (h *DeviceGroupHandler) ListOptions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteMethodNotAllowed(w, http.MethodGet)
		return
	}

	items, err := h.service.ListOptions(r.Context(), strings.TrimSpace(r.URL.Query().Get("keyword")))
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "DEVICE_GROUPS_LIST_FAILED", "Errors.DevicesListFailed", "加载设备分组选项失败")
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (h *DeviceGroupHandler) Create(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteMethodNotAllowed(w, http.MethodPost)
		return
	}

	var payload struct {
		Name        string `json:"name"`
		Description string `json:"description"`
	}
	if err := decodeJSONBody(r, &payload); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_JSON", "Errors.InvalidJson", "请求 JSON 无效")
		return
	}

	group, err := h.service.Create(r.Context(), payload.Name, payload.Description)
	if err != nil {
		h.writeGroupError(w, err, "CREATE_DEVICE_GROUP_FAILED", "创建设备分组失败")
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"success": true, "group": group})
}

func (h *DeviceGroupHandler) Update(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		WriteMethodNotAllowed(w, http.MethodPut)
		return
	}

	groupID, err := deviceGroupIDFromPath(r.URL.Path)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_GROUP_ID", "Errors.InvalidDeviceId", "无效的分组 ID")
		return
	}

	var payload struct {
		Name        string `json:"name"`
		Description string `json:"description"`
	}
	if err := decodeJSONBody(r, &payload); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_JSON", "Errors.InvalidJson", "请求 JSON 无效")
		return
	}

	group, err := h.service.Update(r.Context(), groupID, payload.Name, payload.Description)
	if err != nil {
		h.writeGroupError(w, err, "UPDATE_DEVICE_GROUP_FAILED", "更新设备分组失败")
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"success": true, "group": group})
}

func (h *DeviceGroupHandler) Delete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		WriteMethodNotAllowed(w, http.MethodDelete)
		return
	}

	groupID, err := deviceGroupIDFromPath(r.URL.Path)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_GROUP_ID", "Errors.InvalidDeviceId", "无效的分组 ID")
		return
	}

	if err := h.service.Delete(r.Context(), groupID); err != nil {
		h.writeGroupError(w, err, "DELETE_DEVICE_GROUP_FAILED", "删除设备分组失败")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *DeviceGroupHandler) writeGroupError(w http.ResponseWriter, err error, code string, fallback string) {
	switch {
	case errors.Is(err, devicegroupservice.ErrGroupNameRequired):
		WriteError(w, http.StatusBadRequest, code, "Errors.RoleNameRequired", "分组名称不能为空")
	case errors.Is(err, devicegroupservice.ErrGroupExists):
		WriteError(w, http.StatusBadRequest, code, "Errors.RoleExists", "分组名称已存在")
	case errors.Is(err, devicegroupservice.ErrGroupNotFound):
		WriteError(w, http.StatusNotFound, "DEVICE_GROUP_NOT_FOUND", "Devices.NotFound", "分组不存在")
	default:
		WriteError(w, http.StatusInternalServerError, code, "Errors.DeviceUpdateFailed", fallback)
	}
}

func deviceGroupIDFromPath(path string) (int, error) {
	value := strings.TrimPrefix(path, "/api/device-groups/")
	if index := strings.IndexByte(value, '/'); index >= 0 {
		value = value[:index]
	}
	return strconv.Atoi(value)
}
