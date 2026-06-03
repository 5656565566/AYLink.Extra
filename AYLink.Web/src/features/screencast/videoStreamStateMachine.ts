export type VideoStreamState = 'idle' | 'connecting' | 'observing' | 'stable' | 'stalled' | 'detached';

export interface VideoStreamStateMachine {
  state: VideoStreamState;
  connectionId: number | null;
  stableSince: number;
  lastUnstableAt: number;
}

export function createVideoStreamStateMachine(): VideoStreamStateMachine {
  return {
    state: 'idle',
    connectionId: null,
    stableSince: 0,
    lastUnstableAt: 0
  };
}

export function resetVideoStreamStateMachine(machine: VideoStreamStateMachine) {
  machine.state = 'idle';
  machine.connectionId = null;
  machine.stableSince = 0;
  machine.lastUnstableAt = 0;
}

export function markVideoStreamConnecting(machine: VideoStreamStateMachine, connectionId: number, now: number) {
  machine.state = 'connecting';
  machine.connectionId = connectionId;
  machine.stableSince = 0;
  machine.lastUnstableAt = now;
}

export function markVideoStreamUnstable(machine: VideoStreamStateMachine, connectionId: number, now: number) {
  if (machine.connectionId !== connectionId) {
    machine.connectionId = connectionId;
  }
  machine.state = 'stalled';
  machine.stableSince = 0;
  machine.lastUnstableAt = now;
}

export function markVideoStreamAdvanced(machine: VideoStreamStateMachine, connectionId: number, now: number) {
  if (machine.connectionId !== connectionId || machine.state === 'idle' || machine.state === 'connecting' || machine.state === 'stalled') {
    machine.connectionId = connectionId;
    machine.state = 'observing';
    machine.stableSince = now;
    return;
  }

  if (machine.state === 'observing') {
    return;
  }

  if (machine.state === 'stable' || machine.state === 'detached') {
    return;
  }

  machine.state = 'observing';
  machine.stableSince = now;
}

export function markVideoStreamDetached(machine: VideoStreamStateMachine, connectionId: number) {
  if (machine.connectionId !== connectionId) {
    return;
  }
  machine.state = 'detached';
}

export function markVideoStreamStable(machine: VideoStreamStateMachine, connectionId: number) {
  if (machine.connectionId !== connectionId || machine.stableSince <= 0 || machine.state === 'idle' || machine.state === 'connecting' || machine.state === 'stalled') {
    return;
  }
  machine.state = 'stable';
}

export function getVideoStreamStableDuration(machine: VideoStreamStateMachine, connectionId: number, now: number) {
  if (machine.connectionId !== connectionId || machine.stableSince <= 0 || machine.state === 'idle' || machine.state === 'connecting' || machine.state === 'stalled') {
    return 0;
  }
  return Math.max(0, now - machine.stableSince);
}

export function getVideoStreamDetachDelay(machine: VideoStreamStateMachine, connectionId: number, now: number, stablePeriodMs: number) {
  const stableDuration = getVideoStreamStableDuration(machine, connectionId, now);
  if (stableDuration <= 0) {
    return null;
  }
  return Math.max(0, stablePeriodMs - stableDuration);
}
