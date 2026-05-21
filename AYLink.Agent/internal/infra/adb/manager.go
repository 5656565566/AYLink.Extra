package adb

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"os/exec"
	"strconv"
	"strings"
	"time"

	adbconfig "aylink-agent/internal/config"
	domainadb "aylink-agent/internal/domain/adb"
	"aylink-agent/internal/infra/logging"
	"aylink-agent/pkg/adbkit"
)

type Manager struct {
	logger   logging.Logger
	resolved domainadb.ResolvedBinary
	client   *adbkit.Client
	address  string
	binPath  string
}

func NewManager(cfg adbconfig.ADBConfig, logger logging.Logger) *Manager {
	resolved, ok := ResolveBinary(cfg)
	if ok {
		logger.Info("adb resolved", "path", resolved.Path, "source", resolved.Source)
	} else {
		logger.Warn("adb not resolved yet", "serverHost", cfg.ServerHost, "serverPort", cfg.ServerPort)
	}

	address := net.JoinHostPort(cfg.ServerHost, fmt.Sprintf("%d", cfg.ServerPort))
	client := adbkit.NewClientWithOptions(adbkit.ClientOptions{
		Host: cfg.ServerHost,
		Port: cfg.ServerPort,
		Bin:  resolved.Path,
	})

	return &Manager{
		logger:   logger,
		resolved: resolved,
		address:  address,
		client:   client,
		binPath:  resolved.Path,
	}
}

func (m *Manager) ResolvedBinary() (domainadb.ResolvedBinary, bool) {
	return m.resolved, m.resolved.Path != ""
}

func (m *Manager) ServerAddress() string {
	return m.address
}

func (m *Manager) Devices(ctx context.Context) ([]domainadb.Device, error) {
	// 确保服务端已启动
	if m.hasBinary() {
		_ = m.StartServer(ctx)
	}

	adbkitDevices, err := m.client.ListDevices()
	if err != nil {
		return nil, fmt.Errorf("failed to list devices via adbkit: %w", err)
	}

	var devices []domainadb.Device
	for _, d := range adbkitDevices {
		devices = append(devices, domainadb.Device{
			Serial: d.Serial,
			State:  d.State,
		})
	}
	return devices, nil
}

func (m *Manager) StartServer(ctx context.Context) error {
	if !m.hasBinary() {
		return ErrBinaryNotFound
	}

	// adbkit 会在请求失败时尝试自启服务端
	// 为了确保 API 稳定性 显式启动一次服务端
	cmd := exec.CommandContext(ctx, m.binPath, "start-server")
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("failed to start adb server: %w", err)
	}
	return nil
}

func (m *Manager) KillServer(ctx context.Context) error {
	_, err := m.client.KillServer()
	if err != nil {
		// 如果通过 adbkit 通信失败（服务端失去响应） 则通过命令行强制结束
		if m.hasBinary() {
			cmd := exec.CommandContext(ctx, m.binPath, "kill-server")
			if cmdErr := cmd.Run(); cmdErr != nil {
				return fmt.Errorf("failed to kill adb server via adbkit (%v) and fallback cli: %w", err, cmdErr)
			}
			return nil
		}
		return fmt.Errorf("failed to kill adb server via adbkit: %w", err)
	}
	return nil
}

// PairDevice 使用底层协议对目标设备进行无线配对
func (m *Manager) PairDevice(ctx context.Context, host string, port int, code string) (string, error) {
	// 配对操作提供基础超时保护
	_, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	hostPort := fmt.Sprintf("%s:%d", host, port)
	return m.client.Pair(hostPort, code)
}

// ConnectDevice 尝试与网络设备建立连接
func (m *Manager) ConnectDevice(ctx context.Context, host string, port int) error {
	hostPort := fmt.Sprintf("%s:%d", host, port)
	return m.client.Connect(hostPort)
}

func (m *Manager) DeviceDisplayName(ctx context.Context, serial string) (string, error) {
	device := m.client.Device(adbkit.DeviceWithSerial(serial))
	props, err := device.Properties()
	if err != nil {
		return "", err
	}

	candidates := []string{
		props["ro.product.marketname"],
		props["ro.product.odm.marketname"],
		props["ro.product.system.marketname"],
		props["ro.product.vendor.marketname"],
		props["ro.product.model"],
		props["ro.product.system.model"],
		props["ro.product.vendor.model"],
		props["ro.product.name"],
	}

	for _, candidate := range candidates {
		if value := strings.TrimSpace(candidate); value != "" && !strings.EqualFold(value, "unknown") {
			return value, nil
		}
	}

	return "", fmt.Errorf("device display name unavailable")
}

func (m *Manager) RunCommand(ctx context.Context, serial string, command string) (string, error) {
	device := m.client.Device(adbkit.DeviceWithSerial(serial))
	return device.RunCommandContext(ctx, command)
}

func (m *Manager) ListDirectory(ctx context.Context, serial string, remotePath string) ([]domainadb.DirectoryEntry, error) {
	device := m.client.Device(adbkit.DeviceWithSerial(serial))
	syncService, err := device.NewSyncService()
	if err != nil {
		return nil, err
	}
	defer syncService.Close()

	entries, err := syncService.Readdir(remotePath)
	if err != nil {
		return nil, err
	}

	const unixModeDir = 0o040000
	files := make([]domainadb.DirectoryEntry, 0, len(entries))
	for _, entry := range entries {
		files = append(files, domainadb.DirectoryEntry{
			Name:        entry.Name,
			IsDirectory: entry.Mode&unixModeDir != 0,
			Size:        uint64(entry.Size),
		})
	}
	return files, nil
}

func (m *Manager) OpenRead(ctx context.Context, serial string, remotePath string) (io.ReadCloser, error) {
	device := m.client.Device(adbkit.DeviceWithSerial(serial))
	return device.Pull(remotePath)
}

func (m *Manager) Push(ctx context.Context, serial string, remotePath string, reader io.Reader, mode uint32) error {
	device := m.client.Device(adbkit.DeviceWithSerial(serial))
	return device.Push(reader, remotePath, mode)
}

func (m *Manager) RenamePath(ctx context.Context, serial string, oldPath string, newPath string) error {
	device := m.client.Device(adbkit.DeviceWithSerial(serial))
	_, err := device.RunCommandContext(ctx, fmt.Sprintf("mv %s %s", quoteShellArg(oldPath), quoteShellArg(newPath)))
	return err
}

func (m *Manager) DeletePath(ctx context.Context, serial string, remotePath string) error {
	device := m.client.Device(adbkit.DeviceWithSerial(serial))
	_, err := device.RunCommandContext(ctx, fmt.Sprintf("rm -rf %s", quoteShellArg(remotePath)))
	return err
}

// OpenShellSession 开启并返回一个设备的 Shell 交互式会话
func (m *Manager) OpenShellSession(ctx context.Context, serial string) (domainadb.ShellSession, error) {
	device := m.client.Device(adbkit.DeviceWithSerial(serial))

	session, err := device.OpenShellSessionContext(ctx, adbkit.ShellSessionOptions{
		Term:    "xterm-256color",
		Pty:     true,
		Command: "sh",
	})
	if err != nil {
		return nil, err
	}

	return &adbkitShellSession{session: session}, nil
}

func (m *Manager) hasBinary() bool {
	return m.resolved.Path != ""
}

var ErrBinaryNotFound = errors.New("adb executable could not be resolved")

// adbkitShellSession 实现了 domainadb.ShellSession 接口
type adbkitShellSession struct {
	session *adbkit.ShellSession
}

func (s *adbkitShellSession) ReadPacket() (domainadb.ShellPacket, error) {
	packet, err := s.session.ReadPacket()
	if err != nil {
		return domainadb.ShellPacket{}, err
	}

	result := domainadb.ShellPacket{Data: packet.Data}
	switch packet.ID {
	case adbkit.ShellPacketStdout:
		result.Stream = domainadb.ShellStreamStdout
	case adbkit.ShellPacketStderr:
		result.Stream = domainadb.ShellStreamStderr
	case adbkit.ShellPacketExit:
		result.Stream = domainadb.ShellStreamExit
		if code, parseErr := strconv.Atoi(strings.TrimSpace(string(packet.Data))); parseErr == nil {
			result.ExitCode = code
		}
	case adbkit.ShellPacketCloseStdin:
		result.Stream = domainadb.ShellStreamCloseStdin
	case adbkit.ShellPacketWindowSizeChange:
		result.Stream = domainadb.ShellStreamWindowSizeChange
	default:
		result.Stream = domainadb.ShellStreamStdout
	}
	return result, nil
}

func (s *adbkitShellSession) WriteInput(data string) error {
	return s.session.WriteInput(data)
}

func (s *adbkitShellSession) Resize(cols, rows int) error {
	return s.session.Resize(cols, rows)
}

func (s *adbkitShellSession) CloseStdin() error {
	return s.session.CloseStdin()
}

func (s *adbkitShellSession) Close() error {
	return s.session.Close()
}

func quoteShellArg(value string) string {
	return "'" + strings.ReplaceAll(value, "'", `'\''`) + "'"
}
