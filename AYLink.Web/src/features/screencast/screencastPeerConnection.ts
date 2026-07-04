export interface WireScreencastPeerConnectionOptions {
  peerConnection: RTCPeerConnection;
  getIsCurrentConnection: () => boolean;
  getSignalSocket: () => WebSocket | null;
  hasVideoTrack: () => boolean;
  onRemoteTrack: (event: RTCTrackEvent) => void | Promise<void>;
  onPeerStateChanged: (state: RTCPeerConnectionState) => void;
  onPeerConnected: () => void;
  onPeerConnectedWithoutVideo: () => void;
  onPeerRecoverableFailure: (state: RTCPeerConnectionState) => void;
  onPeerClosed: () => void;
  onPeerStateSettled: () => void;
  onIceStateChanged: (state: RTCIceConnectionState) => void;
  onIceConnected: (state: Extract<RTCIceConnectionState, 'connected' | 'completed'>) => void;
  onIceConnectedWithoutVideo: (state: Extract<RTCIceConnectionState, 'connected' | 'completed'>) => void;
  onIceUnstable: (state: RTCIceConnectionState) => void;
  onIceClosed: () => void;
  onDataChannel: (channel: RTCDataChannel) => void;
}

export function wireScreencastPeerConnection(options: WireScreencastPeerConnectionOptions): void {
  const { peerConnection } = options;

  peerConnection.ontrack = (event) => {
    if (!options.getIsCurrentConnection()) {
      return;
    }
    console.log('[WebRTC] ontrack fired:', event.track.kind);
    void options.onRemoteTrack(event);
  };

  peerConnection.onicecandidate = (event) => {
    if (!options.getIsCurrentConnection()) {
      return;
    }
    const socket = options.getSignalSocket();
    if (event.candidate && socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(event.candidate));
    }
  };

  peerConnection.onconnectionstatechange = () => {
    if (!options.getIsCurrentConnection()) {
      return;
    }

    const state = peerConnection.connectionState;
    options.onPeerStateChanged(state);

    if (state === 'connected') {
      options.onPeerConnected();
      if (!options.hasVideoTrack()) {
        options.onPeerConnectedWithoutVideo();
      }
      options.onPeerStateSettled();
      return;
    }

    if (state === 'closed') {
      options.onPeerClosed();
      return;
    }

    if (state === 'failed' || state === 'disconnected') {
      options.onPeerRecoverableFailure(state);
      return;
    }

    options.onPeerStateSettled();
  };

  peerConnection.oniceconnectionstatechange = () => {
    if (!options.getIsCurrentConnection()) {
      return;
    }

    const state = peerConnection.iceConnectionState;
    options.onIceStateChanged(state);

    if (state === 'connected' || state === 'completed') {
      options.onIceConnected(state);
      if (!options.hasVideoTrack()) {
        options.onIceConnectedWithoutVideo(state);
      }
      return;
    }

    options.onIceUnstable(state);
    if (state === 'closed') {
      options.onIceClosed();
    }
  };

  peerConnection.ondatachannel = (event) => {
    if (!options.getIsCurrentConnection()) {
      return;
    }
    options.onDataChannel(event.channel);
  };
}
