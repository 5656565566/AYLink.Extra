import { describe, expect, it } from 'vitest';
import {
  SCRCPY_ACTION_DOWN,
  SCRCPY_ACTION_MOVE,
  SCRCPY_ACTION_UP,
  SCRCPY_MSG_INJECT_TOUCH_EVENT
} from './scrcpyControlProtocol';
import {
  buildPointerLifecyclePayloads,
  buildPointerMovePayload,
  type PendingPointerMove
} from './touchPointerPayloads';

function readTouchPayload(payload: Uint8Array) {
  const view = new DataView(payload.buffer);
  return {
    type: view.getUint8(0),
    action: view.getUint8(1),
    pointerId: view.getBigUint64(2, false),
    x: view.getUint32(10, false),
    y: view.getUint32(14, false),
    width: view.getUint16(18, false),
    height: view.getUint16(20, false),
    pressure: view.getUint16(22, false),
    actionButton: view.getUint32(24, false),
    buttons: view.getUint32(28, false)
  };
}

describe('touchPointerPayloads', () => {
  it('builds pointer move payloads from normalized coordinates', () => {
    const move: PendingPointerMove = {
      pointerId: 7,
      xRatio: 0.25,
      yRatio: 0.5,
      frameWidth: 1920,
      frameHeight: 1080,
      pressure: 0.75
    };

    expect(readTouchPayload(buildPointerMovePayload(move, 3n)!)).toMatchObject({
      type: SCRCPY_MSG_INJECT_TOUCH_EVENT,
      action: SCRCPY_ACTION_MOVE,
      pointerId: 3n,
      x: 480,
      y: 540,
      width: 1920,
      height: 1080,
      actionButton: 0,
      buttons: 1
    });
    expect(buildPointerMovePayload(move, null)).toBeNull();
  });

  it('allocates ids for down events', () => {
    const payloads = buildPointerLifecyclePayloads({
      phase: 'down',
      event: { pointerId: 9, pressure: 0.4 },
      ratios: {
        xRatio: 0.5,
        yRatio: 0.25,
        frameWidth: 1000,
        frameHeight: 800
      },
      getOrCreateScrcpyPointerId: () => 5n,
      getScrcpyPointerId: () => null
    });

    expect(payloads).toHaveLength(1);
    expect(readTouchPayload(payloads![0])).toMatchObject({
      action: SCRCPY_ACTION_DOWN,
      pointerId: 5n,
      x: 500,
      y: 200,
      pressure: Math.round(0.4 * 0xffff),
      actionButton: 1,
      buttons: 1
    });
  });

  it('prepends a pending move before release payloads', () => {
    const payloads = buildPointerLifecyclePayloads({
      phase: 'up',
      event: { pointerId: 9, pressure: 0 },
      ratios: {
        xRatio: 0.7,
        yRatio: 0.8,
        frameWidth: 1000,
        frameHeight: 800
      },
      pendingMove: {
        pointerId: 9,
        xRatio: 0.6,
        yRatio: 0.4,
        frameWidth: 1000,
        frameHeight: 800,
        pressure: 0.5
      },
      getOrCreateScrcpyPointerId: () => 0n,
      getScrcpyPointerId: () => 5n
    });

    expect(payloads).toHaveLength(2);
    expect(readTouchPayload(payloads![0])).toMatchObject({
      action: SCRCPY_ACTION_MOVE,
      pointerId: 5n,
      x: 600,
      y: 320
    });
    expect(readTouchPayload(payloads![1])).toMatchObject({
      action: SCRCPY_ACTION_UP,
      pointerId: 5n,
      x: 700,
      y: 640,
      pressure: 0,
      actionButton: 1,
      buttons: 0
    });
  });
});
