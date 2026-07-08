package file

import (
	"context"
	"errors"
	"io"
	"path"
	"slices"
	"strings"

	domainadb "aylink-agent/internal/domain/adb"
	deviceservice "aylink-agent/internal/service/device"
)

var ErrFileNameEmpty = errors.New("file name is required")
var ErrPathOutOfScope = errors.New("path is outside the allowed root")
var ErrProtectedPath = errors.New("path is protected")

const allowedRootDirectory = "/sdcard"

type Service struct {
	devices *deviceservice.Service
	adb     domainadb.Manager
}

type ListResult struct {
	Path  string                     `json:"path"`
	Items []domainadb.DirectoryEntry `json:"items"`
}

type DownloadResult struct {
	Name   string
	Reader io.ReadCloser
}

func NewService(devices *deviceservice.Service, adb domainadb.Manager) *Service {
	return &Service{
		devices: devices,
		adb:     adb,
	}
}

func (s *Service) List(ctx context.Context, deviceID int, rawPath string) (*ListResult, error) {
	serial, err := s.devices.ResolveSerialForAccess(ctx, deviceID)
	if err != nil {
		return nil, err
	}

	normalizedPath, err := validateScopedPath(rawPath)
	if err != nil {
		return nil, err
	}
	normalizedPath = normalizeDirectoryPath(normalizedPath)
	entries, err := s.adb.ListDirectory(ctx, serial, normalizedPath)
	if err != nil {
		return nil, err
	}

	items := make([]domainadb.DirectoryEntry, 0, len(entries))
	for _, entry := range entries {
		if entry.Name == "." || entry.Name == ".." {
			continue
		}
		items = append(items, entry)
	}

	slices.SortFunc(items, func(a, b domainadb.DirectoryEntry) int {
		switch {
		case a.IsDirectory && !b.IsDirectory:
			return -1
		case !a.IsDirectory && b.IsDirectory:
			return 1
		default:
			return strings.Compare(strings.ToLower(a.Name), strings.ToLower(b.Name))
		}
	})

	return &ListResult{
		Path:  normalizedPath,
		Items: items,
	}, nil
}

func (s *Service) Download(ctx context.Context, deviceID int, rawPath string) (*DownloadResult, error) {
	serial, err := s.devices.ResolveSerialForAccess(ctx, deviceID)
	if err != nil {
		return nil, err
	}

	normalizedPath, err := validateScopedPath(rawPath)
	if err != nil {
		return nil, err
	}
	reader, err := s.adb.OpenRead(ctx, serial, normalizedPath)
	if err != nil {
		return nil, err
	}

	return &DownloadResult{
		Name:   baseName(normalizedPath),
		Reader: reader,
	}, nil
}

func (s *Service) Upload(ctx context.Context, deviceID int, rawDirectory string, relativePath string, fallbackName string, reader io.Reader) error {
	serial, err := s.devices.ResolveSerialForAccess(ctx, deviceID)
	if err != nil {
		return err
	}
	if reader == nil {
		return ErrFileNameEmpty
	}

	directory, err := validateScopedPath(rawDirectory)
	if err != nil {
		return err
	}
	uploadRelativePath, err := normalizeUploadRelativePath(relativePath, fallbackName)
	if err != nil {
		return err
	}
	targetPath, err := validateScopedPath(normalizeDirectoryPath(directory) + uploadRelativePath)
	if err != nil {
		return err
	}

	targetDirectory := parentDirectory(targetPath)
	if _, err := s.adb.RunCommand(ctx, serial, "mkdir -p "+quoteShellArg(targetDirectory)); err != nil {
		return err
	}
	return s.adb.Push(ctx, serial, targetPath, reader, 0644)
}

func (s *Service) Rename(ctx context.Context, deviceID int, rawPath string, newName string) error {
	serial, err := s.devices.ResolveSerialForAccess(ctx, deviceID)
	if err != nil {
		return err
	}

	trimmedName := strings.TrimSpace(newName)
	if trimmedName == "" {
		return ErrFileNameEmpty
	}
	trimmedName = strings.ReplaceAll(trimmedName, "\\", "/")
	if strings.Contains(trimmedName, "/") {
		return ErrFileNameEmpty
	}

	sourcePath, err := validateScopedPath(rawPath)
	if err != nil {
		return err
	}
	if isProtectedPath(sourcePath) {
		return ErrProtectedPath
	}
	targetPath := parentDirectory(sourcePath) + trimmedName
	if strings.HasSuffix(rawPath, "/") {
		targetPath = ensureTrailingSlash(targetPath)
	}
	if _, err := validateScopedPath(targetPath); err != nil {
		return err
	}
	return s.adb.RenamePath(ctx, serial, sourcePath, targetPath)
}

func (s *Service) Delete(ctx context.Context, deviceID int, rawPath string) error {
	serial, err := s.devices.ResolveSerialForAccess(ctx, deviceID)
	if err != nil {
		return err
	}

	normalizedPath, err := validateScopedPath(rawPath)
	if err != nil {
		return err
	}
	if isProtectedPath(normalizedPath) {
		return ErrProtectedPath
	}
	return s.adb.DeletePath(ctx, serial, normalizedPath)
}

func normalizeDirectoryPath(path string) string {
	normalized := normalizeEntryPath(path)
	return ensureTrailingSlash(normalized)
}

func normalizeEntryPath(path string) string {
	if strings.TrimSpace(path) == "" {
		return "/sdcard/"
	}

	normalized := strings.ReplaceAll(strings.TrimSpace(path), "\\", "/")
	if !strings.HasPrefix(normalized, "/") {
		normalized = "/" + normalized
	}
	cleaned := pathpkgClean(normalized)
	if cleaned == "/" {
		return ensureTrailingSlash(allowedRootDirectory)
	}
	return cleaned
}

func ensureTrailingSlash(path string) string {
	if path == "/" || strings.HasSuffix(path, "/") {
		return path
	}
	return path + "/"
}

func parentDirectory(path string) string {
	normalized := normalizeEntryPath(path)
	if normalized == "/" {
		return "/"
	}

	parts := strings.Split(normalized, "/")
	if len(parts) <= 2 {
		return "/"
	}
	return strings.Join(parts[:len(parts)-1], "/") + "/"
}

func baseName(path string) string {
	normalized := normalizeEntryPath(path)
	if normalized == ensureTrailingSlash(allowedRootDirectory) || normalized == allowedRootDirectory {
		return "root"
	}
	parts := strings.Split(normalized, "/")
	return parts[len(parts)-1]
}

func normalizeUploadRelativePath(relativePath string, fallbackName string) (string, error) {
	candidate := strings.TrimSpace(relativePath)
	if candidate == "" {
		fallback := strings.ReplaceAll(strings.TrimSpace(fallbackName), "\\", "/")
		candidate = path.Base(fallback)
	}

	candidate = strings.ReplaceAll(candidate, "\\", "/")
	if candidate == "" || strings.HasPrefix(candidate, "/") {
		return "", ErrPathOutOfScope
	}
	for _, segment := range strings.Split(candidate, "/") {
		if segment == "." || segment == ".." {
			return "", ErrPathOutOfScope
		}
	}

	cleaned := path.Clean(candidate)
	if cleaned == "." || cleaned == "/" || cleaned == ".." || strings.HasPrefix(cleaned, "../") {
		return "", ErrPathOutOfScope
	}

	for _, segment := range strings.Split(cleaned, "/") {
		if segment == "" || segment == "." || segment == ".." {
			return "", ErrPathOutOfScope
		}
	}
	return cleaned, nil
}

func validateScopedPath(rawPath string) (string, error) {
	normalized := normalizeEntryPath(rawPath)
	root := ensureTrailingSlash(allowedRootDirectory)
	if normalized == allowedRootDirectory || normalized == root {
		return root, nil
	}
	if !strings.HasPrefix(ensureTrailingSlash(normalized), root) {
		return "", ErrPathOutOfScope
	}
	return normalized, nil
}

func isProtectedPath(normalized string) bool {
	return normalized == allowedRootDirectory || normalized == ensureTrailingSlash(allowedRootDirectory)
}

func pathpkgClean(value string) string {
	cleaned := path.Clean(value)
	if cleaned == "." {
		return ensureTrailingSlash(allowedRootDirectory)
	}
	return cleaned
}

func quoteShellArg(value string) string {
	return "'" + strings.ReplaceAll(value, "'", `'\''`) + "'"
}
