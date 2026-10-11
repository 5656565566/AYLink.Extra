package rtc

import "testing"

func TestAllowedDeviceURLBindsDeviceAndOperation(t *testing.T) {
	for _, test := range []struct {
		url     string
		allowed bool
	}{
		{"/api/devices/1/files/upload?path=%2Fsdcard", true},
		{"/api/devices/1/apps/install", true},
		{"/api/devices/1/terminal/stream", true},
		{"/api/devices/2/files/download", false},
		{"/api/devices/1/transport", false},
		{"/api/accounts", false},
		{"https://example.test/api/devices/1/files/download", false},
		{"/api/devices/1/files/../apps/install", false},
	} {
		if AllowedDeviceURL(test.url, "1") != test.allowed {
			t.Errorf("URL scope mismatch: %s", test.url)
		}
	}
}
