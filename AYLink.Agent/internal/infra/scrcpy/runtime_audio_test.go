package scrcpy

import (
	"encoding/binary"
	"io"
	"log/slog"
	"net"
	"testing"
	"time"

	domainscrcpy "aylink-agent/internal/domain/scrcpy"
)

func TestRuntimeOpusPacketsRemainImmutableUntilReleased(t *testing.T) {
	input, output := net.Pipe()
	defer output.Close()
	deadline := time.Now().Add(3 * time.Second)
	_ = input.SetDeadline(deadline)
	_ = output.SetDeadline(deadline)
	subscribers := []chan domainscrcpy.AudioPacket{make(chan domainscrcpy.AudioPacket, 4), make(chan domainscrcpy.AudioPacket, 4)}
	rt := &runtime{
		logger:           slog.New(slog.NewTextHandler(io.Discard, nil)),
		audioConn:        input,
		audioSubscribers: map[int]chan domainscrcpy.AudioPacket{0: subscribers[0], 1: subscribers[1]},
		done:             make(chan struct{}),
	}
	defer rt.Close()
	stopped := make(chan struct{})
	go func() {
		defer close(stopped)
		rt.readAudioLoop()
	}()
	defer func() {
		_ = rt.Close()
		select {
		case <-stopped:
		case <-time.After(3 * time.Second):
			t.Error("audio loop did not stop")
		}
	}()
	if _, err := output.Write([]byte("opus")); err != nil {
		t.Fatal(err)
	}
	send := func(payload string) {
		t.Helper()
		header := make([]byte, 12)
		binary.BigEndian.PutUint32(header[8:], uint32(len(payload)))
		if _, err := output.Write(header); err != nil {
			t.Fatal(err)
		}
		if _, err := output.Write([]byte(payload)); err != nil {
			t.Fatal(err)
		}
	}
	receive := func(sub <-chan domainscrcpy.AudioPacket) domainscrcpy.AudioPacket {
		t.Helper()
		select {
		case packet := <-sub:
			return packet
		case <-time.After(3 * time.Second):
			t.Fatal("audio packet timeout")
			return domainscrcpy.AudioPacket{}
		}
	}
	send("AAAA")
	first := []domainscrcpy.AudioPacket{receive(subscribers[0]), receive(subscribers[1])}
	// 一个订阅者释放后，另一个仍持有的包也不能被后续读取覆盖。
	first[0].Release()
	send("BBBB")
	second := []domainscrcpy.AudioPacket{receive(subscribers[0]), receive(subscribers[1])}
	defer first[1].Release()
	defer second[0].Release()
	defer second[1].Release()
	if string(first[1].Data) != "AAAA" {
		t.Fatalf("published packet overwritten before release: got %q", first[1].Data)
	}
	if string(second[0].Data) != "BBBB" || string(second[1].Data) != "BBBB" {
		t.Fatal("second packet corrupted")
	}
}
