import { describe, expect, it } from 'vitest';
import type { PersistedCastConnection } from '../../types/screencast';
import { createRestoredScreencastRuntimeState, isPersistedConnectionStale } from './screencastSessionRestore';

function createPersistedConnection(overrides: Partial<PersistedCastConnection> = {}): PersistedCastConnection {
  const peerConnection = {
    connectionState: 'connected'
  } as RTCPeerConnection;
  return {
    tabKey: 'tab-1',
    deviceId: 'device-1',
    appPackageName: '',
    appDisplayName: '',
    newDisplay: false,
    sessionId: 'session-1',
    persistedAt: 1000,
    peerConnection,
    ws: null,
    dataChannel: null,
    metaControlChannel: null,
    pointerMoveChannel: null,
    remoteTracks: new Map(),
    remoteVideoStream: new MediaStream(),
    remoteAudioStream: new MediaStream(),
    pendingCandidates: [],
    ...overrides
  };
}

describe('isPersistedConnectionStale', () => {
  it('keeps active persisted connections', () => {
    expect(isPersistedConnectionStale(createPersistedConnection(), 12000, 2000)).toBe(false);
  });

  it('rejects closing sockets and terminal peer states', () => {
    expect(isPersistedConnectionStale(createPersistedConnection({
      ws: { readyState: WebSocket.CLOSING } as WebSocket
    }), 12000, 2000)).toBe(true);

    expect(isPersistedConnectionStale(createPersistedConnection({
      peerConnection: { connectionState: 'failed' } as RTCPeerConnection
    }), 12000, 2000)).toBe(true);
  });

  it('rejects disconnected snapshots after the grace window', () => {
    expect(isPersistedConnectionStale(createPersistedConnection({
      peerConnection: { connectionState: 'disconnected' } as RTCPeerConnection,
      disconnectedAt: 1000
    }), 12000, 13000)).toBe(true);

    expect(isPersistedConnectionStale(createPersistedConnection({
      peerConnection: { connectionState: 'disconnected' } as RTCPeerConnection,
      disconnectedAt: 1000
    }), 12000, 12999)).toBe(false);
  });
});

describe('createRestoredScreencastRuntimeState', () => {
  it('copies mutable runtime collections from the persisted snapshot', () => {
    const track = { kind: 'video' } as MediaStreamTrack;
    const candidate = { candidate: 'candidate:1' };
    const persisted = createPersistedConnection({
      remoteTracks: new Map([['video', track]]),
      pendingCandidates: [candidate]
    });

    const restored = createRestoredScreencastRuntimeState(persisted);

    expect(restored.peerConnection).toBe(persisted.peerConnection);
    expect(restored.remoteVideoStream).toBe(persisted.remoteVideoStream);
    expect(restored.remoteTracks).toEqual(persisted.remoteTracks);
    expect(restored.remoteTracks).not.toBe(persisted.remoteTracks);
    expect(restored.pendingCandidates).toEqual([candidate]);
    expect(restored.pendingCandidates).not.toBe(persisted.pendingCandidates);
  });
});
