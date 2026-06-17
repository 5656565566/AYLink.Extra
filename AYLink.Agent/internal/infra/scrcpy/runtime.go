package scrcpy

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"sync"
	"time"

	domainscrcpy "aylink-agent/internal/domain/scrcpy"
	"aylink-agent/internal/infra/logging"

	"github.com/jj11hh/opus"
)

const (
	deviceMetaLengthWithDummyByte                = 65
	sessionHeaderLength                          = 12
	configPacketFlag                             = 1 << 62
	keyFrameFlag                                 = 1 << 61
	ptsMask                                      = keyFrameFlag - 1
	controlQueueWaitTimeout                      = 100 * time.Millisecond
	videoPacketQueueSize                         = 8
	audioPacketQueueSize                         = 32
	controlQueueSize                             = 256
	videoRefreshDebounce                         = 10 * time.Second
	videoRefreshConfirmationWindow               = 12 * time.Second
	videoRefreshConfirmations                    = 2
	replayableKeyFrameMaxAge                     = 3 * time.Second
	videoKeyFrameReplayCooldown                  = 500 * time.Millisecond
	sourceHealthPacketFreshness                  = 3 * time.Second
	sourceHealthRecoveryWindow                   = 8 * time.Second
	sourceHealthRepeatedPTSStallThreshold        = 6
	opusSampleRate                               = 48000
	opusChannels                                 = 2
	audioGainMultiplier                          = 1.3
	deviceMsgTypeClipboard                       = 0
	deviceMsgTypeAckClipboard                    = 1
	deviceMsgTypeUHIDOutput                      = 2
	controlMsgClipboardSequenceInvalid    uint64 = 0
)

var opusWasmMu sync.Mutex
var mediaPacketBufferPool = sync.Pool{
	New: func() any {
		return make([]byte, 0, 64*1024)
	},
}

type runtime struct {
	logger logging.Logger

	videoConn   net.Conn
	audioConn   net.Conn
	controlConn net.Conn

	controlMu        sync.Mutex
	controlEnqueueMu sync.Mutex
	closeOnce        sync.Once
	controlWrites    chan []byte
	controlReadMu    sync.Mutex
	controlBuffer    []byte

	videoMu             sync.Mutex
	videoSubscribers    map[int]chan domainscrcpy.VideoPacket
	nextVideoSubID      int
	videoGeneration     uint64
	latestVideoConfig   cachedVideoPacket
	latestVideoKeyFrame cachedVideoPacket

	audioMu          sync.Mutex
	audioSubscribers map[int]chan domainscrcpy.AudioPacket
	nextAudioSubID   int

	errorMu          sync.Mutex
	errorSubscribers map[int]chan error
	nextErrorSubID   int

	clipboardMu           sync.Mutex
	clipboardWaiters      map[int]chan string
	nextClipboardWaiterID int
	clipboardAckWaiters   map[uint64]chan struct{}
	nextClipboardSequence uint64
	latestClipboardText   string
	hasLatestClipboard    bool

	refreshMu        sync.Mutex
	refreshRequested bool
	lastRefreshTime  time.Time
	lastRefreshAskAt time.Time
	refreshAskCount  int

	healthMu sync.Mutex
	health   domainscrcpy.SourceHealthSnapshot

	done chan struct{}
}

type cachedVideoPacket struct {
	packet     domainscrcpy.VideoPacket
	generation uint64
	cachedAt   time.Time
}

func (s *Service) OpenRuntime(ctx context.Context, session *domainscrcpy.Session) (domainscrcpy.Runtime, error) {
	if session == nil {
		return nil, errors.New("scrcpy session is nil")
	}
	if session.VideoPort == 0 {
		return nil, errors.New("scrcpy video port is not available")
	}

	s.logger.Info("scrcpy runtime connecting video socket", "port", session.VideoPort)
	videoConn, err := dialLocalPort(ctx, session.VideoPort)
	if err != nil {
		return nil, fmt.Errorf("connect scrcpy video socket: %w", err)
	}

	rt := &runtime{
		logger:                s.logger,
		videoConn:             videoConn,
		videoSubscribers:      make(map[int]chan domainscrcpy.VideoPacket),
		audioSubscribers:      make(map[int]chan domainscrcpy.AudioPacket),
		errorSubscribers:      make(map[int]chan error),
		clipboardWaiters:      make(map[int]chan string),
		clipboardAckWaiters:   make(map[uint64]chan struct{}),
		nextClipboardSequence: 1,
		done:                  make(chan struct{}),
		controlWrites:         make(chan []byte, controlQueueSize),
	}
	go rt.readVideoLoop()

	var audioConn net.Conn
	if session.AudioPort != 0 {
		s.logger.Info("scrcpy runtime connecting audio socket", "port", session.AudioPort)
		audioConn, err = dialLocalPort(ctx, session.AudioPort)
		if err != nil {
			_ = rt.Close()
			return nil, fmt.Errorf("connect scrcpy audio socket: %w", err)
		}
		rt.audioConn = audioConn
		go rt.readAudioLoop()
	}

	var controlConn net.Conn
	if session.ControlPort != 0 {
		s.logger.Info("scrcpy runtime connecting control socket", "port", session.ControlPort)
		controlConn, err = dialLocalPort(ctx, session.ControlPort)
		if err != nil {
			_ = rt.Close()
			return nil, fmt.Errorf("connect scrcpy control socket: %w", err)
		}
		rt.controlConn = controlConn
		go rt.writeControlLoop()
		go rt.readControlLoop()
	}
	return rt, nil
}

func (r *runtime) SubscribeVideoPackets() (<-chan domainscrcpy.VideoPacket, func()) {
	ch := make(chan domainscrcpy.VideoPacket, videoPacketQueueSize)

	r.videoMu.Lock()
	select {
	case <-r.done:
		r.videoMu.Unlock()
		close(ch)
		return ch, func() {}
	default:
	}

	id := r.nextVideoSubID
	r.nextVideoSubID++
	r.videoSubscribers[id] = ch
	configPacket := r.latestVideoConfig
	keyFramePacket := r.latestVideoKeyFrame
	if packet := cloneCachedVideoPacket(configPacket); len(packet.Data) > 0 {
		ch <- packet
	}
	if configPacket.generation != 0 && keyFramePacket.generation == configPacket.generation {
		if packet := cloneCachedVideoPacket(keyFramePacket); len(packet.Data) > 0 {
			ch <- packet
		}
	}
	r.videoMu.Unlock()

	return ch, func() {
		r.videoMu.Lock()
		sub, ok := r.videoSubscribers[id]
		if ok {
			delete(r.videoSubscribers, id)
		}
		r.videoMu.Unlock()
		if ok {
			close(sub)
			releaseQueuedVideoPackets(sub)
		}
	}
}

func (r *runtime) SubscribeAudioPackets() (<-chan domainscrcpy.AudioPacket, func()) {
	ch := make(chan domainscrcpy.AudioPacket, audioPacketQueueSize)

	r.audioMu.Lock()
	select {
	case <-r.done:
		r.audioMu.Unlock()
		close(ch)
		return ch, func() {}
	default:
	}

	id := r.nextAudioSubID
	r.nextAudioSubID++
	r.audioSubscribers[id] = ch
	r.audioMu.Unlock()

	return ch, func() {
		r.audioMu.Lock()
		sub, ok := r.audioSubscribers[id]
		if ok {
			delete(r.audioSubscribers, id)
		}
		r.audioMu.Unlock()
		if ok {
			close(sub)
			releaseQueuedAudioPackets(sub)
		}
	}
}

func (r *runtime) SubscribeErrors() (<-chan error, func()) {
	ch := make(chan error, 4)

	r.errorMu.Lock()
	select {
	case <-r.done:
		r.errorMu.Unlock()
		close(ch)
		return ch, func() {}
	default:
	}

	id := r.nextErrorSubID
	r.nextErrorSubID++
	r.errorSubscribers[id] = ch
	r.errorMu.Unlock()

	return ch, func() {
		r.errorMu.Lock()
		sub, ok := r.errorSubscribers[id]
		if ok {
			delete(r.errorSubscribers, id)
		}
		r.errorMu.Unlock()
		if ok {
			close(sub)
		}
	}
}

func (r *runtime) GetClipboard(ctx context.Context) (string, error) {
	if r.controlConn == nil {
		return "", errors.New("scrcpy control socket is not available")
	}

	waiter := make(chan string, 1)

	r.clipboardMu.Lock()
	waiterID := r.nextClipboardWaiterID
	r.nextClipboardWaiterID++
	r.clipboardWaiters[waiterID] = waiter
	r.clipboardMu.Unlock()

	if err := r.SendControl(domainscrcpy.BuildGetClipboardControl()); err != nil {
		r.removeClipboardWaiter(waiterID)
		return "", err
	}

	select {
	case <-r.done:
		r.removeClipboardWaiter(waiterID)
		return "", net.ErrClosed
	case text := <-waiter:
		return text, nil
	case <-ctx.Done():
		r.removeClipboardWaiter(waiterID)
		return "", ctx.Err()
	}
}

func (r *runtime) GetClipboardCached() (string, bool) {
	r.clipboardMu.Lock()
	defer r.clipboardMu.Unlock()

	if !r.hasLatestClipboard {
		return "", false
	}

	return r.latestClipboardText, true
}

func (r *runtime) SetClipboard(ctx context.Context, text string) error {
	return r.setClipboard(ctx, text, false)
}

func (r *runtime) PasteClipboard(ctx context.Context, text string) error {
	return r.setClipboard(ctx, text, true)
}

func (r *runtime) setClipboard(ctx context.Context, text string, paste bool) error {
	if r.controlConn == nil {
		return errors.New("scrcpy control socket is not available")
	}

	waiter := make(chan struct{}, 1)

	r.clipboardMu.Lock()
	sequence := r.nextClipboardSequence
	r.nextClipboardSequence++
	if sequence == controlMsgClipboardSequenceInvalid {
		sequence = r.nextClipboardSequence
		r.nextClipboardSequence++
	}
	r.clipboardAckWaiters[sequence] = waiter
	r.clipboardMu.Unlock()

	if err := r.SendControl(domainscrcpy.BuildSetClipboardControl(sequence, text, paste)); err != nil {
		r.removeClipboardAckWaiter(sequence)
		return err
	}

	select {
	case <-r.done:
		r.removeClipboardAckWaiter(sequence)
		return net.ErrClosed
	case <-waiter:
		r.clipboardMu.Lock()
		r.latestClipboardText = text
		r.hasLatestClipboard = true
		r.clipboardMu.Unlock()
		return nil
	case <-ctx.Done():
		r.removeClipboardAckWaiter(sequence)
		return ctx.Err()
	}
}

func (r *runtime) ReplayLatestVideoKeyFrame() bool {
	r.videoMu.Lock()

	select {
	case <-r.done:
		r.videoMu.Unlock()
		return false
	default:
	}

	configPacket := r.latestVideoConfig
	keyFramePacket := r.latestVideoKeyFrame
	if configPacket.generation == 0 || keyFramePacket.generation == 0 || keyFramePacket.generation != configPacket.generation {
		r.videoMu.Unlock()
		return false
	}
	now := time.Now()
	keyFrameAge := now.Sub(keyFramePacket.cachedAt)
	if keyFramePacket.cachedAt.IsZero() || keyFrameAge > replayableKeyFrameMaxAge {
		r.videoMu.Unlock()
		if r.logger != nil {
			r.logger.Info("scrcpy video key frame replay skipped",
				"reason", "cached_keyframe_too_old",
				"generation", keyFramePacket.generation,
				"keyFrameAge", keyFrameAge.String(),
				"maxAge", replayableKeyFrameMaxAge.String(),
			)
		}
		return false
	}
	lastReplayAt := r.getLastVideoKeyFrameReplayAt()
	if !lastReplayAt.IsZero() && now.Sub(lastReplayAt) < videoKeyFrameReplayCooldown {
		r.videoMu.Unlock()
		if r.logger != nil {
			r.logger.Info("scrcpy video key frame replay skipped",
				"reason", "replay_cooldown",
				"generation", keyFramePacket.generation,
				"sinceLastReplay", now.Sub(lastReplayAt).String(),
				"cooldown", videoKeyFrameReplayCooldown.String(),
			)
		}
		return false
	}
	if len(r.videoSubscribers) == 0 {
		r.videoMu.Unlock()
		return false
	}

	for _, sub := range r.videoSubscribers {
		if packet := cloneCachedVideoPacket(configPacket); len(packet.Data) > 0 {
			offerCriticalVideoPacketToSubscriber(sub, packet)
		}
		if packet := cloneCachedVideoPacket(keyFramePacket); len(packet.Data) > 0 {
			offerCriticalVideoPacketToSubscriber(sub, packet)
		}
	}
	subscriberCount := len(r.videoSubscribers)
	generation := keyFramePacket.generation
	r.markVideoKeyFrameReplayed(now)
	r.videoMu.Unlock()

	if r.logger != nil {
		r.logger.Info("scrcpy video key frame replayed",
			"generation", generation,
			"subscriberCount", subscriberCount,
			"keyFrameAge", keyFrameAge.String(),
		)
	}
	return true
}

func (r *runtime) RequestVideoRefresh(options ...domainscrcpy.VideoRefreshOptions) error {
	refreshOptions := domainscrcpy.VideoRefreshOptions{}
	for _, option := range options {
		if option.BypassConfirmation {
			refreshOptions.BypassConfirmation = true
		}
	}

	r.refreshMu.Lock()
	if r.refreshRequested {
		if r.logger != nil {
			r.logger.Info("scrcpy video refresh skipped", "reason", "refresh_already_inflight")
		}
		r.refreshMu.Unlock()
		return nil
	}
	now := time.Now()
	health := r.GetSourceHealth()
	if health.State == domainscrcpy.SourceHealthStaticButAlive {
		r.refreshAskCount = 0
		r.lastRefreshAskAt = time.Time{}
		if r.logger != nil {
			r.logger.Info("scrcpy video refresh skipped",
				"reason", "source_static_but_alive",
				"sourceHealth", string(health.State),
				"sourceHealthReason", health.Reason,
			)
		}
		r.refreshMu.Unlock()
		return nil
	}
	bypassConfirmation := refreshOptions.BypassConfirmation || shouldBypassVideoRefreshConfirmation(health.State)
	if !r.lastRefreshAskAt.IsZero() && now.Sub(r.lastRefreshAskAt) > videoRefreshConfirmationWindow {
		r.refreshAskCount = 0
	}
	r.lastRefreshAskAt = now
	r.refreshAskCount++
	if !bypassConfirmation && r.refreshAskCount < videoRefreshConfirmations {
		if r.logger != nil {
			r.logger.Info("scrcpy video refresh deferred",
				"reason", "confirmation_pending",
				"requestCount", r.refreshAskCount,
				"confirmationThreshold", videoRefreshConfirmations,
				"confirmationWindow", videoRefreshConfirmationWindow.String(),
			)
		}
		r.refreshMu.Unlock()
		return nil
	}
	r.refreshAskCount = 0
	sinceLastRefresh := time.Since(r.lastRefreshTime)
	if sinceLastRefresh < videoRefreshDebounce {
		if r.logger != nil {
			r.logger.Info("scrcpy video refresh skipped",
				"reason", "debounced",
				"sinceLastRefresh", sinceLastRefresh.String(),
				"debounce", videoRefreshDebounce.String(),
			)
		}
		r.refreshMu.Unlock()
		return nil
	}
	r.lastRefreshTime = time.Now()
	r.refreshRequested = true
	r.markVideoRefreshRequested(r.lastRefreshTime)
	r.refreshMu.Unlock()

	go func() {
		defer func() {
			r.refreshMu.Lock()
			r.refreshRequested = false
			r.refreshMu.Unlock()
		}()
		if r.logger != nil {
			r.logger.Info("scrcpy video refresh dispatching reset control",
				"queueDepth", len(r.controlWrites),
				"queueCapacity", cap(r.controlWrites),
				"sourceHealth", string(health.State),
				"sourceHealthReason", health.Reason,
				"bypassConfirmation", bypassConfirmation,
			)
		}
		_ = r.SendControl(domainscrcpy.BuildResetVideoControl())
	}()

	return nil
}

func shouldBypassVideoRefreshConfirmation(state domainscrcpy.SourceHealthState) bool {
	switch state {
	case domainscrcpy.SourceHealthPacketStalled, domainscrcpy.SourceHealthPTSStalled, domainscrcpy.SourceHealthSourceStalled:
		return true
	default:
		return false
	}
}

func (r *runtime) GetSourceHealth() domainscrcpy.SourceHealthSnapshot {
	r.healthMu.Lock()
	defer r.healthMu.Unlock()

	health := r.health
	select {
	case <-r.done:
		health.RuntimeClosed = true
	default:
	}
	health.State, health.Reason = classifySourceHealth(health, time.Now())
	return health
}

func (r *runtime) SendControl(payload []byte) error {
	if len(payload) == 0 {
		return nil
	}
	if r.controlConn == nil {
		return errors.New("scrcpy control socket is not available")
	}

	message := append([]byte(nil), payload...)
	droppableKind := droppableControlPayloadKindOf(message)
	r.controlEnqueueMu.Lock()
	defer r.controlEnqueueMu.Unlock()
	if droppableKind != droppableControlPayloadNone {
		r.dropQueuedControlPayloads(droppableKind)
	}

	select {
	case <-r.done:
		return net.ErrClosed
	case r.controlWrites <- message:
		return nil
	default:
		if isDroppableControlPayload(message) {
			return nil
		}
	}

	timer := time.NewTimer(controlQueueWaitTimeout)
	defer timer.Stop()

	select {
	case <-r.done:
		return net.ErrClosed
	case r.controlWrites <- message:
		return nil
	case <-timer.C:
		return fmt.Errorf("scrcpy control queue is congested")
	}
}

func (r *runtime) dropQueuedControlPayloads(kind droppableControlPayloadKind) {
	if kind == droppableControlPayloadNone || r.controlWrites == nil {
		return
	}

	remaining := make([][]byte, 0, len(r.controlWrites))
	for {
		select {
		case queued := <-r.controlWrites:
			if droppableControlPayloadKindOf(queued) != kind {
				remaining = append(remaining, queued)
			}
		default:
			for _, queued := range remaining {
				r.controlWrites <- queued
			}
			return
		}
	}
}

func (r *runtime) Close() error {
	var closeErr error
	r.closeOnce.Do(func() {
		close(r.done)
		r.markSourceRuntimeClosed()
		r.closeAllSubscribers()
		if r.videoConn != nil {
			if err := r.videoConn.Close(); err != nil && closeErr == nil {
				closeErr = err
			}
		}
		if r.audioConn != nil {
			if err := r.audioConn.Close(); err != nil && closeErr == nil {
				closeErr = err
			}
		}
		if r.controlConn != nil {
			if err := r.controlConn.Close(); err != nil && closeErr == nil {
				closeErr = err
			}
		}
	})
	return closeErr
}

func (r *runtime) readVideoLoop() {
	defer r.Close()

	deviceHeader := make([]byte, deviceMetaLengthWithDummyByte)
	if _, err := io.ReadFull(r.videoConn, deviceHeader); err != nil {
		r.emitError(fmt.Errorf("read scrcpy device header: %w", err))
		return
	}

	codecHeader := make([]byte, 4)
	if _, err := io.ReadFull(r.videoConn, codecHeader); err != nil {
		r.emitError(fmt.Errorf("read scrcpy codec header: %w", err))
		return
	}

	codec, err := parseVideoCodec(codecHeader)
	if err != nil {
		r.emitError(err)
		return
	}

	sessionHeader := make([]byte, sessionHeaderLength)
	if _, err := io.ReadFull(r.videoConn, sessionHeader); err != nil {
		r.emitError(fmt.Errorf("read scrcpy session header: %w", err))
		return
	}

	screenWidth, screenHeight, err := parseSessionHeader(sessionHeader)
	if err != nil {
		r.emitError(err)
		return
	}
	r.logger.Info("scrcpy video runtime ready", "codec", codec, "width", screenWidth, "height", screenHeight)

	loggedConfig := false
	loggedKeyFrame := false
	header := make([]byte, 12)

	for {
		if _, err := io.ReadFull(r.videoConn, header); err != nil {
			if !errors.Is(err, net.ErrClosed) && !errors.Is(err, io.EOF) {
				r.emitError(fmt.Errorf("read scrcpy packet header: %w", err))
			}
			return
		}

		if isSessionPacket(header) {
			screenWidth, screenHeight, err = parseSessionHeader(header)
			if err != nil {
				r.emitError(err)
				return
			}
			continue
		}

		ptsAndFlags := binary.BigEndian.Uint64(header[:8])
		packetSize := int(binary.BigEndian.Uint32(header[8:12]))
		if packetSize <= 0 || packetSize > 2*1024*1024 {
			r.emitError(fmt.Errorf("invalid scrcpy packet size: %d", packetSize))
			return
		}

		payload := acquireMediaPacketBuffer(packetSize)
		if _, err := io.ReadFull(r.videoConn, payload); err != nil {
			releaseMediaPacketBuffer(payload)
			r.emitError(fmt.Errorf("read scrcpy packet payload: %w", err))
			return
		}

		packet := domainscrcpy.VideoPacket{
			Data:                  payload,
			Buffer:                payload,
			Release:               func() { releaseMediaPacketBuffer(payload) },
			PresentationTimestamp: int64(ptsAndFlags & ptsMask),
			IsConfig:              (ptsAndFlags & configPacketFlag) != 0,
			IsKeyFrame:            (ptsAndFlags & keyFrameFlag) != 0,
			Codec:                 codec,
			ScreenWidth:           screenWidth,
			ScreenHeight:          screenHeight,
		}
		if packet.IsConfig {
			packet.PresentationTimestamp = 0
			if !loggedConfig {
				loggedConfig = true
				r.logger.Info("scrcpy video config packet", "size", len(packet.Data), "codec", packet.Codec)
			}
		} else if !loggedKeyFrame && (packet.IsKeyFrame || packet.Codec == domainscrcpy.VideoCodecH264 && containsAnnexBIDRPacket(packet.Data)) {
			loggedKeyFrame = true
			r.logger.Info("scrcpy video key frame packet", "size", len(packet.Data), "pts", packet.PresentationTimestamp, "codec", packet.Codec)
		}

		r.offerLatestVideoPacket(packet)
	}
}

func containsAnnexBIDRPacket(sample []byte) bool {
	for i := 0; i+4 < len(sample); i++ {
		startCodeLength := 0
		if i+3 < len(sample) && sample[i] == 0 && sample[i+1] == 0 && sample[i+2] == 1 {
			startCodeLength = 3
		} else if i+4 < len(sample) && sample[i] == 0 && sample[i+1] == 0 && sample[i+2] == 0 && sample[i+3] == 1 {
			startCodeLength = 4
		}
		if startCodeLength == 0 {
			continue
		}

		headerIndex := i + startCodeLength
		if headerIndex < len(sample) && (sample[headerIndex]&0x1F) == 5 {
			return true
		}
	}
	return false
}

func (r *runtime) readAudioLoop() {
	defer r.Close()

	codecHeader := make([]byte, 4)
	if _, err := io.ReadFull(r.audioConn, codecHeader); err != nil {
		r.emitError(fmt.Errorf("read scrcpy audio codec header: %w", err))
		return
	}

	codec, err := parseAudioCodec(codecHeader)
	if err != nil {
		r.emitError(err)
		return
	}

	r.logger.Info("scrcpy audio runtime ready", "codec", codec)

	var encoder *opus.Encoder
	if codec == domainscrcpy.AudioCodecRaw {
		// 当使用 raw 格式时 scrcpy 输出 48000Hz 立体声 16位 PCM
		// github.com/jj11hh/opus 使用全局共享的 Wasm 运行时和内存，
		// 多个会话并发初始化/编码时会踩内存并导致 Windows 访问冲突。
		opusWasmMu.Lock()
		enc, err := opus.NewEncoder(opusSampleRate, opusChannels, opus.AppAudio)
		opusWasmMu.Unlock()
		if err != nil {
			r.emitError(fmt.Errorf("failed to create opus encoder: %w", err))
			return
		}
		encoder = enc
	}

	var pcmBuffer []int16
	var sampleScratch []int16
	var payloadBuffer []byte
	header := make([]byte, 12)
	encodeScratch := make([]byte, 1500)
	// WebRTC Opus 通常需要 20ms 帧 对于 48kHz 立体声:
	// 48000 x 2声道 x 0.02 s = 1920 samples
	const samplesPerFrame = opusSampleRate * opusChannels / 50

	for {
		if _, err := io.ReadFull(r.audioConn, header); err != nil {
			if !errors.Is(err, net.ErrClosed) && !errors.Is(err, io.EOF) {
				r.emitError(fmt.Errorf("read scrcpy audio packet header: %w", err))
			}
			return
		}

		ptsAndFlags := binary.BigEndian.Uint64(header[:8])
		packetSize := int(binary.BigEndian.Uint32(header[8:12]))
		if packetSize <= 0 || packetSize > 2*1024*1024 {
			r.emitError(fmt.Errorf("invalid scrcpy audio packet size: %d", packetSize))
			return
		}

		if cap(payloadBuffer) < packetSize {
			payloadBuffer = make([]byte, packetSize)
		}
		payload := payloadBuffer[:packetSize]
		if _, err := io.ReadFull(r.audioConn, payload); err != nil {
			r.emitError(fmt.Errorf("read scrcpy audio packet payload: %w", err))
			return
		}

		if codec == domainscrcpy.AudioCodecOpus {
			// 纯 Opus 透传模式
			packet := domainscrcpy.AudioPacket{
				Data:                  payload,
				Buffer:                payload,
				Release:               func() { releaseMediaPacketBuffer(payload) },
				PresentationTimestamp: int64(ptsAndFlags & ptsMask),
				IsConfig:              (ptsAndFlags & configPacketFlag) != 0,
				Codec:                 codec,
			}
			r.offerLatestAudioPacket(packet)
		} else if codec == domainscrcpy.AudioCodecRaw && encoder != nil {
			// 累加 PCM 载荷
			sampleCount := len(payload) / 2
			if cap(sampleScratch) < sampleCount {
				sampleScratch = make([]int16, sampleCount)
			}
			sampleScratch = sampleScratch[:sampleCount]
			for i := 0; i < sampleCount; i++ {
				sampleScratch[i] = int16(binary.LittleEndian.Uint16(payload[i*2 : i*2+2]))
			}
			applyPCMInt16Gain(sampleScratch, audioGainMultiplier)
			pcmBuffer = append(pcmBuffer, sampleScratch...)

			// 编码为 20ms 长度的数据帧
			for len(pcmBuffer) >= samplesPerFrame {
				framePCM := pcmBuffer[:samplesPerFrame]
				pcmBuffer = pcmBuffer[samplesPerFrame:]

				// 串行化对共享 Wasm Opus 编码器运行时的访问 避免多路会话并发
				// 调用 malloc/free/encode 时破坏同一块 Wasm 线性内存
				opusWasmMu.Lock()
				n, err := encoder.Encode(framePCM, encodeScratch)
				opusWasmMu.Unlock()
				if err != nil {
					r.emitError(fmt.Errorf("opus encoding failed: %w", err))
					continue
				}

				if n > 0 {
					packet := domainscrcpy.AudioPacket{
						Data:                  append([]byte(nil), encodeScratch[:n]...),
						PresentationTimestamp: int64(ptsAndFlags & ptsMask),
						IsConfig:              false,
						Codec:                 domainscrcpy.AudioCodecOpus,
					}
					r.offerLatestAudioPacket(packet)
				}
			}
		}
	}
}

func (r *runtime) readControlLoop() {
	if r.controlConn == nil {
		return
	}

	buffer := make([]byte, 4096)
	for {
		if err := r.controlConn.SetReadDeadline(time.Now().Add(30 * time.Second)); err != nil {
			return
		}

		n, err := r.controlConn.Read(buffer)
		if err != nil {
			if ne, ok := err.(net.Error); ok && ne.Timeout() {
				select {
				case <-r.done:
					return
				default:
					continue
				}
			}
			return
		}

		if n == 0 {
			return
		}

		if err := r.handleControlMessages(buffer[:n]); err != nil {
			r.emitError(err)
			return
		}
	}
}

func (r *runtime) writeControlLoop() {
	if r.controlConn == nil {
		return
	}

	for {
		select {
		case <-r.done:
			return
		case payload := <-r.controlWrites:
			if len(payload) == 0 {
				continue
			}

			r.controlMu.Lock()
			if err := r.controlConn.SetWriteDeadline(time.Now().Add(5 * time.Second)); err != nil {
				r.controlMu.Unlock()
				r.emitError(err)
				return
			}
			_, err := r.controlConn.Write(payload)
			r.controlMu.Unlock()
			if err != nil {
				r.emitError(err)
				return
			}
		}
	}
}

func (r *runtime) handleControlMessages(chunk []byte) error {
	r.controlReadMu.Lock()
	r.controlBuffer = append(r.controlBuffer, chunk...)

	for {
		consumed, err := r.consumeControlMessageLocked()
		if err != nil {
			r.controlReadMu.Unlock()
			return err
		}
		if consumed == 0 {
			r.controlReadMu.Unlock()
			return nil
		}
		r.controlBuffer = append(r.controlBuffer[:0], r.controlBuffer[consumed:]...)
	}
}

func (r *runtime) consumeControlMessageLocked() (int, error) {
	if len(r.controlBuffer) == 0 {
		return 0, nil
	}

	switch r.controlBuffer[0] {
	case deviceMsgTypeClipboard:
		if len(r.controlBuffer) < 5 {
			return 0, nil
		}
		textLength := int(binary.BigEndian.Uint32(r.controlBuffer[1:5]))
		if textLength < 0 || textLength > (1<<18)-5 {
			return 0, fmt.Errorf("invalid scrcpy clipboard payload size: %d", textLength)
		}
		messageSize := 5 + textLength
		if len(r.controlBuffer) < messageSize {
			return 0, nil
		}
		text := string(r.controlBuffer[5:messageSize])
		r.dispatchClipboardText(text)
		return messageSize, nil
	case deviceMsgTypeAckClipboard:
		if len(r.controlBuffer) < 9 {
			return 0, nil
		}
		sequence := binary.BigEndian.Uint64(r.controlBuffer[1:9])
		r.dispatchClipboardAck(sequence)
		return 9, nil
	case deviceMsgTypeUHIDOutput:
		if len(r.controlBuffer) < 5 {
			return 0, nil
		}
		payloadSize := int(binary.BigEndian.Uint16(r.controlBuffer[3:5]))
		if payloadSize < 0 || payloadSize > (1<<18)-5 {
			return 0, fmt.Errorf("invalid scrcpy uhid output size: %d", payloadSize)
		}
		messageSize := 5 + payloadSize
		if len(r.controlBuffer) < messageSize {
			return 0, nil
		}
		return messageSize, nil
	default:
		return 0, fmt.Errorf("unsupported scrcpy device message type: %d", r.controlBuffer[0])
	}
}

func (r *runtime) dispatchClipboardText(text string) {
	r.clipboardMu.Lock()
	r.latestClipboardText = text
	r.hasLatestClipboard = true

	waiters := r.clipboardWaiters
	r.clipboardWaiters = make(map[int]chan string)
	r.clipboardMu.Unlock()

	for _, waiter := range waiters {
		select {
		case waiter <- text:
		default:
		}
		close(waiter)
	}
}

func (r *runtime) dispatchClipboardAck(sequence uint64) {
	r.clipboardMu.Lock()
	waiter := r.clipboardAckWaiters[sequence]
	if waiter != nil {
		delete(r.clipboardAckWaiters, sequence)
	}
	r.clipboardMu.Unlock()

	if waiter != nil {
		select {
		case waiter <- struct{}{}:
		default:
		}
		close(waiter)
	}
}

func (r *runtime) removeClipboardWaiter(waiterID int) {
	r.clipboardMu.Lock()
	waiter := r.clipboardWaiters[waiterID]
	if waiter != nil {
		delete(r.clipboardWaiters, waiterID)
	}
	r.clipboardMu.Unlock()

	if waiter != nil {
		close(waiter)
	}
}

func (r *runtime) removeClipboardAckWaiter(sequence uint64) {
	r.clipboardMu.Lock()
	waiter := r.clipboardAckWaiters[sequence]
	if waiter != nil {
		delete(r.clipboardAckWaiters, sequence)
	}
	r.clipboardMu.Unlock()

	if waiter != nil {
		close(waiter)
	}
}

func (r *runtime) emitError(err error) {
	r.errorMu.Lock()
	defer r.errorMu.Unlock()

	select {
	case <-r.done:
		return
	default:
	}

	for _, sub := range r.errorSubscribers {
		select {
		case sub <- err:
		default:
			select {
			case <-sub:
			default:
			}
			select {
			case sub <- err:
			default:
			}
		}
	}
}

func (r *runtime) offerLatestVideoPacket(packet domainscrcpy.VideoPacket) {
	r.recordVideoPacketHealth(packet)

	r.videoMu.Lock()
	defer r.videoMu.Unlock()

	select {
	case <-r.done:
		if packet.Release != nil {
			packet.Release()
		}
		return
	default:
	}

	if packet.IsConfig {
		r.videoGeneration++
		r.latestVideoConfig = cloneVideoPacketForCache(packet, r.videoGeneration)
		r.latestVideoKeyFrame = cachedVideoPacket{}
	} else if packet.IsKeyFrame || packet.Codec == domainscrcpy.VideoCodecH264 && containsAnnexBIDRPacket(packet.Data) {
		r.latestVideoKeyFrame = cloneVideoPacketForCache(packet, r.videoGeneration)
	}

	count := len(r.videoSubscribers)
	if count == 0 {
		if packet.Release != nil {
			packet.Release()
		}
		return
	}

	releases := sharedReleaseFuncs(count, packet.Release)
	index := 0
	for _, sub := range r.videoSubscribers {
		sharedPacket := packet
		sharedPacket.Release = releases[index]
		index++
		offerLatestVideoPacketToSubscriber(sub, sharedPacket)
	}
}

func (r *runtime) recordVideoPacketHealth(packet domainscrcpy.VideoPacket) {
	now := time.Now()

	r.healthMu.Lock()
	defer r.healthMu.Unlock()

	r.health.LastPacketAt = now
	r.health.RuntimeClosed = false
	if packet.IsConfig {
		return
	}

	pts := packet.PresentationTimestamp
	hadSeenMediaPacket := r.health.HasSeenMediaPacket
	r.health.HasSeenMediaPacket = true
	if !hadSeenMediaPacket || pts > r.health.LastPTS {
		r.health.LastPTS = pts
		r.health.LastNewPTSAt = now
		r.health.RepeatedPTSCount = 0
	} else if pts == r.health.LastPTS {
		r.health.RepeatedPTSCount++
	}

	if packet.IsKeyFrame || packet.Codec == domainscrcpy.VideoCodecH264 && containsAnnexBIDRPacket(packet.Data) {
		r.health.LastKeyFrameAt = now
	}
}

func (r *runtime) markVideoKeyFrameReplayed(now time.Time) {
	r.healthMu.Lock()
	r.health.LastKeyFrameReplayAt = now
	r.healthMu.Unlock()
}

func (r *runtime) getLastVideoKeyFrameReplayAt() time.Time {
	r.healthMu.Lock()
	defer r.healthMu.Unlock()

	return r.health.LastKeyFrameReplayAt
}

func (r *runtime) markVideoRefreshRequested(now time.Time) {
	r.healthMu.Lock()
	r.health.LastVideoRefreshAt = now
	r.healthMu.Unlock()
}

func (r *runtime) markSourceRuntimeClosed() {
	r.healthMu.Lock()
	r.health.RuntimeClosed = true
	r.healthMu.Unlock()
}

func (r *runtime) offerLatestAudioPacket(packet domainscrcpy.AudioPacket) {
	r.audioMu.Lock()
	defer r.audioMu.Unlock()

	select {
	case <-r.done:
		if packet.Release != nil {
			packet.Release()
		}
		return
	default:
	}

	count := len(r.audioSubscribers)
	if count == 0 {
		if packet.Release != nil {
			packet.Release()
		}
		return
	}

	releases := sharedReleaseFuncs(count, packet.Release)
	index := 0
	for _, sub := range r.audioSubscribers {
		sharedPacket := packet
		sharedPacket.Release = releases[index]
		index++
		offerLatestAudioPacketToSubscriber(sub, sharedPacket)
	}
}

func (r *runtime) closeAllSubscribers() {
	r.videoMu.Lock()
	videoSubscribers := r.videoSubscribers
	r.videoSubscribers = make(map[int]chan domainscrcpy.VideoPacket)
	r.videoMu.Unlock()

	for _, sub := range videoSubscribers {
		close(sub)
		releaseQueuedVideoPackets(sub)
	}

	r.audioMu.Lock()
	audioSubscribers := r.audioSubscribers
	r.audioSubscribers = make(map[int]chan domainscrcpy.AudioPacket)
	r.audioMu.Unlock()

	for _, sub := range audioSubscribers {
		close(sub)
		releaseQueuedAudioPackets(sub)
	}

	r.errorMu.Lock()
	errorSubscribers := r.errorSubscribers
	r.errorSubscribers = make(map[int]chan error)
	r.errorMu.Unlock()

	for _, sub := range errorSubscribers {
		close(sub)
	}

	r.clipboardMu.Lock()
	clipboardWaiters := r.clipboardWaiters
	clipboardAckWaiters := r.clipboardAckWaiters
	r.clipboardWaiters = make(map[int]chan string)
	r.clipboardAckWaiters = make(map[uint64]chan struct{})
	r.clipboardMu.Unlock()

	for _, waiter := range clipboardWaiters {
		close(waiter)
	}
	for _, waiter := range clipboardAckWaiters {
		close(waiter)
	}
}

func offerLatestVideoPacketToSubscriber(sub chan domainscrcpy.VideoPacket, packet domainscrcpy.VideoPacket) {
	if isCriticalVideoPacket(packet) {
		offerCriticalVideoPacketToSubscriber(sub, packet)
		return
	}

	select {
	case sub <- packet:
		return
	default:
	}

	select {
	case dropped := <-sub:
		if dropped.Release != nil {
			dropped.Release()
		}
	default:
	}

	select {
	case sub <- packet:
	default:
		if packet.Release != nil {
			packet.Release()
		}
	}
}

func offerCriticalVideoPacketToSubscriber(sub chan domainscrcpy.VideoPacket, packet domainscrcpy.VideoPacket) {
	select {
	case sub <- packet:
		return
	default:
	}

	releaseQueuedVideoPackets(sub)

	select {
	case sub <- packet:
	default:
		if packet.Release != nil {
			packet.Release()
		}
	}
}

func isCriticalVideoPacket(packet domainscrcpy.VideoPacket) bool {
	if packet.IsConfig || packet.IsKeyFrame {
		return true
	}

	return packet.Codec == domainscrcpy.VideoCodecH264 && containsAnnexBIDRPacket(packet.Data)
}

func offerLatestAudioPacketToSubscriber(sub chan domainscrcpy.AudioPacket, packet domainscrcpy.AudioPacket) {
	select {
	case sub <- packet:
		return
	default:
	}

	select {
	case dropped := <-sub:
		if dropped.Release != nil {
			dropped.Release()
		}
	default:
	}

	select {
	case sub <- packet:
	default:
		if packet.Release != nil {
			packet.Release()
		}
	}
}

func releaseQueuedVideoPackets(ch <-chan domainscrcpy.VideoPacket) {
	for {
		select {
		case packet, ok := <-ch:
			if !ok {
				return
			}
			if packet.Release != nil {
				packet.Release()
			}
		default:
			return
		}
	}
}

func releaseQueuedAudioPackets(ch <-chan domainscrcpy.AudioPacket) {
	for {
		select {
		case packet, ok := <-ch:
			if !ok {
				return
			}
			if packet.Release != nil {
				packet.Release()
			}
		default:
			return
		}
	}
}

func cloneVideoPacketForCache(packet domainscrcpy.VideoPacket, generation uint64) cachedVideoPacket {
	if len(packet.Data) == 0 || generation == 0 {
		return cachedVideoPacket{}
	}
	cloned := packet
	cloned.Data = append([]byte(nil), packet.Data...)
	cloned.Buffer = nil
	cloned.Release = nil
	return cachedVideoPacket{
		packet:     cloned,
		generation: generation,
		cachedAt:   time.Now(),
	}
}

func cloneCachedVideoPacket(packet cachedVideoPacket) domainscrcpy.VideoPacket {
	if len(packet.packet.Data) == 0 || packet.generation == 0 {
		return domainscrcpy.VideoPacket{}
	}

	return cloneVideoPacketValue(packet.packet)
}

func cloneVideoPacketValue(packet domainscrcpy.VideoPacket) domainscrcpy.VideoPacket {
	if len(packet.Data) == 0 {
		return domainscrcpy.VideoPacket{}
	}
	cloned := packet
	cloned.Data = append([]byte(nil), packet.Data...)
	cloned.Buffer = nil
	cloned.Release = nil
	return cloned
}

func sharedReleaseFuncs(count int, release func()) []func() {
	if count <= 0 {
		return nil
	}
	if release == nil {
		releases := make([]func(), count)
		for i := range releases {
			releases[i] = func() {}
		}
		return releases
	}

	type sharedReleaseState struct {
		mu        sync.Mutex
		remaining int
		release   func()
	}

	state := &sharedReleaseState{
		remaining: count,
		release:   release,
	}

	releases := make([]func(), count)
	for i := range releases {
		releases[i] = func() {
			state.mu.Lock()
			if state.remaining <= 0 {
				state.mu.Unlock()
				return
			}
			state.remaining--
			if state.remaining == 0 && state.release != nil {
				release := state.release
				state.release = nil
				state.mu.Unlock()
				release()
				return
			}
			state.mu.Unlock()
		}
	}
	return releases
}

func acquireMediaPacketBuffer(size int) []byte {
	buffer := mediaPacketBufferPool.Get().([]byte)
	if cap(buffer) < size {
		return make([]byte, size)
	}
	return buffer[:size]
}

func releaseMediaPacketBuffer(buffer []byte) {
	if cap(buffer) == 0 || cap(buffer) > 2*1024*1024 {
		return
	}
	mediaPacketBufferPool.Put(buffer[:0])
}

func classifySourceHealth(health domainscrcpy.SourceHealthSnapshot, now time.Time) (domainscrcpy.SourceHealthState, string) {
	if health.RuntimeClosed {
		return domainscrcpy.SourceHealthSourceStalled, "runtime_closed"
	}
	if !health.LastVideoRefreshAt.IsZero() && now.Sub(health.LastVideoRefreshAt) < sourceHealthRecoveryWindow {
		return domainscrcpy.SourceHealthRecovering, "refresh_recovering"
	}
	if health.LastPacketAt.IsZero() {
		return domainscrcpy.SourceHealthSourceStalled, "no_video_packet"
	}
	if !health.HasSeenMediaPacket {
		if now.Sub(health.LastPacketAt) > sourceHealthPacketFreshness {
			return domainscrcpy.SourceHealthSourceStalled, "no_media_packet"
		}
		return domainscrcpy.SourceHealthHealthy, "waiting_first_media_packet"
	}
	if health.RepeatedPTSCount >= sourceHealthRepeatedPTSStallThreshold {
		return domainscrcpy.SourceHealthPTSStalled, "pts_repeated"
	}
	if now.Sub(health.LastPacketAt) > sourceHealthPacketFreshness {
		return domainscrcpy.SourceHealthStaticButAlive, "holding_last_frame_packet_idle"
	}
	if health.LastNewPTSAt.IsZero() || now.Sub(health.LastNewPTSAt) <= sourceHealthPacketFreshness {
		return domainscrcpy.SourceHealthHealthy, "pts_advancing"
	}
	return domainscrcpy.SourceHealthStaticButAlive, "static_packets_alive"
}

func applyPCMInt16Gain(samples []int16, gain float64) {
	if gain == 1 || len(samples) == 0 {
		return
	}

	for i, sample := range samples {
		amplified := int(float64(sample) * gain)
		switch {
		case amplified > 32767:
			samples[i] = 32767
		case amplified < -32768:
			samples[i] = -32768
		default:
			samples[i] = int16(amplified)
		}
	}
}

type droppableControlPayloadKind int

const (
	droppableControlPayloadNone droppableControlPayloadKind = iota
	droppableControlPayloadTouchMove
	droppableControlPayloadHidMouseMove
	droppableControlPayloadResizeDisplay
)

func isDroppableControlPayload(payload []byte) bool {
	return droppableControlPayloadKindOf(payload) != droppableControlPayloadNone
}

func droppableControlPayloadKindOf(payload []byte) droppableControlPayloadKind {
	if len(payload) == 0 {
		return droppableControlPayloadNone
	}

	switch payload[0] {
	case 2:
		if len(payload) > 1 && payload[1] == 2 {
			return droppableControlPayloadTouchMove
		}
	case 13:
		if len(payload) < 10 {
			return droppableControlPayloadNone
		}
		deviceID := binary.BigEndian.Uint16(payload[1:3])
		if deviceID != 1 {
			return droppableControlPayloadNone
		}
		if payload[6] != 0 || payload[7] != 0 || payload[8] != 0 || payload[9] != 0 {
			return droppableControlPayloadHidMouseMove
		}
	case 21:
		return droppableControlPayloadResizeDisplay
	}
	return droppableControlPayloadNone
}

func dialLocalPort(ctx context.Context, port int) (net.Conn, error) {
	address := fmt.Sprintf("127.0.0.1:%d", port)
	dialer := net.Dialer{Timeout: time.Second}
	deadline := time.Now().Add(5 * time.Second)
	for {
		conn, err := dialer.DialContext(ctx, "tcp", address)
		if err == nil {
			return conn, nil
		}
		if time.Now().After(deadline) {
			return nil, err
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(150 * time.Millisecond):
		}
	}
}

func parseVideoCodec(header []byte) (domainscrcpy.VideoCodec, error) {
	switch string(header) {
	case "h264":
		return domainscrcpy.VideoCodecH264, nil
	case "h265":
		return domainscrcpy.VideoCodecH265, nil
	case "\x00av1", "av1\x00":
		return domainscrcpy.VideoCodecAV1, nil
	default:
		return "", fmt.Errorf("unsupported scrcpy video codec: %q", string(header))
	}
}

func parseAudioCodec(header []byte) (domainscrcpy.AudioCodec, error) {
	switch string(header) {
	case "opus":
		return domainscrcpy.AudioCodecOpus, nil
	case "\x00raw", "raw\x00":
		return domainscrcpy.AudioCodecRaw, nil
	case "\x00aac", "aac\x00":
		return domainscrcpy.AudioCodecAAC, nil
	case "flac":
		return domainscrcpy.AudioCodecFLAC, nil
	default:
		return "", fmt.Errorf("unsupported scrcpy audio codec: %q", string(header))
	}
}

func parseSessionHeader(header []byte) (int, int, error) {
	if len(header) < sessionHeaderLength {
		return 0, 0, errors.New("scrcpy session header is too short")
	}
	width := int(binary.BigEndian.Uint32(header[4:8]))
	height := int(binary.BigEndian.Uint32(header[8:12]))
	if width <= 0 || width > 8192 || height <= 0 || height > 8192 {
		return 0, 0, fmt.Errorf("invalid scrcpy session dimensions: %dx%d", width, height)
	}
	return width, height, nil
}

func isSessionPacket(header []byte) bool {
	return len(header) > 0 && (header[0]&0x80) != 0
}
