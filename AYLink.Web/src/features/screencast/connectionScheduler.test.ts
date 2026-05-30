import { ref } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPendingReconnect,
  clearPendingStartConnection,
  clearStartConnectionState,
  createCastConnectionSchedulerState,
  disableAutoReconnect,
  enableAutoReconnect,
  scheduleReconnect,
  scheduleStartConnection,
} from './connectionScheduler';

describe('connectionScheduler', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('schedules reconnect attempts with exponential delays', async () => {
    vi.useFakeTimers();
    const state = createCastConnectionSchedulerState();
    const isConnecting = ref(false);
    const status = ref('');
    const startConnection = vi.fn();

    scheduleReconnect('closed', {
      state,
      getActiveTabPresent: () => true,
      getDeviceId: () => 'device-1',
      getActiveTabKey: () => 'tab-1',
      isConnecting,
      status,
      startConnection,
      logger: { warn: vi.fn() }
    });

    expect(state.reconnectAttempt).toBe(1);
    expect(isConnecting.value).toBe(true);
    expect(status.value).toContain('重连');

    await vi.advanceTimersByTimeAsync(1000);
    expect(startConnection).toHaveBeenCalledTimes(1);
  });

  it('does not schedule reconnect when auto reconnect is suppressed', () => {
    const state = createCastConnectionSchedulerState();
    state.suppressAutoReconnect = true;

    scheduleReconnect('closed', {
      state,
      getActiveTabPresent: () => true,
      getDeviceId: () => 'device-1',
      getActiveTabKey: () => 'tab-1',
      isConnecting: ref(false),
      status: ref(''),
      startConnection: vi.fn(),
      logger: { warn: vi.fn() }
    });

    expect(state.pendingReconnectTimer).toBeNull();
  });

  it('schedules delayed start connection and marks in-flight state', async () => {
    vi.useFakeTimers();
    const state = createCastConnectionSchedulerState();
    const startConnection = vi.fn();

    scheduleStartConnection(200, {
      state,
      getDeviceId: () => 'device-1',
      getActiveTabKey: () => 'tab-1',
      hasLiveConnection: () => false,
      isConnecting: ref(false),
      status: ref(''),
      enableAutoReconnect: () => enableAutoReconnect(state),
      startConnection
    });

    expect(state.pendingStartConnectionTimer).not.toBeNull();
    await vi.advanceTimersByTimeAsync(200);
    expect(state.isStartConnectionInFlight).toBe(true);
    expect(state.activeConnectionTargetKey).toBe('tab-1');
    expect(startConnection).toHaveBeenCalledTimes(1);
  });

  it('clears timers and start state when disabling auto reconnect', () => {
    const state = createCastConnectionSchedulerState();
    state.pendingReconnectTimer = 1;
    state.pendingStartConnectionTimer = 2;
    state.isStartConnectionInFlight = true;
    state.activeConnectionTargetKey = 'tab-1';

    const clearReconnectSpy = vi.fn(() => clearPendingReconnect(state));
    const clearIceSpy = vi.fn();
    const clearVideoSpy = vi.fn();
    const resetDetachSpy = vi.fn();
    const iceResetSpy = vi.fn();

    disableAutoReconnect({
      state,
      clearPendingReconnect: clearReconnectSpy,
      clearPendingIceRestartFallback: clearIceSpy,
      clearPendingVideoRecovery: clearVideoSpy,
      resetSignalingDetachState: resetDetachSpy,
      onIceRestartReset: iceResetSpy
    });

    expect(state.suppressAutoReconnect).toBe(true);
    expect(clearReconnectSpy).toHaveBeenCalled();
    expect(clearIceSpy).toHaveBeenCalled();
    expect(clearVideoSpy).toHaveBeenCalled();
    expect(resetDetachSpy).toHaveBeenCalled();
    expect(iceResetSpy).toHaveBeenCalled();
    expect(state.isStartConnectionInFlight).toBe(false);
    expect(state.activeConnectionTargetKey).toBe('');
  });

  it('clears pending timer state helpers', () => {
    const state = createCastConnectionSchedulerState();
    state.pendingReconnectTimer = 123;
    state.pendingStartConnectionTimer = 456;
    state.isStartConnectionInFlight = true;
    state.activeConnectionTargetKey = 'tab-1';

    clearPendingReconnect(state);
    clearPendingStartConnection(state);
    clearStartConnectionState(state);

    expect(state.pendingReconnectTimer).toBeNull();
    expect(state.pendingStartConnectionTimer).toBeNull();
    expect(state.isStartConnectionInFlight).toBe(false);
    expect(state.activeConnectionTargetKey).toBe('');
  });
});
