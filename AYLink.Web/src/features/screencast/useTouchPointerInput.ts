import { createScrcpyPointerIdTracker } from './scrcpyPointerIdTracker';
import {
  buildPointerLifecyclePayloads as buildTouchPointerLifecyclePayloads,
  buildPointerMovePayload,
  type PendingPointerMove,
  type PointerLifecyclePhase
} from './touchPointerPayloads';
import { usePointerControlQueues } from './usePointerControlQueues';
import type { PointerRatios } from './videoViewport';

interface TouchPointerInputOptions {
  getVideoElement: () => HTMLVideoElement | null;
  getPointerRatios: (event: PointerEvent) => PointerRatios | null;
  getPrimaryControlChannel: () => RTCDataChannel | null;
  getPointerMoveSendChannel: () => RTCDataChannel | null;
  getCurrentPointerMoveBufferLimit: () => number;
  getCurrentPointerMoveSampleIntervalMs: () => number;
  flushPendingPointerControlPayloads: () => void;
  enqueuePointerPayloadBuffers: (payloads: Uint8Array[], onLastSent?: () => void) => boolean;
  onPointerMoveSendFailed?: (channel: RTCDataChannel) => void;
  mouseCompatSuppressionMs: number;
}

export interface PointerRatiosCommand {
  phase: PointerLifecyclePhase | 'move';
  pointerId: number;
  ratios: PointerRatios;
  pressure?: number;
  pointerType?: string;
  onFinalized?: () => void;
}

export function useTouchPointerInput(options: TouchPointerInputOptions) {
  const activePointers = new Set<number>();
  const commandPointerIds = new Set<number>();
  const pointerGenerations = new Map<number, number>();
  const pointerSnapshots = new Map<number, { xRatio: number; yRatio: number; pointerType: string }>();
  const scrcpyPointerIdTracker = createScrcpyPointerIdTracker();
  let lastTouchPointerAt = 0;

  const getCommandPointerId = (pointerId: number) => -(Math.abs(Math.trunc(pointerId)) + 1);

  function getScrcpyPointerId(pointerId: number) {
    return scrcpyPointerIdTracker.get(pointerId);
  }

  const pointerControlQueues = usePointerControlQueues({
    flushPendingPointerControlPayloads: () => options.flushPendingPointerControlPayloads(),
    getPointerMoveSendChannel: () => options.getPointerMoveSendChannel(),
    getCurrentPointerMoveBufferLimit: () => options.getCurrentPointerMoveBufferLimit(),
    getCurrentPointerMoveSampleIntervalMs: () => options.getCurrentPointerMoveSampleIntervalMs(),
    getScrcpyPointerId,
    releasePointer: (pointerId, phase) => {
      releasePointer(pointerId, phase);
    },
    onPointerMoveSendFailed: (channel) => options.onPointerMoveSendFailed?.(channel)
  });

  const {
    pendingPointerReleases,
    queuedPointerReleases,
    pendingPointerMoves,
    stopPointerMoveFlushLoop,
    stopPointerReleaseFlushLoop,
    flushPendingPointerReleases,
    schedulePointerReleaseFlush,
    schedulePointerMoveFlush,
    flushPendingPointerMoves
  } = pointerControlQueues;

  const createSyntheticPointerEvent = (pointerId: number, xRatio = 0.5, yRatio = 0.5): PointerEvent | null => {
    const videoElement = options.getVideoElement();
    if (!videoElement) return null;
    const rect = videoElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const snapshot = pointerSnapshots.get(pointerId);

    return new PointerEvent('pointercancel', {
      pointerId,
      pointerType: snapshot?.pointerType ?? 'touch',
      isPrimary: true,
      clientX: rect.left + rect.width * (snapshot?.xRatio ?? xRatio),
      clientY: rect.top + rect.height * (snapshot?.yRatio ?? yRatio),
      buttons: 0,
      pressure: 0
    });
  };

  const getOrCreateScrcpyPointerId = (pointerId: number) => {
    return scrcpyPointerIdTracker.getOrCreate(pointerId);
  };

  const releaseScrcpyPointerId = (pointerId: number) => {
    scrcpyPointerIdTracker.release(pointerId);
  };

  const clearLocalPointerState = (pointerId: number) => {
    activePointers.delete(pointerId);
    commandPointerIds.delete(pointerId);
    pointerControlQueues.clearPointerState(pointerId);
    pointerGenerations.delete(pointerId);
    pointerSnapshots.delete(pointerId);
    releaseScrcpyPointerId(pointerId);
    try {
      options.getVideoElement()?.releasePointerCapture?.(pointerId);
    } catch {
      // Ignore release failures when the browser has already dropped capture.
    }
  };

  const getPointerGeneration = (pointerId: number) => pointerGenerations.get(pointerId) ?? 0;

  const bumpPointerGeneration = (pointerId: number) => {
    const nextGeneration = getPointerGeneration(pointerId) + 1;
    pointerGenerations.set(pointerId, nextGeneration);
    return nextGeneration;
  };

  const finalizePointerRelease = (pointerId: number, releaseGeneration: number) => {
    pointerControlQueues.clearPointerState(pointerId);

    if (getPointerGeneration(pointerId) !== releaseGeneration || activePointers.has(pointerId)) {
      return false;
    }

    clearLocalPointerState(pointerId);
    return true;
  };

  const markTouchPointerActivity = () => {
    lastTouchPointerAt = performance.now();
  };

  const shouldIgnoreCompatMouse = () => performance.now() - lastTouchPointerAt < options.mouseCompatSuppressionMs;

  const buildQueuedPointerMovePayload = (move: PendingPointerMove) => {
    return buildPointerMovePayload(move, getScrcpyPointerId(move.pointerId));
  };

  const buildPointerLifecyclePayloads = (
    phase: PointerLifecyclePhase,
    event: { pointerId: number; pressure: number },
    ratios: PointerRatios | null
  ) => {
    return buildTouchPointerLifecyclePayloads({
      phase,
      event,
      ratios,
      pendingMove: pendingPointerMoves.get(event.pointerId),
      getOrCreateScrcpyPointerId,
      getScrcpyPointerId
    });
  };

  const sendPointerMessage = (phase: PointerLifecyclePhase | 'move', event: PointerEvent) => {
    const isMove = phase === 'move';
    const channel = isMove ? options.getPointerMoveSendChannel() : options.getPrimaryControlChannel();
    if (!channel || channel.readyState !== 'open') {
      if (!isMove) {
        return false;
      }
    }

    const ratios = options.getPointerRatios(event);
    if (!ratios) return false;

    pointerSnapshots.set(event.pointerId, {
      xRatio: ratios.xRatio,
      yRatio: ratios.yRatio,
      pointerType: event.pointerType || 'touch'
    });

    if (isMove) {
      pendingPointerMoves.set(event.pointerId, {
        pointerId: event.pointerId,
        xRatio: ratios.xRatio,
        yRatio: ratios.yRatio,
        frameWidth: ratios.frameWidth,
        frameHeight: ratios.frameHeight,
        pressure: event.pressure || 1,
      });
      if (!channel || channel.readyState !== 'open') {
        schedulePointerMoveFlush();
        return true;
      }
      if (pointerControlQueues.canFlushPointerMoveImmediately()) {
        flushPendingPointerMoves();
        if (pendingPointerMoves.size === 0) {
          return true;
        }
      }
      schedulePointerMoveFlush();
      return true;
    }

    const payloads = buildPointerLifecyclePayloads(phase, event, ratios);
    if (!payloads || payloads.length === 0) {
      return false;
    }

    return options.enqueuePointerPayloadBuffers(payloads);
  };

  const sendPointerRatiosCommand = (command: PointerRatiosCommand) => {
    const pointerId = getCommandPointerId(command.pointerId);
    const pointerType = command.pointerType || 'touch';
    const pressure = command.pressure ?? (command.phase === 'up' || command.phase === 'cancel' ? 0 : 1);

    pointerSnapshots.set(pointerId, {
      xRatio: command.ratios.xRatio,
      yRatio: command.ratios.yRatio,
      pointerType
    });

    if (command.phase === 'move') {
      if (!activePointers.has(pointerId)) {
        return false;
      }

      const channel = options.getPointerMoveSendChannel();
      pendingPointerMoves.set(pointerId, {
        pointerId,
        xRatio: command.ratios.xRatio,
        yRatio: command.ratios.yRatio,
        frameWidth: command.ratios.frameWidth,
        frameHeight: command.ratios.frameHeight,
        pressure: pressure || 1,
      });
      if (!channel || channel.readyState !== 'open') {
        schedulePointerMoveFlush();
        return true;
      }
      if (pointerControlQueues.canFlushPointerMoveImmediately()) {
        flushPendingPointerMoves();
        if (pendingPointerMoves.size === 0) {
          return true;
        }
      }
      schedulePointerMoveFlush();
      return true;
    }

    if (command.phase === 'down') {
      if (activePointers.has(pointerId) || pendingPointerReleases.has(pointerId) || queuedPointerReleases.has(pointerId)) {
        releasePointer(pointerId, 'cancel');
      }

      flushPendingPointerReleases();
      bumpPointerGeneration(pointerId);
      const payloads = buildPointerLifecyclePayloads('down', {
        pointerId,
        pressure
      }, command.ratios);
      if (!payloads || payloads.length === 0) {
        return false;
      }

      if (options.enqueuePointerPayloadBuffers(payloads)) {
        activePointers.add(pointerId);
        commandPointerIds.add(pointerId);
        pendingPointerReleases.delete(pointerId);
        return true;
      }

      return false;
    }

    if (!activePointers.has(pointerId) && !pendingPointerReleases.has(pointerId)) {
      return false;
    }

    if (queuedPointerReleases.has(pointerId)) {
      return true;
    }

    const releasePhase: 'up' | 'cancel' = command.phase;
    const releaseGeneration = getPointerGeneration(pointerId);
    const payloads = buildPointerLifecyclePayloads(releasePhase, {
      pointerId,
      pressure
    }, command.ratios);
    if (!payloads || payloads.length === 0) {
      return false;
    }

    pendingPointerReleases.set(pointerId, releasePhase);
    queuedPointerReleases.add(pointerId);
    const queued = options.enqueuePointerPayloadBuffers(payloads, () => {
      if (finalizePointerRelease(pointerId, releaseGeneration)) {
        command.onFinalized?.();
      }
    });
    if (!queued) {
      queuedPointerReleases.delete(pointerId);
      schedulePointerReleaseFlush();
    } else {
      activePointers.delete(pointerId);
    }

    return queued;
  };

  function releasePointer(pointerId: number, phase: 'up' | 'cancel', event?: PointerEvent) {
    if (!activePointers.has(pointerId) && !pendingPointerReleases.has(pointerId)) return false;

    if (queuedPointerReleases.has(pointerId)) {
      return true;
    }

    const releaseGeneration = getPointerGeneration(pointerId);
    const finalizeRelease = () => {
      finalizePointerRelease(pointerId, releaseGeneration);
    };

    const attemptRelease = (pointerEvent?: PointerEvent | null) => {
      if (!pointerEvent) {
        return false;
      }

      const ratios = options.getPointerRatios(pointerEvent);
      if (!ratios) {
        return false;
      }

      const payloads = buildPointerLifecyclePayloads(phase, pointerEvent, ratios);
      if (!payloads || payloads.length === 0) {
        return false;
      }

      pendingPointerReleases.set(pointerId, phase);
      queuedPointerReleases.add(pointerId);
      const queued = options.enqueuePointerPayloadBuffers(payloads, finalizeRelease);
      if (!queued) {
        queuedPointerReleases.delete(pointerId);
      } else {
        activePointers.delete(pointerId);
      }
      return queued;
    };

    const pointerEvent = event ?? createSyntheticPointerEvent(pointerId);
    if (attemptRelease(pointerEvent)) {
      return true;
    }

    const fallbackPointerEvent = createSyntheticPointerEvent(pointerId);
    if (attemptRelease(fallbackPointerEvent)) {
      return true;
    }

    if (!fallbackPointerEvent) {
      queuedPointerReleases.delete(pointerId);
      pendingPointerReleases.set(pointerId, phase);
      schedulePointerReleaseFlush();
      return false;
    }

    queuedPointerReleases.delete(pointerId);
    pendingPointerReleases.set(pointerId, phase);
    schedulePointerReleaseFlush();
    return false;
  }

  const releaseAllPointers = (phase: 'up' | 'cancel' = 'cancel') => {
    pendingPointerMoves.clear();
    stopPointerMoveFlushLoop();

    for (const pointerId of [...activePointers]) {
      releasePointer(pointerId, phase);
    }
  };

  const releaseLingeringTouchPointers = (nextPointerId: number) => {
    const stalePointerIds = new Set<number>([
      ...activePointers,
      ...pendingPointerReleases.keys(),
      ...queuedPointerReleases,
    ]);

    for (const pointerId of stalePointerIds) {
      if (pointerId === nextPointerId || commandPointerIds.has(pointerId)) {
        continue;
      }

      releasePointer(pointerId, 'cancel');
    }
  };

  const getLatestPointerSample = (event: PointerEvent) => {
    if (typeof event.getCoalescedEvents !== 'function') {
      return event;
    }

    const samples = event.getCoalescedEvents();
    return samples.length > 0 ? samples[samples.length - 1] : event;
  };

  const handlePointerDown = (event: PointerEvent) => {
    if (event.pointerType === 'mouse') return;
    markTouchPointerActivity();
    if (activePointers.has(event.pointerId) || pendingPointerReleases.has(event.pointerId) || queuedPointerReleases.has(event.pointerId)) {
      releasePointer(event.pointerId, 'cancel');
    }
    releaseLingeringTouchPointers(event.pointerId);
    flushPendingPointerReleases();
    bumpPointerGeneration(event.pointerId);
    options.getVideoElement()?.setPointerCapture?.(event.pointerId);
    if (sendPointerMessage('down', event)) {
      activePointers.add(event.pointerId);
      pendingPointerReleases.delete(event.pointerId);
      return;
    }

    try {
      options.getVideoElement()?.releasePointerCapture?.(event.pointerId);
    } catch {
      // Ignore release failures if capture was never established.
    }
  };

  const handlePointerMove = (event: PointerEvent) => {
    if (event.pointerType === 'mouse') return;
    markTouchPointerActivity();
    if (!activePointers.has(event.pointerId)) return;
    sendPointerMessage('move', getLatestPointerSample(event));
  };

  const handlePointerUp = (event: PointerEvent) => {
    if (event.pointerType === 'mouse') return;
    markTouchPointerActivity();
    releasePointer(event.pointerId, 'up', event);
  };

  const handlePointerCancel = (event: PointerEvent) => {
    if (event.pointerType === 'mouse') return;
    markTouchPointerActivity();
    releasePointer(event.pointerId, 'cancel', event);
  };

  const handlePointerCaptureLost = (event: PointerEvent) => {
    if (event.pointerType === 'mouse') return;
    markTouchPointerActivity();
    releasePointer(event.pointerId, 'cancel', event);
  };

  const clearAllPointerState = () => {
    activePointers.clear();
    commandPointerIds.clear();
    pointerGenerations.clear();
    pointerSnapshots.clear();
    scrcpyPointerIdTracker.clear();
    pointerControlQueues.clearAll();
  };

  const resetAllPointerState = () => {
    activePointers.clear();
    commandPointerIds.clear();
    pointerGenerations.clear();
    pointerSnapshots.clear();
    scrcpyPointerIdTracker.reset();
    pointerControlQueues.clearAll();
  };

  return {
    activePointers,
    pointerGenerations,
    pointerSnapshots,
    pointerControlQueues,
    pendingPointerReleases,
    queuedPointerReleases,
    pendingPointerMoves,
    createSyntheticPointerEvent,
    getOrCreateScrcpyPointerId,
    getScrcpyPointerId,
    releaseScrcpyPointerId,
    clearLocalPointerState,
    getPointerGeneration,
    bumpPointerGeneration,
    finalizePointerRelease,
    markTouchPointerActivity,
    shouldIgnoreCompatMouse,
    buildQueuedPointerMovePayload,
    buildPointerLifecyclePayloads,
    sendPointerMessage,
    sendPointerRatiosCommand,
    releasePointer,
    releaseAllPointers,
    releaseLingeringTouchPointers,
    getLatestPointerSample,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
    handlePointerCaptureLost,
    clearAllPointerState,
    resetAllPointerState,
    stopPointerMoveFlushLoop,
    stopPointerReleaseFlushLoop,
    flushPendingPointerReleases,
    schedulePointerReleaseFlush,
    schedulePointerMoveFlush,
    flushPendingPointerMoves,
    getNextScrcpyPointerId: () => scrcpyPointerIdTracker.getNextPointerId(),
    getScrcpyPointerIds: () => scrcpyPointerIdTracker.getPointerIds(),
    getLastTouchPointerAt: () => lastTouchPointerAt
  };
}
