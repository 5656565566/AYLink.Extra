package scrcpy

import (
	"context"
	"encoding/binary"
	"errors"
	"io"
	"log/slog"
	"net"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	domainscrcpy "aylink-agent/internal/domain/scrcpy"
	"aylink-agent/pkg/adbkit"
)

func TestStartSessionFailureRemovesOnlyOwnedForwards(t *testing.T) {
	for _, failure := range []string{"second forward", "readiness cancellation"} {
		t.Run(failure, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			adb, service := newSessionTestService(t)
			if failure == "second forward" {
				adb.failForward = 2
			} else {
				adb.cancelProbe = cancel
			}
			session, err := service.StartSession(ctx, "test", domainscrcpy.SessionConfig{Video: true, Control: true})
			if err == nil || session != nil {
				t.Fatalf("expected startup failure, got session %v, error %v", session, err)
			}
			adb.assertCleaned(t)
		})
	}
}

func TestStartSessionKeepsForwardOrderForEnabledStreams(t *testing.T) {
	for _, enabled := range []struct {
		name    string
		video   bool
		audio   bool
		control bool
	}{
		{name: "video", video: true},
		{name: "audio", audio: true},
		{name: "control", control: true},
		{name: "video and control", video: true, control: true},
		{name: "all streams", video: true, audio: true, control: true},
	} {
		t.Run(enabled.name, func(t *testing.T) {
			adb, service := newSessionTestService(t)
			session, err := service.StartSession(context.Background(), "test", domainscrcpy.SessionConfig{
				Video: enabled.video, Audio: enabled.audio, Control: enabled.control,
			})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = session.Close() })
			var expected []string
			for _, stream := range []struct {
				enabled bool
				port    int
			}{{enabled.video, session.VideoPort}, {enabled.audio, session.AudioPort}, {enabled.control, session.ControlPort}} {
				if (stream.port != 0) != stream.enabled {
					t.Fatalf("stream enabled=%v has unexpected port %d", stream.enabled, stream.port)
				}
				if stream.enabled {
					expected = append(expected, "tcp:"+strconv.Itoa(stream.port))
				}
			}
			adb.mu.Lock()
			created := append([]string(nil), adb.created...)
			adb.mu.Unlock()
			if !slices.Equal(created, expected) {
				t.Fatalf("forward creation order changed: got %v, want %v", created, expected)
			}
			if err := session.Close(); err != nil {
				t.Fatal(err)
			}
			adb.assertCleaned(t)
			adb.mu.Lock()
			defer adb.mu.Unlock()
			if !slices.Equal(adb.removed, expected) {
				t.Fatalf("forward removal order changed: got %v, want %v", adb.removed, expected)
			}
		})
	}
}

func TestOpenRuntimeFailureClosesSession(t *testing.T) {
	for _, failure := range []string{"missing video", "video dial", "audio dial", "control dial"} {
		t.Run(failure, func(t *testing.T) {
			adb, service := newSessionTestService(t)
			session, err := service.StartSession(context.Background(), "test", domainscrcpy.SessionConfig{Video: true, Control: true})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = session.Close() })
			if failure == "missing video" {
				session.VideoPort = 0
			} else if failure != "video dial" {
				listenOnSessionPort(t, session.VideoPort)
				if failure == "audio dial" {
					session.AudioPort, err = allocateTCPPort()
					if err != nil {
						t.Fatal(err)
					}
				}
			}
			ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
			defer cancel()
			runtime, err := service.OpenRuntime(ctx, session)
			if err == nil || runtime != nil {
				t.Fatalf("expected runtime startup failure, got runtime %v, error %v", runtime, err)
			}
			adb.assertCleaned(t)
		})
	}
}

func TestRuntimeCloseReleasesSessionAndSocketsOnce(t *testing.T) {
	adb, service := newSessionTestService(t)
	session, err := service.StartSession(context.Background(), "test", domainscrcpy.SessionConfig{Video: true, Control: true})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = session.Close() })
	video := listenOnSessionPort(t, session.VideoPort)
	control := listenOnSessionPort(t, session.ControlPort)
	runtime, err := service.OpenRuntime(context.Background(), session)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = runtime.Close() })
	for _, listener := range []*net.TCPListener{video, control} {
		conn, err := listener.Accept()
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = conn.Close() })
		if err := runtime.Close(); err != nil {
			t.Fatal(err)
		}
		_ = conn.SetReadDeadline(time.Now().Add(time.Second))
		var data [1]byte
		if _, err := conn.Read(data[:]); !errors.Is(err, io.EOF) {
			t.Fatalf("runtime socket was not closed: %v", err)
		}
	}
	if err := session.Close(); err != nil {
		t.Fatal(err)
	}
	adb.assertCleaned(t)
	adb.mu.Lock()
	defer adb.mu.Unlock()
	if len(adb.removed) != 2 {
		t.Fatalf("expected exactly one removal per forward, got %v", adb.removed)
	}
}

func TestServerExitClosesSession(t *testing.T) {
	adb, service := newSessionTestService(t)
	session, err := service.StartSession(context.Background(), "test", domainscrcpy.SessionConfig{Video: true, Control: true})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = session.Close() })
	adb.mu.Lock()
	shell := adb.shell
	adb.mu.Unlock()
	if err := shell.Close(); err != nil {
		t.Fatal(err)
	}
	select {
	case <-adb.cleanupDone:
	case <-time.After(time.Second):
		t.Fatal("server exit did not remove its forwards")
	}
	adb.assertCleaned(t)
}

func listenOnSessionPort(t *testing.T, port int) *net.TCPListener {
	t.Helper()
	listener, err := net.ListenTCP("tcp", &net.TCPAddr{IP: net.IPv4(127, 0, 0, 1), Port: port})
	if err != nil {
		t.Fatal(err)
	}
	_ = listener.SetDeadline(time.Now().Add(3 * time.Second))
	t.Cleanup(func() { _ = listener.Close() })
	return listener
}

type sessionTestADB struct {
	t            *testing.T
	mu           sync.Mutex
	connections  []net.Conn
	workers      sync.WaitGroup
	forwards     map[string]string
	created      []string
	removed      []string
	forwardCount int
	failForward  int
	cancelProbe  context.CancelFunc
	scid         string
	shellClosed  chan struct{}
	shell        net.Conn
	cleanupDone  chan struct{}
}

func newSessionTestService(t *testing.T) (*sessionTestADB, *Service) {
	t.Helper()
	adb := &sessionTestADB{
		t: t, forwards: map[string]string{"tcp:54321": "localabstract:other_session"},
		shellClosed: make(chan struct{}),
		cleanupDone: make(chan struct{}),
	}
	t.Cleanup(func() {
		adb.mu.Lock()
		connections := append([]net.Conn(nil), adb.connections...)
		adb.mu.Unlock()
		for _, conn := range connections {
			_ = conn.Close()
		}
		adb.workers.Wait()
	})
	serverPath := filepath.Join(t.TempDir(), "scrcpy-server")
	if err := os.WriteFile(serverPath, []byte("test server"), 0600); err != nil {
		t.Fatal(err)
	}
	return adb, &Service{
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		client: adbkit.NewClientWithConnector(adb), serverPath: serverPath, version: "4.1",
	}
}

func (a *sessionTestADB) ConnectionContext(ctx context.Context) (net.Conn, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	client, server := net.Pipe()
	_ = server.SetDeadline(time.Now().Add(5 * time.Second))
	a.mu.Lock()
	a.connections = append(a.connections, client, server)
	a.mu.Unlock()
	a.workers.Add(1)
	go func() {
		defer a.workers.Done()
		defer server.Close()
		a.serve(server)
	}()
	return client, nil
}

func (a *sessionTestADB) serve(conn net.Conn) {
	for {
		var length [4]byte
		if _, err := io.ReadFull(conn, length[:]); err != nil {
			return
		}
		size, err := strconv.ParseUint(string(length[:]), 16, 16)
		if err != nil {
			a.t.Errorf("invalid ADB command length: %v", err)
			return
		}
		commandBytes := make([]byte, size)
		if _, err := io.ReadFull(conn, commandBytes); err != nil {
			return
		}
		command := string(commandBytes)
		switch {
		case strings.HasPrefix(command, "host:transport:"):
			_, _ = io.WriteString(conn, "OKAY")
		case command == "sync:":
			_, _ = io.WriteString(conn, "OKAY")
			a.servePush(conn)
			return
		case strings.HasPrefix(command, "shell,v2,raw:"):
			a.mu.Lock()
			a.shell = conn
			for _, arg := range strings.Fields(command) {
				if strings.HasPrefix(arg, "scid=") {
					a.scid = strings.TrimPrefix(arg, "scid=")
				}
			}
			a.mu.Unlock()
			_, _ = io.WriteString(conn, "OKAY")
			_, _ = io.Copy(io.Discard, conn)
			close(a.shellClosed)
			return
		case command == "shell:cat /proc/net/unix":
			_, _ = io.WriteString(conn, "OKAY")
			if a.cancelProbe != nil {
				a.cancelProbe()
			} else {
				a.mu.Lock()
				scid := a.scid
				a.mu.Unlock()
				_, _ = io.WriteString(conn, "scrcpy_"+scid)
			}
			return
		case strings.HasPrefix(command, "shell:") && strings.Contains(command, "list_encoders=true"):
			_, _ = io.WriteString(conn, "OKAY--audio-codec=opus --audio-encoder=c2.android.opus.encoder\n")
			return
		case strings.Contains(command, ":forward:"):
			_, endpoints, _ := strings.Cut(command, ":forward:")
			local, remote, _ := strings.Cut(endpoints, ";")
			a.mu.Lock()
			a.forwardCount++
			fail := a.forwardCount == a.failForward
			if !fail {
				a.forwards[local] = remote
				a.created = append(a.created, local)
			}
			a.mu.Unlock()
			if fail {
				_, _ = io.WriteString(conn, "OKAYFAIL000fforward refused")
			} else {
				_, _ = io.WriteString(conn, "OKAYOKAY")
			}
			return
		case strings.Contains(command, ":killforward:"):
			_, local, _ := strings.Cut(command, ":killforward:")
			a.mu.Lock()
			delete(a.forwards, local)
			a.removed = append(a.removed, local)
			if len(a.forwards) == 1 {
				close(a.cleanupDone)
			}
			a.mu.Unlock()
			_, _ = io.WriteString(conn, "OKAYOKAY")
			return
		default:
			a.t.Errorf("unexpected ADB command %q", command)
			return
		}
	}
}

func (a *sessionTestADB) servePush(conn net.Conn) {
	for {
		var header [8]byte
		if _, err := io.ReadFull(conn, header[:]); err != nil {
			return
		}
		if string(header[:4]) == "DONE" {
			_, _ = conn.Write([]byte("OKAY\x00\x00\x00\x00"))
			return
		}
		if _, err := io.CopyN(io.Discard, conn, int64(binary.LittleEndian.Uint32(header[4:]))); err != nil {
			return
		}
	}
}

func (a *sessionTestADB) assertCleaned(t *testing.T) {
	t.Helper()
	select {
	case <-a.shellClosed:
	case <-time.After(time.Second):
		t.Fatal("shell was not closed")
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if len(a.forwards) != 1 || a.forwards["tcp:54321"] != "localabstract:other_session" {
		t.Fatalf("expected only the unrelated forward to remain, got %v", a.forwards)
	}
	for _, local := range a.removed {
		if local == "tcp:54321" {
			t.Fatal("removed a forward owned by another session")
		}
	}
	if len(a.removed) == 0 {
		t.Fatal("expected owned forwards to be removed")
	}
}
