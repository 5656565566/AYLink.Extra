package handler

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	domaini18n "aylink-agent/internal/domain/i18n"
	domainsettings "aylink-agent/internal/domain/settings"
	i18nservice "aylink-agent/internal/service/i18n"
)

type fakeI18NService struct {
	languages    []domaini18n.LanguageOption
	languagesErr error
	languagePack map[string]any
	languageErr  error
	exists       bool
}

func (f *fakeI18NService) GetLanguages() ([]domaini18n.LanguageOption, error) {
	return f.languages, f.languagesErr
}

func (f *fakeI18NService) GetLanguage(string) (map[string]any, error) {
	return f.languagePack, f.languageErr
}

func (f *fakeI18NService) LocaleExists(string) bool {
	return f.exists
}

type fakeLanguageSettingsService struct {
	language      string
	getErr        error
	setErr        error
	savedLanguage string
}

func (f *fakeLanguageSettingsService) GetLanguage(context.Context) (string, error) {
	return f.language, f.getErr
}

func (f *fakeLanguageSettingsService) SetLanguage(_ context.Context, locale string) error {
	f.savedLanguage = locale
	return f.setErr
}

func (f *fakeLanguageSettingsService) GetWebRtcNetworkSettings(context.Context) (domainsettings.WebRtcNetworkSettings, error) {
	panic("unexpected call")
}

func (f *fakeLanguageSettingsService) SaveWebRtcNetworkSettings(context.Context, domainsettings.WebRtcNetworkSettings) (domainsettings.WebRtcNetworkSettings, error) {
	panic("unexpected call")
}

func TestI18NHandlerLanguagesReturnsList(t *testing.T) {
	handler := NewI18NHandler(&fakeI18NService{
		languages: []domaini18n.LanguageOption{{Locale: "zh-CN", Name: "简体中文"}},
	}, &fakeSettingsService{})

	req := httptest.NewRequest(http.MethodGet, "/api/i18n/languages", nil)
	recorder := httptest.NewRecorder()

	handler.Languages(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", recorder.Code)
	}
	if !strings.Contains(recorder.Body.String(), `"locale":"zh-CN"`) {
		t.Fatalf("expected language payload, got %s", recorder.Body.String())
	}
}

func TestI18NHandlerLocaleMapsInvalidLocale(t *testing.T) {
	handler := NewI18NHandler(&fakeI18NService{
		languageErr: i18nservice.ErrInvalidLocale,
	}, &fakeSettingsService{})

	req := httptest.NewRequest(http.MethodGet, "/api/i18n/invalid", nil)
	recorder := httptest.NewRecorder()

	handler.Locale(recorder, req)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", recorder.Code)
	}
}

func TestI18NHandlerSetServerLanguageRejectsUnsupportedLocale(t *testing.T) {
	settings := &fakeLanguageSettingsService{}
	handler := NewI18NHandler(&fakeI18NService{exists: false}, settings)

	req := httptest.NewRequest(http.MethodPut, "/api/settings/language", strings.NewReader(`{"locale":"fr-FR"}`))
	recorder := httptest.NewRecorder()

	handler.SetServerLanguage(recorder, req)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", recorder.Code)
	}
	if settings.savedLanguage != "" {
		t.Fatal("expected SetLanguage not to be called for unsupported locale")
	}
}

func TestI18NHandlerSetServerLanguageSavesLocale(t *testing.T) {
	settings := &fakeLanguageSettingsService{}
	handler := NewI18NHandler(&fakeI18NService{exists: true}, settings)

	req := httptest.NewRequest(http.MethodPut, "/api/settings/language", strings.NewReader(`{"locale":"en-US"}`))
	recorder := httptest.NewRecorder()

	handler.SetServerLanguage(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", recorder.Code)
	}
	if settings.savedLanguage != "en-US" {
		t.Fatalf("expected locale to be saved, got %s", settings.savedLanguage)
	}
}

func TestI18NHandlerGetServerLanguageMapsSettingsError(t *testing.T) {
	handler := NewI18NHandler(&fakeI18NService{}, &fakeLanguageSettingsService{getErr: errors.New("load failed")})

	req := httptest.NewRequest(http.MethodGet, "/api/settings/language", nil)
	recorder := httptest.NewRecorder()

	handler.GetServerLanguage(recorder, req)

	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", recorder.Code)
	}
}
