package router

import "testing"

func TestIsDeviceConnectPath(t *testing.T) {
	tests := []struct {
		path string
		want bool
	}{
		{path: "/api/devices/connect/1", want: true},
		{path: "/api/devices/1/connect", want: false},
		{path: "/api/devices/some/connect/1", want: false},
		{path: "/api/devices/connect/", want: false},
	}

	for _, test := range tests {
		if got := isDeviceConnectPath(test.path); got != test.want {
			t.Fatalf("path %q: expected %v, got %v", test.path, test.want, got)
		}
	}
}

func TestClassifyDeviceRoute(t *testing.T) {
	tests := []struct {
		path string
		want deviceRouteKind
	}{
		{path: "/api/devices/connect/1", want: deviceRouteConnect},
		{path: "/api/devices/1/terminal/ws", want: deviceRouteTerminalWS},
		{path: "/api/devices/1/settings", want: deviceRouteSettings},
		{path: "/api/devices/1/preview", want: deviceRoutePreview},
		{path: "/api/devices/1/apps", want: deviceRouteApps},
		{path: "/api/devices/1/apps/install", want: deviceRouteAppInstall},
		{path: "/api/devices/1/files/download", want: deviceRouteFilesDownload},
		{path: "/api/devices/1/unknown", want: deviceRouteUnknown},
	}

	for _, test := range tests {
		if got := classifyDeviceRoute(test.path); got != test.want {
			t.Fatalf("path %q: expected %v, got %v", test.path, test.want, got)
		}
	}
}
