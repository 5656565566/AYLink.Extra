package settings

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"

	domainsettings "aylink-agent/internal/domain/settings"
	"aylink-agent/internal/infra/sqlite"
)

func openTestDB(t *testing.T) *sql.DB {
	t.Helper()

	dbPath := filepath.Join(t.TempDir(), "settings-service-test.db")
	db, err := sqlite.Open(dbPath)
	if err != nil {
		t.Fatalf("sqlite.Open() error = %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})
	return db
}

func TestGetLanguageReturnsDefaultWhenValueMissingOrEmpty(t *testing.T) {
	db := openTestDB(t)
	service := NewService(db)
	ctx := context.Background()

	_, err := db.ExecContext(ctx, `DELETE FROM Settings WHERE Key = 'ui_language'`)
	if err != nil {
		t.Fatalf("delete ui_language error = %v", err)
	}

	locale, err := service.GetLanguage(ctx)
	if err != nil {
		t.Fatalf("GetLanguage() missing error = %v", err)
	}
	if locale != "zh-CN" {
		t.Fatalf("expected zh-CN default, got %s", locale)
	}

	_, err = db.ExecContext(ctx, `INSERT INTO Settings (Key, Value, Description, UpdatedAt) VALUES ('ui_language', '', 'UI language locale', '2025-01-01T00:00:00Z')
		ON CONFLICT(Key) DO UPDATE SET Value = excluded.Value, UpdatedAt = excluded.UpdatedAt`)
	if err != nil {
		t.Fatalf("insert empty ui_language error = %v", err)
	}

	locale, err = service.GetLanguage(ctx)
	if err != nil {
		t.Fatalf("GetLanguage() empty error = %v", err)
	}
	if locale != "zh-CN" {
		t.Fatalf("expected zh-CN default for empty value, got %s", locale)
	}
}

func TestSetLanguagePersistsValue(t *testing.T) {
	db := openTestDB(t)
	service := NewService(db)
	ctx := context.Background()

	if err := service.SetLanguage(ctx, "en-US"); err != nil {
		t.Fatalf("SetLanguage() error = %v", err)
	}

	locale, err := service.GetLanguage(ctx)
	if err != nil {
		t.Fatalf("GetLanguage() error = %v", err)
	}
	if locale != "en-US" {
		t.Fatalf("expected persisted locale en-US, got %s", locale)
	}
}

func TestGetWebRtcNetworkSettingsFallsBackToDefaultsOnInvalidJSON(t *testing.T) {
	db := openTestDB(t)
	service := NewService(db)
	ctx := context.Background()

	_, err := db.ExecContext(ctx, `UPDATE Settings SET Value = '{' WHERE Key = ?`, webRtcNetworkConfigKey)
	if err != nil {
		t.Fatalf("update invalid webrtc config error = %v", err)
	}

	settings, err := service.GetWebRtcNetworkSettings(ctx)
	if err != nil {
		t.Fatalf("GetWebRtcNetworkSettings() error = %v", err)
	}
	if settings.IceTransportPolicy != "all" || len(settings.IceServers) != 1 {
		t.Fatalf("expected default settings fallback, got %+v", settings)
	}
}

func TestSaveWebRtcNetworkSettingsNormalizesAndPersists(t *testing.T) {
	db := openTestDB(t)
	service := NewService(db)
	ctx := context.Background()

	username := "  user  "
	credential := "secret"
	bindPort := 3478
	invalidPublishPort := 70000
	input := domainsettings.WebRtcNetworkSettings{
		IceTransportPolicy: "relay",
		IceServers: []domainsettings.WebRtcIceServer{
			{
				Urls:       []string{" stun:example.org ", "stun:example.org", ""},
				Username:   &username,
				Credential: &credential,
			},
			{
				Urls:       []string{"stun:example.org"},
				Username:   &username,
				Credential: &credential,
			},
		},
		HostCandidateOverrideEnabled: false,
		HostCandidateOverrideIPs:     []string{" 1.1.1.1 ", "1.1.1.1", ""},
		HostCandidatePortMin:         intPtr(10000),
		HostCandidatePortMax:         intPtr(10010),
		SinglePortMuxEnabled:         true,
		SinglePortMuxBindPort:        &bindPort,
		SinglePortMuxPublishPort:     &invalidPublishPort,
	}

	saved, err := service.SaveWebRtcNetworkSettings(ctx, input)
	if err != nil {
		t.Fatalf("SaveWebRtcNetworkSettings() error = %v", err)
	}
	if saved.IceTransportPolicy != "relay" {
		t.Fatalf("expected relay transport policy, got %s", saved.IceTransportPolicy)
	}
	if len(saved.IceServers) != 1 || len(saved.IceServers[0].Urls) != 1 || saved.IceServers[0].Urls[0] != "stun:example.org" {
		t.Fatalf("expected deduped ice servers, got %+v", saved.IceServers)
	}
	if saved.IceServers[0].Username == nil || *saved.IceServers[0].Username != "user" {
		t.Fatalf("expected trimmed username, got %+v", saved.IceServers[0].Username)
	}
	if len(saved.HostCandidateOverrideIPs) != 1 || saved.HostCandidateOverrideIPs[0] != "1.1.1.1" {
		t.Fatalf("expected deduped host override IPs, got %+v", saved.HostCandidateOverrideIPs)
	}
	if saved.HostCandidatePortMin != nil || saved.HostCandidatePortMax != nil {
		t.Fatalf("expected host candidate port range to be cleared when single-port mux enabled, got %+v/%+v", saved.HostCandidatePortMin, saved.HostCandidatePortMax)
	}
	if saved.SinglePortMuxBindPort == nil || *saved.SinglePortMuxBindPort != bindPort {
		t.Fatalf("expected bind port %d, got %+v", bindPort, saved.SinglePortMuxBindPort)
	}
	if saved.SinglePortMuxPublishPort != nil {
		t.Fatalf("expected invalid publish port to normalize to nil, got %+v", saved.SinglePortMuxPublishPort)
	}
	if !saved.HostCandidateOverrideEnabled {
		t.Fatal("expected host candidate override to be enabled when single-port mux is enabled")
	}

	loaded, err := service.GetWebRtcNetworkSettings(ctx)
	if err != nil {
		t.Fatalf("GetWebRtcNetworkSettings() error = %v", err)
	}
	if loaded.IceTransportPolicy != saved.IceTransportPolicy || len(loaded.IceServers) != len(saved.IceServers) {
		t.Fatalf("expected persisted normalized settings, got %+v", loaded)
	}
}

func TestNormalizeOptionalPortRange(t *testing.T) {
	min, max := normalizeOptionalPortRange(intPtr(1000), intPtr(2000))
	if min == nil || max == nil || *min != 1000 || *max != 2000 {
		t.Fatalf("expected valid port range, got %+v %+v", min, max)
	}

	min, max = normalizeOptionalPortRange(intPtr(2000), intPtr(1000))
	if min != nil || max != nil {
		t.Fatalf("expected invalid descending range to normalize to nil, got %+v %+v", min, max)
	}
}

func TestNormalizeSinglePortMux(t *testing.T) {
	enabled, bind, publish := normalizeSinglePortMux(false, intPtr(1234), intPtr(5678))
	if enabled || bind != nil || publish != nil {
		t.Fatalf("expected disabled mux to clear ports, got enabled=%v bind=%+v publish=%+v", enabled, bind, publish)
	}

	enabled, bind, publish = normalizeSinglePortMux(true, intPtr(1234), intPtr(5678))
	if !enabled || bind == nil || publish == nil || *bind != 1234 || *publish != 5678 {
		t.Fatalf("expected valid mux ports, got enabled=%v bind=%+v publish=%+v", enabled, bind, publish)
	}

	invalidPublish := 99999
	enabled, bind, publish = normalizeSinglePortMux(true, intPtr(1234), &invalidPublish)
	if !enabled || bind == nil || *bind != 1234 || publish != nil {
		t.Fatalf("expected invalid publish port to normalize to nil, got enabled=%v bind=%+v publish=%+v", enabled, bind, publish)
	}
}

func intPtr(value int) *int {
	return &value
}
