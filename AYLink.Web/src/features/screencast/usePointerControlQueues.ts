import { buildPointerMovePayload, type PendingPointerMove } from './touchPointerPayloads';

export type PendingPointerReleasePhase = 'up' | 'cancel';

interface PointerControlQueuesOptions {
  flushPendingPointerControlPayloads: () => void;
  getPointerMoveSendChannel: () => RTCDataChannel | null;
  getCurrentPointerMoveBufferLimit: () => number;
  getCurrentPointerMoveSampleIntervalMs: () => number;
  getScrcpyPointerId: (pointerId: number) => bigint | null;
  releasePointer: (pointerId: number, phase: PendingPointerReleasePhase) => void;
  onPointerMoveSendFailed?: (channel: RTCDataChannel) => void;
  now?: () => number;
  logger?: Pick<Console, 'warn'>;
}

export function usePointerControlQueues(options: PointerControlQueuesOptions) {
  const logger = options.logger ?? console;
  const now = options.now ?? (() => performance.now());
  const pendingPointerReleases = new Map<number, PendingPointerReleasePhase>();
  const queuedPointerReleases = new Set<number>();
  const pendingPointerMoves = new Map<number, PendingPointerMove>();

  let pointerMoveFlushHandle: number | null = null;
  let pointerMoveSampleTimer: number | null = null;
  let pointerReleaseFlushHandle: number | null = null;
  let lastPointerMoveFlushAt = 0;

  const stopPointerMoveFlushLoop = () => {
    if (pointerMoveFlushHandle !== null) {
      window.cancelAnimationFrame(pointerMoveFlushHandle);
      pointerMoveFlushHandle = null;
    }
    if (pointerMoveSampleTimer !== null) {
      window.clearTimeout(pointerMoveSampleTimer);
      pointerMoveSampleTimer = null;
    }
  };

  const stopPointerReleaseFlushLoop = () => {
    if (pointerReleaseFlushHandle !== null) {
      window.cancelAnimationFrame(pointerReleaseFlushHandle);
      pointerReleaseFlushHandle = null;
    }
  };

  const flushPendingPointerReleases = () => {
    options.flushPendingPointerControlPayloads();
    for (const [pointerId, phase] of [...pendingPointerReleases.entries()]) {
      if (queuedPointerReleases.has(pointerId)) {
        continue;
      }
      options.releasePointer(pointerId, phase);
    }

    if (pendingPointerReleases.size > 0) {
      schedulePointerReleaseFlush();
      return;
    }

    stopPointerReleaseFlushLoop();
  };

  const schedulePointerReleaseFlush = () => {
    if (pointerReleaseFlushHandle !== null || pendingPointerReleases.size === 0) {
      return;
    }

    pointerReleaseFlushHandle = window.requestAnimationFrame(() => {
      pointerReleaseFlushHandle = null;
      flushPendingPointerReleases();
    });
  };

  const schedulePointerMoveFlush = () => {
    if ((pointerMoveFlushHandle !== null || pointerMoveSampleTimer !== null) || pendingPointerMoves.size === 0) {
      return;
    }

    const elapsed = now() - lastPointerMoveFlushAt;
    const delayMs = Math.max(0, options.getCurrentPointerMoveSampleIntervalMs() - elapsed);

    const requestFlushFrame = () => {
      pointerMoveSampleTimer = null;
      pointerMoveFlushHandle = window.requestAnimationFrame(() => {
        pointerMoveFlushHandle = null;
        flushPendingPointerMoves();
      });
    };

    if (delayMs <= 0) {
      requestFlushFrame();
      return;
    }

    pointerMoveSampleTimer = window.setTimeout(requestFlushFrame, delayMs);
  };

  const flushPendingPointerMoves = () => {
    options.flushPendingPointerControlPayloads();
    const channel = options.getPointerMoveSendChannel();
    if (!channel || channel.readyState !== 'open') {
      return;
    }

    if (channel.bufferedAmount > options.getCurrentPointerMoveBufferLimit()) {
      schedulePointerMoveFlush();
      return;
    }

    const moves = [...pendingPointerMoves.values()];
    pendingPointerMoves.clear();
    let sentAnyMove = false;

    for (const move of moves) {
      const payload = buildPointerMovePayload(move, options.getScrcpyPointerId(move.pointerId));
      if (!payload) {
        continue;
      }

      try {
        channel.send(payload);
        sentAnyMove = true;
      } catch (error) {
        logger.warn('Pointer move send failed:', error);
        pendingPointerMoves.set(move.pointerId, move);
        options.onPointerMoveSendFailed?.(channel);
        schedulePointerMoveFlush();
        return;
      }
    }

    if (pendingPointerMoves.size > 0) {
      schedulePointerMoveFlush();
      return;
    }

    if (sentAnyMove) {
      lastPointerMoveFlushAt = now();
    }
  };

  const canFlushPointerMoveImmediately = () =>
    pointerMoveFlushHandle === null
    && pointerMoveSampleTimer === null
    && now() - lastPointerMoveFlushAt >= options.getCurrentPointerMoveSampleIntervalMs();

  const clearPointerState = (pointerId: number) => {
    pendingPointerReleases.delete(pointerId);
    queuedPointerReleases.delete(pointerId);
    pendingPointerMoves.delete(pointerId);
  };

  const clearAll = () => {
    pendingPointerReleases.clear();
    queuedPointerReleases.clear();
    pendingPointerMoves.clear();
    stopPointerMoveFlushLoop();
    stopPointerReleaseFlushLoop();
  };

  return {
    pendingPointerReleases,
    queuedPointerReleases,
    pendingPointerMoves,
    stopPointerMoveFlushLoop,
    stopPointerReleaseFlushLoop,
    flushPendingPointerReleases,
    schedulePointerReleaseFlush,
    schedulePointerMoveFlush,
    flushPendingPointerMoves,
    canFlushPointerMoveImmediately,
    clearPointerState,
    clearAll,
    getPointerMoveFlushHandle: () => pointerMoveFlushHandle,
    getPointerMoveSampleTimer: () => pointerMoveSampleTimer,
    getPointerReleaseFlushHandle: () => pointerReleaseFlushHandle,
    getLastPointerMoveFlushAt: () => lastPointerMoveFlushAt
  };
}
