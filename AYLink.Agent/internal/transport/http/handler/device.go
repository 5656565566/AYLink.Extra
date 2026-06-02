package handler

import (
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

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
	appService      AppService
	fileService     FileService
	settingsService DeviceSettingsService
	scrcpyService   ScrcpyService
}

func NewDeviceHandler(service DeviceService, accessService DeviceAccessService, groupService DeviceGroupService, appService AppService, fileService FileService, settingsService DeviceSettingsService, scrcpyService ScrcpyService) *DeviceHandler {
	return &DeviceHandler{
		service:         service,
		accessService:   accessService,
		groupService:    groupService,
		appService:      appService,
		fileService:     fileService,
		settingsService: settingsService,
		scrcpyService:   scrcpyService,
	}
}

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

	var payload struct {
		Name string `json:"Name"`
	}
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

	var payload struct {
		PackageName string `json:"packageName"`
	}
	if err := decodeJSONBody(r, &payload); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_JSON", "Errors.InvalidJson", "请求 JSON 无效")
		return
	}

	if err := h.appService.Launch(r.Context(), id, payload.PackageName); err != nil {
		h.writeAppError(w, err, "应用启动失败")
		return
	}

	WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

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

	var payload struct {
		PackageName string `json:"packageName"`
	}
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

	var payload struct {
		PackageName string `json:"packageName"`
	}
	if err := decodeJSONBody(r, &payload); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_JSON", "Errors.InvalidJson", "请求 JSON 无效")
		return
	}

	if err := h.appService.Uninstall(r.Context(), id, payload.PackageName); err != nil {
		h.writeAppError(w, err, "应用卸载失败")
		return
	}

	WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

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

	var payload struct {
		PackageName string `json:"packageName"`
	}
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

	if err := r.ParseMultipartForm(256 << 20); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_MULTIPART", "Errors.InvalidUpload", "上传请求无效")
		return
	}

	file, fileHeader, err := r.FormFile("file")
	if err != nil {
		WriteError(w, http.StatusBadRequest, "APP_FILE_REQUIRED", "AppPage.InstallFileRequired", "请选择 APK 文件")
		return
	}
	defer file.Close()

	if err := h.appService.Install(r.Context(), id, fileHeader.Filename, file); err != nil {
		h.writeAppError(w, err, "APK 安装失败")
		return
	}

	WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

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

	var payload struct {
		Path string `json:"path"`
	}
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

	var payload struct {
		Path string `json:"path"`
	}
	if err := decodeJSONBody(r, &payload); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_JSON", "Errors.InvalidJson", "请求 JSON 无效")
		return
	}

	result, err := h.fileService.Download(r.Context(), id, payload.Path)
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

	var payload struct {
		Path    string `json:"path"`
		NewName string `json:"newName"`
	}
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

	WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

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
	WriteJSON(w, http.StatusOK, map[string]any{"groups": groups})
}

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

	var payload struct {
		GroupIDs []int `json:"groupIds"`
	}
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

	WriteJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"groups":  groups,
	})
}

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

	var payload struct {
		Path string `json:"path"`
	}
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

	WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
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

func deviceIDFromPath(path string) (int, error) {
	value := strings.TrimPrefix(path, "/api/devices/")
	if index := strings.IndexByte(value, '/'); index >= 0 {
		value = value[:index]
	}
	return strconv.Atoi(value)
}

func sanitizeDownloadFilename(name string) string {
	replacer := strings.NewReplacer("\\", "_", "/", "_", "\"", "_", "\r", "_", "\n", "_")
	clean := strings.TrimSpace(replacer.Replace(name))
	if clean == "" {
		return "download.bin"
	}
	return clean
}
