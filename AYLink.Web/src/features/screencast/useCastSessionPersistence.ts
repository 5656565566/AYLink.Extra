import { apiFetch } from '../../utils/api';
import type { PersistedCastConnection } from '../../types/screencast';

declare global {
  interface Window {
    __aylinkPersistedCastConnections?: Record<string, PersistedCastConnection>;
  }
}

export function useCastSessionPersistence() {
  const scrcpySessionHeartbeatTimers = new Map<string, number>();

  const heartbeatKey = (targetDeviceId: string, sessionId: string) => `${targetDeviceId}::${sessionId}`;

  const postScrcpySessionAction = async (action: 'heartbeat' | 'release', targetDeviceId: string, sessionId: string) => {
    if (!targetDeviceId || !sessionId) {
      return;
    }

    try {
      console.debug('[WebRTC] Session action ->', action, { deviceId: targetDeviceId, sessionId });
      await apiFetch(`/api/scrcpy-sessions/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: targetDeviceId, sessionId })
      });
    } catch (error) {
      console.warn(`Failed to ${action} scrcpy session:`, error);
    }
  };

  const stopScrcpySessionHeartbeat = (targetDeviceId?: string, sessionId?: string) => {
    if (targetDeviceId && sessionId) {
      const key = heartbeatKey(targetDeviceId, sessionId);
      const timer = scrcpySessionHeartbeatTimers.get(key);
      if (timer !== undefined) {
        window.clearInterval(timer);
        scrcpySessionHeartbeatTimers.delete(key);
      }
      return;
    }

    for (const timer of scrcpySessionHeartbeatTimers.values()) {
      window.clearInterval(timer);
    }
    scrcpySessionHeartbeatTimers.clear();
  };

  const startScrcpySessionHeartbeat = (targetDeviceId: string, sessionId: string) => {
    if (!targetDeviceId || !sessionId) {
      return;
    }

    stopScrcpySessionHeartbeat(targetDeviceId, sessionId);
    const key = heartbeatKey(targetDeviceId, sessionId);

    const tick = () => {
      void postScrcpySessionAction('heartbeat', targetDeviceId, sessionId);
    };

    tick();
    scrcpySessionHeartbeatTimers.set(key, window.setInterval(tick, 15000));
  };

  const clearPersistedConnection = (tabKey: string) => {
    if (!tabKey || !window.__aylinkPersistedCastConnections) {
      return;
    }

    delete window.__aylinkPersistedCastConnections[tabKey];
    if (Object.keys(window.__aylinkPersistedCastConnections).length === 0) {
      window.__aylinkPersistedCastConnections = undefined;
    }
  };

  const getPersistedConnection = (tabKey: string) => {
    if (!tabKey) {
      return null;
    }

    return window.__aylinkPersistedCastConnections?.[tabKey] ?? null;
  };

  const disposePersistedConnection = (tabKey: string) => {
    const persisted = window.__aylinkPersistedCastConnections?.[tabKey];
    if (!persisted) {
      return;
    }

    try {
      persisted.dataChannel?.close();
    } catch {
      // Ignore channel close failures during persisted connection cleanup.
    }

    try {
      persisted.metaControlChannel?.close();
    } catch {
      // Ignore channel close failures during persisted connection cleanup.
    }

    try {
      persisted.pointerMoveChannel?.close();
    } catch {
      // Ignore channel close failures during persisted connection cleanup.
    }

    try {
      persisted.peerConnection.ontrack = null;
      persisted.peerConnection.onicecandidate = null;
      persisted.peerConnection.onconnectionstatechange = null;
      persisted.peerConnection.ondatachannel = null;
      persisted.peerConnection.close();
    } catch {
      // Ignore peer connection cleanup failures during persisted connection cleanup.
    }

    try {
      if (persisted.ws) {
        persisted.ws.onopen = null;
        persisted.ws.onmessage = null;
        persisted.ws.onerror = null;
        persisted.ws.onclose = null;
        persisted.ws.close();
      }
    } catch {
      // Ignore websocket cleanup failures during persisted connection cleanup.
    }

    clearPersistedConnection(tabKey);
  };

  const disposeOtherPersistedConnections = (keepTabKey: string) => {
    const persistedConnections = window.__aylinkPersistedCastConnections;
    if (!persistedConnections) {
      return;
    }

    for (const tabKey of Object.keys(persistedConnections)) {
      if (tabKey === keepTabKey) {
        continue;
      }

      disposePersistedConnection(tabKey);
    }
  };

  const disposeAllPersistedConnections = () => {
    const persistedConnections = window.__aylinkPersistedCastConnections;
    if (!persistedConnections) {
      return;
    }

    for (const tabKey of Object.keys(persistedConnections)) {
      disposePersistedConnection(tabKey);
    }
  };

  const persistCurrentConnection = (
    tabKey: string,
    connection: PersistedCastConnection | null,
    options: { disposeOtherConnections?: boolean } = {}
  ) => {
    if (!connection || !tabKey) {
      return;
    }

    window.__aylinkPersistedCastConnections ??= {};
    window.__aylinkPersistedCastConnections[tabKey] = connection;
    if (options.disposeOtherConnections !== false) {
      disposeOtherPersistedConnections(tabKey);
    }
  };

  return {
    postScrcpySessionAction,
    stopScrcpySessionHeartbeat,
    startScrcpySessionHeartbeat,
    persistCurrentConnection,
    clearPersistedConnection,
    getPersistedConnection,
    disposePersistedConnection,
    disposeOtherPersistedConnections,
    disposeAllPersistedConnections
  };
}
