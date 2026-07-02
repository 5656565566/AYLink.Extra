package handler

import (
	"errors"
	"net/http"
	"strings"

	i18nservice "aylink-agent/internal/service/i18n"
)

type I18NHandler struct {
	i18n     I18NService
	settings SettingsService
}

func NewI18NHandler(i18n I18NService, settings SettingsService) *I18NHandler {
	return &I18NHandler{
		i18n:     i18n,
		settings: settings,
	}
}

// Languages 获取语言列表
// @Summary 获取语言列表
// @Description 返回 Agent 支持的语言列表。
// @Tags 国际化
// @Produce json
// @Success 200 {array} LanguageOption
// @Failure 500 {object} ErrorResponse
// @Router /api/i18n/languages [get]
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

// Locale 获取语言包
// @Summary 获取语言包
// @Description 返回指定语言区域的语言包，不存在时回退到服务端语言设置。
// @Tags 国际化
// @Produce json
// @Param locale path string true "语言区域代码"
// @Success 200 {object} map[string]interface{}
// @Failure 400 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/i18n/{locale} [get]
func (h *I18NHandler) Locale(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteMethodNotAllowed(w, http.MethodGet)
		return
	}

	locale := strings.TrimPrefix(r.URL.Path, "/api/i18n/")
	if !i18nservice.IsValidLocale(locale) {
		WriteError(w, http.StatusBadRequest, "INVALID_LOCALE", "Errors.InvalidLocale", "无效的语言区域代码")
		return
	}
	if !h.i18n.LocaleExists(locale) {
		fallbackLocale, err := h.settings.GetLanguage(r.Context())
		if err != nil {
			WriteError(w, http.StatusInternalServerError, "SETTINGS_LANGUAGE_LOAD_FAILED", "Errors.SettingsLanguageLoadFailed", "加载服务端语言设置失败")
			return
		}
		locale = fallbackLocale
	}

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

// GetServerLanguage 获取服务端语言
// @Summary 获取服务端语言
// @Description 返回当前服务端语言设置。
// @Tags 设置
// @Produce json
// @Security BearerAuth
// @Success 200 {object} ServerLanguageResponse
// @Failure 401 {object} ErrorResponse
// @Failure 403 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/settings/language [get]
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

	WriteJSON(w, http.StatusOK, ServerLanguageResponse{Locale: locale})
}

// SetServerLanguage 保存服务端语言
// @Summary 保存服务端语言
// @Description 保存服务端语言设置。
// @Tags 设置
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param body body ServerLanguageRequest true "语言设置"
// @Success 200 {object} ServerLanguageResponse
// @Failure 400 {object} ErrorResponse
// @Failure 401 {object} ErrorResponse
// @Failure 403 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/settings/language [put]
func (h *I18NHandler) SetServerLanguage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		WriteMethodNotAllowed(w, http.MethodPut)
		return
	}

	var payload ServerLanguageRequest
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

	WriteJSON(w, http.StatusOK, ServerLanguageResponse{Locale: payload.Locale})
}
