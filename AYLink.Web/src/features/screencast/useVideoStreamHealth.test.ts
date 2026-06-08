import { afterEach, describe, expect, it, vi } from 'vitest';
import { useVideoStreamHealth } from './useVideoStreamHealth';

function createVideoStreamHealthHarness() {
  const haveEnoughData = typeof HTMLMediaElement.HAVE_ENOUGH_DATA === 'number' ? HTMLMediaElement.HAVE_ENOUGH_DATA : 4;
  const haveMetadata = typeof HTMLMediaElement.HAVE_METADATA === 'number' ? HTMLMediaElement.HAVE_METADATA : 1;
  let activeConnectionId = 1;
  let packetsReceived = 0;
  let bytesReceived = 0;
  let framesDecoded: number | null = null;
  let videoFrameCallback: VideoFrameRequestCallback | null = null;
  let statsCallCount = 0;
  let readyState: number = haveEnoughData;
  const videoElement = {
    paused: false,
    ended: false,
    seeking: false,
    currentTime: 0,
    get readyState() {
      return readyState;
    },
    requestVideoFrameCallback: vi.fn((callback: VideoFrameRequestCallback) => {
      videoFrameCallback = callback;
      return 1;
    }),
    cancelVideoFrameCallback: vi.fn()
  } as unknown as HTMLVideoElement;
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn()
  };
  const onVideoStreamStalledConfirmed = vi.fn();
  const close = vi.fn();
  const socket = {
    readyState: WebSocket.OPEN,
    close
  } as unknown as WebSocket;
  const peerConnection = {
    connectionState: 'connected',
    getReceivers: () => [
      {
        track: { kind: 'video' },
        getStats: async () => {
          statsCallCount += 1;
          return new Map([
            ['inbound-video', {
              type: 'inbound-rtp',
              kind: 'video',
              packetsReceived,
              bytesReceived,
              framesDecoded,
              framesDropped: null,
              timestamp: performance.now()
            }]
          ]);
        }
      }
    ]
  } as unknown as RTCPeerConnection;
  const videoTrack = { readyState: 'live', muted: false } as unknown as MediaStreamTrack;

  const health = useVideoStreamHealth({
    stableDetachMs: 20000,
    stallThresholdMs: 3000,
    watchdogIntervalMs: 1000,
    diagnosticIntervalMs: 5000,
    stallConfirmationCount: 2,
    getActiveConnectionId: () => activeConnectionId,
    isAutoReconnectSuppressed: () => false,
    isScreencastVisible: () => true,
    getPeerConnection: () => peerConnection,
    getSignalingSocket: () => socket,
    getVideoTrack: () => videoTrack,
    hasVideoTrack: () => true,
    hasVideoSource: () => true,
    getVideoElement: () => videoElement,
    syncVideoFrameSize: vi.fn(),
    getDeviceId: () => 'device-1',
    getTabKey: () => 'tab-1',
    onVideoStreamStalledConfirmed,
    logger
  });

  return {
    health,
    close,
    logger,
    onVideoStreamStalledConfirmed,
    advanceVideoPackets: () => {
      packetsReceived += 1;
      bytesReceived += 100;
    },
    advanceDecodedFrames: () => {
      framesDecoded = (framesDecoded ?? 0) + 1;
    },
    enableDecodedFrameStats: () => {
      framesDecoded = 0;
    },
    emitRenderedFrame: () => {
      videoFrameCallback?.(performance.now(), {
        expectedDisplayTime: performance.now(),
        height: 720,
        mediaTime: 0,
        presentedFrames: 1,
        presentationTime: performance.now(),
        processingDuration: 0,
        captureTime: performance.now(),
        receiveTime: performance.now(),
        rtpTimestamp: 0,
        width: 1280
      });
    },
    setVideoReadyState: (value: number) => {
      readyState = value;
    },
    setVideoPlaybackStarved: () => {
      readyState = haveMetadata;
    },
    setVideoTrackMuted: (muted: boolean) => {
      (videoTrack as { muted: boolean }).muted = muted;
    },
    setActiveConnectionId: (connectionId: number) => {
      activeConnectionId = connectionId;
    },
    getStatsCallCount: () => statsCallCount
  };
}

describe('useVideoStreamHealth', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('detaches signaling only after inbound RTP has stayed stable for the configured period', async () => {
    vi.useFakeTimers();
    const { health, close, advanceVideoPackets } = createVideoStreamHealthHarness();

    await vi.advanceTimersByTimeAsync(1);
    advanceVideoPackets();
    await health.handleWatchdog(1, 'test');
    await vi.advanceTimersByTimeAsync(1000);
    advanceVideoPackets();
    await health.handleWatchdog(1, 'test');
    expect(close).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(18999);
    expect(close).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(close).toHaveBeenCalledWith(1000, 'signaling-detached');
  });

  it('uses rendered video frames to advance health and detach signaling without waiting for stats polling', async () => {
    vi.useFakeTimers();
    const { health, close, emitRenderedFrame } = createVideoStreamHealthHarness();

    health.start(1);
    await vi.advanceTimersByTimeAsync(1);
    emitRenderedFrame();

    await vi.advanceTimersByTimeAsync(19999);
    expect(close).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(close).toHaveBeenCalledWith(1000, 'signaling-detached');
  });

  it('reschedules the watchdog from rendered frames instead of running a fixed interval', async () => {
    vi.useFakeTimers();
    const { health, emitRenderedFrame, getStatsCallCount } = createVideoStreamHealthHarness();

    health.start(1);
    await vi.advanceTimersByTimeAsync(1);
    emitRenderedFrame();

    await vi.advanceTimersByTimeAsync(2999);
    expect(getStatsCallCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(getStatsCallCount()).toBe(1);
  });

  it('cancels pending signaling detach when the stream becomes unstable', async () => {
    vi.useFakeTimers();
    const { health, close, advanceVideoPackets } = createVideoStreamHealthHarness();

    await vi.advanceTimersByTimeAsync(1);
    advanceVideoPackets();
    await health.handleWatchdog(1, 'test');
    await vi.advanceTimersByTimeAsync(1000);
    advanceVideoPackets();
    await health.handleWatchdog(1, 'test');

    await vi.advanceTimersByTimeAsync(10000);
    health.markUnstable(1, 'test_unstable');
    await vi.advanceTimersByTimeAsync(20000);

    expect(close).not.toHaveBeenCalled();
  });

  it('ignores stale detach timers from older connections', async () => {
    vi.useFakeTimers();
    const { health, close, advanceVideoPackets, setActiveConnectionId } = createVideoStreamHealthHarness();

    await vi.advanceTimersByTimeAsync(1);
    advanceVideoPackets();
    await health.handleWatchdog(1, 'test');
    await vi.advanceTimersByTimeAsync(1000);
    advanceVideoPackets();
    await health.handleWatchdog(1, 'test');
    setActiveConnectionId(2);
    await vi.advanceTimersByTimeAsync(20000);

    expect(close).not.toHaveBeenCalled();
  });

  it('does not repeatedly log unstable transitions while inbound RTP remains idle', async () => {
    vi.useFakeTimers();
    const { health, logger, advanceVideoPackets, setVideoTrackMuted } = createVideoStreamHealthHarness();

    await vi.advanceTimersByTimeAsync(1);
    advanceVideoPackets();
    await health.handleWatchdog(1, 'test');

    setVideoTrackMuted(true);
    await vi.advanceTimersByTimeAsync(4000);
    await health.handleWatchdog(1, 'test');
    await vi.advanceTimersByTimeAsync(1000);
    await health.handleWatchdog(1, 'test');
    await vi.advanceTimersByTimeAsync(1000);
    await health.handleWatchdog(1, 'test');
    await vi.advanceTimersByTimeAsync(1000);
    await health.handleWatchdog(1, 'test');

    expect(logger.debug.mock.calls.filter(([message]) => message === '[WebRTC] Video stream marked unstable; keeping signaling websocket attached.')).toHaveLength(1);
  });

  it('notifies when inbound RTP stall is confirmed', async () => {
    vi.useFakeTimers();
    const { health, onVideoStreamStalledConfirmed, advanceVideoPackets, setVideoTrackMuted } = createVideoStreamHealthHarness();

    await vi.advanceTimersByTimeAsync(1);
    advanceVideoPackets();
    await health.handleWatchdog(1, 'test');

    setVideoTrackMuted(true);
    await vi.advanceTimersByTimeAsync(4000);
    await health.handleWatchdog(1, 'test');
    await vi.advanceTimersByTimeAsync(1000);
    await health.handleWatchdog(1, 'test');

    expect(onVideoStreamStalledConfirmed).toHaveBeenCalledTimes(1);
    expect(onVideoStreamStalledConfirmed).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'test',
      connectionId: 1,
      deviceId: 'device-1',
      tabKey: 'tab-1',
      signalingAttached: true,
      peerConnectionState: 'connected'
    }));
  });

  it('does not treat intentionally static video as a confirmed stall when playback is not starved', async () => {
    vi.useFakeTimers();
    const { health, logger, onVideoStreamStalledConfirmed, advanceVideoPackets } = createVideoStreamHealthHarness();

    await vi.advanceTimersByTimeAsync(1);
    advanceVideoPackets();
    await health.handleWatchdog(1, 'test');

    await vi.advanceTimersByTimeAsync(4000);
    await health.handleWatchdog(1, 'test');
    await vi.advanceTimersByTimeAsync(4000);
    await health.handleWatchdog(1, 'test');

    expect(onVideoStreamStalledConfirmed).not.toHaveBeenCalled();
    expect(logger.debug.mock.calls.filter(([message]) => message === '[WebRTC] Inbound video RTP stream is idle without playback starvation; treating the frame as intentionally static.')).toHaveLength(1);
  });

  it('keeps static-looking idle video as diagnostic-only beyond the static-frame grace period', async () => {
    vi.useFakeTimers();
    const { health, onVideoStreamStalledConfirmed, advanceVideoPackets } = createVideoStreamHealthHarness();

    await vi.advanceTimersByTimeAsync(1);
    advanceVideoPackets();
    await health.handleWatchdog(1, 'test');

    await vi.advanceTimersByTimeAsync(10001);
    await health.handleWatchdog(1, 'test');
    await vi.advanceTimersByTimeAsync(1000);
    await health.handleWatchdog(1, 'test');

    expect(onVideoStreamStalledConfirmed).not.toHaveBeenCalled();
    expect(health.stateMachine.state).not.toBe('stalled');
  });

  it('notifies when inbound RTP advances but browser decoded frames stop advancing', async () => {
    vi.useFakeTimers();
    const { health, onVideoStreamStalledConfirmed, advanceVideoPackets, advanceDecodedFrames, enableDecodedFrameStats, emitRenderedFrame, setVideoPlaybackStarved } = createVideoStreamHealthHarness();

    enableDecodedFrameStats();
    health.start(1);
    await vi.advanceTimersByTimeAsync(1);
    emitRenderedFrame();
    health.stopWatchdog();
    advanceVideoPackets();
    advanceDecodedFrames();
    await health.handleWatchdog(1, 'test');

    await vi.advanceTimersByTimeAsync(4000);
    setVideoPlaybackStarved();
    advanceVideoPackets();
    await health.handleWatchdog(1, 'test');
    await vi.advanceTimersByTimeAsync(1000);
    advanceVideoPackets();
    await health.handleWatchdog(1, 'test');

    expect(onVideoStreamStalledConfirmed).toHaveBeenCalledTimes(1);
    expect(onVideoStreamStalledConfirmed).toHaveBeenCalledWith(expect.objectContaining({
      status: 'browser_decode_stalled_confirmed',
      reason: 'test',
      connectionId: 1
    }));
  });

  it('does not recover unchanged rendered frames while playback is not starved', async () => {
    vi.useFakeTimers();
    const { health, onVideoStreamStalledConfirmed, advanceVideoPackets, advanceDecodedFrames, enableDecodedFrameStats, emitRenderedFrame } = createVideoStreamHealthHarness();

    enableDecodedFrameStats();
    health.start(1);
    await vi.advanceTimersByTimeAsync(1);
    emitRenderedFrame();
    health.stopWatchdog();
    advanceVideoPackets();
    advanceDecodedFrames();
    await health.handleWatchdog(1, 'test');

    await vi.advanceTimersByTimeAsync(4000);
    advanceVideoPackets();
    await health.handleWatchdog(1, 'test');
    await vi.advanceTimersByTimeAsync(1000);
    advanceVideoPackets();
    await health.handleWatchdog(1, 'test');

    expect(onVideoStreamStalledConfirmed).not.toHaveBeenCalled();
    expect(health.stateMachine.state).not.toBe('stalled');
  });
});
