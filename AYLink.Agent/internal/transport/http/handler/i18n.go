package handler

import (
	"errors"
	"net/http"
	"strings"

	i18nservice "aylink-agent/internal/service/i18n"
	settingsservice "aylink-agent/internal/service/settings"
)

type I18NHandler struct {
	i18n     *i18nservice.Service
	settings *settingsservice.Service
}

func NewI18NHandler(i18n *i18nservice.Service, settings *settingsservice.Service) *I18NHandler {
	return &I18NHandler{
		i18n:     i18n,
		settings: settings,
	}
}

func (h *I18NHandler) Languages(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteMethodNotAllowed(w, http.MethodGet)
		return
	}

	languages, err := h.i18n.GetLanguages()
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "I18N_LANGUAGES_LOAD_FAILED", "Errors.I18nLanguagesLoadFailed", "加载语言列表失败")
		return
	}

	WriteJSON(w, http.StatusOK, languages)
}

func (h *I18NHandler) Locale(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteMethodNotAllowed(w, http.MethodGet)
		return
	}

	locale := strings.TrimPrefix(r.URL.Path, "/api/i18n/")
	payload, err := h.i18n.GetLanguage(locale)
	if err != nil {
		if errors.Is(err, i18nservice.ErrInvalidLocale) {
			WriteError(w, http.StatusBadRequest, "INVALID_LOCALE", "Errors.InvalidLocale", "无效的语言区域代码")
			return
		}
		WriteError(w, http.StatusInternalServerError, "I18N_LOCALE_LOAD_FAILED", "Errors.I18nLocaleLoadFailed", "加载语言内容失败")
		return
	}

	WriteJSON(w, http.StatusOK, payload)
}

func (h *I18NHandler) GetServerLanguage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteMethodNotAllowed(w, http.MethodGet)
		return
	}

	locale, err := h.settings.GetLanguage(r.Context())
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "SETTINGS_LANGUAGE_LOAD_FAILED", "Errors.SettingsLanguageLoadFailed", "加载服务端语言设置失败")
		return
	}

	WriteJSON(w, http.StatusOK, map[string]any{
		"locale": locale,
	})
}

func (h *I18NHandler) SetServerLanguage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		WriteMethodNotAllowed(w, http.MethodPut)
		return
	}

	var payload struct {
		Locale string `json:"locale"`
	}
	if err := decodeJSONBody(r, &payload); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_JSON", "Errors.InvalidJson", "请求 JSON 无效")
		return
	}

	if !h.i18n.LocaleExists(payload.Locale) {
		WriteError(w, http.StatusBadRequest, "UNSUPPORTED_LOCALE", "Errors.UnsupportedLocale", "不支持的语言区域代码")
		return
	}

	if err := h.settings.SetLanguage(r.Context(), payload.Locale); err != nil {
		WriteError(w, http.StatusInternalServerError, "SETTINGS_LANGUAGE_SAVE_FAILED", "Errors.SettingsLanguageSaveFailed", "保存服务端语言设置失败")
		return
	}

	WriteJSON(w, http.StatusOK, map[string]any{
		"locale": payload.Locale,
	})
}
