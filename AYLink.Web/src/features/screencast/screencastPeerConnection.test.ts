import { describe, expect, it, vi } from 'vitest';
import { wireScreencastPeerConnection, type WireScreencastPeerConnectionOptions } from './screencastPeerConnection';

interface MockPeerConnection extends RTCPeerConnection {
  connectionState: RTCPeerConnectionState;
  iceConnectionState: RTCIceConnectionState;
}

function createPeerConnection(): MockPeerConnection {
  return {
    connectionState: 'new',
    iceConnectionState: 'new',
    ontrack: null,
    onicecandidate: null,
    onconnectionstatechange: null,
    oniceconnectionstatechange: null,
    ondatachannel: null
  } as MockPeerConnection;
}

function createOptions(overrides: Partial<WireScreencastPeerConnectionOptions> = {}): WireScreencastPeerConnectionOptions {
  const peerConnection = overrides.peerConnection ?? createPeerConnection();
  return {
    peerConnection,
    getIsCurrentConnection: () => true,
    getSignalSocket: () => null,
    hasVideoTrack: () => true,
    onRemoteTrack: vi.fn(),
    onPeerStateChanged: vi.fn(),
    onPeerConnected: vi.fn(),
    onPeerConnectedWithoutVideo: vi.fn(),
    onPeerRecoverableFailure: vi.fn(),
    onPeerClosed: vi.fn(),
    onPeerStateSettled: vi.fn(),
    onIceStateChanged: vi.fn(),
    onIceConnected: vi.fn(),
    onIceConnectedWithoutVideo: vi.fn(),
    onIceUnstable: vi.fn(),
    onIceClosed: vi.fn(),
    onDataChannel: vi.fn(),
    ...overrides
  };
}

describe('wireScreencastPeerConnection', () => {
  it('ignores events from stale connections', () => {
    const peerConnection = createPeerConnection();
    const onPeerStateChanged = vi.fn();
    wireScreencastPeerConnection(createOptions({
      peerConnection,
      getIsCurrentConnection: () => false,
      onPeerStateChanged
    }));

    peerConnection.connectionState = 'connected';
    peerConnection.onconnectionstatechange?.(new Event('connectionstatechange'));

    expect(onPeerStateChanged).not.toHaveBeenCalled();
  });

  it('sends local ICE candidates over an open signaling socket', () => {
    const peerConnection = createPeerConnection();
    const send = vi.fn();
    const socket = { readyState: WebSocket.OPEN, send } as unknown as WebSocket;
    const candidate = { candidate: 'candidate:local' } as RTCIceCandidate;
    wireScreencastPeerConnection(createOptions({
      peerConnection,
      getSignalSocket: () => socket
    }));

    peerConnection.onicecandidate?.({ candidate } as RTCPeerConnectionIceEvent);

    expect(send).toHaveBeenCalledWith(JSON.stringify(candidate));
  });

  it('routes connected peer state and missing video separately', () => {
    const peerConnection = createPeerConnection();
    const onPeerConnected = vi.fn();
    const onPeerConnectedWithoutVideo = vi.fn();
    wireScreencastPeerConnection(createOptions({
      peerConnection,
      hasVideoTrack: () => false,
      onPeerConnected,
      onPeerConnectedWithoutVideo
    }));

    peerConnection.connectionState = 'connected';
    peerConnection.onconnectionstatechange?.(new Event('connectionstatechange'));

    expect(onPeerConnected).toHaveBeenCalled();
    expect(onPeerConnectedWithoutVideo).toHaveBeenCalled();
  });

  it('settles stable peer states so owners can persist connection snapshots', () => {
    const peerConnection = createPeerConnection();
    const onPeerStateSettled = vi.fn();
    wireScreencastPeerConnection(createOptions({ peerConnection, onPeerStateSettled }));

    peerConnection.connectionState = 'connecting';
    peerConnection.onconnectionstatechange?.(new Event('connectionstatechange'));

    expect(onPeerStateSettled).toHaveBeenCalled();
  });

  it('routes failed and closed peer states to different callbacks', () => {
    const peerConnection = createPeerConnection();
    const onPeerRecoverableFailure = vi.fn();
    const onPeerClosed = vi.fn();
    wireScreencastPeerConnection(createOptions({ peerConnection, onPeerRecoverableFailure, onPeerClosed }));

    peerConnection.connectionState = 'failed';
    peerConnection.onconnectionstatechange?.(new Event('connectionstatechange'));
    peerConnection.connectionState = 'closed';
    peerConnection.onconnectionstatechange?.(new Event('connectionstatechange'));

    expect(onPeerRecoverableFailure).toHaveBeenCalledWith('failed');
    expect(onPeerClosed).toHaveBeenCalled();
  });

  it('routes ICE connected-without-video and closed states', () => {
    const peerConnection = createPeerConnection();
    const onIceConnected = vi.fn();
    const onIceConnectedWithoutVideo = vi.fn();
    const onIceClosed = vi.fn();
    wireScreencastPeerConnection(createOptions({
      peerConnection,
      hasVideoTrack: () => false,
      onIceConnected,
      onIceConnectedWithoutVideo,
      onIceClosed
    }));

    peerConnection.iceConnectionState = 'connected';
    peerConnection.oniceconnectionstatechange?.(new Event('iceconnectionstatechange'));
    peerConnection.iceConnectionState = 'closed';
    peerConnection.oniceconnectionstatechange?.(new Event('iceconnectionstatechange'));

    expect(onIceConnected).toHaveBeenCalledWith('connected');
    expect(onIceConnectedWithoutVideo).toHaveBeenCalledWith('connected');
    expect(onIceClosed).toHaveBeenCalled();
  });

  it('passes remote tracks and data channels to the owner', () => {
    const peerConnection = createPeerConnection();
    const onRemoteTrack = vi.fn();
    const onDataChannel = vi.fn();
    const track = { kind: 'video' } as MediaStreamTrack;
    const channel = { label: 'control' } as RTCDataChannel;
    wireScreencastPeerConnection(createOptions({ peerConnection, onRemoteTrack, onDataChannel }));

    peerConnection.ontrack?.({ track } as RTCTrackEvent);
    peerConnection.ondatachannel?.({ channel } as RTCDataChannelEvent);

    expect(onRemoteTrack).toHaveBeenCalledWith({ track });
    expect(onDataChannel).toHaveBeenCalledWith(channel);
  });
});
