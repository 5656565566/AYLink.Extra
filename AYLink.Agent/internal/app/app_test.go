package app

import (
	"context"
	"testing"
	"time"

	domaindevice "aylink-agent/internal/domain/device"
	deviceservice "aylink-agent/internal/service/device"
)

type reconnectTestRepository struct {
	listCalled chan struct{}
}

type testADBStarter struct {
	called bool
}

func (s *testADBStarter) StartServer(context.Context) error {
	s.called = true
	return nil
}

func (r *reconnectTestRepository) List(context.Context) ([]domaindevice.Device, error) {
	select {
	case r.listCalled <- struct{}{}:
	default:
	}
	return nil, nil
}

func (*reconnectTestRepository) GetByID(context.Context, int) (*domaindevice.Device, error) {
	return nil, nil
}

func (*reconnectTestRepository) FindBySerialOrAddress(context.Context, string, *string, *int) (*domaindevice.Device, error) {
	return nil, nil
}

func (*reconnectTestRepository) Insert(context.Context, *domaindevice.Device) error { return nil }
func (*reconnectTestRepository) Update(context.Context, *domaindevice.Device) error { return nil }
func (*reconnectTestRepository) Delete(context.Context, int) error                  { return nil }

func TestDeviceReconnectLoopRunsInitialPassImmediately(t *testing.T) {
	repo := &reconnectTestRepository{listCalled: make(chan struct{}, 1)}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	application := &App{
		logger:  testLogger{},
		devices: deviceservice.NewService(repo),
	}

	go func() {
		application.runDeviceReconnectLoop(ctx)
		close(done)
	}()

	select {
	case <-repo.listCalled:
	case <-time.After(250 * time.Millisecond):
		cancel()
		<-done
		t.Fatal("expected an immediate device reconnect pass")
	}

	cancel()
	<-done
}

func TestStartADBServer(t *testing.T) {
	adb := &testADBStarter{}
	application := &App{logger: testLogger{}, adb: adb}

	application.startADBServer(context.Background())

	if !adb.called {
		t.Fatal("expected adb server to be started")
	}
}

type testLogger struct{}

func (testLogger) Debug(string, ...any) {}
func (testLogger) Info(string, ...any)  {}
func (testLogger) Warn(string, ...any)  {}
func (testLogger) Error(string, ...any) {}
