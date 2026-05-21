package adb

import (
	"os"
	"os/exec"
	"path/filepath"

	adbconfig "aylink-agent/internal/config"
	domainadb "aylink-agent/internal/domain/adb"
)

func ResolveBinary(cfg adbconfig.ADBConfig) (domainadb.ResolvedBinary, bool) {
	if path := os.Getenv("AYLINK_ADB_PATH"); path != "" {
		if resolved, ok := existing(path, "env"); ok {
			return resolved, true
		}
	}

	if cfg.Path != "" {
		if resolved, ok := existing(cfg.Path, "config"); ok {
			return resolved, true
		}
	}

	if path, err := exec.LookPath("adb"); err == nil {
		return domainadb.ResolvedBinary{
			Path:   path,
			Source: "path",
		}, true
	}

	bundledPath := filepath.Join(cfg.BundledDir, adbconfig.BundledADBExecutableName())
	if resolved, ok := existing(bundledPath, "bundled"); ok {
		return resolved, true
	}

	return domainadb.ResolvedBinary{}, false
}

func existing(path, source string) (domainadb.ResolvedBinary, bool) {
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		return domainadb.ResolvedBinary{}, false
	}

	return domainadb.ResolvedBinary{
		Path:   path,
		Source: source,
	}, true
}
