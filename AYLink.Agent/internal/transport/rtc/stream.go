// Package rtc 通过 WebRTC 数据通道传输可靠字节流 并限制缓冲区大小
package rtc

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"sync"
)

// 每个方向初始可发送一个窗口的数据 只有消费者读取后才返还发送额度
// 避免下游读取缓慢时接收队列持续增长
const (
	ChunkBytes  = 16 * 1024
	WindowBytes = 256 * 1024
)

type Message struct {
	Type    string            `json:"type"`
	Method  string            `json:"method,omitempty"`
	URL     string            `json:"url,omitempty"`
	Headers map[string]string `json:"headers,omitempty"`
	Status  int               `json:"status,omitempty"`
	Bytes   int               `json:"bytes,omitempty"`
	Error   string            `json:"error,omitempty"`
}

type Stream struct {
	ctx         context.Context
	cancel      context.CancelCauseFunc
	send        func([]byte, bool) error
	closeWire   func()
	closeOnce   sync.Once
	sendMu      sync.Mutex
	mu          sync.Mutex
	credit      int
	allowance   int
	ended       bool
	controlled  bool
	input       [][]byte
	inputReady  chan struct{}
	controls    chan Message
	creditReady chan struct{}
	current     []byte
}

func NewStream(ctx context.Context, send func([]byte, bool) error, closeWire func()) *Stream {
	ctx, cancel := context.WithCancelCause(ctx)
	return &Stream{ctx: ctx, cancel: cancel, send: send, closeWire: closeWire,
		credit: WindowBytes, allowance: WindowBytes, inputReady: make(chan struct{}, 1),
		controls: make(chan Message, 1), creditReady: make(chan struct{}, 1)}
}

func (s *Stream) Context() context.Context { return s.ctx }

func (s *Stream) Receive(data []byte, text bool) error {
	if s.ctx.Err() != nil {
		return context.Cause(s.ctx)
	}
	if len(data) > ChunkBytes {
		return errors.New("RTC frame exceeds chunk limit")
	}
	if !text {
		s.mu.Lock()
		defer s.mu.Unlock()
		if s.ended || len(data) == 0 || len(data) > s.allowance {
			return errors.New("invalid RTC receive window")
		}
		s.input = append(s.input, append([]byte(nil), data...))
		s.allowance -= len(data)
		select {
		case s.inputReady <- struct{}{}:
		default:
		}
		return nil
	}
	var message Message
	if err := json.Unmarshal(data, &message); err != nil {
		return err
	}
	switch message.Type {
	case "credit":
		s.mu.Lock()
		defer s.mu.Unlock()
		if message.Bytes <= 0 || message.Bytes > WindowBytes-s.credit {
			return errors.New("invalid RTC credit")
		}
		s.credit += message.Bytes
		select {
		case s.creditReady <- struct{}{}:
		default:
		}
	case "end":
		s.mu.Lock()
		defer s.mu.Unlock()
		if s.ended {
			return errors.New("duplicate RTC end")
		}
		s.ended = true
		select {
		case s.inputReady <- struct{}{}:
		default:
		}
	case "cancel", "error":
		if message.Error == "" {
			message.Error = "RTC request cancelled"
		}
		s.cancel(errors.New(message.Error))
	case "request", "response":
		s.mu.Lock()
		defer s.mu.Unlock()
		if s.controlled {
			return errors.New("duplicate RTC control message")
		}
		s.controlled = true
		select {
		case s.controls <- message:
		default:
			return errors.New("duplicate RTC control message")
		}
	default:
		return errors.New("unknown RTC message")
	}
	return nil
}

func (s *Stream) Control() (Message, error) {
	select {
	case message := <-s.controls:
		return message, nil
	case <-s.ctx.Done():
		return Message{}, context.Cause(s.ctx)
	}
}

func (s *Stream) SendControl(message Message) error {
	data, err := json.Marshal(message)
	if err != nil {
		return err
	}
	if len(data) > ChunkBytes {
		return errors.New("RTC control message too large")
	}
	s.sendMu.Lock()
	defer s.sendMu.Unlock()
	if s.ctx.Err() != nil {
		return context.Cause(s.ctx)
	}
	return s.send(data, true)
}

func (s *Stream) Read(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	if s.ctx.Err() != nil {
		return 0, context.Cause(s.ctx)
	}
	for len(s.current) == 0 {
		s.mu.Lock()
		if len(s.input) > 0 {
			s.current = s.input[0]
			s.input[0] = nil
			s.input = s.input[1:]
		} else if s.ended {
			s.mu.Unlock()
			return 0, io.EOF
		}
		s.mu.Unlock()
		if len(s.current) == 0 {
			select {
			case <-s.inputReady:
			case <-s.ctx.Done():
				return 0, context.Cause(s.ctx)
			}
		}
	}
	n := copy(p, s.current)
	s.current = s.current[n:]
	s.mu.Lock()
	s.allowance += n
	s.mu.Unlock()
	if err := s.SendControl(Message{Type: "credit", Bytes: n}); err != nil {
		return n, err
	}
	return n, nil
}

func (s *Stream) Write(p []byte) (int, error) {
	written := 0
	for len(p) > 0 {
		if s.ctx.Err() != nil {
			return written, context.Cause(s.ctx)
		}
		s.mu.Lock()
		n := min(len(p), ChunkBytes, s.credit)
		s.credit -= n
		s.mu.Unlock()
		if n == 0 {
			select {
			case <-s.creditReady:
				continue
			case <-s.ctx.Done():
				return written, context.Cause(s.ctx)
			}
		}
		s.sendMu.Lock()
		err := s.send(p[:n], false)
		s.sendMu.Unlock()
		if err != nil {
			return written, err
		}
		written += n
		p = p[n:]
	}
	return written, nil
}

func (s *Stream) End() error { return s.SendControl(Message{Type: "end"}) }

func (s *Stream) Close() error {
	s.closeOnce.Do(func() { s.cancel(io.ErrClosedPipe); s.closeWire() })
	return nil
}

func (s *Stream) Fail(err error) {
	_ = s.SendControl(Message{Type: "error", Error: err.Error()})
	s.cancel(err)
	_ = s.Close()
}
