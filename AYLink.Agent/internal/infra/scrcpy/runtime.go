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
	deviceMetaLengthWithDummyByte = 65
	sessionHeaderLength           = 12
	configPacketFlag              = 1 << 62
	keyFrameFlag                  = 1 << 61
	ptsMask                       = keyFrameFlag - 1
	controlQueueWaitTimeout       = 100 * time.Millisecond
	videoPacketQueueSize          = 8
	audioPacketQueueSize          = 32
	controlQueueSize              = 256
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

	controlMu     sync.Mutex
	closeOnce     sync.Once
	controlWrites chan []byte

	videoPackets chan domainscrcpy.VideoPacket
	audioPackets chan domainscrcpy.AudioPacket
	errors       chan error
	done         chan struct{}
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
		logger:        s.logger,
		videoConn:     videoConn,
		videoPackets:  make(chan domainscrcpy.VideoPacket, videoPacketQueueSize),
		audioPackets:  make(chan domainscrcpy.AudioPacket, audioPacketQueueSize),
		errors:        make(chan error, 4),
		done:          make(chan struct{}),
		controlWrites: make(chan []byte, controlQueueSize),
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

func (r *runtime) VideoPackets() <-chan domainscrcpy.VideoPacket {
	return r.videoPackets
}

func (r *runtime) AudioPackets() <-chan domainscrcpy.AudioPacket {
	return r.audioPackets
}

func (r *runtime) Errors() <-chan error {
	return r.errors
}

func (r *runtime) SendControl(payload []byte) error {
	if len(payload) == 0 {
		return nil
	}
	if r.controlConn == nil {
		return errors.New("scrcpy control socket is not available")
	}

	message := append([]byte(nil), payload...)
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

func (r *runtime) Close() error {
	var closeErr error
	r.closeOnce.Do(func() {
		close(r.done)
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
	defer close(r.videoPackets)
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
	defer close(r.audioPackets)
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
		enc, err := opus.NewEncoder(48000, 2, opus.AppAudio)
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
	const samplesPerFrame = 1920

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
			select {
			case <-r.done:
				if packet.Release != nil {
					packet.Release()
				}
				return
			case r.audioPackets <- packet:
			}
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

	buffer := make([]byte, 1024)
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

func (r *runtime) emitError(err error) {
	select {
	case <-r.done:
		return
	case r.errors <- err:
	default:
	}
}

func (r *runtime) offerLatestVideoPacket(packet domainscrcpy.VideoPacket) {
	select {
	case <-r.done:
		if packet.Release != nil {
			packet.Release()
		}
		return
	case r.videoPackets <- packet:
		return
	default:
	}

	select {
	case dropped := <-r.videoPackets:
		if dropped.Release != nil {
			dropped.Release()
		}
	default:
	}

	select {
	case <-r.done:
		if packet.Release != nil {
			packet.Release()
		}
	case r.videoPackets <- packet:
	default:
		if packet.Release != nil {
			packet.Release()
		}
	}
}

func (r *runtime) offerLatestAudioPacket(packet domainscrcpy.AudioPacket) {
	select {
	case <-r.done:
		if packet.Release != nil {
			packet.Release()
		}
		return
	case r.audioPackets <- packet:
		return
	default:
	}

	select {
	case dropped := <-r.audioPackets:
		if dropped.Release != nil {
			dropped.Release()
		}
	default:
	}

	select {
	case <-r.done:
		if packet.Release != nil {
			packet.Release()
		}
	case r.audioPackets <- packet:
	default:
		if packet.Release != nil {
			packet.Release()
		}
	}
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

func isDroppableControlPayload(payload []byte) bool {
	if len(payload) == 0 {
		return false
	}

	switch payload[0] {
	case 2:
		return len(payload) > 1 && payload[1] == 2
	case 13:
		if len(payload) < 10 {
			return false
		}
		deviceID := binary.BigEndian.Uint16(payload[1:3])
		if deviceID != 1 {
			return false
		}
		return payload[6] != 0 || payload[7] != 0 || payload[8] != 0 || payload[9] != 0
	case 21:
		return true
	default:
		return false
	}
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
