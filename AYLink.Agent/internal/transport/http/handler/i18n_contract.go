package handler

import domaini18n "aylink-agent/internal/domain/i18n"

type LanguageOption = domaini18n.LanguageOption

type ServerLanguageRequest struct {
	Locale string `json:"locale"`
}

type ServerLanguageResponse struct {
	Locale string `json:"locale"`
}
