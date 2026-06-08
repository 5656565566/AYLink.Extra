import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiFetchMock = vi.fn();

vi.mock('../../utils/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

import { useCastSessionPersistence } from './useCastSessionPersistence';
import type { PersistedCastConnection } from '../../types/screencast';

function createPersistedConnection(overrides: Partial<PersistedCastConnection> = {}) {
  const dataChannelClose = vi.fn();
  const metaChannelClose = vi.fn();
  const pointerChannelClose = vi.fn();
  const peerClose = vi.fn();
  const wsClose = vi.fn();

  const connection: PersistedCastConnection = {
    tabKey: 'tab-1',
    deviceId: 'device-1',
    appPackageName: '',
    appDisplayName: '',
    newDisplay: false,
    sessionId: 'session-1',
    persistedAt: Date.now(),
    peerConnection: {
      ontrack: vi.fn(),
      onicecandidate: vi.fn(),
      onconnectionstatechange: vi.fn(),
      ondatachannel: vi.fn(),
      close: peerClose,
    } as unknown as RTCPeerConnection,
    ws: {
      onopen: vi.fn(),
      onmessage: vi.fn(),
      onerror: vi.fn(),
      onclose: vi.fn(),
      close: wsClose,
    } as unknown as WebSocket,
    dataChannel: {
      close: dataChannelClose,
    } as unknown as RTCDataChannel,
    metaControlChannel: {
      close: metaChannelClose,
    } as unknown as RTCDataChannel,
    pointerMoveChannel: {
      close: pointerChannelClose,
    } as unknown as RTCDataChannel,
    remoteTracks: new Map(),
    remoteVideoStream: new MediaStream(),
    remoteAudioStream: new MediaStream(),
    pendingCandidates: [],
    ...overrides
  };

  return {
    connection,
    dataChannelClose,
    metaChannelClose,
    pointerChannelClose,
    peerClose,
    wsClose,
  };
}

describe('useCastSessionPersistence', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    window.__aylinkPersistedCastConnections = undefined;
    vi.useRealTimers();
  });

  it('persists the latest connection and disposes older ones', () => {
    const service = useCastSessionPersistence();
    const first = createPersistedConnection({ tabKey: 'tab-1' });
    const second = createPersistedConnection({ tabKey: 'tab-2' });

    service.persistCurrentConnection('tab-1', first.connection);
    service.persistCurrentConnection('tab-2', second.connection);

    expect(service.getPersistedConnection('tab-1')).toBeNull();
    expect(service.getPersistedConnection('tab-2')).toBe(second.connection);
    expect(first.dataChannelClose).toHaveBeenCalled();
    expect(first.peerClose).toHaveBeenCalled();
  });

  it('can keep other persisted connections for tab switching', () => {
    const service = useCastSessionPersistence();
    const first = createPersistedConnection({ tabKey: 'tab-1' });
    const second = createPersistedConnection({ tabKey: 'tab-2' });

    service.persistCurrentConnection('tab-1', first.connection);
    service.persistCurrentConnection('tab-2', second.connection, { disposeOtherConnections: false });

    expect(service.getPersistedConnection('tab-1')).toBe(first.connection);
    expect(service.getPersistedConnection('tab-2')).toBe(second.connection);
    expect(first.dataChannelClose).not.toHaveBeenCalled();
    expect(first.peerClose).not.toHaveBeenCalled();
  });

  it('clears persisted connections by tab key', () => {
    const service = useCastSessionPersistence();
    const connection = createPersistedConnection();

    service.persistCurrentConnection('tab-1', connection.connection);
    service.clearPersistedConnection('tab-1');

    expect(service.getPersistedConnection('tab-1')).toBeNull();
    expect(window.__aylinkPersistedCastConnections).toBeUndefined();
  });

  it('starts and stops heartbeat polling', async () => {
    vi.useFakeTimers();
    apiFetchMock.mockResolvedValue(new Response(null, { status: 200 }));

    const service = useCastSessionPersistence();
    service.startScrcpySessionHeartbeat('device-1', 'session-1');

    expect(apiFetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(15000);
    expect(apiFetchMock).toHaveBeenCalledTimes(2);

    service.stopScrcpySessionHeartbeat();
    await vi.advanceTimersByTimeAsync(30000);
    expect(apiFetchMock).toHaveBeenCalledTimes(2);
  });

  it('disposes all persisted connections', () => {
    const service = useCastSessionPersistence();
    const first = createPersistedConnection({ tabKey: 'tab-1' });
    const second = createPersistedConnection({ tabKey: 'tab-2' });

    window.__aylinkPersistedCastConnections = {
      'tab-1': first.connection,
      'tab-2': second.connection
    };

    service.disposeAllPersistedConnections();

    expect(window.__aylinkPersistedCastConnections).toBeUndefined();
    expect(first.wsClose).toHaveBeenCalled();
    expect(second.wsClose).toHaveBeenCalled();
  });
});
