package handler

import (
	"bytes"
	"context"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	domainauth "aylink-agent/internal/domain/auth"
	webrtcservice "aylink-agent/internal/service/webrtc"
	"aylink-agent/internal/transport/http/middleware"
	"aylink-agent/internal/transport/rtc"
	pion "github.com/pion/webrtc/v4"
)

type transportAuth struct{}

func (transportAuth) ValidateAccessToken(_ context.Context, token string) (*domainauth.Identity, error) {
	switch token {
	case "owner":
		return &domainauth.Identity{UserID: 1, Permissions: []string{"files.access"}}, nil
	case "other":
		return &domainauth.Identity{UserID: 2, Permissions: []string{"files.access"}}, nil
	default:
		return nil, errors.New("expired")
	}
}

func TestDataTransportRevalidatesTokenAndOwner(t *testing.T) {
	calls := 0
	h := NewDataTransportHandler(nil, nil, nil, transportAuth{}, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if getIdentity(r).UserID != 1 {
			t.Error("identity not propagated")
		}
		w.WriteHeader(200)
	}))
	for _, test := range []struct {
		token  string
		status int
	}{{"owner", 200}, {"other", 403}, {"expired", 401}} {
		r := httptest.NewRequest("POST", "/api/devices/1/files/upload", nil)
		r.Header.Set("Authorization", "Bearer "+test.token)
		w := httptest.NewRecorder()
		h.authorizedDispatcher(1).ServeHTTP(w, r)
		if w.Code != test.status {
			t.Errorf("%s: status %d", test.token, w.Code)
		}
	}
	if calls != 1 {
		t.Fatalf("unauthorized operation executed: %d", calls)
	}
}

func TestDataTransportConfigurationRequiresAnOperationPermission(t *testing.T) {
	h := NewDataTransportHandler(nil, &fakeSettingsService{}, nil, nil, nil)
	for _, test := range []struct {
		permissions []string
		status      int
	}{
		{[]string{"devices.view"}, 403}, {[]string{"files.access"}, 200}, {[]string{"terminal.access"}, 200}, {[]string{"devices.control"}, 200},
	} {
		r := httptest.NewRequest("GET", "/api/devices/1/transport", nil)
		r = r.WithContext(context.WithValue(r.Context(), middleware.IdentityKey, &domainauth.Identity{UserID: 1, Permissions: test.permissions}))
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != test.status {
			t.Errorf("permissions %v: status %d", test.permissions, w.Code)
		}
	}
}

func TestDataTransportFileDownloadSurvivesRequestBodyClose(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	var client, server *rtc.Stream
	client = rtc.NewStream(ctx, func(data []byte, text bool) error { return server.Receive(data, text) }, func() {})
	server = rtc.NewStream(ctx, func(data []byte, text bool) error { return client.Receive(data, text) }, func() { _ = client.Close() })
	defer client.Close()
	defer server.Close()
	payload := strings.Repeat("download\x00bytes", rtc.WindowBytes)
	files := &recordingFileService{downloadName: "资料🚀.bin", downloadContent: payload}
	device := NewDeviceHandler(nil, nil, nil, nil, nil, files, nil, nil)
	transport := NewDataTransportHandler(nil, nil, nil, transportAuth{}, http.HandlerFunc(device.DownloadFile))
	go rtc.ServeHTTP(server, "1", transport.authorizedDispatcher(1))
	if err := client.SendControl(rtc.Message{Type: "request", Method: "POST", URL: "/api/devices/1/files/download", Headers: map[string]string{"Authorization": "Bearer owner"}}); err != nil {
		t.Fatal(err)
	}
	if _, err := client.Write([]byte(`{"path":"/sdcard/test.bin"}`)); err != nil {
		t.Fatal(err)
	}
	if err := client.End(); err != nil {
		t.Fatal(err)
	}
	response, err := client.Control()
	if err != nil {
		t.Fatalf("request body close interrupted response: %v", err)
	}
	if response.Type != "response" || response.Status != http.StatusOK {
		t.Fatalf("unexpected response: %+v", response)
	}
	header := response.Headers["Content-Disposition"]
	for _, char := range header {
		if char > 127 {
			t.Fatalf("RTC response header contains unencoded Unicode: %q", header)
		}
	}
	_, params, err := mime.ParseMediaType(header)
	if err != nil || params["filename"] != files.downloadName {
		t.Fatalf("RTC download filename changed: %q, error %v", header, err)
	}
	actual, err := io.ReadAll(client)
	if err != nil {
		t.Fatal(err)
	}
	if string(actual) != payload || files.downloadDeviceID != 1 || files.downloadPath != "/sdcard/test.bin" {
		t.Fatal("download content or request changed")
	}
}

func TestDataTransportOverRealPeerConnection(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	server, err := webrtcservice.NewService(nil).NewDataPeer(ctx, &fakeSettingsService{})
	if err != nil {
		t.Fatal(err)
	}
	payload := bytes.Repeat([]byte("rtc\x00binary-transfer"), rtc.WindowBytes/2)
	session := newDataTransportSession(server.Connection, "1", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Error(err)
			return
		}
		if err := r.Body.Close(); err != nil {
			t.Error(err)
			return
		}
		w.Header().Set("Content-Type", "application/octet-stream")
		_, _ = w.Write(body)
	}))
	defer session.close()
	client, err := pion.NewPeerConnection(pion.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	ready, err := client.CreateDataChannel("ready", nil)
	if err != nil {
		t.Fatal(err)
	}
	connected := make(chan struct{}, 1)
	ready.OnMessage(func(message pion.DataChannelMessage) {
		if string(message.Data) == "ready" {
			connected <- struct{}{}
		}
	})
	offer, err := client.CreateOffer(nil)
	if err != nil {
		t.Fatal(err)
	}
	gathered := pion.GatheringCompletePromise(client)
	if err := client.SetLocalDescription(offer); err != nil {
		t.Fatal(err)
	}
	select {
	case <-gathered:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	answer, err := server.Answer(ctx, *client.LocalDescription())
	if err != nil {
		t.Fatal(err)
	}
	if err := client.SetRemoteDescription(*answer); err != nil {
		t.Fatal(err)
	}
	select {
	case <-connected:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	channel, err := client.CreateDataChannel("request-1", nil)
	if err != nil {
		t.Fatal(err)
	}
	stream := rtc.NewStream(ctx, func(data []byte, text bool) error {
		if text {
			return channel.SendText(string(data))
		}
		return channel.Send(data)
	}, func() { _ = channel.Close() })
	defer stream.Close()
	channel.OnMessage(func(message pion.DataChannelMessage) {
		if err := stream.Receive(message.Data, message.IsString); err != nil {
			stream.Fail(err)
		}
	})
	channel.OnClose(func() { _ = stream.Close() })
	sent := make(chan error, 1)
	channel.OnOpen(func() {
		go func() {
			err := stream.SendControl(rtc.Message{Type: "request", Method: "POST", URL: "/api/devices/1/files/upload"})
			if err == nil {
				_, err = stream.Write(payload)
			}
			if err == nil {
				err = stream.End()
			}
			sent <- err
		}()
	})
	response, err := stream.Control()
	if err != nil {
		t.Fatal(err)
	}
	if response.Type != "response" || response.Status != 200 {
		t.Fatalf("unexpected response: %+v", response)
	}
	actual, err := io.ReadAll(stream)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(actual, payload) {
		t.Fatal("real SCTP stream corrupted")
	}
	if err := <-sent; err != nil {
		t.Fatal(err)
	}
}
