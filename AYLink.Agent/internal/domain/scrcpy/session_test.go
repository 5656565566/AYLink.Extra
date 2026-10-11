package scrcpy

import (
	"errors"
	"sync"
	"sync/atomic"
	"testing"
)

func TestSessionCloseReleasesOnceAndPreservesError(t *testing.T) {
	cleanupErr := errors.New("cleanup failed")
	var calls atomic.Int32
	session := &Session{CloseFunc: func() error {
		calls.Add(1)
		return cleanupErr
	}}
	var workers sync.WaitGroup
	for range 10 {
		workers.Add(1)
		go func() {
			defer workers.Done()
			if err := session.Close(); !errors.Is(err, cleanupErr) {
				t.Errorf("expected cleanup error, got %v", err)
			}
		}()
	}
	workers.Wait()
	if calls.Load() != 1 {
		t.Fatalf("expected one cleanup, got %d", calls.Load())
	}
}
