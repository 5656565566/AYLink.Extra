package adbkit

import (
	"context"
	"encoding/binary"
	"fmt"
	"io"
	"strings"
	"sync"
)

type ShellPacketID uint8

const (
	ShellPacketStdin ShellPacketID = iota
	ShellPacketStdout
	ShellPacketStderr
	ShellPacketExit
	ShellPacketCloseStdin
	ShellPacketWindowSizeChange
	ShellPacketInvalid ShellPacketID = 255
)

type ShellSessionOptions struct {
	Term    string
	Pty     bool
	Command string
	Rows    int
	Cols    int
	XPixels int
	YPixels int
}

type ShellPacket struct {
	ID   ShellPacketID
	Data []byte
}

type ShellSession struct {
	transport *Transport
	writeMu   sync.Mutex
}

func (d *Device) OpenShellSession() (*ShellSession, error) {
	return d.OpenShellSessionContext(context.Background(), ShellSessionOptions{})
}

func (d *Device) OpenShellSessionContext(ctx context.Context, opts ShellSessionOptions) (*ShellSession, error) {
	transport, err := d.TransportContext(ctx)
	if err != nil {
		return nil, err
	}

	service := buildShellService(opts)
	status, err := transport.SendCommand(service)
	if err != nil {
		transport.Close()
		return nil, err
	}
	if status != StatusOkay {
		transport.Close()
		return nil, fmt.Errorf("unexpected shell status: %s", status)
	}

	session := &ShellSession{transport: transport}
	if opts.Pty && opts.Rows > 0 && opts.Cols > 0 {
		if err := session.Resize(opts.Cols, opts.Rows); err != nil {
			transport.Close()
			return nil, err
		}
	}

	return session, nil
}

func buildShellService(opts ShellSessionOptions) string {
	args := []string{"v2"}
	if term := strings.TrimSpace(opts.Term); term != "" {
		args = append(args, "TERM="+term)
	}
	if opts.Pty {
		args = append(args, "pty")
	} else {
		args = append(args, "raw")
	}

	command := opts.Command
	return "shell," + strings.Join(args, ",") + ":" + command
}

func (s *ShellSession) ReadPacket() (ShellPacket, error) {
	header := make([]byte, 5)
	if _, err := io.ReadFull(s.transport, header); err != nil {
		return ShellPacket{}, err
	}

	length := binary.LittleEndian.Uint32(header[1:])
	data := make([]byte, int(length))
	if _, err := io.ReadFull(s.transport, data); err != nil {
		return ShellPacket{}, err
	}

	return ShellPacket{
		ID:   ShellPacketID(header[0]),
		Data: data,
	}, nil
}

func (s *ShellSession) WriteInput(data string) error {
	return s.writePacket(ShellPacketStdin, []byte(data))
}

func (s *ShellSession) Resize(cols, rows int) error {
	if cols <= 0 || rows <= 0 {
		return nil
	}

	payload := fmt.Sprintf("%dx%d,%dx%d\x00", rows, cols, 0, 0)
	return s.writePacket(ShellPacketWindowSizeChange, []byte(payload))
}

func (s *ShellSession) CloseStdin() error {
	return s.writePacket(ShellPacketCloseStdin, nil)
}

func (s *ShellSession) Close() error {
	return s.transport.Close()
}

func (s *ShellSession) writePacket(id ShellPacketID, payload []byte) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	header := make([]byte, 5)
	header[0] = byte(id)
	binary.LittleEndian.PutUint32(header[1:], uint32(len(payload)))

	if _, err := s.transport.Write(header); err != nil {
		return err
	}
	if len(payload) == 0 {
		return nil
	}
	_, err := s.transport.Write(payload)
	return err
}
