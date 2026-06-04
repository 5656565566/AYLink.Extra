package handler

import (
	"net/http"

	domainsettings "aylink-agent/internal/domain/settings"
)

type SettingsHandler struct {
	service SettingsService
	i18n    I18NService
}

func NewSettingsHandler(service SettingsService, i18n I18NService) *SettingsHandler {
	return &SettingsHandler{service: service, i18n: i18n}
}

func (h *SettingsHandler) GetWebRtcNetwork(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteMethodNotAllowed(w, http.MethodGet)
		return
	}

	payload, err := h.service.GetWebRtcNetworkSettings(r.Context())
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "SETTINGS_WEBRTC_LOAD_FAILED", "Errors.SettingsWebRtcLoadFailed", "加载 WebRTC 网络设置失败")
		return
	}

	WriteJSON(w, http.StatusOK, payload)
}

func (h *SettingsHandler) SaveWebRtcNetwork(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		WriteMethodNotAllowed(w, http.MethodPut)
		return
	}

	var payload domainsettings.WebRtcNetworkSettings
	if err := decodeJSONBody(r, &payload); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_JSON", "Errors.InvalidJson", "请求 JSON 无效")
		return
	}

	if payload.FallbackLocale != "" && !h.i18n.LocaleExists(payload.FallbackLocale) {
		WriteError(w, http.StatusBadRequest, "UNSUPPORTED_LOCALE", "Errors.UnsupportedLocale", "不支持的语言区域代码")
		return
	}

	saved, err := h.service.SaveWebRtcNetworkSettings(r.Context(), payload)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "SETTINGS_WEBRTC_SAVE_FAILED", "Errors.SettingsWebRtcSaveFailed", "保存 WebRTC 网络设置失败")
		return
	}

	WriteJSON(w, http.StatusOK, saved)
}
