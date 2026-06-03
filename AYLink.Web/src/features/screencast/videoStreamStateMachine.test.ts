import { describe, expect, it } from 'vitest';
import {
  createVideoStreamStateMachine,
  getVideoStreamDetachDelay,
  markVideoStreamAdvanced,
  markVideoStreamConnecting,
  markVideoStreamDetached,
  markVideoStreamStable,
  markVideoStreamUnstable,
  resetVideoStreamStateMachine
} from './videoStreamStateMachine';

describe('videoStreamStateMachine', () => {
  it('allows signaling detach only after the stream has been stable long enough', () => {
    const machine = createVideoStreamStateMachine();

    markVideoStreamConnecting(machine, 1, 0);
    expect(getVideoStreamDetachDelay(machine, 1, 1000, 20000)).toBeNull();

    markVideoStreamAdvanced(machine, 1, 1000);
    expect(getVideoStreamDetachDelay(machine, 1, 5000, 20000)).toBe(16000);
    expect(getVideoStreamDetachDelay(machine, 1, 21000, 20000)).toBe(0);
    markVideoStreamStable(machine, 1);
    expect(machine.state).toBe('stable');
  });

  it('restarts the stable window after the stream becomes unstable', () => {
    const machine = createVideoStreamStateMachine();

    markVideoStreamConnecting(machine, 1, 0);
    markVideoStreamAdvanced(machine, 1, 1000);
    markVideoStreamUnstable(machine, 1, 7000);
    expect(getVideoStreamDetachDelay(machine, 1, 8000, 20000)).toBeNull();

    markVideoStreamAdvanced(machine, 1, 9000);
    expect(getVideoStreamDetachDelay(machine, 1, 21000, 20000)).toBe(8000);
  });

  it('keeps detached state stable until the machine is reset', () => {
    const machine = createVideoStreamStateMachine();

    markVideoStreamConnecting(machine, 1, 0);
    markVideoStreamAdvanced(machine, 1, 1000);
    markVideoStreamDetached(machine, 1);
    expect(machine.state).toBe('detached');
    expect(getVideoStreamDetachDelay(machine, 1, 30000, 20000)).toBe(0);

    resetVideoStreamStateMachine(machine);
    expect(machine.state).toBe('idle');
    expect(getVideoStreamDetachDelay(machine, 1, 30000, 20000)).toBeNull();
  });
});
