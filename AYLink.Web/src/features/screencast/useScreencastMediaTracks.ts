type RemoteTrackKind = 'audio' | 'video';

interface ScreencastMediaTracksOptions {
  remoteTracks: Map<RemoteTrackKind, MediaStreamTrack>;
  getVideoStream: () => MediaStream;
  setVideoStream: (stream: MediaStream) => void;
  getAudioStream: () => MediaStream;
  setAudioStream: (stream: MediaStream) => void;
  getVideoElement: () => HTMLVideoElement | null;
  getAudioElement: () => HTMLAudioElement | null;
  getPersistentAudioElement: () => HTMLAudioElement;
  getConnectionId: () => number;
  shouldReconnectOnVideoEnded: () => boolean;
  getDeviceId: () => string;
  getTabKey: () => string;
  getWebSocketReadyState: () => number | null;
  getPeerConnectionState: () => RTCPeerConnectionState | null;
  onVideoTrackBound: (connectionId: number) => void;
  onAudioTrackBound: () => void;
  onTrackChanged: () => void;
  onVideoTrackEnded: (connectionId: number) => void;
  logger?: Pick<Console, 'log' | 'warn'>;
}

function replaceSingleTrack(stream: MediaStream, track: MediaStreamTrack) {
  for (const existingTrack of stream.getTracks()) {
    stream.removeTrack(existingTrack);
  }

  stream.addTrack(track);
}

function applyLowLatencyTrackHints(event: RTCTrackEvent) {
  const receiver = event.receiver as RTCRtpReceiver & {
    playoutDelayHint?: number;
    jitterBufferTarget?: number | null;
  };

  if (event.track.kind === 'video') {
    event.track.contentHint = 'motion';
  }

  if ('playoutDelayHint' in receiver) {
    receiver.playoutDelayHint = 0;
  }

  if ('jitterBufferTarget' in receiver) {
    receiver.jitterBufferTarget = 0;
  }
}

export function useScreencastMediaTracks(options: ScreencastMediaTracksOptions) {
  const logger = options.logger ?? console;

  const bindVideoTrack = (event: RTCTrackEvent) => {
    const videoElement = options.getVideoElement();
    if (!videoElement) {
      return;
    }

    const videoStream = options.getVideoStream();
    replaceSingleTrack(videoStream, event.track);
    if (videoElement.srcObject !== videoStream) {
      videoElement.srcObject = videoStream;
    }
    options.onVideoTrackBound(options.getConnectionId());
  };

  const bindAudioTrack = (event: RTCTrackEvent) => {
    const backgroundAudioElement = options.getPersistentAudioElement();
    const audioStream = options.getAudioStream();
    replaceSingleTrack(audioStream, event.track);

    const audioElement = options.getAudioElement();
    if (audioElement && audioElement.srcObject !== audioStream) {
      audioElement.srcObject = audioStream;
    }
    if (backgroundAudioElement.srcObject !== audioStream) {
      backgroundAudioElement.srcObject = audioStream;
    }

    options.onAudioTrackBound();
  };

  const attachRemoteTrack = async (event: RTCTrackEvent) => {
    logger.log('[WebRTC] Track arrived:', event.track.kind, 'streams:', event.streams?.length || 0);

    if (event.track.kind !== 'audio' && event.track.kind !== 'video') {
      return;
    }

    applyLowLatencyTrackHints(event);

    const trackKind = event.track.kind;
    options.remoteTracks.set(trackKind, event.track);
    event.track.onended = () => {
      if (options.remoteTracks.get(trackKind) !== event.track) {
        return;
      }

      options.remoteTracks.delete(trackKind);
      if (trackKind === 'video') {
        options.setVideoStream(new MediaStream());
        const videoElement = options.getVideoElement();
        if (videoElement) {
          videoElement.srcObject = null;
        }
      } else {
        options.setAudioStream(new MediaStream());
        const audioElement = options.getAudioElement();
        if (audioElement) {
          audioElement.srcObject = null;
        }
        options.getPersistentAudioElement().srcObject = null;
      }
      options.onTrackChanged();

      if (trackKind === 'video' && options.shouldReconnectOnVideoEnded()) {
        const connectionId = options.getConnectionId();
        logger.warn('[WebRTC] Remote video track ended.', {
          deviceId: options.getDeviceId(),
          tabKey: options.getTabKey(),
          wsReadyState: options.getWebSocketReadyState(),
          peerConnectionState: options.getPeerConnectionState()
        });
        options.onVideoTrackEnded(connectionId);
      }
    };

    if (trackKind === 'video') {
      bindVideoTrack(event);
    } else {
      bindAudioTrack(event);
    }
    options.onTrackChanged();
  };

  const cleanupMediaElements = () => {
    const videoElement = options.getVideoElement();
    if (videoElement) {
      videoElement.pause();
      videoElement.srcObject = null;
    }

    const audioElement = options.getAudioElement();
    if (audioElement) {
      audioElement.pause();
      audioElement.srcObject = null;
    }

    const backgroundAudioElement = options.getPersistentAudioElement();
    backgroundAudioElement.pause();
    backgroundAudioElement.srcObject = null;
    options.remoteTracks.clear();
    options.setVideoStream(new MediaStream());
    options.setAudioStream(new MediaStream());
  };

  return {
    attachRemoteTrack,
    cleanupMediaElements
  };
}
