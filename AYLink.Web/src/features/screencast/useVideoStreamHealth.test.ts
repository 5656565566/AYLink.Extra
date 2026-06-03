import { afterEach, describe, expect, it, vi } from 'vitest';
import { useVideoStreamHealth } from './useVideoStreamHealth';

function createVideoStreamHealthHarness() {
  let activeConnectionId = 1;
  let packetsReceived = 0;
  let bytesReceived = 0;
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn()
  };
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
        getStats: async () => new Map([
          ['inbound-video', {
            type: 'inbound-rtp',
            kind: 'video',
            packetsReceived,
            bytesReceived,
            framesDecoded: null,
            framesDropped: null,
            timestamp: performance.now()
          }]
        ])
      }
    ]
  } as unknown as RTCPeerConnection;
  const videoTrack = { readyState: 'live' } as MediaStreamTrack;

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
    getVideoElement: () => null,
    syncVideoFrameSize: vi.fn(),
    getDeviceId: () => 'device-1',
    getTabKey: () => 'tab-1',
    logger
  });

  return {
    health,
    close,
    logger,
    advanceVideoPackets: () => {
      packetsReceived += 1;
      bytesReceived += 100;
    },
    setActiveConnectionId: (connectionId: number) => {
      activeConnectionId = connectionId;
    }
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
    const { health, logger, advanceVideoPackets } = createVideoStreamHealthHarness();

    await vi.advanceTimersByTimeAsync(1);
    advanceVideoPackets();
    await health.handleWatchdog(1, 'test');

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
});
