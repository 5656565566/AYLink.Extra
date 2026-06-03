package devicepreview

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"sync"
	"time"

	domainadb "aylink-agent/internal/domain/adb"
	deviceservice "aylink-agent/internal/service/device"
)

const (
	defaultPreviewWidth   = 240
	defaultPreviewQuality = 45
	defaultCacheTTL       = 5 * time.Second
)

type DeviceResolver interface {
	ResolveSerialForAccess(ctx context.Context, id int) (string, error)
}

type Service struct {
	deviceResolver DeviceResolver
	adb            domainadb.Manager
	cacheTTL       time.Duration

	mu    sync.Mutex
	cache map[string]*cacheEntry
}

type cacheEntry struct {
	data      []byte
	updatedAt time.Time
	inflight  chan struct{}
}

func NewService(deviceResolver DeviceResolver, adb domainadb.Manager) *Service {
	return &Service{
		deviceResolver: deviceResolver,
		adb:            adb,
		cacheTTL:       defaultCacheTTL,
		cache:          make(map[string]*cacheEntry),
	}
}

func (s *Service) Get(ctx context.Context, deviceID int, width int) ([]byte, error) {
	if s.deviceResolver == nil || s.adb == nil {
		return nil, errors.New("device preview service is unavailable")
	}

	normalizedWidth := normalizePreviewWidth(width)
	cacheKey := fmt.Sprintf("%d:%d:%d", deviceID, normalizedWidth, defaultPreviewQuality)

	for {
		s.mu.Lock()
		entry, ok := s.cache[cacheKey]
		if !ok {
			entry = &cacheEntry{}
			s.cache[cacheKey] = entry
		}

		if entry.inflight != nil {
			inflight := entry.inflight
			s.mu.Unlock()

			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-inflight:
				continue
			}
		}

		if len(entry.data) > 0 && time.Since(entry.updatedAt) < s.cacheTTL {
			cached := append([]byte(nil), entry.data...)
			s.mu.Unlock()
			return cached, nil
		}

		stale := append([]byte(nil), entry.data...)
		entry.inflight = make(chan struct{})
		inflight := entry.inflight
		s.mu.Unlock()

		data, err := s.capturePreview(ctx, deviceID, normalizedWidth)

		s.mu.Lock()
		if err == nil {
			entry.data = append(entry.data[:0], data...)
			entry.updatedAt = time.Now().UTC()
		}
		entry.inflight = nil
		s.mu.Unlock()
		close(inflight)

		if err == nil {
			return data, nil
		}
		if len(stale) > 0 {
			return stale, nil
		}
		return nil, err
	}
}

func (s *Service) capturePreview(ctx context.Context, deviceID int, width int) ([]byte, error) {
	serial, err := s.deviceResolver.ResolveSerialForAccess(ctx, deviceID)
	if err != nil {
		return nil, err
	}

	screenshot, err := s.adb.CaptureScreenshot(ctx, serial)
	if err != nil {
		return nil, err
	}

	preview := renderPortraitPreview(screenshot, width)
	var buffer bytes.Buffer
	if err := jpeg.Encode(&buffer, preview, &jpeg.Options{Quality: defaultPreviewQuality}); err != nil {
		return nil, err
	}

	return buffer.Bytes(), nil
}

func normalizePreviewWidth(width int) int {
	if width <= 0 {
		return defaultPreviewWidth
	}
	return width
}

func renderPortraitPreview(src image.Image, width int) image.Image {
	normalizedWidth := width
	if normalizedWidth <= 0 {
		normalizedWidth = defaultPreviewWidth
	}

	bounds := src.Bounds()
	srcWidth := bounds.Dx()
	srcHeight := bounds.Dy()
	if srcWidth <= 0 || srcHeight <= 0 {
		return image.NewRGBA(image.Rect(0, 0, normalizedWidth, normalizedWidth*16/9))
	}

	targetHeight := maxInt(normalizedWidth*16/9, normalizedWidth)
	canvas := image.NewRGBA(image.Rect(0, 0, normalizedWidth, targetHeight))
	draw.Draw(canvas, canvas.Bounds(), &image.Uniform{C: color.RGBA{R: 12, G: 12, B: 14, A: 255}}, image.Point{}, draw.Src)

	scaleX := float64(normalizedWidth) / float64(srcWidth)
	scaleY := float64(targetHeight) / float64(srcHeight)
	scale := minFloat64(scaleX, scaleY)
	scaledWidth := maxInt(int(float64(srcWidth)*scale+0.5), 1)
	scaledHeight := maxInt(int(float64(srcHeight)*scale+0.5), 1)
	offsetX := (normalizedWidth - scaledWidth) / 2
	offsetY := (targetHeight - scaledHeight) / 2

	for y := 0; y < scaledHeight; y++ {
		srcY := bounds.Min.Y + int(float64(y)*float64(srcHeight)/float64(scaledHeight))
		for x := 0; x < scaledWidth; x++ {
			srcX := bounds.Min.X + int(float64(x)*float64(srcWidth)/float64(scaledWidth))
			canvas.Set(offsetX+x, offsetY+y, src.At(srcX, srcY))
		}
	}

	return canvas
}

func minFloat64(left, right float64) float64 {
	if left < right {
		return left
	}
	return right
}

func maxInt(left, right int) int {
	if left > right {
		return left
	}
	return right
}

var (
	ErrDeviceNotFound    = deviceservice.ErrDeviceNotFound
	ErrDeviceOffline     = deviceservice.ErrDeviceOffline
	ErrDeviceSerialEmpty = deviceservice.ErrDeviceSerialEmpty
)
