export interface CastTab {
  key: string;
  deviceId: string;
  appPackageName: string;
  appDisplayName: string;
  deviceName: string;
  newDisplay: boolean;
}

type TrackKind = 'audio' | 'video';

export interface PersistedCastConnection {
  tabKey: string;
  deviceId: string;
  appPackageName: string;
  appDisplayName: string;
  newDisplay: boolean;
  sessionId: string;
  persistedAt: number;
  peerConnection: RTCPeerConnection;
  ws: WebSocket | null;
  dataChannel: RTCDataChannel | null;
  metaControlChannel: RTCDataChannel | null;
  pointerMoveChannel: RTCDataChannel | null;
  remoteTracks: Map<TrackKind, MediaStreamTrack>;
  remoteVideoStream: MediaStream;
  remoteAudioStream: MediaStream;
  pendingCandidates: RTCIceCandidateInit[];
}
