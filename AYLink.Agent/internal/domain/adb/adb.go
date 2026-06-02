package adb

import (
	"context"
	"image"
	"io"
)

type Device struct {
	Serial string `json:"serial"`
	State  string `json:"state"`
}

type DirectoryEntry struct {
	Name        string `json:"Name"`
	IsDirectory bool   `json:"IsDirectory"`
	Size        uint64 `json:"Size"`
}

type ResolvedBinary struct {
	Path   string `json:"path"`
	Source string `json:"source"`
}

type ShellStream uint8

const (
	ShellStreamStdin ShellStream = iota
	ShellStreamStdout
	ShellStreamStderr
	ShellStreamExit
	ShellStreamCloseStdin
	ShellStreamWindowSizeChange
)

type ShellPacket struct {
	Stream   ShellStream
	Data     []byte
	ExitCode int
}

type ShellSession interface {
	ReadPacket() (ShellPacket, error)
	WriteInput(data string) error
	Resize(cols, rows int) error
	CloseStdin() error
	Close() error
}

type Manager interface {
	ResolvedBinary() (ResolvedBinary, bool)
	Devices(ctx context.Context) ([]Device, error)
	StartServer(ctx context.Context) error
	KillServer(ctx context.Context) error
	ServerAddress() string
	PairDevice(ctx context.Context, host string, port int, code string) (string, error)
	ConnectDevice(ctx context.Context, host string, port int) error
	DeviceDisplayName(ctx context.Context, serial string) (string, error)
	CaptureScreenshot(ctx context.Context, serial string) (image.Image, error)
	RunCommand(ctx context.Context, serial string, command string) (string, error)
	ListDirectory(ctx context.Context, serial string, path string) ([]DirectoryEntry, error)
	OpenRead(ctx context.Context, serial string, path string) (io.ReadCloser, error)
	Push(ctx context.Context, serial string, remotePath string, reader io.Reader, mode uint32) error
	RenamePath(ctx context.Context, serial string, oldPath string, newPath string) error
	DeletePath(ctx context.Context, serial string, path string) error
	OpenShellSession(ctx context.Context, serial string) (ShellSession, error)
}
