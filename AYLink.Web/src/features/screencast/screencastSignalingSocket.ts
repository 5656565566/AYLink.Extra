import { normalizeIceCandidate } from './iceCandidate';

export interface SignalErrorMessagePayload {
  type: 'error';
  code?: string;
  messageKey: string;
  message?: string;
  detail?: string;
  retryable?: boolean;
}

export interface WireScreencastSignalingSocketOptions {
  connectionId: number;
  socket: WebSocket;
  getIsCurrentConnection: () => boolean;
  getPeerConnection: () => RTCPeerConnection | null;
  getPendingCandidates: () => RTCIceCandidateInit[];
  setPendingCandidates: (candidates: RTCIceCandidateInit[]) => void;
  createSessionDescription: (message: RTCSessionDescriptionInit) => RTCSessionDescriptionInit;
  onInvalidSignalError: (message: unknown) => void;
  onSignalError: (message: SignalErrorMessagePayload) => void;
  onRemoteAnswerApplied: () => void;
  onSocketError: () => void;
  onSocketClosed: () => void;
}

export function isSignalErrorMessagePayload(payload: unknown): payload is SignalErrorMessagePayload {
  return payload !== null &&
    typeof payload === 'object' &&
    (payload as { type?: unknown }).type === 'error' &&
    typeof (payload as { messageKey?: unknown }).messageKey === 'string' &&
    (payload as { messageKey: string }).messageKey.length > 0;
}

export function wireScreencastSignalingSocket(options: WireScreencastSignalingSocketOptions): void {
  const { socket } = options;

  socket.onmessage = async (event) => {
    if (!options.getIsCurrentConnection()) {
      return;
    }

    const message = JSON.parse(event.data);
    if ((message as { type?: unknown })?.type === 'error') {
      if (!isSignalErrorMessagePayload(message)) {
        options.onInvalidSignalError(message);
        return;
      }

      options.onSignalError(message);
      return;
    }

    const peerConnection = options.getPeerConnection();
    if (message?.candidate && peerConnection) {
      const candidate = normalizeIceCandidate(message);
      if (candidate) {
        if (peerConnection.remoteDescription) {
          try {
            await peerConnection.addIceCandidate(candidate);
          } catch (error) {
            console.warn('Ignored ICE candidate:', candidate, error);
          }
        } else {
          options.getPendingCandidates().push(candidate);
        }
      }
    } else if (message?.sdp && peerConnection && message.type === 'answer') {
      await peerConnection.setRemoteDescription(options.createSessionDescription(message));
      options.onRemoteAnswerApplied();
      const pendingCandidates = options.getPendingCandidates();
      for (const candidate of pendingCandidates) {
        try {
          await peerConnection.addIceCandidate(candidate);
        } catch (error) {
          console.warn('Ignored queued ICE candidate:', candidate, error);
        }
      }
      options.setPendingCandidates([]);
    }
  };

  socket.onerror = () => {
    if (!options.getIsCurrentConnection()) {
      return;
    }
    options.onSocketError();
  };

  socket.onclose = () => {
    if (!options.getIsCurrentConnection()) {
      return;
    }
    options.onSocketClosed();
  };
}
