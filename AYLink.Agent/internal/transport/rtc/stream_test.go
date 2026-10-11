package rtc

import (
	"bytes"
	"context"
	"io"
	"testing"
	"time"
)

func TestStreamTransfersBeyondWindowWithSlowReader(t *testing.T) {
	var left, right *Stream
	left = NewStream(context.Background(), func(data []byte, text bool) error { return right.Receive(data, text) }, func() {})
	right = NewStream(context.Background(), func(data []byte, text bool) error { return left.Receive(data, text) }, func() {})
	defer left.Close()
	defer right.Close()
	payload := bytes.Repeat([]byte("binary\x00data"), WindowBytes)
	done := make(chan error, 1)
	go func() {
		_, err := left.Write(payload)
		if err == nil {
			err = left.End()
		}
		done <- err
	}()
	select {
	case <-done:
		t.Fatal("writer should wait for receiver consumption")
	case <-time.After(20 * time.Millisecond):
	}
	actual, err := io.ReadAll(right)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(actual, payload) {
		t.Fatal("payload corrupted")
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}

func TestStreamRejectsOversizedFramesAndUncreditedData(t *testing.T) {
	for _, oversized := range []bool{true, false} {
		stream := NewStream(context.Background(), func([]byte, bool) error { return nil }, func() {})
		if oversized {
			if stream.Receive(make([]byte, ChunkBytes+1), false) == nil {
				t.Fatal("oversized frame accepted")
			}
		} else {
			for range WindowBytes / ChunkBytes {
				if err := stream.Receive(make([]byte, ChunkBytes), false); err != nil {
					t.Fatal(err)
				}
			}
			if stream.Receive([]byte{1}, false) == nil {
				t.Fatal("uncredited data accepted")
			}
		}
		stream.Close()
	}
}

func TestStreamCancellationUnblocksReaderAndWriter(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	stream := NewStream(ctx, func([]byte, bool) error { return nil }, func() {})
	defer stream.Close()
	done := make(chan error, 2)
	go func() { _, err := stream.Read(make([]byte, 1)); done <- err }()
	go func() { _, err := stream.Write(make([]byte, WindowBytes+1)); done <- err }()
	cancel()
	for range 2 {
		select {
		case err := <-done:
			if err == nil {
				t.Fatal("cancellation lost")
			}
		case <-time.After(time.Second):
			t.Fatal("cancelled stream blocked")
		}
	}
}

func TestStreamRejectsSecondEnvelopeAfterFirstWasConsumed(t *testing.T) {
	stream := NewStream(context.Background(), func([]byte, bool) error { return nil }, func() {})
	defer stream.Close()
	frame := []byte(`{"type":"request","method":"GET","url":"/api/devices/1/files/list"}`)
	if err := stream.Receive(frame, true); err != nil {
		t.Fatal(err)
	}
	if _, err := stream.Control(); err != nil {
		t.Fatal(err)
	}
	if err := stream.Receive(frame, true); err == nil {
		t.Fatal("second request envelope accepted on a single-operation channel")
	}
}
