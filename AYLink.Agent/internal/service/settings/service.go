package settings

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"time"

	domainsettings "aylink-agent/internal/domain/settings"
	i18nservice "aylink-agent/internal/service/i18n"
)

type Service struct {
	db *sql.DB
}

type settingsExecutor interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

const (
	fallbackLanguageConfigKey = "fallback_language"
	legacyUILanguageConfigKey = "ui_language"
	webRtcNetworkConfigKey    = "webrtc_network_config"
)

func NewService(db *sql.DB) *Service {
	return &Service{db: db}
}

func (s *Service) GetLanguage(ctx context.Context) (string, error) {
	locale, found, err := s.getSettingValue(ctx, fallbackLanguageConfigKey)
	if err != nil {
		return "", err
	}
	if locale = normalizeFallbackLocale(locale); locale != "" {
		return locale, nil
	}

	legacyLocale, foundLegacy, err := s.getSettingValue(ctx, legacyUILanguageConfigKey)
	if err != nil {
		return "", err
	}
	if legacyLocale = normalizeFallbackLocale(legacyLocale); !found && foundLegacy && legacyLocale != "" {
		return legacyLocale, nil
	}

	return i18nservice.DefaultLocale, nil
}

func (s *Service) getSettingValue(ctx context.Context, key string) (string, bool, error) {
	row := s.db.QueryRowContext(ctx, `SELECT Value FROM Settings WHERE Key = ?`, key)
	var locale string
	if err := row.Scan(&locale); err != nil {
		if err == sql.ErrNoRows {
			return "", false, nil
		}
		return "", false, err
	}

	return locale, true, nil
}

func (s *Service) SetLanguage(ctx context.Context, locale string) error {
	normalizedLocale := normalizeFallbackLocale(locale)
	if normalizedLocale == "" {
		normalizedLocale = i18nservice.DefaultLocale
	}
	return upsertSettingValue(ctx, s.db, fallbackLanguageConfigKey, normalizedLocale, "Default fallback language locale")
}

func upsertSettingValue(ctx context.Context, executor settingsExecutor, key string, value string, description string) error {
	_, err := executor.ExecContext(ctx, `
		INSERT INTO Settings (Key, Value, Description, UpdatedAt)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(Key) DO UPDATE SET
			Value = excluded.Value,
			Description = excluded.Description,
			UpdatedAt = excluded.UpdatedAt`,
		key, value, description, time.Now().UTC().Format(time.RFC3339Nano))
	return err
}

func (s *Service) GetWebRtcNetworkSettings(ctx context.Context) (domainsettings.WebRtcNetworkSettings, error) {
	row := s.db.QueryRowContext(ctx, `SELECT Value FROM Settings WHERE Key = ?`, webRtcNetworkConfigKey)
	var raw string
	if err := row.Scan(&raw); err != nil {
		if err == sql.ErrNoRows {
			return s.defaultWebRtcNetworkSettings(ctx)
		}
		return domainsettings.WebRtcNetworkSettings{}, err
	}

	if strings.TrimSpace(raw) == "" {
		return s.defaultWebRtcNetworkSettings(ctx)
	}

	var payload domainsettings.WebRtcNetworkSettings
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		return s.defaultWebRtcNetworkSettings(ctx)
	}

	normalized := normalizeWebRtcNetworkSettings(payload)
	locale, err := s.GetLanguage(ctx)
	if err != nil {
		return domainsettings.WebRtcNetworkSettings{}, err
	}
	normalized.FallbackLocale = locale
	return normalized, nil
}

func (s *Service) defaultWebRtcNetworkSettings(ctx context.Context) (domainsettings.WebRtcNetworkSettings, error) {
	settings := defaultWebRtcNetworkSettings()
	locale, err := s.GetLanguage(ctx)
	if err != nil {
		return domainsettings.WebRtcNetworkSettings{}, err
	}
	settings.FallbackLocale = locale
	return settings, nil
}

func (s *Service) SaveWebRtcNetworkSettings(ctx context.Context, settings domainsettings.WebRtcNetworkSettings) (domainsettings.WebRtcNetworkSettings, error) {
	normalized := normalizeWebRtcNetworkSettings(settings)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return domainsettings.WebRtcNetworkSettings{}, err
	}
	defer tx.Rollback()

	raw, err := json.Marshal(normalized)
	if err != nil {
		return domainsettings.WebRtcNetworkSettings{}, err
	}

	if err := upsertSettingValue(ctx, tx, fallbackLanguageConfigKey, normalized.FallbackLocale, "Default fallback language locale"); err != nil {
		return domainsettings.WebRtcNetworkSettings{}, err
	}

	_, err = tx.ExecContext(ctx, `
		INSERT INTO Settings (Key, Value, Description, UpdatedAt)
		VALUES (?, ?, 'Global WebRTC ICE network settings', ?)
		ON CONFLICT(Key) DO UPDATE SET
			Value = excluded.Value,
			Description = excluded.Description,
			UpdatedAt = excluded.UpdatedAt`,
		webRtcNetworkConfigKey,
		string(raw),
		time.Now().UTC().Format(time.RFC3339Nano),
	)
	if err != nil {
		return domainsettings.WebRtcNetworkSettings{}, err
	}

	if err := tx.Commit(); err != nil {
		return domainsettings.WebRtcNetworkSettings{}, err
	}

	return normalized, nil
}

func defaultWebRtcNetworkSettings() domainsettings.WebRtcNetworkSettings {
	return domainsettings.WebRtcNetworkSettings{
		IceTransportPolicy:           "all",
		FallbackLocale:               i18nservice.DefaultLocale,
		HostCandidateOverrideEnabled: false,
		HostCandidateOverrideIPs:     nil,
		HostCandidatePortMin:         nil,
		HostCandidatePortMax:         nil,
		SinglePortMuxEnabled:         false,
		SinglePortMuxBindPort:        nil,
		SinglePortMuxPublishPort:     nil,
		IceServers: []domainsettings.WebRtcIceServer{
			{
				Urls: []string{"stun:stun.l.google.com:19302"},
			},
		},
	}
}

func normalizeWebRtcNetworkSettings(settings domainsettings.WebRtcNetworkSettings) domainsettings.WebRtcNetworkSettings {
	policy := "all"
	if strings.EqualFold(settings.IceTransportPolicy, "relay") {
		policy = "relay"
	}

	fallbackLocale := normalizeFallbackLocale(settings.FallbackLocale)
	if fallbackLocale == "" {
		fallbackLocale = i18nservice.DefaultLocale
	}

	seen := map[string]struct{}{}
	servers := make([]domainsettings.WebRtcIceServer, 0, len(settings.IceServers))
	for _, server := range settings.IceServers {
		urls := make([]string, 0, len(server.Urls))
		seenURLs := map[string]struct{}{}
		for _, url := range server.Urls {
			trimmed := strings.TrimSpace(url)
			if trimmed == "" {
				continue
			}
			key := strings.ToLower(trimmed)
			if _, exists := seenURLs[key]; exists {
				continue
			}
			seenURLs[key] = struct{}{}
			urls = append(urls, trimmed)
		}
		if len(urls) == 0 {
			continue
		}

		var username *string
		if server.Username != nil {
			trimmed := strings.TrimSpace(*server.Username)
			if trimmed != "" {
				username = &trimmed
			}
		}

		var credential *string
		if server.Credential != nil && *server.Credential != "" {
			value := *server.Credential
			credential = &value
		}

		dedupKey := strings.Join(urls, "\n") + "||"
		if username != nil {
			dedupKey += *username
		}
		dedupKey += "||"
		if credential != nil {
			dedupKey += *credential
		}
		if _, exists := seen[dedupKey]; exists {
			continue
		}
		seen[dedupKey] = struct{}{}

		servers = append(servers, domainsettings.WebRtcIceServer{
			Urls:       urls,
			Username:   username,
			Credential: credential,
		})
	}

	hostCandidateIPs := make([]string, 0, len(settings.HostCandidateOverrideIPs))
	seenIPs := map[string]struct{}{}
	for _, ip := range settings.HostCandidateOverrideIPs {
		trimmed := strings.TrimSpace(ip)
		if trimmed == "" {
			continue
		}

		key := strings.ToLower(trimmed)
		if _, exists := seenIPs[key]; exists {
			continue
		}

		seenIPs[key] = struct{}{}
		hostCandidateIPs = append(hostCandidateIPs, trimmed)
	}

	singlePortMuxEnabled, singlePortBindPort, singlePortPublishPort := normalizeSinglePortMux(settings.SinglePortMuxEnabled, settings.SinglePortMuxBindPort, settings.SinglePortMuxPublishPort)
	hostCandidatePortMin, hostCandidatePortMax := normalizeOptionalPortRange(settings.HostCandidatePortMin, settings.HostCandidatePortMax)
	if singlePortMuxEnabled {
		hostCandidatePortMin, hostCandidatePortMax = nil, nil
	}

	return domainsettings.WebRtcNetworkSettings{
		IceTransportPolicy:           policy,
		FallbackLocale:               fallbackLocale,
		IceServers:                   servers,
		HostCandidateOverrideEnabled: settings.HostCandidateOverrideEnabled || singlePortMuxEnabled,
		HostCandidateOverrideIPs:     hostCandidateIPs,
		HostCandidatePortMin:         hostCandidatePortMin,
		HostCandidatePortMax:         hostCandidatePortMax,
		SinglePortMuxEnabled:         singlePortMuxEnabled,
		SinglePortMuxBindPort:        singlePortBindPort,
		SinglePortMuxPublishPort:     singlePortPublishPort,
	}
}

func normalizeFallbackLocale(locale string) string {
	normalized := strings.TrimSpace(locale)
	if normalized == "" || !i18nservice.IsValidLocale(normalized) {
		return ""
	}
	return normalized
}

func normalizeOptionalPortRange(minValue *int, maxValue *int) (*int, *int) {
	if minValue == nil || maxValue == nil {
		return nil, nil
	}

	minPort := *minValue
	maxPort := *maxValue
	if minPort < 1 || minPort > 65535 || maxPort < 1 || maxPort > 65535 || minPort > maxPort {
		return nil, nil
	}

	return &minPort, &maxPort
}

func normalizeSinglePortMux(enabled bool, bindValue *int, publishValue *int) (bool, *int, *int) {
	if !enabled {
		return false, nil, nil
	}

	if bindValue == nil {
		return true, nil, nil
	}

	bindPort := *bindValue
	if bindPort < 1 || bindPort > 65535 {
		return true, nil, nil
	}

	publishPort := bindPort
	if publishValue != nil {
		publishPort = *publishValue
	}
	if publishPort < 1 || publishPort > 65535 {
		return true, &bindPort, nil
	}

	return true, &bindPort, &publishPort
}
