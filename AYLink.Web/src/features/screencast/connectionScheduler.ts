import type { Ref } from 'vue';

export interface CastConnectionSchedulerState {
  pendingReconnectTimer: number | null;
  pendingStartConnectionTimer: number | null;
  reconnectAttempt: number;
  suppressAutoReconnect: boolean;
  isStartConnectionInFlight: boolean;
  activeConnectionTargetKey: string;
}

interface ScheduleReconnectOptions {
  state: CastConnectionSchedulerState;
  getActiveTabPresent: () => boolean;
  getDeviceId: () => string;
  getActiveTabKey: () => string;
  isConnecting: Ref<boolean>;
  status: Ref<string>;
  startConnection: () => void;
  logger?: Pick<Console, 'warn'>;
}

interface DisableAutoReconnectOptions {
  state: CastConnectionSchedulerState;
  clearPendingReconnect: () => void;
  clearPendingIceRestartFallback: () => void;
  clearPendingVideoRecovery: () => void;
  resetSignalingDetachState: () => void;
  onIceRestartReset: () => void;
}

interface ScheduleStartConnectionOptions {
  state: CastConnectionSchedulerState;
  getDeviceId: () => string;
  getActiveTabKey: () => string;
  hasLiveConnection: () => boolean;
  isConnecting: Ref<boolean>;
  status: Ref<string>;
  enableAutoReconnect: () => void;
  startConnection: () => void;
}

export function createCastConnectionSchedulerState(): CastConnectionSchedulerState {
  return {
    pendingReconnectTimer: null,
    pendingStartConnectionTimer: null,
    reconnectAttempt: 0,
    suppressAutoReconnect: false,
    isStartConnectionInFlight: false,
    activeConnectionTargetKey: ''
  };
}

export function clearPendingReconnect(state: CastConnectionSchedulerState) {
  if (state.pendingReconnectTimer !== null) {
    window.clearTimeout(state.pendingReconnectTimer);
    state.pendingReconnectTimer = null;
  }
}

export function clearPendingStartConnection(state: CastConnectionSchedulerState) {
  if (state.pendingStartConnectionTimer !== null) {
    window.clearTimeout(state.pendingStartConnectionTimer);
    state.pendingStartConnectionTimer = null;
  }
}

export function clearStartConnectionState(state: CastConnectionSchedulerState) {
  state.isStartConnectionInFlight = false;
  state.activeConnectionTargetKey = '';
}

export function enableAutoReconnect(state: CastConnectionSchedulerState) {
  state.suppressAutoReconnect = false;
}

export function disableAutoReconnect(options: DisableAutoReconnectOptions) {
  const {
    state,
    clearPendingReconnect: clearReconnect,
    clearPendingIceRestartFallback,
    clearPendingVideoRecovery,
    resetSignalingDetachState,
    onIceRestartReset
  } = options;

  state.suppressAutoReconnect = true;
  clearReconnect();
  clearPendingIceRestartFallback();
  clearPendingVideoRecovery();
  resetSignalingDetachState();
  onIceRestartReset();
  clearStartConnectionState(state);
}

export function scheduleReconnect(reason: string, options: ScheduleReconnectOptions) {
  const {
    state,
    getActiveTabPresent,
    getDeviceId,
    getActiveTabKey,
    isConnecting,
    status,
    startConnection,
    logger = console
  } = options;

  const deviceId = getDeviceId();
  const activeTabKey = getActiveTabKey();

  if (state.suppressAutoReconnect || !getActiveTabPresent() || !deviceId) {
    return;
  }
  if (state.pendingReconnectTimer !== null || state.pendingStartConnectionTimer !== null) {
    return;
  }

  const delays = [1000, 2000, 5000, 10000];
  const delayMs = delays[Math.min(state.reconnectAttempt, delays.length - 1)];
  state.reconnectAttempt += 1;
  isConnecting.value = true;
  status.value = `连接中断，正在重连 (${state.reconnectAttempt})...`;
  logger.warn('[WebRTC] Scheduling reconnect:', {
    reason,
    attempt: state.reconnectAttempt,
    delayMs,
    deviceId,
    tabKey: activeTabKey
  });

  state.pendingReconnectTimer = window.setTimeout(() => {
    state.pendingReconnectTimer = null;
    if (state.suppressAutoReconnect || !getActiveTabPresent() || !getDeviceId()) {
      return;
    }
    startConnection();
  }, delayMs);
}

export function scheduleStartConnection(delayMs: number, options: ScheduleStartConnectionOptions) {
  const {
    state,
    getDeviceId,
    getActiveTabKey,
    hasLiveConnection,
    isConnecting,
    status,
    enableAutoReconnect: enableReconnect,
    startConnection
  } = options;

  clearPendingStartConnection(state);
  const deviceId = getDeviceId();
  if (!deviceId) {
    return;
  }

  const activeTabKey = getActiveTabKey();
  if (state.activeConnectionTargetKey === activeTabKey && (state.isStartConnectionInFlight || hasLiveConnection() || isConnecting.value)) {
    return;
  }

  enableReconnect();

  if (delayMs <= 0) {
    state.isStartConnectionInFlight = true;
    state.activeConnectionTargetKey = activeTabKey;
    startConnection();
    return;
  }

  status.value = '正在准备 WebRTC 会话...';
  isConnecting.value = true;
  state.pendingStartConnectionTimer = window.setTimeout(() => {
    state.pendingStartConnectionTimer = null;
    state.isStartConnectionInFlight = true;
    state.activeConnectionTargetKey = getActiveTabKey();
    startConnection();
  }, delayMs);
}
