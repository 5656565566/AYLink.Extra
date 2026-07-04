import { describe, expect, it, vi } from 'vitest';
import { isSignalErrorMessagePayload, wireScreencastSignalingSocket } from './screencastSignalingSocket';

function createSocket() {
  return {
    onmessage: null,
    onerror: null,
    onclose: null
  } as unknown as WebSocket;
}

function emitMessage(socket: WebSocket, data: unknown) {
  return socket.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
}

describe('isSignalErrorMessagePayload', () => {
  it('accepts signaling errors with a message key', () => {
    expect(isSignalErrorMessagePayload({ type: 'error', messageKey: 'Screencast.Error' })).toBe(true);
  });

  it('rejects malformed signaling errors', () => {
    expect(isSignalErrorMessagePayload({ type: 'error', messageKey: '' })).toBe(false);
    expect(isSignalErrorMessagePayload({ type: 'error' })).toBe(false);
  });
});

describe('wireScreencastSignalingSocket', () => {
  it('queues ICE candidates until the remote description is applied', async () => {
    const socket = createSocket();
    const pendingCandidates: RTCIceCandidateInit[] = [];
    const peerConnection = {
      remoteDescription: null,
      addIceCandidate: vi.fn()
    } as unknown as RTCPeerConnection;

    wireScreencastSignalingSocket({
      connectionId: 1,
      socket,
      getIsCurrentConnection: () => true,
      getPeerConnection: () => peerConnection,
      getPendingCandidates: () => pendingCandidates,
      setPendingCandidates: vi.fn(),
      createSessionDescription: (message) => message,
      onInvalidSignalError: vi.fn(),
      onSignalError: vi.fn(),
      onRemoteAnswerApplied: vi.fn(),
      onSocketError: vi.fn(),
      onSocketClosed: vi.fn()
    });

    await emitMessage(socket, { candidate: '1 1 udp 1 127.0.0.1 9 typ host' });

    expect(pendingCandidates).toEqual([{ candidate: 'candidate:1 1 udp 1 127.0.0.1 9 typ host', sdpMLineIndex: 0 }]);
    expect(peerConnection.addIceCandidate).not.toHaveBeenCalled();
  });

  it('applies answers and flushes queued candidates', async () => {
    const socket = createSocket();
    const queuedCandidate = { candidate: 'candidate:queued', sdpMLineIndex: 0 };
    let pendingCandidates: RTCIceCandidateInit[] = [queuedCandidate];
    const setPendingCandidates = vi.fn((next: RTCIceCandidateInit[]) => {
      pendingCandidates = next;
    });
    const onRemoteAnswerApplied = vi.fn();
    const peerConnection = {
      remoteDescription: null,
      setRemoteDescription: vi.fn(async () => undefined),
      addIceCandidate: vi.fn(async () => undefined)
    } as unknown as RTCPeerConnection;

    wireScreencastSignalingSocket({
      connectionId: 1,
      socket,
      getIsCurrentConnection: () => true,
      getPeerConnection: () => peerConnection,
      getPendingCandidates: () => pendingCandidates,
      setPendingCandidates,
      createSessionDescription: (message) => ({ ...message, sdp: `${message.sdp}-wrapped` }),
      onInvalidSignalError: vi.fn(),
      onSignalError: vi.fn(),
      onRemoteAnswerApplied,
      onSocketError: vi.fn(),
      onSocketClosed: vi.fn()
    });

    await emitMessage(socket, { type: 'answer', sdp: 'answer-sdp' });

    expect(peerConnection.setRemoteDescription).toHaveBeenCalledWith({ type: 'answer', sdp: 'answer-sdp-wrapped' });
    expect(onRemoteAnswerApplied).toHaveBeenCalled();
    expect(peerConnection.addIceCandidate).toHaveBeenCalledWith(queuedCandidate);
    expect(setPendingCandidates).toHaveBeenCalledWith([]);
  });

  it('routes signaling error payloads', async () => {
    const socket = createSocket();
    const onSignalError = vi.fn();
    const onInvalidSignalError = vi.fn();

    wireScreencastSignalingSocket({
      connectionId: 1,
      socket,
      getIsCurrentConnection: () => true,
      getPeerConnection: () => null,
      getPendingCandidates: () => [],
      setPendingCandidates: vi.fn(),
      createSessionDescription: (message) => message,
      onInvalidSignalError,
      onSignalError,
      onRemoteAnswerApplied: vi.fn(),
      onSocketError: vi.fn(),
      onSocketClosed: vi.fn()
    });

    await emitMessage(socket, { type: 'error', messageKey: 'Screencast.Error', detail: 'detail' });
    await emitMessage(socket, { type: 'error' });

    expect(onSignalError).toHaveBeenCalledWith({ type: 'error', messageKey: 'Screencast.Error', detail: 'detail' });
    expect(onInvalidSignalError).toHaveBeenCalledWith({ type: 'error' });
  });

  it('ignores stale sockets and routes active close/error events', () => {
    const socket = createSocket();
    let isCurrent = false;
    const onSocketError = vi.fn();
    const onSocketClosed = vi.fn();

    wireScreencastSignalingSocket({
      connectionId: 1,
      socket,
      getIsCurrentConnection: () => isCurrent,
      getPeerConnection: () => null,
      getPendingCandidates: () => [],
      setPendingCandidates: vi.fn(),
      createSessionDescription: (message) => message,
      onInvalidSignalError: vi.fn(),
      onSignalError: vi.fn(),
      onRemoteAnswerApplied: vi.fn(),
      onSocketError,
      onSocketClosed
    });

    socket.onerror?.({} as Event);
    socket.onclose?.({} as CloseEvent);
    isCurrent = true;
    socket.onerror?.({} as Event);
    socket.onclose?.({} as CloseEvent);

    expect(onSocketError).toHaveBeenCalledTimes(1);
    expect(onSocketClosed).toHaveBeenCalledTimes(1);
  });
});
