package adb

import (
	"testing"

	"aylink-agent/pkg/adbkit"
)

func TestClassifyADBTransport(t *testing.T) {
	tests := []struct {
		name   string
		device adbkit.DeviceWithPath
		want   string
	}{
		{name: "usb path", device: adbkit.DeviceWithPath{Serial: "R58N123", USB: "1-2"}, want: "usb"},
		{name: "usb serial fallback", device: adbkit.DeviceWithPath{Serial: "R58N123"}, want: "usb"},
		{name: "wifi ipv4", device: adbkit.DeviceWithPath{Serial: "192.168.1.20:5555"}, want: "wifi"},
		{name: "wifi ipv6", device: adbkit.DeviceWithPath{Serial: "[fd00::20]:5555"}, want: "wifi"},
		{name: "wifi mdns", device: adbkit.DeviceWithPath{Serial: "adb-R58N123._adb-tls-connect._tcp"}, want: "wifi"},
		{name: "emulator", device: adbkit.DeviceWithPath{Serial: "emulator-5554"}, want: "emulator"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := classifyADBTransport(test.device); got != test.want {
				t.Fatalf("classifyADBTransport() = %q, want %q", got, test.want)
			}
		})
	}
}
