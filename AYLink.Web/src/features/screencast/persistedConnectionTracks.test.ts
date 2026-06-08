import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bindBackgroundRemoteTrack,
  wireBackgroundPersistedConnectionHandlers
} from './persistedConnectionTracks';
import type { PersistedCastConnection } from '../../types/screencast';

type TestTrackKind = 'audio' | 'video' | 'data';

interface TestMediaTrack extends MediaStreamTrack {
  kind: TestTrackKind;
  onended: (() => void) | null;
}

class TestMediaStream {
  private tracks: MediaStreamTrack[] = [];

  getTracks() {
    return [...this.tracks];
  }

  addTrack(track: MediaStreamTrack) {
    this.tracks.push(track);
  }

  removeTrack(track: MediaStreamTrack) {
    this.tracks = this.tracks.filter(item => item !== track);
  }
}

function createTrack(kind: TestTrackKind) {
  return {
    kind,
    readyState: 'live',
    onended: null
  } as TestMediaTrack;
}

function createTrackEvent(track: TestMediaTrack) {
  return {
    track,
    receiver: {},
    streams: []
  } as unknown as RTCTrackEvent;
}

function createPersistedConnection(overrides: Partial<PersistedCastConnection> = {}) {
  return {
    tabKey: 'tab-1',
    deviceId: 'device-1',
    appPackageName: '',
    appDisplayName: '',
    newDisplay: false,
    sessionId: 'session-1',
    persistedAt: Date.now(),
    peerConnection: {
      connectionState: 'connected',
      ontrack: null,
      onconnectionstatechange: null
    } as unknown as RTCPeerConnection,
    ws: null,
    dataChannel: null,
    metaControlChannel: null,
    pointerMoveChannel: null,
    remoteTracks: new Map(),
    remoteVideoStream: new MediaStream(),
    remoteAudioStream: new MediaStream(),
    pendingCandidates: [],
    ...overrides
  } as PersistedCastConnection;
}

describe('persistedConnectionTracks', () => {
  beforeEach(() => {
    vi.stubGlobal('MediaStream', TestMediaStream);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps video tracks that arrive while the screencast view is in the background', () => {
    const persisted = createPersistedConnection();
    const track = createTrack('video');

    bindBackgroundRemoteTrack(persisted, createTrackEvent(track));

    expect(persisted.remoteTracks.get('video')).toBe(track);
    expect(persisted.remoteVideoStream.getTracks()).toEqual([track]);
  });

  it('replaces stale background tracks of the same kind', () => {
    const persisted = createPersistedConnection();
    const firstTrack = createTrack('video');
    const secondTrack = createTrack('video');

    bindBackgroundRemoteTrack(persisted, createTrackEvent(firstTrack));
    bindBackgroundRemoteTrack(persisted, createTrackEvent(secondTrack));
    firstTrack.onended?.();

    expect(persisted.remoteTracks.get('video')).toBe(secondTrack);
    expect(persisted.remoteVideoStream.getTracks()).toEqual([secondTrack]);
  });

  it('clears the persisted stream when the active background track ends', () => {
    const persisted = createPersistedConnection();
    const track = createTrack('video');
    bindBackgroundRemoteTrack(persisted, createTrackEvent(track));

    track.onended?.();

    expect(persisted.remoteTracks.has('video')).toBe(false);
    expect(persisted.remoteVideoStream.getTracks()).toEqual([]);
  });

  it('wires peer handlers and disposes failed background connections', () => {
    const disposePersistedConnection = vi.fn();
    const persisted = createPersistedConnection({
      peerConnection: {
        connectionState: 'connected',
        ontrack: null,
        onconnectionstatechange: null
      } as unknown as RTCPeerConnection
    });
    const track = createTrack('audio');

    wireBackgroundPersistedConnectionHandlers(persisted, disposePersistedConnection);
    persisted.peerConnection.ontrack?.(createTrackEvent(track));

    expect(persisted.remoteTracks.get('audio')).toBe(track);
    expect(persisted.remoteAudioStream.getTracks()).toEqual([track]);

    Object.defineProperty(persisted.peerConnection, 'connectionState', { value: 'failed' });
    persisted.peerConnection.onconnectionstatechange?.(new Event('connectionstatechange'));

    expect(disposePersistedConnection).toHaveBeenCalledWith('tab-1');
  });

  it('ignores unsupported background track kinds', () => {
    const persisted = createPersistedConnection();

    bindBackgroundRemoteTrack(persisted, createTrackEvent(createTrack('data')));

    expect(persisted.remoteTracks.size).toBe(0);
    expect(persisted.remoteVideoStream.getTracks()).toEqual([]);
    expect(persisted.remoteAudioStream.getTracks()).toEqual([]);
  });
});
