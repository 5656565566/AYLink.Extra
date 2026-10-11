package rtc

import (
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// ServeHTTP 保留原有 HTTP 接口约定 仅替换底层字节传输
// 认证和业务规则仍由请求分发器处理
func ServeHTTP(stream *Stream, deviceID string, dispatch http.Handler) {
	message, err := stream.Control()
	if err != nil {
		return
	}
	if message.Type != "request" || !AllowedDeviceURL(message.URL, deviceID) {
		stream.Fail(errors.New("invalid RTC request URL"))
		return
	}
	// 业务接口关闭请求体只结束读取 不能关闭仍需发送响应的双向通道
	// 通道生命周期由客户端消费完成、取消或会话关闭控制
	request, err := http.NewRequestWithContext(stream.Context(), message.Method, message.URL, io.NopCloser(stream))
	if err != nil {
		stream.Fail(err)
		return
	}
	for name, value := range message.Headers {
		request.Header.Set(name, value)
	}
	writer := &responseWriter{stream: stream, headers: make(http.Header)}
	dispatch.ServeHTTP(writer, request)
	if writer.err != nil {
		stream.Fail(writer.err)
		return
	}
	if !writer.started {
		writer.WriteHeader(http.StatusOK)
	}
	if err := stream.End(); err != nil {
		stream.Fail(err)
	}
	// 由客户端读完 end 帧后关闭通道 这里立即关闭可能丢失 SCTP 缓冲区中的数据
	// 尤其是上传请求的最终响应
}

func AllowedDeviceURL(rawURL, deviceID string) bool {
	u, err := url.ParseRequestURI(rawURL)
	if err != nil || u.IsAbs() || u.Host != "" || u.Fragment != "" {
		return false
	}
	prefix := "/api/devices/" + deviceID + "/"
	if !strings.HasPrefix(u.Path, prefix) {
		return false
	}
	switch strings.TrimPrefix(u.Path, prefix) {
	case "files/list", "files/download", "files/upload", "files/rename", "files/delete",
		"apps", "apps/info", "apps/install", "apps/download", "apps/launch", "apps/uninstall", "terminal/stream":
		return true
	default:
		return false
	}
}

type responseWriter struct {
	stream  *Stream
	headers http.Header
	started bool
	err     error
}

func (w *responseWriter) Header() http.Header { return w.headers }
func (w *responseWriter) WriteHeader(status int) {
	if w.started {
		return
	}
	w.started = true
	headers := make(map[string]string, len(w.headers))
	for name := range w.headers {
		headers[name] = w.headers.Get(name)
	}
	w.err = w.stream.SendControl(Message{Type: "response", Status: status, Headers: headers})
}
func (w *responseWriter) Write(data []byte) (int, error) {
	if !w.started {
		w.WriteHeader(http.StatusOK)
	}
	if w.err != nil {
		return 0, w.err
	}
	n, err := w.stream.Write(data)
	w.err = err
	return n, err
}
