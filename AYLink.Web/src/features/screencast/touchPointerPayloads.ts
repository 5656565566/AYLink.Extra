import {
  SCRCPY_ACTION_DOWN,
  SCRCPY_ACTION_MOVE,
  SCRCPY_ACTION_UP,
  SCRCPY_PRIMARY_BUTTON,
  buildTouchMessage
} from './scrcpyControlProtocol';
import type { PointerRatios } from './videoViewport';

export interface PendingPointerMove {
  pointerId: number;
  xRatio: number;
  yRatio: number;
  frameWidth: number;
  frameHeight: number;
  pressure: number;
}

export type PointerLifecyclePhase = 'down' | 'up' | 'cancel';

interface PointerEventLike {
  pointerId: number;
  pressure: number;
}

interface BuildPointerLifecyclePayloadsOptions {
  phase: PointerLifecyclePhase;
  event: PointerEventLike;
  ratios: PointerRatios | null;
  pendingMove?: PendingPointerMove | null;
  getOrCreateScrcpyPointerId: (pointerId: number) => bigint;
  getScrcpyPointerId: (pointerId: number) => bigint | null;
}

export const buildPointerMovePayload = (
  move: PendingPointerMove,
  scrcpyPointerId: bigint | null
) => {
  if (scrcpyPointerId === null || scrcpyPointerId === undefined) {
    return null;
  }

  return buildTouchMessage(
    SCRCPY_ACTION_MOVE,
    scrcpyPointerId,
    Math.trunc(move.xRatio * move.frameWidth),
    Math.trunc(move.yRatio * move.frameHeight),
    move.frameWidth,
    move.frameHeight,
    move.pressure,
    0,
    SCRCPY_PRIMARY_BUTTON
  );
};

export const buildPointerLifecyclePayloads = (options: BuildPointerLifecyclePayloadsOptions) => {
  if (!options.ratios) {
    return null;
  }

  const action = options.phase === 'down' ? SCRCPY_ACTION_DOWN : SCRCPY_ACTION_UP;
  const pointerId = action === SCRCPY_ACTION_DOWN
    ? options.getOrCreateScrcpyPointerId(options.event.pointerId)
    : options.getScrcpyPointerId(options.event.pointerId);
  if (pointerId === null || pointerId === undefined) {
    return null;
  }

  const payloads: Uint8Array[] = [];
  if (options.phase !== 'down' && options.pendingMove) {
    const movePayload = buildPointerMovePayload(options.pendingMove, pointerId);
    if (movePayload) {
      payloads.push(movePayload);
    }
  }

  const x = Math.trunc(options.ratios.xRatio * options.ratios.frameWidth);
  const y = Math.trunc(options.ratios.yRatio * options.ratios.frameHeight);
  const isUp = action === SCRCPY_ACTION_UP;
  payloads.push(
    buildTouchMessage(
      action,
      pointerId,
      x,
      y,
      options.ratios.frameWidth,
      options.ratios.frameHeight,
      isUp ? 0 : (options.event.pressure || 1),
      SCRCPY_PRIMARY_BUTTON,
      isUp ? 0 : SCRCPY_PRIMARY_BUTTON
    )
  );

  return payloads;
};
