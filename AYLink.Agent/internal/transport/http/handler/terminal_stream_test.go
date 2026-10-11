package handler

import (
	"bytes"
	"errors"
	"io"
	"strings"
	"testing"

	"aylink-agent/internal/transport/rtc"
)

func TestTerminalStreamReadsExistingInputProtocol(t *testing.T) {
	read := terminalStreamReader(strings.NewReader("{\"type\":\"input\",\"data\":\"你好\\n\"}\n{\"type\":\"resize\",\"cols\":80,\"rows\":24}\n"))
	var message terminalMessage
	if err := read(&message); err != nil || message.Type != "input" || message.Data != "你好\n" {
		t.Fatalf("input: %+v, %v", message, err)
	}
	if err := read(&message); err != nil || message.Type != "resize" || message.Cols != 80 || message.Rows != 24 {
		t.Fatalf("resize: %+v, %v", message, err)
	}
	if err := read(&message); !errors.Is(err, io.EOF) {
		t.Fatalf("expected EOF, got %v", err)
	}
}

func TestTerminalStreamRejectsOversizedMessage(t *testing.T) {
	read := terminalStreamReader(strings.NewReader(`{"type":"input","data":"` + strings.Repeat("x", rtc.WindowBytes) + `"}` + "\n"))
	var message terminalMessage
	if err := read(&message); err == nil {
		t.Fatal("oversized terminal input accepted")
	}
}

func TestTerminalStreamWriterPreservesMessageBoundaries(t *testing.T) {
	var output bytes.Buffer
	writer := &streamTerminalWriter{writer: &output}
	if err := writer.queueOutput([]byte("你好\nline two")); err != nil {
		t.Fatal(err)
	}
	if err := writer.writeJSON(terminalMessage{Type: "ready"}); err != nil {
		t.Fatal(err)
	}
	read := terminalStreamReader(&output)
	var message terminalMessage
	if err := read(&message); err != nil || message.Type != "output" || message.Data != "你好\nline two" {
		t.Fatalf("output: %+v, %v", message, err)
	}
	if err := read(&message); err != nil || message.Type != "ready" {
		t.Fatalf("ready: %+v, %v", message, err)
	}
}
