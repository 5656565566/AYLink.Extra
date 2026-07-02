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

// List 获取设备分组列表
// @Summary 获取设备分组列表
// @Description 返回设备分组列表，可按关键字过滤。
// @Tags 设备分组
// @Produce json
// @Security BearerAuth
// @Param keyword query string false "关键字"
// @Success 200 {object} DeviceGroupListResponse
// @Failure 401 {object} ErrorResponse
// @Failure 403 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/device-groups [get]
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
		WriteJSON(w, http.StatusOK, DeviceGroupListResponse{Items: filtered})
		return
	}
	WriteJSON(w, http.StatusOK, DeviceGroupListResponse{Items: items})
}

// ListOptions 获取可选设备分组
// @Summary 获取可选设备分组
// @Description 返回当前用户可见的设备分组选项，可按关键字过滤。
// @Tags 设备分组
// @Produce json
// @Security BearerAuth
// @Param keyword query string false "关键字"
// @Success 200 {object} DeviceGroupOptionsResponse
// @Failure 401 {object} ErrorResponse
// @Failure 403 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/device-groups/options [get]
func (h *DeviceGroupHandler) ListOptions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteMethodNotAllowed(w, http.MethodGet)
		return
	}

	identity := getIdentity(r)
	if identity == nil {
		WriteUnauthorized(w)
		return
	}

	items, err := h.service.ListOptionsForUser(r.Context(), identity.UserID, strings.TrimSpace(r.URL.Query().Get("keyword")))
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "DEVICE_GROUPS_LIST_FAILED", "Errors.DevicesListFailed", "加载设备分组选项失败")
		return
	}
	WriteJSON(w, http.StatusOK, DeviceGroupOptionsResponse{Items: items})
}

// Create 创建设备分组
// @Summary 创建设备分组
// @Description 创建一个设备分组。
// @Tags 设备分组
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param body body SaveDeviceGroupRequest true "设备分组参数"
// @Success 200 {object} DeviceGroupResponse
// @Failure 400 {object} ErrorResponse
// @Failure 401 {object} ErrorResponse
// @Failure 403 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/device-groups [post]
func (h *DeviceGroupHandler) Create(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteMethodNotAllowed(w, http.MethodPost)
		return
	}

	var payload SaveDeviceGroupRequest
	if err := decodeJSONBody(r, &payload); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_JSON", "Errors.InvalidJson", "请求 JSON 无效")
		return
	}

	group, err := h.service.Create(r.Context(), payload.Name, payload.Description)
	if err != nil {
		h.writeGroupError(w, err, "CREATE_DEVICE_GROUP_FAILED", "创建设备分组失败")
		return
	}
	WriteJSON(w, http.StatusOK, DeviceGroupResponse{Success: true, Group: group})
}

// Update 更新设备分组
// @Summary 更新设备分组
// @Description 更新指定设备分组。
// @Tags 设备分组
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "设备分组 ID"
// @Param body body SaveDeviceGroupRequest true "设备分组参数"
// @Success 200 {object} DeviceGroupResponse
// @Failure 400 {object} ErrorResponse
// @Failure 401 {object} ErrorResponse
// @Failure 403 {object} ErrorResponse
// @Failure 404 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/device-groups/{id} [put]
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

	var payload SaveDeviceGroupRequest
	if err := decodeJSONBody(r, &payload); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_JSON", "Errors.InvalidJson", "请求 JSON 无效")
		return
	}

	group, err := h.service.Update(r.Context(), groupID, payload.Name, payload.Description)
	if err != nil {
		h.writeGroupError(w, err, "UPDATE_DEVICE_GROUP_FAILED", "更新设备分组失败")
		return
	}
	WriteJSON(w, http.StatusOK, DeviceGroupResponse{Success: true, Group: group})
}

// Delete 删除设备分组
// @Summary 删除设备分组
// @Description 删除指定设备分组。
// @Tags 设备分组
// @Produce json
// @Security BearerAuth
// @Param id path int true "设备分组 ID"
// @Success 204 "删除成功"
// @Failure 400 {object} ErrorResponse
// @Failure 401 {object} ErrorResponse
// @Failure 403 {object} ErrorResponse
// @Failure 404 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/device-groups/{id} [delete]
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
	case errors.Is(err, devicegroupservice.ErrGroupInternal):
		WriteError(w, http.StatusBadRequest, "DEVICE_GROUP_INTERNAL", "Errors.DeviceUpdateFailed", "内置分组不允许修改")
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
