package webrtc

import (
	"context"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"testing"
	"time"

	pion "github.com/pion/webrtc/v4"
)

func webBitmap(count int, alive ...int) string {
	data := make([]byte, 2+(count+7)/8)
	binary.LittleEndian.PutUint16(data, uint16(count))
	for _, index := range alive {
		data[2+index/8] |= 1 << uint(index%8)
	}
	return base64.RawURLEncoding.EncodeToString(data)
}

func createWebTestTicket(t *testing.T, s *Service, owner WebOwner, page, device string) CreateTicketResult {
	t.Helper()
	ticket, err := s.CreateTicket(context.Background(), CreateTicketInput{PageID: page, UserID: owner.UserID,
		LoginSessionID: owner.LoginSessionID, DeviceID: device, NewDisplay: true, AppPackage: "test.app"})
	if err != nil {
		t.Fatal(err)
	}
	return ticket
}

func TestWebHeartbeatOwnershipSequenceAndPendingRegistrations(t *testing.T) {
	s := NewService(nil)
	now := time.Now().UTC()
	s.now = func() time.Time { return now }
	owner := WebOwner{1, "login-a"}
	page, err := s.RegisterWebPage(owner)
	if err != nil {
		t.Fatal(err)
	}
	first := createWebTestTicket(t, s, owner, page, "1")
	if first.Slot == nil || *first.Slot != 0 {
		t.Fatal("first slot must be zero")
	}
	if err := s.HeartbeatWebPage(owner, page, 1, webBitmap(1, 0)); err != nil {
		t.Fatal(err)
	}
	expires := s.sessionLeases[first.SessionID].ExpiresAt
	now = now.Add(30 * time.Second)
	if err := s.HeartbeatWebPage(owner, page, 1, webBitmap(1, 0)); err != nil {
		t.Fatal(err)
	}
	if s.sessionLeases[first.SessionID].ExpiresAt != expires {
		t.Fatal("replay extended the lease")
	}
	if err := s.HeartbeatWebPage(WebOwner{1, "another-login"}, page, 2, webBitmap(1, 0)); !errors.Is(err, ErrWebPageNotFound) {
		t.Fatal("another login renewed the page")
	}
	if err := s.HeartbeatWebPage(WebOwner{2, "login-a"}, page, 2, webBitmap(1, 0)); !errors.Is(err, ErrWebPageNotFound) {
		t.Fatal("another account renewed the page")
	}
	second := createWebTestTicket(t, s, owner, page, "2")
	if err := s.HeartbeatWebPage(owner, page, 2, webBitmap(1, 0)); err != nil {
		t.Fatal(err)
	}
	if !s.HasSessionLease("2", second.SessionID) {
		t.Fatal("old bitmap released an unacknowledged new slot")
	}
	if err := s.HeartbeatWebPage(owner, page, 3, webBitmap(2, 1)); err != nil {
		t.Fatal(err)
	}
	if s.HasSessionLease("1", first.SessionID) || !s.HasSessionLease("2", second.SessionID) {
		t.Fatal("closing one slot affected the wrong session")
	}
	for _, input := range []struct {
		sequence uint64
		bitmap   string
	}{
		{2, webBitmap(2, 0, 1)}, {3, webBitmap(2)}, {4, webBitmap(2, 0, 1)}, {4, webBitmap(1, 0)}, {4, "AAAAAA"},
	} {
		if err := s.HeartbeatWebPage(owner, page, input.sequence, input.bitmap); !errors.Is(err, ErrWebHeartbeat) {
			t.Fatalf("accepted invalid heartbeat: %+v, %v", input, err)
		}
	}
	now = now.Add(webSessionTTL + time.Second)
	if s.HasSessionLease("2", second.SessionID) || len(s.WebPageOwners()) != 0 {
		t.Fatal("expired page leaked a session")
	}
	if err := s.HeartbeatWebPage(owner, page, 10, webBitmap(2, 1)); !errors.Is(err, ErrWebPageNotFound) {
		t.Fatal("expired marker was resurrected")
	}
	consumed, err := s.ConsumeTicket(context.Background(), second.Ticket)
	if err == nil && s.StartTicket(consumed) {
		t.Fatal("late ticket revived an expired session")
	}
}

func TestWebSessionQuotaAndReleasedSlotsAreNotReused(t *testing.T) {
	s := NewService(nil)
	owner := WebOwner{1, "login"}
	page, _ := s.RegisterWebPage(owner)
	for index := 0; index < maxSessionsPerLogin; index++ {
		createWebTestTicket(t, s, owner, page, "1")
	}
	if _, err := s.CreateTicket(context.Background(), CreateTicketInput{PageID: page, UserID: 1, LoginSessionID: "login", DeviceID: "1"}); !errors.Is(err, ErrWebSessionLimit) {
		t.Fatal("session quota was bypassed")
	}
	alive := make([]int, 0, maxSessionsPerLogin-1)
	for index := 1; index < maxSessionsPerLogin; index++ {
		alive = append(alive, index)
	}
	if err := s.HeartbeatWebPage(owner, page, 1, webBitmap(maxSessionsPerLogin, alive...)); err != nil {
		t.Fatal(err)
	}
	next := createWebTestTicket(t, s, owner, page, "1")
	if *next.Slot != maxSessionsPerLogin {
		t.Fatal("closed slot was reused")
	}
	for index := 1; index < maxPagesPerLogin; index++ {
		if _, err := s.RegisterWebPage(owner); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.RegisterWebPage(owner); !errors.Is(err, ErrWebSessionLimit) {
		t.Fatal("page quota was bypassed")
	}
}

func TestClosingWebPageClosesPeerAndKeepsOtherPage(t *testing.T) {
	s := NewService(nil)
	owner := WebOwner{1, "login"}
	page, _ := s.RegisterWebPage(owner)
	first := createWebTestTicket(t, s, owner, page, "1")
	other, _ := s.RegisterWebPage(owner)
	second := createWebTestTicket(t, s, owner, other, "2")
	pc, err := pion.NewPeerConnection(pion.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = pc.Close() })
	closed := make(chan struct{}, 1)
	pc.OnConnectionStateChange(func(state pion.PeerConnectionState) {
		if state == pion.PeerConnectionStateClosed {
			closed <- struct{}{}
		}
	})
	s.signaling[first.SessionID] = &signalingSession{peerConnection: pc}
	if err := s.HeartbeatWebPage(owner, page, 1, ""); err != nil {
		t.Fatal(err)
	}
	select {
	case <-closed:
	case <-time.After(3 * time.Second):
		t.Fatal("page close left its peer alive")
	}
	if s.HasSessionLease("1", first.SessionID) || !s.HasSessionLease("2", second.SessionID) {
		t.Fatal("page cleanup crossed ownership")
	}
}
