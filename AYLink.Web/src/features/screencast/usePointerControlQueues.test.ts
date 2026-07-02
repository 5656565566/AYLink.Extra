import { describe, expect, it, vi } from 'vitest';
import { SCRCPY_ACTION_MOVE } from './scrcpyControlProtocol';
import { usePointerControlQueues } from './usePointerControlQueues';

function createOpenChannel(send = vi.fn()) {
  return {
    readyState: 'open',
    bufferedAmount: 0,
    send
  } as unknown as RTCDataChannel;
}

describe('usePointerControlQueues', () => {
  it('flushes pending move payloads through the pointer channel', () => {
    const send = vi.fn();
    const channel = createOpenChannel(send);
    const queues = usePointerControlQueues({
      flushPendingPointerControlPayloads: vi.fn(),
      getPointerMoveSendChannel: () => channel,
      getCurrentPointerMoveBufferLimit: () => 1024,
      getCurrentPointerMoveSampleIntervalMs: () => 8,
      getScrcpyPointerId: () => 3n,
      releasePointer: vi.fn(),
      now: () => 100
    });

    queues.pendingPointerMoves.set(1, {
      pointerId: 1,
      xRatio: 0.5,
      yRatio: 0.25,
      frameWidth: 1000,
      frameHeight: 800,
      pressure: 1
    });

    queues.flushPendingPointerMoves();

    expect(send).toHaveBeenCalledOnce();
    const payload = send.mock.calls[0][0] as Uint8Array;
    const view = new DataView(payload.buffer);
    expect(view.getUint8(1)).toBe(SCRCPY_ACTION_MOVE);
    expect(view.getBigUint64(2, false)).toBe(3n);
    expect(view.getUint32(10, false)).toBe(500);
    expect(view.getUint32(14, false)).toBe(200);
    expect(queues.pendingPointerMoves.size).toBe(0);
    expect(queues.getLastPointerMoveFlushAt()).toBe(100);
  });

  it('flushes unqueued pointer releases and leaves queued releases alone', () => {
    const queueRef: { current: ReturnType<typeof usePointerControlQueues> | null } = { current: null };
    const releasePointer = vi.fn((pointerId: number) => {
      queueRef.current?.pendingPointerReleases.delete(pointerId);
    });
    const queues = usePointerControlQueues({
      flushPendingPointerControlPayloads: vi.fn(),
      getPointerMoveSendChannel: () => null,
      getCurrentPointerMoveBufferLimit: () => 1024,
      getCurrentPointerMoveSampleIntervalMs: () => 8,
      getScrcpyPointerId: () => null,
      releasePointer
    });
    queueRef.current = queues;

    queues.pendingPointerReleases.set(1, 'up');
    queues.pendingPointerReleases.set(2, 'cancel');
    queues.queuedPointerReleases.add(2);

    queues.flushPendingPointerReleases();

    expect(releasePointer).toHaveBeenCalledWith(1, 'up');
    expect(releasePointer).not.toHaveBeenCalledWith(2, 'cancel');
    expect(queues.pendingPointerReleases.has(2)).toBe(true);
  });

  it('reports pointer move send failures so callers can fall back', () => {
    const channel = createOpenChannel(vi.fn(() => {
      throw new Error('send failed');
    }));
    const onPointerMoveSendFailed = vi.fn();
    const queues = usePointerControlQueues({
      flushPendingPointerControlPayloads: vi.fn(),
      getPointerMoveSendChannel: () => channel,
      getCurrentPointerMoveBufferLimit: () => 1024,
      getCurrentPointerMoveSampleIntervalMs: () => 8,
      getScrcpyPointerId: () => 3n,
      releasePointer: vi.fn(),
      onPointerMoveSendFailed,
      logger: { warn: vi.fn() }
    });

    queues.pendingPointerMoves.set(1, {
      pointerId: 1,
      xRatio: 0.5,
      yRatio: 0.25,
      frameWidth: 1000,
      frameHeight: 800,
      pressure: 1
    });

    queues.flushPendingPointerMoves();

    expect(onPointerMoveSendFailed).toHaveBeenCalledWith(channel);
    expect(queues.pendingPointerMoves.size).toBe(1);
    queues.stopPointerMoveFlushLoop();
  });

  it('clears queued state for one pointer or all pointers', () => {
    const queues = usePointerControlQueues({
      flushPendingPointerControlPayloads: vi.fn(),
      getPointerMoveSendChannel: () => null,
      getCurrentPointerMoveBufferLimit: () => 1024,
      getCurrentPointerMoveSampleIntervalMs: () => 8,
      getScrcpyPointerId: () => null,
      releasePointer: vi.fn()
    });

    queues.pendingPointerReleases.set(1, 'up');
    queues.queuedPointerReleases.add(1);
    queues.pendingPointerMoves.set(1, {
      pointerId: 1,
      xRatio: 0,
      yRatio: 0,
      frameWidth: 1,
      frameHeight: 1,
      pressure: 1
    });

    queues.clearPointerState(1);

    expect(queues.pendingPointerReleases.size).toBe(0);
    expect(queues.queuedPointerReleases.size).toBe(0);
    expect(queues.pendingPointerMoves.size).toBe(0);
  });
});
