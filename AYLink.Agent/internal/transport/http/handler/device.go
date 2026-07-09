package handler

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	domaindevice "aylink-agent/internal/domain/device"
	appservice "aylink-agent/internal/service/app"
	deviceservice "aylink-agent/internal/service/device"
	fileservice "aylink-agent/internal/service/file"
	scrcpyservice "aylink-agent/internal/service/scrcpy"
)

type DeviceHandler struct {
	service         DeviceService
	accessService   DeviceAccessService
	groupService    DeviceGroupService
	previewService  DevicePreviewService
	appService      AppService
	fileService     FileService
	settingsService DeviceSettingsService
	scrcpyService   ScrcpyService
	downloadTickets *fileDownloadTicketStore
}

func NewDeviceHandler(service DeviceService, accessService DeviceAccessService, groupService DeviceGroupService, previewService DevicePreviewService, appService AppService, fileService FileService, settingsService DeviceSettingsService, scrcpyService ScrcpyService) *DeviceHandler {
	return &DeviceHandler{
		service:         service,
		accessService:   accessService,
		groupService:    groupService,
		previewService:  previewService,
		appService:      appService,
		fileService:     fileService,
		settingsService: settingsService,
		scrcpyService:   scrcpyService,
		downloadTickets: newFileDownloadTicketStore(2 * time.Minute),
	}
}

type fileDownloadTicket struct {
	deviceID  int
	path      string
	expiresAt time.Time
}

type fileDownloadTicketStore struct {
	mu      sync.Mutex
	ttl     time.Duration
	tickets map[string]fileDownloadTicket
}

func newFileDownloadTicketStore(ttl time.Duration) *fileDownloadTicketStore {
	return &fileDownloadTicketStore{
		ttl:     ttl,
		tickets: make(map[string]fileDownloadTicket),
	}
}

func (s *fileDownloadTicketStore) Create(deviceID int, path string) (string, time.Time, error) {
	var raw [32]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", time.Time{}, err
	}

	now := time.Now()
	expiresAt := now.Add(s.ttl)
	ticket := base64.RawURLEncoding.EncodeToString(raw[:])

	s.mu.Lock()
	defer s.mu.Unlock()
	s.cleanupExpiredLocked(now)
	s.tickets[ticket] = fileDownloadTicket{
		deviceID:  deviceID,
		path:      path,
		expiresAt: expiresAt,
	}
	return ticket, expiresAt, nil
}

func (s *fileDownloadTicketStore) Consume(ticket string) (fileDownloadTicket, bool) {
	now := time.Now()
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cleanupExpiredLocked(now)

	value, ok := s.tickets[ticket]
	if !ok {
		return fileDownloadTicket{}, false
	}
	delete(s.tickets, ticket)
	if now.After(value.expiresAt) {
		return fileDownloadTicket{}, false
	}
	return value, true
}

func (s *fileDownloadTicketStore) cleanupExpiredLocked(now time.Time) {
	for ticket, value := range s.tickets {
		if now.After(value.expiresAt) {
			delete(s.tickets, ticket)
		}
	}
}

// List 获取设备列表
// @Summary 获取设备列表
// @Description 返回当前用户可访问的设备列表。
// @Tags 设备
// @Produce json
// @Security BearerAuth
// @Success 200 {array} Device
// @Failure 401 {object} ErrorResponse
// @Failure 403 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/devices [get]
func (h *DeviceHandler) List(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteMethodNotAllowed(w, http.MethodGet)
		return
	}
	devices, err := h.service.List(r.Context())
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "DEVICES_LIST_FAILED", "Errors.DevicesListFailed", "加载设备列表失败")
		return
	}
	if h.accessService != nil {
		identity := getIdentity(r)
		devices, err = h.accessService.FilterDevices(r.Context(), identity, devices)
		if err != nil {
			WriteError(w, http.StatusInternalServerError, "DEVICES_FILTER_FAILED", "Errors.DevicesListFailed", "过滤设备列表失败")
			return
		}
	}
	if h.groupService != nil && len(devices) > 0 {
		deviceIDs := make([]int, 0, len(devices))
		for _, device := range devices {
			deviceIDs = append(deviceIDs, device.ID)
		}
		groupsByDeviceID, err := h.groupService.GetGroupsForDevices(r.Context(), deviceIDs)
		if err != nil {
			WriteError(w, http.StatusInternalServerError, "DEVICE_GROUPS_LOAD_FAILED", "Errors.DevicesListFailed", "加载设备分组失败")
			return
		}
		for index := range devices {
			devices[index].Groups = groupsByDeviceID[devices[index].ID]
		}
	}
	WriteJSON(w, http.StatusOK, devices)
}

// Get 获取单个设备
// @Summary 获取单个设备
// @Description 返回指定设备的最新状态。用于在不刷新完整设备列表的情况下校验单个设备。
// @Tags 设备
// @Produce json
// @Security BearerAuth
// @Param id path int true "设备 ID"
// @Success 200 {object} Device
// @Failure 400 {object} ErrorResponse
// @Failure 401 {object} ErrorResponse
// @Failure 403 {object} ErrorResponse
// @Failure 404 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/devices/{id} [get]
func (h *DeviceHandler) Get(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteMethodNotAllowed(w, http.MethodGet)
		return
	}
	id, err := deviceIDFromPath(r.URL.Path)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_DEVICE_ID", "Errors.InvalidDeviceId", "无效的设备 ID")
		return
	}
	if _, ok := ensureDeviceAccess(w, r, h.accessService, id); !ok {
		return
	}

	device, err := h.service.GetByID(r.Context(), id)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "DEVICE_GET_FAILED", "Errors.DevicesListFailed", "加载设备失败")
		return
	}
	if device == nil {
		WriteError(w, http.StatusNotFound, "DEVICE_NOT_FOUND", "Devices.NotFound", "设备不存在")
		return
	}

	WriteJSON(w, http.StatusOK, device)
}

// Preview 获取设备预览
// @Summary 获取设备预览
// @Description 获取设备屏幕预览图片。
// @Tags 设备
// @Produce jpeg
// @Security BearerAuth
// @Param id path int true "设备 ID"
// @Param width query int false "预览宽度"
// @Success 200 {file} binary
// @Failure 400 {object} ErrorResponse
// @Failure 401 {object} ErrorResponse
// @Failure 403 {object} ErrorResponse
// @Failure 404 {object} ErrorResponse
// @Failure 409 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Failure 503 {object} ErrorResponse
// @Router /api/devices/{id}/preview [get]
func (h *DeviceHandler) Preview(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteMethodNotAllowed(w, http.MethodGet)
		return
	}
	id, err := deviceIDFromPath(r.URL.Path)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_DEVICE_ID", "Errors.InvalidDeviceId", "无效的设备 ID")
		return
	}
	if _, ok := ensureDeviceAccess(w, r, h.accessService, id); !ok {
		return
	}
	if h.previewService == nil {
		WriteError(w, http.StatusServiceUnavailable, "DEVICE_PREVIEW_UNAVAILABLE", "HomeView.PreviewUnavailable", "设备预览不可用")
		return
	}

	width, err := previewWidthFromQuery(r)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_PREVIEW_WIDTH", "HomeView.PreviewWidthInvalid", "预览宽度无效")
		return
	}

	payload, err := h.previewService.Get(r.Context(), id, width)
	if err != nil {
		h.writeDevicePreviewError(w, err)
		return
	}

	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Cache-Control", "private, max-age=5")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(payload)
}

// Create 创建设备
// @Summary 创建设备
// @Description 添加一个设备记录。
// @Tags 设备
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param body body CreateDeviceRequest true "设备参数"
// @Success 200 {object} Device
// @Failure 400 {object} ErrorResponse
// @Failure 401 {object} ErrorResponse
// @Failure 403 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/devices [post]
func (h *DeviceHandler) Create(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteMethodNotAllowed(w, http.MethodPost)
		return
	}
	var payload deviceservice.CreateInput
	if err := decodeJSONBody(r, &payload); err != nil {
		WriteInvalidJSON(w)
		return
	}
	device, err := h.service.Create(r.Context(), payload)
	if err != nil {
		if errors.Is(err, deviceservice.ErrDeviceSerialEmpty) {
			WriteError(w, http.StatusBadRequest, "DEVICE_SERIAL_REQUIRED", "Devices.SerialRequired", "device serial is required")
			return
		}
		if errors.Is(err, deviceservice.ErrDeviceMustBeOnline) {
			WriteError(w, http.StatusBadRequest, "DEVICE_MUST_BE_ONLINE", "Devices.MustBeOnline", "device must be online before it can be added")
			return
		}
		WriteError(w, http.StatusInternalServerError, "DEVICE_CREATE_FAILED", "Errors.DeviceCreateFailed", "添加设备失败")
		return
	}
	WriteJSON(w, http.StatusOK, device)
}

// Delete 删除设备
// @Summary 删除设备
// @Description 删除指定设备。
// @Tags 设备
// @Produce json
// @Security BearerAuth
// @Param id path int true "设备 ID"
// @Success 204 "删除成功"
// @Failure 400 {object} ErrorResponse
// @Failure 401 {object} ErrorResponse
// @Failure 403 {object} ErrorResponse
// @Failure 404 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/devices/{id} [delete]
func (h *DeviceHandler) Delete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		WriteMethodNotAllowed(w, http.MethodDelete)
		return
	}
	id, err := deviceIDFromPath(r.URL.Path)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_DEVICE_ID", "Errors.InvalidDeviceId", "无效的设备 ID")
		return
	}
	if _, ok := ensureDeviceAccess(w, r, h.accessService, id); !ok {
		return
	}
	if err := h.service.Delete(r.Context(), id); err != nil {
		if errors.Is(err, deviceservice.ErrDeviceNotFound) {
			WriteError(w, http.StatusNotFound, "DEVICE_NOT_FOUND", "Devices.NotFound", "Device not found")
			return
		}
		WriteError(w, http.StatusInternalServerError, "DEVICE_DELETE_FAILED", "Errors.DeviceDeleteFailed", "删除设备失败")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Connect 连接设备
// @Summary 连接设备
// @Description 对指定设备发起网络连接。
// @Tags 设备
// @Produce json
// @Security BearerAuth
// @Param id path int true "设备 ID"
// @Success 200 {object} Device
// @Failure 400 {object} ErrorResponse
// @Failure 401 {object} ErrorResponse
// @Failure 403 {object} ErrorResponse
// @Failure 404 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/devices/connect/{id} [post]
func (h *DeviceHandler) Connect(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteMethodNotAllowed(w, http.MethodPost)
		return
	}

	// Format is /api/devices/connect/{id}
	value := strings.TrimPrefix(r.URL.Path, "/api/devices/connect/")
	id, err := strconv.Atoi(value)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_DEVICE_ID", "Errors.InvalidDeviceId", "无效的设备 ID")
		return
	}
	if _, ok := ensureDeviceAccess(w, r, h.accessService, id); !ok {
		return
	}

	device, err := h.service.Connect(r.Context(), id)
	if err != nil {
		if errors.Is(err, deviceservice.ErrDeviceNotFound) {
			WriteError(w, http.StatusNotFound, "DEVICE_NOT_FOUND", "Devices.NotFound", "Device not found")
			return
		}
		if errors.Is(err, deviceservice.ErrDeviceInvalidIPPort) {
			WriteError(
				w,
				http.StatusBadRequest,
				"DEVICE_INVALID_IP_PORT",
				"Devices.InvalidIpPort",
				"Device does not have a valid IP and Port for network connection",
			)
			return
		}
		WriteInternalServerError(w, "DEVICE_CONNECT_FAILED", "Errors.DeviceConnectFailed", "设备连接失败")
		return
	}

	WriteJSON(w, http.StatusOK, device)
}

// Rename 重命名设备
// @Summary 重命名设备
// @Description 修改指定设备名称。
// @Tags 设备
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "设备 ID"
// @Param body body RenameDeviceRequest true "设备名称"
// @Success 200 {object} Device
// @Failure 400 {object} ErrorResponse
// @Failure 401 {object} ErrorResponse
// @Failure 403 {object} ErrorResponse
// @Failure 404 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/devices/{id}/rename [put]
func (h *DeviceHandler) Rename(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		WriteMethodNotAllowed(w, http.MethodPut)
		return
	}

	id, err := deviceIDFromPath(strings.TrimSuffix(r.URL.Path, "/rename"))
	if err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_DEVICE_ID", "Errors.InvalidDeviceId", "无效的设备 ID")
		return
	}
	if _, ok := ensureDeviceAccess(w, r, h.accessService, id); !ok {
		return
	}

	var payload RenameDeviceRequest
	if err := decodeJSONBody(r, &payload); err != nil {
		WriteInvalidJSON(w)
		return
	}

	device, err := h.service.Rename(r.Context(), id, payload.Name)
	if err != nil {
		switch {
		case errors.Is(err, deviceservice.ErrDeviceNameEmpty):
			WriteError(w, http.StatusBadRequest, "DEVICE_NAME_REQUIRED", "Devices.NameRequired", "设备名称不能为空")
		case errors.Is(err, deviceservice.ErrDeviceNotFound):
			WriteError(w, http.StatusNotFound, "DEVICE_NOT_FOUND", "Devices.NotFound", "Device not found")
		default:
			WriteError(w, http.StatusInternalServerError, "DEVICE_RENAME_FAILED", "Errors.DeviceUpdateFailed", "重命名设备失败")
		}
		return
	}

	WriteJSON(w, http.StatusOK, device)
}

// GetSettings 获取设备投屏设置
// @Summary 获取设备投屏设置
// @Description 返回指定设备的投屏设置。
// @Tags 设备设置
// @Produce json
// @Security BearerAuth
// @Param id path int true "设备 ID"
// @Success 200 {object} DeviceSettingsProfile
// @Failure 400 {object} ErrorResponse
// @Failure 401 {object} ErrorResponse
// @Failure 403 {object} ErrorResponse
// @Failure 404 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/devices/{id}/settings [get]
func (h *DeviceHandler) GetSettings(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteMethodNotAllowed(w, http.MethodGet)
		return
	}
	id, err := deviceIDFromPath(r.URL.Path)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_DEVICE_ID", "Errors.InvalidDeviceId", "无效的设备 ID")
		return
	}
	if _, ok := ensureDeviceAccess(w, r, h.accessService, id); !ok {
		return
	}
	settings, err := h.settingsService.GetByDeviceID(r.Context(), id)
	if err != nil {
		h.writeDeviceSettingsError(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, settings)
}

// SaveSettings 保存设备投屏设置
// @Summary 保存设备投屏设置
// @Description 保存指定设备的投屏设置。
// @Tags 设备设置
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "设备 ID"
// @Param body body DeviceSettingsProfile true "投屏设置"
// @Success 200 {object} DeviceSettingsProfile
// @Failure 400 {object} ErrorResponse
// @Failure 401 {object} ErrorResponse
// @Failure 403 {object} ErrorResponse
// @Failure 404 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/devices/{id}/settings [put]
func (h *DeviceHandler) SaveSettings(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		WriteMethodNotAllowed(w, http.MethodPut)
		return
	}
	id, err := deviceIDFromPath(r.URL.Path)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_DEVICE_ID", "Errors.InvalidDeviceId", "无效的设备 ID")
		return
	}
	if _, ok := ensureDeviceAccess(w, r, h.accessService, id); !ok {
		return
	}
	payload := domaindevice.DefaultSettingsProfile()
	if err := decodeJSONBody(r, &payload); err != nil {
		WriteInvalidJSON(w)
		return
	}
	settings, err := h.settingsService.SaveByDeviceID(r.Context(), id, payload)
	if err != nil {
		h.writeDeviceSettingsError(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, settings)
}

// ResetSettings 重置设备投屏设置
// @Summary 重置设备投屏设置
// @Description 将指定设备投屏设置恢复为默认值。
// @Tags 设备设置
// @Produce json
// @Security BearerAuth
// @Param id path int true "设备 ID"
// @Success 200 {object} DeviceSettingsProfile
// @Failure 400 {object} ErrorResponse
// @Failure 401 {object} ErrorResponse
// @Failure 403 {object} ErrorResponse
// @Failure 404 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/devices/{id}/settings [delete]
func (h *DeviceHandler) ResetSettings(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		WriteMethodNotAllowed(w, http.MethodDelete)
		return
	}
	id, err := deviceIDFromPath(r.URL.Path)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_DEVICE_ID", "Errors.InvalidDeviceId", "无效的设备 ID")
		return
	}
	if _, ok := ensureDeviceAccess(w, r, h.accessService, id); !ok {
		return
	}
	settings, err := h.settingsService.ResetByDeviceID(r.Context(), id)
	if err != nil {
		h.writeDeviceSettingsError(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, settings)
}

// ListEncoders 获取编码器列表
// @Summary 获取编码器列表
// @Description 返回指定设备可用的视频编码器列表。
// @Tags 设备
// @Produce json
// @Security BearerAuth
// @Param id path int true "设备 ID"
// @Success 200 {array} string
// @Failure 400 {object} ErrorResponse
// @Failure 401 {object} ErrorResponse
// @Failure 403 {object} ErrorResponse
// @Failure 404 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Failure 503 {object} ErrorResponse
// @Router /api/devices/{id}/encoders [get]
func (h *DeviceHandler) ListEncoders(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteMethodNotAllowed(w, http.MethodGet)
		return
	}
	id, err := deviceIDFromPath(r.URL.Path)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_DEVICE_ID", "Errors.InvalidDeviceId", "无效的设备 ID")
		return
	}
	if _, ok := ensureDeviceAccess(w, r, h.accessService, id); !ok {
		return
	}
	encoders, err := h.scrcpyService.ListEncoders(r.Context(), id)
	if err != nil {
		h.writeScrcpyError(w, err, "获取编码器列表失败")
		return
	}
	WriteJSON(w, http.StatusOK, encoders)
}

// ListApps 获取应用列表
// @Summary 获取应用列表
// @Description 返回指定设备安装的应用列表。
// @Tags 应用管理
// @Produce json
// @Security BearerAuth
// @Param id path int true "设备 ID"
// @Success 200 {array} ScrcpyAppInfo
// @Failure 400 {object} ErrorResponse
// @Failure 401 {object} ErrorResponse
// @Failure 403 {object} ErrorResponse
// @Failure 404 {object} ErrorResponse
// @Failure 409 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/devices/{id}/apps [get]
func (h *DeviceHandler) ListApps(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteMethodNotAllowed(w, http.MethodGet)
		return
	}
	id, err := deviceIDFromPath(r.URL.Path)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_DEVICE_ID", "Errors.InvalidDeviceId", "无效的设备 ID")
		return
	}
	if _, ok := ensureDeviceAccess(w, r, h.accessService, id); !ok {
		return
	}
	apps, err := h.scrcpyService.ListApps(r.Context(), id)
	if err != nil {
		h.writeScrcpyError(w, err, "获取应用列表失败")
		return
	}
	WriteJSON(w, http.StatusOK, apps)
}

// LaunchApp 启动应用
// @Summary 启动应用
// @Description 在指定设备上启动应用。
// @Tags 应用管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "设备 ID"
// @Param body body AppPackageRequest true "应用包名"
// @Success 200 {object} OKResponse
// @Failure 400 {object} ErrorResponse
// @Failure 401 {object} ErrorResponse
// @Failure 403 {object} ErrorResponse
// @Failure 404 {object} ErrorResponse
// @Failure 409 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/devices/{id}/apps/launch [post]
func (h *DeviceHandler) LaunchApp(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteMethodNotAllowed(w, http.MethodPost)
		return
	}
	id, err := deviceIDFromPath(r.URL.Path)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_DEVICE_ID", "Errors.InvalidDeviceId", "无效的设备 ID")
		return
	}
	if _, ok := ensureDeviceAccess(w, r, h.accessService, id); !ok {
		return
	}

	var payload AppPackageRequest
	if err := decodeJSONBody(r, &payload); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_JSON", "Errors.InvalidJson", "请求 JSON 无效")
		return
	}

	if err := h.appService.Launch(r.Context(), id, payload.PackageName); err != nil {
		h.writeAppError(w, err, "应用启动失败")
		return
	}

	WriteJSON(w, http.StatusOK, OKResponse{OK: true})
}

// DownloadApp 下载应用 APK
// @Summary 下载应用 APK
// @Description 下载指定设备上应用的 APK 文件。
// @Tags 应用管理
// @Accept json
// @Produce application/vnd.android.package-archive
// @Security BearerAuth
// @Param id path int true "设备 ID"
// @Param body body AppPackageRequest true "应用包名"
// @Success 200 {file} binary
// @Failure 400 {object} ErrorResponse
// @Failure 401 {object} ErrorResponse
// @Failure 403 {object} ErrorResponse
// @Failure 404 {object} ErrorResponse
// @Failure 409 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/devices/{id}/apps/download [post]
func (h *DeviceHandler) DownloadApp(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteMethodNotAllowed(w, http.MethodPost)
		return
	}
	id, err := deviceIDFromPath(r.URL.Path)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_DEVICE_ID", "Errors.InvalidDeviceId", "无效的设备 ID")
		return
	}
	if _, ok := ensureDeviceAccess(w, r, h.accessService, id); !ok {
		return
	}

	var payload AppPackageRequest
	if err := decodeJSONBody(r, &payload); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_JSON", "Errors.InvalidJson", "请求 JSON 无效")
		return
	}

	result, err := h.appService.Download(r.Context(), id, payload.PackageName)
	if err != nil {
		h.writeAppError(w, err, "APK 下载失败")
		return
	}
	defer result.Reader.Close()

	w.Header().Set("Content-Type", "application/vnd.android.package-archive")
	w.Header().Set("Content-Disposition", `attachment; filename="`+sanitizeDownloadFilename(result.Name)+`"`)
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, result.Reader)
}

// UninstallApp 卸载应用
// @Summary 卸载应用
// @Description 从指定设备卸载应用。
// @Tags 应用管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "设备 ID"
// @Param body body AppPackageRequest true "应用包名"
// @Success 200 {object} OKResponse
// @Failure 400 {object} ErrorResponse
// @Failure 401 {object} ErrorResponse
// @Failure 403 {object} ErrorResponse
// @Failure 404 {object} ErrorResponse
// @Failure 409 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/devices/{id}/apps/uninstall [post]
func (h *DeviceHandler) UninstallApp(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteMethodNotAllowed(w, http.MethodPost)
		return
	}
	id, err := deviceIDFromPath(r.URL.Path)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_DEVICE_ID", "Errors.InvalidDeviceId", "无效的设备 ID")
		return
	}
	if _, ok := ensureDeviceAccess(w, r, h.accessService, id); !ok {
		return
	}

	var payload AppPackageRequest
	if err := decodeJSONBody(r, &payload); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_JSON", "Errors.InvalidJson", "请求 JSON 无效")
		return
	}

	if err := h.appService.Uninstall(r.Context(), id, payload.PackageName); err != nil {
		h.writeAppError(w, err, "应用卸载失败")
		return
	}

	WriteJSON(w, http.StatusOK, OKResponse{OK: true})
}

// AppInfo 获取应用详情
// @Summary 获取应用详情
// @Description 返回指定应用的版本、安装时间和 APK 路径等信息。
// @Tags 应用管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "设备 ID"
// @Param body body AppPackageRequest true "应用包名"
// @Success 200 {object} AppInfoResponse
// @Failure 400 {object} ErrorResponse
// @Failure 401 {object} ErrorResponse
// @Failure 403 {object} ErrorResponse
// @Failure 404 {object} ErrorResponse
// @Failure 409 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/devices/{id}/apps/info [post]
func (h *DeviceHandler) AppInfo(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteMethodNotAllowed(w, http.MethodPost)
		return
	}
	id, err := deviceIDFromPath(r.URL.Path)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_DEVICE_ID", "Errors.InvalidDeviceId", "无效的设备 ID")
		return
	}
	if _, ok := ensureDeviceAccess(w, r, h.accessService, id); !ok {
		return
	}

	var payload AppPackageRequest
	if err := decodeJSONBody(r, &payload); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_JSON", "Errors.InvalidJson", "请求 JSON 无效")
		return
	}

	result, err := h.appService.Info(r.Context(), id, payload.PackageName)
	if err != nil {
		h.writeAppError(w, err, "获取应用信息失败")
		return
	}

	WriteJSON(w, http.StatusOK, result)
}

// InstallApp 安装应用
// @Summary 安装应用
// @Description 上传 APK 并安装到指定设备。
// @Tags 应用管理
// @Accept multipart/form-data
// @Produce json
// @Security BearerAuth
// @Param id path int true "设备 ID"
// @Param file formData file true "APK 文件"
// @Success 200 {object} OKResponse
// @Failure 400 {object} ErrorResponse
// @Failure 401 {object} ErrorResponse
// @Failure 403 {object} ErrorResponse
// @Failure 404 {object} ErrorResponse
// @Failure 409 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/devices/{id}/apps/install [post]
func (h *DeviceHandler) InstallApp(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteMethodNotAllowed(w, http.MethodPost)
		return
	}
	id, err := deviceIDFromPath(r.URL.Path)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_DEVICE_ID", "Errors.InvalidDeviceId", "无效的设备 ID")
		return
	}
	if _, ok := ensureDeviceAccess(w, r, h.accessService, id); !ok {
		return
	}

	reader, err := r.MultipartReader()
	if err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_MULTIPART", "Errors.InvalidUpload", "上传请求无效")
		return
	}

	for {
		part, err := reader.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			WriteError(w, http.StatusBadRequest, "INVALID_MULTIPART", "Errors.InvalidUpload", "上传请求无效")
			return
		}
		if part.FormName() != "file" {
			_ = part.Close()
			continue
		}
		fileName := strings.TrimSpace(part.FileName())
		if fileName == "" {
			_ = part.Close()
			WriteError(w, http.StatusBadRequest, "APP_FILE_REQUIRED", "AppPage.InstallFileRequired", "请选择 APK 文件")
			return
		}

		err = h.appService.Install(r.Context(), id, fileName, part)
		_ = part.Close()
		if err != nil {
			h.writeAppError(w, err, "APK 安装失败")
			return
		}

		WriteJSON(w, http.StatusOK, OKResponse{OK: true})
		return
	}

	WriteError(w, http.StatusBadRequest, "APP_FILE_REQUIRED", "AppPage.InstallFileRequired", "请选择 APK 文件")
}

// ListFiles 获取文件列表
// @Summary 获取文件列表
// @Description 返回指定设备上目录内容。
// @Tags 文件管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "设备 ID"
// @Param body body FilePathRequest true "目录路径"
// @Success 200 {object} FileListResponse
// @Failure 400 {object} ErrorResponse
// @Failure 401 {object} ErrorResponse
// @Failure 403 {object} ErrorResponse
// @Failure 404 {object} ErrorResponse
// @Failure 409 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/devices/{id}/files/list [post]
func (h *DeviceHandler) ListFiles(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteMethodNotAllowed(w, http.MethodPost)
		return
	}
	id, err := deviceIDFromPath(r.URL.Path)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_DEVICE_ID", "Errors.InvalidDeviceId", "无效的设备 ID")
		return
	}
	if _, ok := ensureDeviceAccess(w, r, h.accessService, id); !ok {
		return
	}

	var payload FilePathRequest
	if err := decodeJSONBody(r, &payload); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_JSON", "Errors.InvalidJson", "请求 JSON 无效")
		return
	}

	result, err := h.fileService.List(r.Context(), id, payload.Path)
	if err != nil {
		switch {
		case errors.Is(err, deviceservice.ErrDeviceNotFound):
			WriteError(w, http.StatusNotFound, "DEVICE_NOT_FOUND", "Devices.NotFound", "设备不存在")
		case errors.Is(err, deviceservice.ErrDeviceOffline):
			WriteError(w, http.StatusConflict, "DEVICE_OFFLINE", "Devices.Offline", "设备已断开，请稍后重试")
		case errors.Is(err, fileservice.ErrPathOutOfScope):
			WriteError(w, http.StatusBadRequest, "FILE_PATH_OUT_OF_SCOPE", "FilePage.PathOutOfScope", "路径超出允许范围")
		default:
			WriteError(w, http.StatusInternalServerError, "FILES_LIST_FAILED", "FilePage.ReadFailed", "无法读取当前目录")
		}
		return
	}

	WriteJSON(w, http.StatusOK, result)
}

// DownloadFile 下载文件
// @Summary 下载文件
// @Description 从指定设备下载文件。
// @Tags 文件管理
// @Accept json
// @Produce octet-stream
// @Security BearerAuth
// @Param id path int true "设备 ID"
// @Param body body FilePathRequest true "文件路径"
// @Success 200 {file} binary
// @Failure 400 {object} ErrorResponse
// @Failure 401 {object} ErrorResponse
// @Failure 403 {object} ErrorResponse
// @Failure 404 {object} ErrorResponse
// @Failure 409 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/devices/{id}/files/download [post]
func (h *DeviceHandler) DownloadFile(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteMethodNotAllowed(w, http.MethodPost)
		return
	}
	id, err := deviceIDFromPath(r.URL.Path)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_DEVICE_ID", "Errors.InvalidDeviceId", "无效的设备 ID")
		return
	}
	if _, ok := ensureDeviceAccess(w, r, h.accessService, id); !ok {
		return
	}

	var payload FilePathRequest
	if err := decodeJSONBody(r, &payload); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_JSON", "Errors.InvalidJson", "请求 JSON 无效")
		return
	}

	h.downloadFile(w, r, id, payload.Path)
}

// CreateFileDownloadTicket 创建一次性浏览器下载票据
// @Summary 创建文件下载票据
// @Description 为浏览器原生下载创建短期一次性票据。
// @Tags 文件管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "设备 ID"
// @Param body body FilePathRequest true "文件路径"
// @Success 200 {object} FileDownloadTicketResponse
// @Failure 400 {object} ErrorResponse
// @Failure 401 {object} ErrorResponse
// @Failure 403 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/devices/{id}/files/download-ticket [post]
func (h *DeviceHandler) CreateFileDownloadTicket(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteMethodNotAllowed(w, http.MethodPost)
		return
	}
	id, err := deviceIDFromPath(r.URL.Path)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_DEVICE_ID", "Errors.InvalidDeviceId", "无效的设备 ID")
		return
	}
	if _, ok := ensureDeviceAccess(w, r, h.accessService, id); !ok {
		return
	}

	var payload FilePathRequest
	if err := decodeJSONBody(r, &payload); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_JSON", "Errors.InvalidJson", "请求 JSON 无效")
		return
	}

	ticket, expiresAt, err := h.downloadTickets.Create(id, payload.Path)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "FILE_DOWNLOAD_TICKET_FAILED", "FilePage.DownloadFailed", "无法创建下载票据")
		return
	}

	WriteJSON(w, http.StatusOK, FileDownloadTicketResponse{
		Ticket:    ticket,
		URL:       "/api/file-downloads/" + ticket,
		ExpiresAt: expiresAt.Format(time.RFC3339),
	})
}

// DownloadFileByTicket 使用一次性票据下载文件
// @Summary 使用票据下载文件
// @Description 供浏览器原生下载使用，票据短期有效且只能使用一次。
// @Tags 文件管理
// @Produce octet-stream
// @Param ticket path string true "下载票据"
// @Success 200 {file} binary
// @Failure 400 {object} ErrorResponse
// @Failure 404 {object} ErrorResponse
// @Failure 409 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/file-downloads/{ticket} [get]
func (h *DeviceHandler) DownloadFileByTicket(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteMethodNotAllowed(w, http.MethodGet)
		return
	}

	ticket := strings.TrimPrefix(r.URL.Path, "/api/file-downloads/")
	if strings.TrimSpace(ticket) == "" {
		WriteError(w, http.StatusBadRequest, "INVALID_DOWNLOAD_TICKET", "FilePage.DownloadFailed", "无效的下载票据")
		return
	}

	download, ok := h.downloadTickets.Consume(ticket)
	if !ok {
		WriteError(w, http.StatusNotFound, "DOWNLOAD_TICKET_NOT_FOUND", "FilePage.DownloadFailed", "下载票据不存在或已过期")
		return
	}

	h.downloadFile(w, r, download.deviceID, download.path)
}

func (h *DeviceHandler) downloadFile(w http.ResponseWriter, r *http.Request, id int, path string) {
	result, err := h.fileService.Download(r.Context(), id, path)
	if err != nil {
		switch {
		case errors.Is(err, deviceservice.ErrDeviceNotFound):
			WriteError(w, http.StatusNotFound, "DEVICE_NOT_FOUND", "Devices.NotFound", "设备不存在")
		case errors.Is(err, deviceservice.ErrDeviceOffline):
			WriteError(w, http.StatusConflict, "DEVICE_OFFLINE", "Devices.Offline", "设备已断开，请稍后重试")
		case errors.Is(err, fileservice.ErrPathOutOfScope):
			WriteError(w, http.StatusBadRequest, "FILE_PATH_OUT_OF_SCOPE", "FilePage.PathOutOfScope", "路径超出允许范围")
		default:
			WriteError(w, http.StatusInternalServerError, "FILE_DOWNLOAD_FAILED", "FilePage.DownloadFailed", "文件下载失败")
		}
		return
	}
	defer result.Reader.Close()

	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", `attachment; filename="`+sanitizeDownloadFilename(result.Name)+`"`)
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, result.Reader)
}

// UploadFile 上传文件
// @Summary 上传文件
// @Description 将本地文件上传到指定设备目录，支持通过 relativePath 保留文件夹结构。
// @Tags 文件管理
// @Accept multipart/form-data
// @Produce json
// @Security BearerAuth
// @Param id path int true "设备 ID"
// @Param path query string true "目标目录"
// @Param relativePath query string false "相对路径"
// @Param file formData file true "文件"
// @Success 200 {object} OKResponse
// @Failure 400 {object} ErrorResponse
// @Failure 401 {object} ErrorResponse
// @Failure 403 {object} ErrorResponse
// @Failure 404 {object} ErrorResponse
// @Failure 409 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/devices/{id}/files/upload [post]
func (h *DeviceHandler) UploadFile(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteMethodNotAllowed(w, http.MethodPost)
		return
	}
	id, err := deviceIDFromPath(r.URL.Path)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_DEVICE_ID", "Errors.InvalidDeviceId", "无效的设备 ID")
		return
	}
	if _, ok := ensureDeviceAccess(w, r, h.accessService, id); !ok {
		return
	}

	reader, err := r.MultipartReader()
	if err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_MULTIPART", "Errors.InvalidUpload", "上传请求无效")
		return
	}

	targetDirectory := r.URL.Query().Get("path")
	relativePath := r.URL.Query().Get("relativePath")
	for {
		part, err := reader.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			WriteError(w, http.StatusBadRequest, "INVALID_MULTIPART", "Errors.InvalidUpload", "上传请求无效")
			return
		}
		if part.FormName() != "file" {
			_ = part.Close()
			continue
		}

		err = h.fileService.Upload(r.Context(), id, targetDirectory, relativePath, part.FileName(), part)
		_ = part.Close()
		if err != nil {
			h.writeFileError(w, err, "上传失败")
			return
		}

		WriteJSON(w, http.StatusOK, OKResponse{OK: true})
		return
	}

	WriteError(w, http.StatusBadRequest, "FILE_UPLOAD_REQUIRED", "FilePage.UploadFileRequired", "请选择要上传的文件")
}

// RenameFile 重命名文件
// @Summary 重命名文件
// @Description 重命名指定设备上的文件或目录。
// @Tags 文件管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "设备 ID"
// @Param body body RenameFileRequest true "重命名参数"
// @Success 200 {object} OKResponse
// @Failure 400 {object} ErrorResponse
// @Failure 401 {object} ErrorResponse
// @Failure 403 {object} ErrorResponse
// @Failure 404 {object} ErrorResponse
// @Failure 409 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/devices/{id}/files/rename [post]
func (h *DeviceHandler) RenameFile(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteMethodNotAllowed(w, http.MethodPost)
		return
	}
	id, err := deviceIDFromPath(r.URL.Path)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_DEVICE_ID", "Errors.InvalidDeviceId", "无效的设备 ID")
		return
	}
	if _, ok := ensureDeviceAccess(w, r, h.accessService, id); !ok {
		return
	}

	var payload RenameFileRequest
	if err := decodeJSONBody(r, &payload); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_JSON", "Errors.InvalidJson", "请求 JSON 无效")
		return
	}

	if err := h.fileService.Rename(r.Context(), id, payload.Path, payload.NewName); err != nil {
		switch {
		case errors.Is(err, deviceservice.ErrDeviceNotFound):
			WriteError(w, http.StatusNotFound, "DEVICE_NOT_FOUND", "Devices.NotFound", "设备不存在")
		case errors.Is(err, deviceservice.ErrDeviceOffline):
			WriteError(w, http.StatusConflict, "DEVICE_OFFLINE", "Devices.Offline", "设备已断开，请稍后重试")
		case errors.Is(err, fileservice.ErrFileNameEmpty):
			WriteError(w, http.StatusBadRequest, "FILE_RENAME_INVALID", "FilePage.RenameInvalid", "无效的新名称")
		case errors.Is(err, fileservice.ErrPathOutOfScope):
			WriteError(w, http.StatusBadRequest, "FILE_PATH_OUT_OF_SCOPE", "FilePage.PathOutOfScope", "路径超出允许范围")
		case errors.Is(err, fileservice.ErrProtectedPath):
			WriteError(w, http.StatusBadRequest, "FILE_PATH_PROTECTED", "FilePage.PathProtected", "该路径不允许重命名")
		default:
			WriteError(w, http.StatusInternalServerError, "FILE_RENAME_FAILED", "FilePage.RenameFailed", "重命名失败")
		}
		return
	}

	WriteJSON(w, http.StatusOK, OKResponse{OK: true})
}

// GetGroups 获取设备分组绑定
// @Summary 获取设备分组绑定
// @Description 返回指定设备所属分组。
// @Tags 设备分组
// @Produce json
// @Security BearerAuth
// @Param id path int true "设备 ID"
// @Success 200 {object} DeviceGroupsResponse
// @Failure 400 {object} ErrorResponse
// @Failure 401 {object} ErrorResponse
// @Failure 403 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/devices/{id}/groups [get]
func (h *DeviceHandler) GetGroups(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteMethodNotAllowed(w, http.MethodGet)
		return
	}

	id, err := deviceIDFromPath(strings.TrimSuffix(r.URL.Path, "/groups"))
	if err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_DEVICE_ID", "Errors.InvalidDeviceId", "无效的设备 ID")
		return
	}
	if _, ok := ensureDeviceAccess(w, r, h.accessService, id); !ok {
		return
	}

	groups, err := h.groupService.GetGroupsForDevice(r.Context(), id)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "DEVICE_GROUPS_LOAD_FAILED", "Errors.DeviceUpdateFailed", "加载设备分组失败")
		return
	}
	WriteJSON(w, http.StatusOK, DeviceGroupsResponse{Groups: groups})
}

// SaveGroups 保存设备分组绑定
// @Summary 保存设备分组绑定
// @Description 保存指定设备所属分组。
// @Tags 设备分组
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "设备 ID"
// @Param body body SaveDeviceGroupsRequest true "设备分组绑定"
// @Success 200 {object} SaveDeviceGroupsResponse
// @Failure 400 {object} ErrorResponse
// @Failure 401 {object} ErrorResponse
// @Failure 403 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/devices/{id}/groups [put]
func (h *DeviceHandler) SaveGroups(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		WriteMethodNotAllowed(w, http.MethodPut)
		return
	}

	id, err := deviceIDFromPath(strings.TrimSuffix(r.URL.Path, "/groups"))
	if err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_DEVICE_ID", "Errors.InvalidDeviceId", "无效的设备 ID")
		return
	}
	if _, ok := ensureDeviceAccess(w, r, h.accessService, id); !ok {
		return
	}

	var payload SaveDeviceGroupsRequest
	if err := decodeJSONBody(r, &payload); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_JSON", "Errors.InvalidJson", "请求 JSON 无效")
		return
	}

	if err := h.groupService.SetGroupsForDevice(r.Context(), id, payload.GroupIDs); err != nil {
		WriteError(w, http.StatusInternalServerError, "DEVICE_GROUPS_SAVE_FAILED", "Errors.DeviceUpdateFailed", "保存设备分组失败")
		return
	}

	groups, err := h.groupService.GetGroupsForDevice(r.Context(), id)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "DEVICE_GROUPS_LOAD_FAILED", "Errors.DeviceUpdateFailed", "加载设备分组失败")
		return
	}

	WriteJSON(w, http.StatusOK, SaveDeviceGroupsResponse{
		Success: true,
		Groups:  groups,
	})
}

// DeleteFile 删除文件
// @Summary 删除文件
// @Description 删除指定设备上的文件或目录。
// @Tags 文件管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "设备 ID"
// @Param body body FilePathRequest true "文件路径"
// @Success 200 {object} OKResponse
// @Failure 400 {object} ErrorResponse
// @Failure 401 {object} ErrorResponse
// @Failure 403 {object} ErrorResponse
// @Failure 404 {object} ErrorResponse
// @Failure 409 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/devices/{id}/files/delete [post]
func (h *DeviceHandler) DeleteFile(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteMethodNotAllowed(w, http.MethodPost)
		return
	}
	id, err := deviceIDFromPath(r.URL.Path)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_DEVICE_ID", "Errors.InvalidDeviceId", "无效的设备 ID")
		return
	}
	if _, ok := ensureDeviceAccess(w, r, h.accessService, id); !ok {
		return
	}

	var payload FilePathRequest
	if err := decodeJSONBody(r, &payload); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_JSON", "Errors.InvalidJson", "请求 JSON 无效")
		return
	}

	if err := h.fileService.Delete(r.Context(), id, payload.Path); err != nil {
		switch {
		case errors.Is(err, deviceservice.ErrDeviceNotFound):
			WriteError(w, http.StatusNotFound, "DEVICE_NOT_FOUND", "Devices.NotFound", "设备不存在")
		case errors.Is(err, deviceservice.ErrDeviceOffline):
			WriteError(w, http.StatusConflict, "DEVICE_OFFLINE", "Devices.Offline", "设备已断开，请稍后重试")
		case errors.Is(err, fileservice.ErrPathOutOfScope):
			WriteError(w, http.StatusBadRequest, "FILE_PATH_OUT_OF_SCOPE", "FilePage.PathOutOfScope", "路径超出允许范围")
		case errors.Is(err, fileservice.ErrProtectedPath):
			WriteError(w, http.StatusBadRequest, "FILE_PATH_PROTECTED", "FilePage.PathProtected", "该路径不允许删除")
		default:
			WriteError(w, http.StatusInternalServerError, "FILE_DELETE_FAILED", "FilePage.DeleteFailed", "删除失败")
		}
		return
	}

	WriteJSON(w, http.StatusOK, OKResponse{OK: true})
}

func (h *DeviceHandler) writeDeviceSettingsError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, deviceservice.ErrDeviceNotFound):
		WriteError(w, http.StatusNotFound, "DEVICE_NOT_FOUND", "Devices.NotFound", "设备不存在")
	case errors.Is(err, deviceservice.ErrDeviceSerialEmpty):
		WriteError(w, http.StatusBadRequest, "DEVICE_SERIAL_REQUIRED", "Devices.SerialRequired", "设备序列号不能为空")
	default:
		WriteError(w, http.StatusInternalServerError, "DEVICE_SETTINGS_FAILED", "Errors.DeviceSettingsFailed", "设备设置操作失败")
	}
}

func (h *DeviceHandler) writeScrcpyError(w http.ResponseWriter, err error, fallback string) {
	switch {
	case errors.Is(err, scrcpyservice.ErrDeviceNotFound):
		WriteError(w, http.StatusNotFound, "DEVICE_NOT_FOUND", "Devices.NotFound", "设备不存在")
	case errors.Is(err, scrcpyservice.ErrDeviceSerialMissing):
		WriteError(w, http.StatusBadRequest, "DEVICE_SERIAL_REQUIRED", "Devices.SerialRequired", "设备序列号不能为空")
	case errors.Is(err, deviceservice.ErrDeviceOffline):
		WriteError(w, http.StatusConflict, "DEVICE_OFFLINE", "Devices.Offline", "设备已断开，请稍后重试")
	case errors.Is(err, scrcpyservice.ErrServerUnavailable):
		WriteError(w, http.StatusServiceUnavailable, "SCRCPY_SERVER_UNAVAILABLE", "Scrcpy.ServerUnavailable", "scrcpy-server 文件不可用")
	default:
		WriteError(w, http.StatusInternalServerError, "SCRCPY_REQUEST_FAILED", "Scrcpy.RequestFailed", fallback)
	}
}

func (h *DeviceHandler) writeAppError(w http.ResponseWriter, err error, fallback string) {
	switch {
	case errors.Is(err, deviceservice.ErrDeviceNotFound):
		WriteError(w, http.StatusNotFound, "DEVICE_NOT_FOUND", "Devices.NotFound", "设备不存在")
	case errors.Is(err, deviceservice.ErrDeviceOffline):
		WriteError(w, http.StatusConflict, "DEVICE_OFFLINE", "Devices.Offline", "设备已断开，请稍后重试")
	case errors.Is(err, deviceservice.ErrDeviceSerialEmpty):
		WriteError(w, http.StatusBadRequest, "DEVICE_SERIAL_REQUIRED", "Devices.SerialRequired", "设备序列号不能为空")
	case errors.Is(err, appservice.ErrPackageNameEmpty):
		WriteError(w, http.StatusBadRequest, "APP_PACKAGE_REQUIRED", "AppPage.PackageRequired", "应用包名不能为空")
	case errors.Is(err, appservice.ErrAPKFileEmpty):
		WriteError(w, http.StatusBadRequest, "APP_FILE_REQUIRED", "AppPage.InstallFileRequired", "请选择 APK 文件")
	case errors.Is(err, appservice.ErrPackagePathEmpty):
		WriteError(w, http.StatusNotFound, "APP_PACKAGE_PATH_NOT_FOUND", "AppPage.PackagePathUnavailable", "未找到可下载的 APK 路径")
	default:
		WriteError(w, http.StatusInternalServerError, "APP_REQUEST_FAILED", "AppPage.RequestFailed", fallback)
	}
}

func (h *DeviceHandler) writeFileError(w http.ResponseWriter, err error, fallback string) {
	switch {
	case errors.Is(err, deviceservice.ErrDeviceNotFound):
		WriteError(w, http.StatusNotFound, "DEVICE_NOT_FOUND", "Devices.NotFound", "设备不存在")
	case errors.Is(err, deviceservice.ErrDeviceOffline):
		WriteError(w, http.StatusConflict, "DEVICE_OFFLINE", "Devices.Offline", "设备已断开，请稍后重试")
	case errors.Is(err, deviceservice.ErrDeviceSerialEmpty):
		WriteError(w, http.StatusBadRequest, "DEVICE_SERIAL_REQUIRED", "Devices.SerialRequired", "设备序列号不能为空")
	case errors.Is(err, fileservice.ErrFileNameEmpty):
		WriteError(w, http.StatusBadRequest, "FILE_UPLOAD_REQUIRED", "FilePage.UploadFileRequired", "请选择要上传的文件")
	case errors.Is(err, fileservice.ErrPathOutOfScope):
		WriteError(w, http.StatusBadRequest, "FILE_PATH_OUT_OF_SCOPE", "FilePage.PathOutOfScope", "路径超出允许范围")
	case errors.Is(err, fileservice.ErrProtectedPath):
		WriteError(w, http.StatusBadRequest, "FILE_PATH_PROTECTED", "FilePage.PathProtected", "该路径不允许操作")
	default:
		WriteError(w, http.StatusInternalServerError, "FILE_REQUEST_FAILED", "FilePage.RequestFailed", fallback)
	}
}

func (h *DeviceHandler) writeDevicePreviewError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, deviceservice.ErrDeviceNotFound):
		WriteError(w, http.StatusNotFound, "DEVICE_NOT_FOUND", "Devices.NotFound", "设备不存在")
	case errors.Is(err, deviceservice.ErrDeviceOffline):
		WriteError(w, http.StatusConflict, "DEVICE_OFFLINE", "Devices.Offline", "设备已断开，请稍后重试")
	case errors.Is(err, deviceservice.ErrDeviceSerialEmpty):
		WriteError(w, http.StatusBadRequest, "DEVICE_SERIAL_REQUIRED", "Devices.SerialRequired", "设备序列号不能为空")
	default:
		WriteError(w, http.StatusInternalServerError, "DEVICE_PREVIEW_FAILED", "HomeView.PreviewLoadFailed", "设备预览加载失败")
	}
}

func deviceIDFromPath(path string) (int, error) {
	value := strings.TrimPrefix(path, "/api/devices/")
	if index := strings.IndexByte(value, '/'); index >= 0 {
		value = value[:index]
	}
	return strconv.Atoi(value)
}

func previewWidthFromQuery(r *http.Request) (int, error) {
	if r == nil {
		return 0, nil
	}

	rawValue := strings.TrimSpace(r.URL.Query().Get("width"))
	if rawValue == "" {
		return 0, nil
	}

	width, err := strconv.Atoi(rawValue)
	if err != nil || width <= 0 {
		return 0, errors.New("invalid preview width")
	}
	return width, nil
}

func sanitizeDownloadFilename(name string) string {
	replacer := strings.NewReplacer("\\", "_", "/", "_", "\"", "_", "\r", "_", "\n", "_")
	clean := strings.TrimSpace(replacer.Replace(name))
	if clean == "" {
		return "download.bin"
	}
	return clean
}
