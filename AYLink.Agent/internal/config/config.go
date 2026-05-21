package config

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
)

const (
	defaultListenAddr = ":5501"
	defaultConfigPath = "config.json"
	defaultWWWRoot    = "./www"
)

type Config struct {
	HTTP   HTTPConfig   `json:"http"`
	ADB    ADBConfig    `json:"adb"`
	DB     DBConfig     `json:"db"`
	Scrcpy ScrcpyConfig `json:"scrcpy"`
}

type HTTPConfig struct {
	ListenAddr string `json:"listenAddr"`
}

type ADBConfig struct {
	Path       string `json:"path"`
	ServerHost string `json:"serverHost"`
	ServerPort int    `json:"serverPort"`
	BundledDir string `json:"bundledDir"`
}

type DBConfig struct {
	Path string `json:"path"`
}

type ScrcpyConfig struct {
	ServerPath string `json:"serverPath"`
}

func Load() (Config, error) {
	cfg := Config{
		HTTP: HTTPConfig{
			ListenAddr: envOrDefault("AYLINK_HTTP_LISTENADDR", envOrDefault("AYLINK_AGENT_ADDR", defaultListenAddr)),
		},
		ADB: ADBConfig{
			Path:       envOrDefault("AYLINK_ADB_PATH", ""),
			ServerHost: envOrDefault("AYLINK_ADB_SERVERHOST", "127.0.0.1"),
			ServerPort: envOrDefaultInt("AYLINK_ADB_SERVERPORT", 5037),
			BundledDir: envOrDefault("AYLINK_ADB_BUNDLEDDIR", filepath.Join(".", "ADB")),
		},
		DB: DBConfig{
			Path: envOrDefault("AYLINK_DB_PATH", filepath.Join(".", "aylink.db")), // 修改默认相对路径到当前目录，更符合常规习惯
		},
		Scrcpy: ScrcpyConfig{
			ServerPath: envOrDefault("AYLINK_SCRCPY_SERVER_PATH", ""),
		},
	}

	configPath := envOrDefault("AYLINK_CONFIG", defaultConfigPath)
	if err := mergeJSONFile(configPath, &cfg); err != nil && !errors.Is(err, os.ErrNotExist) {
		return Config{}, err
	}

	// 环境变量优先级最高 如果 JSON 配置文件覆盖了环境变量 这里再强制覆盖一次
	if envAddr := os.Getenv("AYLINK_HTTP_LISTENADDR"); envAddr != "" {
		cfg.HTTP.ListenAddr = envAddr
	} else if envAddr := os.Getenv("AYLINK_AGENT_ADDR"); envAddr != "" {
		cfg.HTTP.ListenAddr = envAddr
	}

	if envPath := os.Getenv("AYLINK_DB_PATH"); envPath != "" {
		cfg.DB.Path = envPath
	}

	if envPath := os.Getenv("AYLINK_ADB_PATH"); envPath != "" {
		cfg.ADB.Path = envPath
	}

	if envHost := os.Getenv("AYLINK_ADB_SERVERHOST"); envHost != "" {
		cfg.ADB.ServerHost = envHost
	}

	if envPort := os.Getenv("AYLINK_ADB_SERVERPORT"); envPort != "" {
		if port, err := strconv.Atoi(envPort); err == nil {
			cfg.ADB.ServerPort = port
		}
	}

	if envBundledDir := os.Getenv("AYLINK_ADB_BUNDLEDDIR"); envBundledDir != "" {
		cfg.ADB.BundledDir = envBundledDir
	}

	if envPath := os.Getenv("AYLINK_SCRCPY_SERVER_PATH"); envPath != "" {
		cfg.Scrcpy.ServerPath = envPath
	}

	if cfg.ADB.BundledDir == "" {
		cfg.ADB.BundledDir = filepath.Join(".", "ADB")
	}

	return cfg, nil
}

func BundledADBExecutableName() string {
	if runtime.GOOS == "windows" {
		return "adb.exe"
	}

	return "adb"
}

func DefaultWWWRoot() string {
	return defaultWWWRoot
}

func envOrDefault(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}

	return fallback
}

func envOrDefaultInt(name string, fallback int) int {
	if value := os.Getenv(name); value != "" {
		if intValue, err := strconv.Atoi(value); err == nil {
			return intValue
		}
	}
	return fallback
}
