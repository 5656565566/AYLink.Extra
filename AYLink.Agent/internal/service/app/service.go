package app

import (
	"context"
	"errors"
	"fmt"
	"io"
	"path"
	"strconv"
	"strings"
	"time"

	domainadb "aylink-agent/internal/domain/adb"
	deviceservice "aylink-agent/internal/service/device"
)

var (
	ErrPackageNameEmpty = errors.New("package name is required")
	ErrAPKFileEmpty     = errors.New("apk file is required")
	ErrPackagePathEmpty = errors.New("package path is unavailable")
)

type Service struct {
	devices *deviceservice.Service
	adb     domainadb.Manager
}

type DownloadResult struct {
	Name   string
	Reader io.ReadCloser
}

type AppInfoResult struct {
	PackageName          string   `json:"packageName"`
	VersionName          string   `json:"versionName"`
	VersionCode          string   `json:"versionCode"`
	FirstInstallTime     string   `json:"firstInstallTime"`
	LastUpdateTime       string   `json:"lastUpdateTime"`
	InstallerPackageName string   `json:"installerPackageName"`
	PrimaryApkPath       string   `json:"primaryApkPath"`
	ApkPaths             []string `json:"apkPaths"`
}

func NewService(devices *deviceservice.Service, adb domainadb.Manager) *Service {
	return &Service{
		devices: devices,
		adb:     adb,
	}
}

func (s *Service) Launch(ctx context.Context, deviceID int, packageName string) error {
	serial, pkg, err := s.resolveDeviceAndPackage(ctx, deviceID, packageName)
	if err != nil {
		return err
	}

	output, err := s.adb.RunCommand(ctx, serial, fmt.Sprintf("monkey -p %s -c android.intent.category.LAUNCHER 1", quoteShellArg(pkg)))
	if err != nil {
		return err
	}

	lower := strings.ToLower(output)
	if strings.Contains(lower, "no activities found") ||
		strings.Contains(lower, "monkey aborted") ||
		strings.Contains(lower, "error") {
		return fmt.Errorf("launch app failed: %s", strings.TrimSpace(output))
	}
	return nil
}

func (s *Service) Uninstall(ctx context.Context, deviceID int, packageName string) error {
	serial, pkg, err := s.resolveDeviceAndPackage(ctx, deviceID, packageName)
	if err != nil {
		return err
	}

	output, err := s.adb.RunCommand(ctx, serial, fmt.Sprintf("pm uninstall %s", quoteShellArg(pkg)))
	if err != nil {
		return err
	}
	if !strings.Contains(output, "Success") {
		return fmt.Errorf("uninstall failed: %s", strings.TrimSpace(output))
	}
	return nil
}

func (s *Service) Download(ctx context.Context, deviceID int, packageName string) (*DownloadResult, error) {
	serial, pkg, err := s.resolveDeviceAndPackage(ctx, deviceID, packageName)
	if err != nil {
		return nil, err
	}

	apkPaths, err := s.packagePaths(ctx, serial, pkg)
	if err != nil {
		return nil, err
	}
	primaryPath := selectPrimaryAPK(apkPaths)
	if primaryPath == "" {
		return nil, ErrPackagePathEmpty
	}

	reader, err := s.adb.OpenRead(ctx, serial, primaryPath)
	if err != nil {
		return nil, err
	}

	return &DownloadResult{
		Name:   sanitizeAPKName(pkg) + ".apk",
		Reader: reader,
	}, nil
}

func (s *Service) Info(ctx context.Context, deviceID int, packageName string) (*AppInfoResult, error) {
	serial, pkg, err := s.resolveDeviceAndPackage(ctx, deviceID, packageName)
	if err != nil {
		return nil, err
	}

	dumpsysOutput, err := s.adb.RunCommand(ctx, serial, fmt.Sprintf("dumpsys package %s", quoteShellArg(pkg)))
	if err != nil {
		return nil, err
	}
	apkPaths, err := s.packagePaths(ctx, serial, pkg)
	if err != nil {
		return nil, err
	}

	return &AppInfoResult{
		PackageName:          pkg,
		VersionName:          extractPrefixedValue(dumpsysOutput, "versionName="),
		VersionCode:          extractVersionCode(dumpsysOutput),
		FirstInstallTime:     extractPrefixedValue(dumpsysOutput, "firstInstallTime="),
		LastUpdateTime:       extractPrefixedValue(dumpsysOutput, "lastUpdateTime="),
		InstallerPackageName: extractPrefixedValue(dumpsysOutput, "installerPackageName="),
		PrimaryApkPath:       selectPrimaryAPK(apkPaths),
		ApkPaths:             apkPaths,
	}, nil
}

func (s *Service) Install(ctx context.Context, deviceID int, fileName string, reader io.Reader) error {
	serial, err := s.resolveSerial(ctx, deviceID)
	if err != nil {
		return err
	}

	if strings.TrimSpace(fileName) == "" || reader == nil {
		return ErrAPKFileEmpty
	}

	remotePath := fmt.Sprintf("/data/local/tmp/aylink-install-%d.apk", time.Now().UnixNano())
	if err := s.adb.Push(ctx, serial, remotePath, reader, 0644); err != nil {
		return err
	}
	defer func() {
		_, _ = s.adb.RunCommand(context.Background(), serial, fmt.Sprintf("rm -f %s", quoteShellArg(remotePath)))
	}()

	output, err := s.adb.RunCommand(ctx, serial, fmt.Sprintf("pm install -r %s", quoteShellArg(remotePath)))
	if err != nil {
		return err
	}
	if !strings.Contains(output, "Success") {
		return fmt.Errorf("install failed: %s", strings.TrimSpace(output))
	}
	return nil
}

func (s *Service) resolveDeviceAndPackage(ctx context.Context, deviceID int, packageName string) (string, string, error) {
	serial, err := s.resolveSerial(ctx, deviceID)
	if err != nil {
		return "", "", err
	}
	pkg := strings.TrimSpace(packageName)
	if pkg == "" {
		return "", "", ErrPackageNameEmpty
	}
	return serial, pkg, nil
}

func (s *Service) resolveSerial(ctx context.Context, deviceID int) (string, error) {
	return s.devices.ResolveSerialForAccess(ctx, deviceID)
}

func (s *Service) packagePaths(ctx context.Context, serial string, packageName string) ([]string, error) {
	output, err := s.adb.RunCommand(ctx, serial, fmt.Sprintf("pm path %s", quoteShellArg(packageName)))
	if err != nil {
		return nil, err
	}

	lines := strings.Split(output, "\n")
	paths := make([]string, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "package:") {
			continue
		}
		apkPath := strings.TrimSpace(strings.TrimPrefix(line, "package:"))
		if apkPath != "" {
			paths = append(paths, apkPath)
		}
	}
	if len(paths) == 0 {
		return nil, ErrPackagePathEmpty
	}
	return paths, nil
}

func extractPrefixedValue(text string, prefix string) string {
	for _, line := range strings.Split(text, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, prefix) {
			return strings.TrimSpace(strings.TrimPrefix(trimmed, prefix))
		}
	}
	return ""
}

func extractVersionCode(text string) string {
	for _, line := range strings.Split(text, "\n") {
		trimmed := strings.TrimSpace(line)
		if !strings.HasPrefix(trimmed, "versionCode=") {
			continue
		}
		value := strings.TrimSpace(strings.TrimPrefix(trimmed, "versionCode="))
		if index := strings.IndexAny(value, " \t"); index >= 0 {
			value = value[:index]
		}
		if _, err := strconv.Atoi(value); err == nil {
			return value
		}
		return value
	}
	return ""
}

func selectPrimaryAPK(paths []string) string {
	for _, apkPath := range paths {
		if strings.HasSuffix(apkPath, "/base.apk") {
			return apkPath
		}
	}
	if len(paths) == 0 {
		return ""
	}
	return paths[0]
}

func sanitizeAPKName(packageName string) string {
	name := strings.TrimSpace(packageName)
	if name == "" {
		return "app"
	}
	return strings.ReplaceAll(name, "/", "_")
}

func quoteShellArg(value string) string {
	return "'" + strings.ReplaceAll(value, "'", `'\''`) + "'"
}

func baseName(remotePath string) string {
	name := path.Base(strings.TrimSpace(remotePath))
	if name == "." || name == "/" || name == "" {
		return "app.apk"
	}
	return name
}
