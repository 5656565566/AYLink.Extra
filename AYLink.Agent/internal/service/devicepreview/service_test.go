package devicepreview

import (
	"context"
	"errors"
	"image"
	"image/color"
	"io"
	"testing"
	"time"

	domainadb "aylink-agent/internal/domain/adb"
	deviceservice "aylink-agent/internal/service/device"
)

type fakeDeviceResolver struct {
	serial string
	err    error
	calls  int
}

func (f *fakeDeviceResolver) ResolveSerialForAccess(context.Context, int) (string, error) {
	f.calls++
	if f.err != nil {
		return "", f.err
	}
	return f.serial, nil
}

type fakeADBManager struct {
	screenshot image.Image
	err        error
	calls      int
	serials    []string
}

func (f *fakeADBManager) ServerAddress() string { panic("unexpected call") }

func (f *fakeADBManager) ResolvedBinary() (domainadb.ResolvedBinary, bool) { panic("unexpected call") }

func (f *fakeADBManager) StartServer(context.Context) error { panic("unexpected call") }

func (f *fakeADBManager) KillServer(context.Context) error { panic("unexpected call") }

func (f *fakeADBManager) Devices(context.Context) ([]domainadb.Device, error) {
	panic("unexpected call")
}

func (f *fakeADBManager) PairDevice(context.Context, string, int, string) (string, error) {
	panic("unexpected call")
}

func (f *fakeADBManager) ConnectDevice(context.Context, string, int) error { panic("unexpected call") }

func (f *fakeADBManager) DeviceDisplayName(context.Context, string) (string, error) {
	panic("unexpected call")
}

func (f *fakeADBManager) CaptureScreenshot(_ context.Context, serial string) (image.Image, error) {
	f.calls++
	f.serials = append(f.serials, serial)
	if f.err != nil {
		return nil, f.err
	}
	return f.screenshot, nil
}

func (f *fakeADBManager) RunCommand(context.Context, string, string) (string, error) {
	panic("unexpected call")
}

func (f *fakeADBManager) ListDirectory(context.Context, string, string) ([]domainadb.DirectoryEntry, error) {
	panic("unexpected call")
}

func (f *fakeADBManager) OpenRead(context.Context, string, string) (io.ReadCloser, error) {
	panic("unexpected call")
}

func (f *fakeADBManager) Push(context.Context, string, string, io.Reader, uint32) error {
	panic("unexpected call")
}

func (f *fakeADBManager) RenamePath(context.Context, string, string, string) error {
	panic("unexpected call")
}

func (f *fakeADBManager) DeletePath(context.Context, string, string) error { panic("unexpected call") }

func (f *fakeADBManager) OpenShellSession(context.Context, string) (domainadb.ShellSession, error) {
	panic("unexpected call")
}

func solidImage(width, height int, fill color.Color) image.Image {
	canvas := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			canvas.Set(x, y, fill)
		}
	}
	return canvas
}

func TestServiceGetCachesSuccessfulPreview(t *testing.T) {
	resolver := &fakeDeviceResolver{serial: "serial-1"}
	adb := &fakeADBManager{screenshot: solidImage(64, 128, color.RGBA{R: 200, G: 100, B: 50, A: 255})}
	service := NewService(resolver, adb)
	service.cacheTTL = time.Hour

	first, err := service.Get(context.Background(), 7)
	if err != nil {
		t.Fatalf("Get() first error = %v", err)
	}
	if len(first) == 0 {
		t.Fatal("expected preview bytes from first capture")
	}

	second, err := service.Get(context.Background(), 7)
	if err != nil {
		t.Fatalf("Get() second error = %v", err)
	}
	if len(second) == 0 {
		t.Fatal("expected preview bytes from cache")
	}
	if adb.calls != 1 {
		t.Fatalf("expected one screenshot capture, got %d", adb.calls)
	}
	if resolver.calls != 1 {
		t.Fatalf("expected one serial resolution, got %d", resolver.calls)
	}
}

func TestServiceGetReturnsStalePreviewWhenRefreshFails(t *testing.T) {
	resolver := &fakeDeviceResolver{serial: "serial-2"}
	adb := &fakeADBManager{screenshot: solidImage(64, 128, color.RGBA{R: 50, G: 120, B: 220, A: 255})}
	service := NewService(resolver, adb)
	service.cacheTTL = time.Millisecond

	cached, err := service.Get(context.Background(), 9)
	if err != nil {
		t.Fatalf("Get() seed cache error = %v", err)
	}
	if len(cached) == 0 {
		t.Fatal("expected cached preview bytes")
	}

	time.Sleep(5 * time.Millisecond)
	adb.err = errors.New("capture failed")

	stale, err := service.Get(context.Background(), 9)
	if err != nil {
		t.Fatalf("Get() stale fallback error = %v", err)
	}
	if string(stale) != string(cached) {
		t.Fatal("expected stale preview bytes to be returned on refresh failure")
	}
	if adb.calls != 2 {
		t.Fatalf("expected refresh attempt after ttl expiry, got %d captures", adb.calls)
	}
}

func TestServiceGetReturnsErrorWithoutCacheWhenCaptureFails(t *testing.T) {
	resolver := &fakeDeviceResolver{serial: "serial-3"}
	adb := &fakeADBManager{err: errors.New("capture failed")}
	service := NewService(resolver, adb)

	data, err := service.Get(context.Background(), 11)
	if err == nil {
		t.Fatal("expected capture error")
	}
	if data != nil {
		t.Fatalf("expected nil preview bytes, got %d", len(data))
	}
}

func TestServiceGetPropagatesResolverErrors(t *testing.T) {
	resolver := &fakeDeviceResolver{err: deviceservice.ErrDeviceNotFound}
	adb := &fakeADBManager{screenshot: solidImage(32, 64, color.RGBA{A: 255})}
	service := NewService(resolver, adb)

	_, err := service.Get(context.Background(), 15)
	if !errors.Is(err, deviceservice.ErrDeviceNotFound) {
		t.Fatalf("expected device not found error, got %v", err)
	}
	if adb.calls != 0 {
		t.Fatalf("expected no screenshot capture when resolving serial fails, got %d", adb.calls)
	}
}
