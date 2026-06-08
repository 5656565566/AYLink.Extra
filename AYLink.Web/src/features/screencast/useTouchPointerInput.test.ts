import { describe, expect, it, vi } from 'vitest';
import {
  SCRCPY_ACTION_DOWN,
  SCRCPY_ACTION_MOVE,
  SCRCPY_ACTION_UP,
  SCRCPY_MSG_INJECT_TOUCH_EVENT
} from './scrcpyControlProtocol';
import { useTouchPointerInput } from './useTouchPointerInput';
import type { PointerRatios } from './videoViewport';

function createOpenChannel(send = vi.fn()) {
  return {
    readyState: 'open',
    bufferedAmount: 0,
    send
  } as unknown as RTCDataChannel;
}

function createVideoElement() {
  return {
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: 1000,
      height: 800,
      right: 1000,
      bottom: 800,
      x: 0,
      y: 0,
      toJSON: () => ({})
    } as DOMRect)
  } as unknown as HTMLVideoElement;
}

function createPointerEvent(pointerId: number, pointerType = 'touch', pressure = 0.5) {
  return {
    pointerId,
    pointerType,
    pressure,
    getCoalescedEvents: () => []
  } as unknown as PointerEvent;
}

function readTouchPayload(payload: Uint8Array) {
  const view = new DataView(payload.buffer);
  return {
    type: view.getUint8(0),
    action: view.getUint8(1),
    pointerId: view.getBigUint64(2, false),
    x: view.getUint32(10, false),
    y: view.getUint32(14, false)
  };
}

function createInput(options: {
  ratios?: PointerRatios | null;
  pointerMoveChannel?: RTCDataChannel | null;
  enqueuePointerPayloadBuffers?: (payloads: Uint8Array[], onLastSent?: () => void) => boolean;
} = {}) {
  const video = createVideoElement();
  const controlChannel = createOpenChannel();
  const queuedPayloads: Uint8Array[] = [];
  const enqueuePointerPayloadBuffers = options.enqueuePointerPayloadBuffers ?? ((payloads: Uint8Array[]) => {
    queuedPayloads.push(...payloads);
    return true;
  });

  const input = useTouchPointerInput({
    getVideoElement: () => video,
    getPointerRatios: () => options.ratios ?? {
      xRatio: 0.25,
      yRatio: 0.5,
      frameWidth: 1000,
      frameHeight: 800
    },
    getPrimaryControlChannel: () => controlChannel,
    getPointerMoveSendChannel: () => options.pointerMoveChannel ?? null,
    getCurrentPointerMoveBufferLimit: () => 1024,
    getCurrentPointerMoveSampleIntervalMs: () => 0,
    flushPendingPointerControlPayloads: vi.fn(),
    enqueuePointerPayloadBuffers,
    mouseCompatSuppressionMs: 500
  });

  return {
    input,
    video,
    queuedPayloads
  };
}

describe('useTouchPointerInput', () => {
  it('handles touch down by registering the pointer and queueing a down payload', () => {
    const { input, video, queuedPayloads } = createInput();

    input.handlePointerDown(createPointerEvent(7));

    expect(input.activePointers.has(7)).toBe(true);
    expect(input.getScrcpyPointerId(7)).toBe(0n);
    expect(video.setPointerCapture).toHaveBeenCalledWith(7);
    expect(queuedPayloads).toHaveLength(1);
    expect(readTouchPayload(queuedPayloads[0])).toMatchObject({
      type: SCRCPY_MSG_INJECT_TOUCH_EVENT,
      action: SCRCPY_ACTION_DOWN,
      pointerId: 0n,
      x: 250,
      y: 400
    });
  });

  it('flushes touch move through the pointer move channel', () => {
    const send = vi.fn();
    const pointerMoveChannel = createOpenChannel(send);
    const { input } = createInput({
      pointerMoveChannel,
      ratios: {
        xRatio: 0.4,
        yRatio: 0.25,
        frameWidth: 1000,
        frameHeight: 800
      }
    });

    input.handlePointerDown(createPointerEvent(3));
    input.handlePointerMove(createPointerEvent(3));

    expect(send).toHaveBeenCalledOnce();
    expect(readTouchPayload(send.mock.calls[0][0] as Uint8Array)).toMatchObject({
      action: SCRCPY_ACTION_MOVE,
      pointerId: 0n,
      x: 400,
      y: 200
    });
  });

  it('resets active pointers, pending queues, and allocated scrcpy ids', () => {
    const { input } = createInput();

    input.handlePointerDown(createPointerEvent(5));
    input.pendingPointerMoves.set(5, {
      pointerId: 5,
      xRatio: 0.1,
      yRatio: 0.2,
      frameWidth: 1000,
      frameHeight: 800,
      pressure: 1
    });

    input.resetAllPointerState();

    expect(input.activePointers.size).toBe(0);
    expect(input.pointerGenerations.size).toBe(0);
    expect(input.pendingPointerMoves.size).toBe(0);
    expect(input.pointerSnapshots.size).toBe(0);
    expect(input.getScrcpyPointerIds().size).toBe(0);
    expect(input.getNextScrcpyPointerId()).toBe(0n);
  });

  it('keeps pointer state until a queued release has been sent', () => {
    let releaseSent: (() => void) | undefined;
    const { input } = createInput({
      enqueuePointerPayloadBuffers: (payloads, onLastSent) => {
        if (readTouchPayload(payloads[payloads.length - 1]).action === SCRCPY_ACTION_UP) {
          releaseSent = onLastSent;
        }
        return true;
      }
    });

    input.handlePointerDown(createPointerEvent(8));
    input.releaseAllPointers('up');

    expect(input.activePointers.has(8)).toBe(false);
    expect(input.getScrcpyPointerId(8)).toBe(0n);

    releaseSent?.();

    expect(input.activePointers.has(8)).toBe(false);
    expect(input.getScrcpyPointerId(8)).toBeNull();
  });

  it('sends pointer ratio commands without DOM pointer events', () => {
    let releaseSent: (() => void) | undefined;
    const queuedPayloads: Uint8Array[] = [];
    const { input } = createInput({
      enqueuePointerPayloadBuffers: (payloads, onLastSent) => {
        queuedPayloads.push(...payloads);
        if (readTouchPayload(payloads[payloads.length - 1]).action === SCRCPY_ACTION_UP) {
          releaseSent = onLastSent;
        }
        return true;
      }
    });
    const onFinalized = vi.fn();

    expect(input.sendPointerRatiosCommand({
      phase: 'down',
      pointerId: 100,
      ratios: {
        xRatio: 0.2,
        yRatio: 0.3,
        frameWidth: 1000,
        frameHeight: 800
      },
      pressure: 0.5
    })).toBe(true);
    expect(input.sendPointerRatiosCommand({
      phase: 'up',
      pointerId: 100,
      ratios: {
        xRatio: 0.25,
        yRatio: 0.35,
        frameWidth: 1000,
        frameHeight: 800
      },
      pressure: 0,
      onFinalized
    })).toBe(true);

    expect(queuedPayloads).toHaveLength(2);
    expect(readTouchPayload(queuedPayloads[0])).toMatchObject({
      action: SCRCPY_ACTION_DOWN,
      pointerId: 0n,
      x: 200,
      y: 240
    });
    expect(readTouchPayload(queuedPayloads[1])).toMatchObject({
      action: SCRCPY_ACTION_UP,
      pointerId: 0n,
      x: 250,
      y: 280
    });
    expect(onFinalized).not.toHaveBeenCalled();
    releaseSent?.();
    expect(onFinalized).toHaveBeenCalledOnce();
  });

  it('does not finalize a stale release after the same virtual pointer is pressed again', () => {
    let firstReleaseSent: (() => void) | undefined;
    const { input } = createInput({
      enqueuePointerPayloadBuffers: (payloads, onLastSent) => {
        if (readTouchPayload(payloads[payloads.length - 1]).action === SCRCPY_ACTION_UP && !firstReleaseSent) {
          firstReleaseSent = onLastSent;
        }
        return true;
      }
    });
    const onFinalized = vi.fn();

    expect(input.sendPointerRatiosCommand({
      phase: 'down',
      pointerId: 200,
      ratios: { xRatio: 0.16, yRatio: 0.78, frameWidth: 1000, frameHeight: 800 }
    })).toBe(true);
    expect(input.sendPointerRatiosCommand({
      phase: 'up',
      pointerId: 200,
      ratios: { xRatio: 0.16, yRatio: 0.78, frameWidth: 1000, frameHeight: 800 },
      pressure: 0,
      onFinalized
    })).toBe(true);
    expect(input.sendPointerRatiosCommand({
      phase: 'down',
      pointerId: 200,
      ratios: { xRatio: 0.16, yRatio: 0.7, frameWidth: 1000, frameHeight: 800 }
    })).toBe(true);

    firstReleaseSent?.();

    expect(onFinalized).not.toHaveBeenCalled();
    expect(input.activePointers.has(200)).toBe(true);
    expect(input.getScrcpyPointerId(200)).toBe(0n);
  });
});
