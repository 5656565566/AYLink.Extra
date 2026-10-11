package adbkit

import (
	"context"
	"errors"
	"io"
	"net"
	"testing"
	"time"
)

func TestForwardRemoveContextCancelsStalledReply(t *testing.T) {
	connector := &pipeConnector{serverConn: make(chan net.Conn, 1)}
	device := NewClientWithConnector(connector).Device(DeviceWithSerial("test"))
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		_, err := device.ForwardRemoveContext(ctx, "tcp:12345")
		done <- err
	}()
	server := <-connector.serverConn
	defer server.Close()
	_ = server.SetDeadline(time.Now().Add(time.Second))
	expected := "host-serial:test:killforward:tcp:12345"
	command := make([]byte, 4+len(expected))
	if _, err := io.ReadFull(server, command); err != nil {
		t.Fatal(err)
	}
	if string(command[4:]) != expected {
		t.Fatalf("unexpected remove command %q", command)
	}
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("expected cancellation, got %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("stalled forward removal did not stop")
	}
	if _, err := server.Write([]byte("OKAYOKAY")); !errors.Is(err, io.ErrClosedPipe) && !errors.Is(err, net.ErrClosed) {
		t.Fatalf("expected canceled connection to close, got %v", err)
	}
}
