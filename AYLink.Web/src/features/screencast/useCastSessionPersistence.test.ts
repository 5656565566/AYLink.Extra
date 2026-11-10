import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiFetchMock = vi.fn();

vi.mock('../../utils/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

import { useCastSessionPersistence } from './useCastSessionPersistence';
import type { PersistedCastConnection } from '../../types/screencast';
import { useAppSettings } from '../../services/appSettings';

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
    remoteVideoStream: { getTracks: () => [] } as unknown as MediaStream,
    remoteAudioStream: { getTracks: () => [] } as unknown as MediaStream,
    audioElement: document.createElement('audio'),
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
    useAppSettings().setActiveCastSessionCount(1);
    window.__aylinkPersistedCastConnections = undefined;
    vi.useRealTimers();
  });

  it('keeps only the most recently viewed background session when no viewer is active', () => {
    const service = useCastSessionPersistence();
    const first = createPersistedConnection({ tabKey: 'tab-1' });
    const second = createPersistedConnection({ tabKey: 'tab-2' });

    service.setViewingTab('tab-1');
    service.persistCurrentConnection('tab-1', first.connection);
    service.persistCurrentConnection('tab-2', second.connection);
    service.setViewingTab('tab-2');
    service.setViewingTab('');
    service.enforceActiveSessionLimit();

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
    service.setViewingTab('tab-2');
    service.persistCurrentConnection('tab-2', second.connection);

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

  it('evicts the least recently viewed stream and protects the viewer when the limit becomes zero', () => {
    const service = useCastSessionPersistence();
    const first = createPersistedConnection({ tabKey: 'a' });
    const second = createPersistedConnection({ tabKey: 'b' });
    const third = createPersistedConnection({ tabKey: 'c' });
    service.setViewingTab('a');
    service.persistCurrentConnection('a', first.connection);
    service.setViewingTab('b');
    service.persistCurrentConnection('b', second.connection);
    service.setViewingTab('c');
    service.persistCurrentConnection('c', third.connection);
    expect(first.peerClose).toHaveBeenCalledOnce();
    expect(second.peerClose).not.toHaveBeenCalled();
    useAppSettings().setActiveCastSessionCount(0);
    service.enforceActiveSessionLimit();
    expect(second.peerClose).toHaveBeenCalledOnce();
    expect(third.peerClose).not.toHaveBeenCalled();
    expect(apiFetchMock).not.toHaveBeenCalled();
    service.disposeAllPersistedConnections();
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

  it('allows only the viewed tab to sound and mutes every player when leaving the viewer', () => {
    const service = useCastSessionPersistence();
    service.setViewingTab('a');
    const first = service.getPersistentAudioElement('a');
    const second = service.getPersistentAudioElement('b');
    expect([first.muted, second.muted]).toEqual([false, true]);
    service.setViewingTab('b');
    expect([first.muted, second.muted]).toEqual([true, false]);
    service.setAudioMuted(true);
    expect([first.muted, second.muted]).toEqual([true, true]);
    service.setAudioMuted(false);
    expect([first.muted, second.muted]).toEqual([true, false]);
    service.setViewingTab('');
    expect([first.muted, second.muted]).toEqual([true, true]);
  });
});
