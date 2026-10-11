package handler

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"sync"
	"time"

	domainadb "aylink-agent/internal/domain/adb"
	terminalservice "aylink-agent/internal/service/terminal"
	"aylink-agent/internal/transport/rtc"

	"github.com/gorilla/websocket"
)

type TerminalHandler struct {
	service       TerminalService
	accessService DeviceAccessService
	upgrader      websocket.Upgrader
}

type terminalMessage struct {
	Type    string `json:"type"`
	Data    string `json:"data,omitempty"`
	Message string `json:"message,omitempty"`
	Cols    int    `json:"cols,omitempty"`
	Rows    int    `json:"rows,omitempty"`
}

func NewTerminalHandler(service TerminalService, accessService DeviceAccessService) *TerminalHandler {
	return &TerminalHandler{
		service:       service,
		accessService: accessService,
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool { return true },
		},
	}
}

func (h *TerminalHandler) ServeWS(w http.ResponseWriter, r *http.Request) {
	deviceID, err := deviceIDFromPath(r.URL.Path)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_DEVICE_ID", "Errors.InvalidDeviceId", "无效的设备 ID")
		return
	}
	if _, ok := ensureDeviceAccess(w, r, h.accessService, deviceID); !ok {
		return
	}

	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	writer := &wsWriter{conn: conn}
	h.serveTerminal(ctx, deviceID, conn.ReadJSON, writer)
}

type terminalOutputWriter interface {
	writeJSON(any) error
	queueOutput([]byte) error
	close(int, string) error
	stop()
}

// ServeStream 与 WebSocket 共用终端协议和 shell 会话生命周期
// 通过 NDJSON 在可靠的 RTC 字节流中划分消息边界
func (h *TerminalHandler) ServeStream(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteMethodNotAllowed(w, http.MethodPost)
		return
	}
	deviceID, err := deviceIDFromPath(r.URL.Path)
	if err != nil {
		WriteError(w, 400, "INVALID_DEVICE_ID", "Errors.InvalidDeviceId", "无效的设备 ID")
		return
	}
	if _, ok := ensureDeviceAccess(w, r, h.accessService, deviceID); !ok {
		return
	}
	w.Header().Set("Content-Type", "application/x-ndjson")
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	h.serveTerminal(ctx, deviceID, terminalStreamReader(r.Body), &streamTerminalWriter{writer: w})
}

func terminalStreamReader(reader io.Reader) func(any) error {
	scanner := bufio.NewScanner(reader)
	// 与浏览器输入队列使用相同的大小限制 拒绝未结束的超大 NDJSON 消息
	// 避免消息跨多个 RTC 窗口持续累积
	scanner.Buffer(make([]byte, 4096), rtc.WindowBytes)
	return func(value any) error {
		if !scanner.Scan() {
			if err := scanner.Err(); err != nil {
				return err
			}
			return io.EOF
		}
		return json.Unmarshal(scanner.Bytes(), value)
	}
}

func (h *TerminalHandler) serveTerminal(ctx context.Context, deviceID int, readJSON func(any) error, writer terminalOutputWriter) {
	defer writer.stop()
	session, err := h.service.Start(ctx, deviceID)
	if err != nil {
		_ = writer.writeJSON(terminalErrorMessage(err))
		_ = writer.close(websocket.CloseNormalClosure, "")
		return
	}
	defer session.Close()
	defer session.CloseInput()

	if err := writer.writeJSON(terminalMessage{Type: "ready"}); err != nil {
		return
	}

	errCh := make(chan error, 2)
	go h.pumpShellPackets(session, writer, errCh)
	go h.readClientMessages(ctx, readJSON, session, errCh)

	for {
		select {
		case <-ctx.Done():
			return
		case err := <-errCh:
			if err == nil || errors.Is(err, io.EOF) || websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
				_ = writer.close(websocket.CloseNormalClosure, "terminal closed")
				return
			}
			_ = writer.writeJSON(terminalMessage{
				Type:    "error",
				Message: "终端会话已断开",
			})
			return
		}
	}
}

func (h *TerminalHandler) readClientMessages(ctx context.Context, readJSON func(any) error, session TerminalSession, errCh chan<- error) {
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		var message terminalMessage
		if err := readJSON(&message); err != nil {
			errCh <- err
			return
		}

		switch message.Type {
		case "input":
			if err := session.WriteInput(message.Data); err != nil {
				errCh <- err
				return
			}
		case "ping":
			continue
		case "resize":
			if err := session.Resize(message.Cols, message.Rows); err != nil {
				errCh <- err
				return
			}
		}
	}
}

func (h *TerminalHandler) pumpShellPackets(session TerminalSession, writer terminalOutputWriter, errCh chan<- error) {
	for {
		packet, err := session.ReadPacket()
		if err != nil {
			if errors.Is(err, io.EOF) {
				errCh <- nil
				return
			}
			errCh <- err
			return
		}

		switch packet.Stream {
		case domainadb.ShellStreamStdout, domainadb.ShellStreamStderr:
			if writeErr := writer.queueOutput(packet.Data); writeErr != nil {
				errCh <- writeErr
				return
			}
		case domainadb.ShellStreamExit:
			errCh <- nil
			return
		case domainadb.ShellStreamCloseStdin:
			continue
		default:
			if len(packet.Data) == 0 {
				return
			}
		}
	}
}

func terminalErrorMessage(err error) terminalMessage {
	message := terminalMessage{
		Type:    "error",
		Message: "无法启动终端会话",
	}

	switch {
	case errors.Is(err, terminalservice.ErrADBUnavailable):
		message.Message = "未找到可用的 ADB"
	case errors.Is(err, terminalservice.ErrDeviceNotFound):
		message.Message = "设备不存在"
	case errors.Is(err, terminalservice.ErrDeviceOffline):
		message.Message = "设备未连接或当前离线"
	case errors.Is(err, terminalservice.ErrSerialRequired):
		message.Message = "设备序列号不能为空"
	}

	return message
}

type streamTerminalWriter struct {
	writer io.Writer
	mu     sync.Mutex
}

func (w *streamTerminalWriter) writeJSON(payload any) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	return json.NewEncoder(w.writer).Encode(payload)
}
func (w *streamTerminalWriter) queueOutput(data []byte) error {
	return w.writeJSON(terminalMessage{Type: "output", Data: string(data)})
}
func (w *streamTerminalWriter) close(_ int, _ string) error { return nil }
func (w *streamTerminalWriter) stop()                       {}

type wsWriter struct {
	conn *websocket.Conn
	mu   sync.Mutex

	outputMu     sync.Mutex
	outputBuffer []byte
	outputTimer  *time.Timer
	flushPending bool
	stopCh       chan struct{}
	stopOnce     sync.Once
}

func (w *wsWriter) writeJSON(payload any) error {
	w.mu.Lock()
	defer w.mu.Unlock()

	return w.conn.WriteJSON(payload)
}

func (w *wsWriter) queueOutput(data []byte) error {
	w.outputMu.Lock()
	defer w.outputMu.Unlock()

	if w.stopCh == nil {
		w.stopCh = make(chan struct{})
		w.outputTimer = time.NewTimer(time.Hour)
		if !w.outputTimer.Stop() {
			select {
			case <-w.outputTimer.C:
			default:
			}
		}
		go w.flushLoop()
	}

	w.outputBuffer = append(w.outputBuffer, data...)
	if len(w.outputBuffer) >= 4096 {
		w.flushPending = false
		w.stopTimerLocked()
		return w.flushLocked()
	}

	w.flushPending = true
	w.resetTimerLocked(10 * time.Millisecond)
	return nil
}

func (w *wsWriter) flushLoop() {
	for {
		select {
		case <-w.outputTimer.C:
			w.outputMu.Lock()
			w.flushPending = false
			_ = w.flushLocked()
			w.outputMu.Unlock()
		case <-w.stopCh:
			return
		}
	}
}

func (w *wsWriter) flushLocked() error {
	if len(w.outputBuffer) == 0 {
		return nil
	}

	payload := terminalMessage{
		Type: "output",
		Data: string(w.outputBuffer),
	}
	w.outputBuffer = w.outputBuffer[:0]

	w.mu.Lock()
	defer w.mu.Unlock()
	return w.conn.WriteJSON(payload)
}

func (w *wsWriter) close(code int, text string) error {
	w.outputMu.Lock()
	w.flushPending = false
	w.stopTimerLocked()
	_ = w.flushLocked()
	w.outputMu.Unlock()

	w.mu.Lock()
	defer w.mu.Unlock()

	return w.conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(code, text))
}

func (w *wsWriter) stop() {
	w.stopOnce.Do(func() {
		w.outputMu.Lock()
		w.flushPending = false
		w.stopTimerLocked()
		_ = w.flushLocked()
		if w.stopCh != nil {
			close(w.stopCh)
		}
		w.outputMu.Unlock()
	})
}

func (w *wsWriter) resetTimerLocked(delay time.Duration) {
	if w.outputTimer == nil {
		return
	}
	w.stopTimerLocked()
	w.outputTimer.Reset(delay)
}

func (w *wsWriter) stopTimerLocked() {
	if w.outputTimer == nil {
		return
	}
	if !w.outputTimer.Stop() {
		select {
		case <-w.outputTimer.C:
		default:
		}
	}
}
