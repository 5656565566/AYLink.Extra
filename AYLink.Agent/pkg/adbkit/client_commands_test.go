package adbkit

import (
	"context"
	"errors"
	"net"
	"testing"
	"time"
)

type pipeConnector struct {
	serverConn chan net.Conn
}

func (c *pipeConnector) ConnectionContext(ctx context.Context) (net.Conn, error) {
	client, server := net.Pipe()
	select {
	case c.serverConn <- server:
		return client, nil
	case <-ctx.Done():
		_ = client.Close()
		_ = server.Close()
		return nil, ctx.Err()
	}
}

func TestSendHostCommandContextReturnsWhenADBServerStalls(t *testing.T) {
	connector := &pipeConnector{serverConn: make(chan net.Conn, 1)}
	client := NewClientWithConnector(connector)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()

	done := make(chan error, 1)
	go func() {
		_, err := client.SendHostCommandContext(ctx, "host:devices")
		done <- err
	}()

	server := <-connector.serverConn
	defer server.Close()

	select {
	case err := <-done:
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("expected context deadline exceeded, got %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("expected stalled host command to return after context deadline")
	}
}

func TestListDevicesContextParsesDevices(t *testing.T) {
	connector := &pipeConnector{serverConn: make(chan net.Conn, 1)}
	client := NewClientWithConnector(connector)

	done := make(chan struct {
		devices []DeviceInfo
		err     error
	}, 1)
	go func() {
		devices, err := client.ListDevicesContext(context.Background())
		done <- struct {
			devices []DeviceInfo
			err     error
		}{devices: devices, err: err}
	}()

	server := <-connector.serverConn
	defer server.Close()
	buf := make([]byte, len("000chost:devices"))
	if _, err := server.Read(buf); err != nil {
		t.Fatalf("expected command read success, got %v", err)
	}
	if string(buf) != "000chost:devices" {
		t.Fatalf("unexpected command %q", string(buf))
	}
	if _, err := server.Write([]byte("OKAY0021serial-1\tdevice\nserial-2\toffline\n")); err != nil {
		t.Fatalf("expected response write success, got %v", err)
	}

	result := <-done
	if result.err != nil {
		t.Fatalf("expected list success, got %v", result.err)
	}
	if len(result.devices) != 2 {
		t.Fatalf("expected two devices, got %d", len(result.devices))
	}
	if result.devices[0].Serial != "serial-1" || result.devices[0].State != "device" {
		t.Fatalf("unexpected first device: %+v", result.devices[0])
	}
}
