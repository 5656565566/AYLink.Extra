import type { PersistedCastConnection } from '../../types/screencast';

function replacePersistedTrack(stream: MediaStream, track: MediaStreamTrack) {
  for (const existingTrack of stream.getTracks()) {
    if (existingTrack.kind === track.kind) {
      stream.removeTrack(existingTrack);
    }
  }

  stream.addTrack(track);
}

export function bindBackgroundRemoteTrack(persisted: PersistedCastConnection, event: RTCTrackEvent) {
  if (event.track.kind !== 'audio' && event.track.kind !== 'video') {
    return;
  }

  const trackKind = event.track.kind;
  persisted.remoteTracks.set(trackKind, event.track);
  if (trackKind === 'video') {
    replacePersistedTrack(persisted.remoteVideoStream, event.track);
  } else {
    replacePersistedTrack(persisted.remoteAudioStream, event.track);
  }

  event.track.onended = () => {
    if (persisted.remoteTracks.get(trackKind) !== event.track) {
      return;
    }

    persisted.remoteTracks.delete(trackKind);
    if (trackKind === 'video') {
      persisted.remoteVideoStream = new MediaStream();
    } else {
      persisted.remoteAudioStream = new MediaStream();
    }
  };
}

export function wireBackgroundPersistedConnectionHandlers(
  persisted: PersistedCastConnection,
  disposePersistedConnection: (tabKey: string) => void
) {
  persisted.peerConnection.ontrack = (event) => {
    bindBackgroundRemoteTrack(persisted, event);
  };
  persisted.peerConnection.onconnectionstatechange = () => {
    if (persisted.peerConnection.connectionState === 'closed' || persisted.peerConnection.connectionState === 'failed') {
      disposePersistedConnection(persisted.tabKey);
    }
  };
}
