import type { PersistedCastConnection } from '../../types/screencast';

export interface RestoredScreencastRuntimeState {
  peerConnection: RTCPeerConnection;
  ws: WebSocket | null;
  dataChannel: RTCDataChannel | null;
  metaControlChannel: RTCDataChannel | null;
  pointerMoveChannel: RTCDataChannel | null;
  pendingCandidates: RTCIceCandidateInit[];
  remoteTracks: Map<'audio' | 'video', MediaStreamTrack>;
  remoteVideoStream: MediaStream;
  remoteAudioStream: MediaStream;
  sessionId: string;
}

export function isPersistedConnectionStale(persisted: PersistedCastConnection, staleDisconnectedGraceMs: number, now = Date.now()): boolean {
  const peerConnectionState = persisted.peerConnection.connectionState;
  return (persisted.ws !== null && persisted.ws.readyState >= WebSocket.CLOSING)
    || peerConnectionState === 'closed'
    || peerConnectionState === 'failed'
    || (peerConnectionState === 'disconnected'
      && now - (persisted.disconnectedAt ?? persisted.persistedAt) >= staleDisconnectedGraceMs);
}

export function createRestoredScreencastRuntimeState(persisted: PersistedCastConnection): RestoredScreencastRuntimeState {
  return {
    peerConnection: persisted.peerConnection,
    ws: persisted.ws,
    dataChannel: persisted.dataChannel,
    metaControlChannel: persisted.metaControlChannel,
    pointerMoveChannel: persisted.pointerMoveChannel,
    pendingCandidates: [...persisted.pendingCandidates],
    remoteTracks: new Map(persisted.remoteTracks),
    remoteVideoStream: persisted.remoteVideoStream,
    remoteAudioStream: persisted.remoteAudioStream,
    sessionId: persisted.sessionId ?? ''
  };
}
