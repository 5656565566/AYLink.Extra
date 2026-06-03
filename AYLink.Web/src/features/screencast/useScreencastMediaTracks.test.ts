import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useScreencastMediaTracks } from './useScreencastMediaTracks';

type TestTrackKind = 'audio' | 'video' | 'data';

interface TestMediaTrack extends MediaStreamTrack {
  kind: TestTrackKind;
  contentHint: string;
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

function createMediaElement<T extends HTMLMediaElement>() {
  return {
    srcObject: null,
    pause: vi.fn()
  } as unknown as T;
}

function createTrack(kind: TestTrackKind) {
  return {
    kind,
    contentHint: '',
    readyState: 'live',
    onended: null
  } as TestMediaTrack;
}

function createTrackEvent(track: TestMediaTrack) {
  return {
    track,
    receiver: {
      playoutDelayHint: 1,
      jitterBufferTarget: 1
    },
    streams: []
  } as unknown as RTCTrackEvent;
}

function createHarness() {
  let connectionId = 7;
  let videoStream = new MediaStream();
  let audioStream = new MediaStream();
  const remoteTracks = new Map<'audio' | 'video', MediaStreamTrack>();
  const videoElement = createMediaElement<HTMLVideoElement>();
  const audioElement = createMediaElement<HTMLAudioElement>();
  const backgroundAudioElement = createMediaElement<HTMLAudioElement>();
  const onVideoTrackBound = vi.fn();
  const onAudioTrackBound = vi.fn();
  const onTrackChanged = vi.fn();
  const onVideoTrackEnded = vi.fn();
  const logger = {
    log: vi.fn(),
    warn: vi.fn()
  };

  const mediaTracks = useScreencastMediaTracks({
    remoteTracks,
    getVideoStream: () => videoStream,
    setVideoStream: (stream) => {
      videoStream = stream;
    },
    getAudioStream: () => audioStream,
    setAudioStream: (stream) => {
      audioStream = stream;
    },
    getVideoElement: () => videoElement,
    getAudioElement: () => audioElement,
    getPersistentAudioElement: () => backgroundAudioElement,
    getConnectionId: () => connectionId,
    shouldReconnectOnVideoEnded: () => true,
    getDeviceId: () => 'device-1',
    getTabKey: () => 'tab-1',
    getWebSocketReadyState: () => WebSocket.OPEN,
    getPeerConnectionState: () => 'connected',
    onVideoTrackBound,
    onAudioTrackBound,
    onTrackChanged,
    onVideoTrackEnded,
    logger
  });

  return {
    mediaTracks,
    remoteTracks,
    videoElement,
    audioElement,
    backgroundAudioElement,
    getVideoStream: () => videoStream,
    getAudioStream: () => audioStream,
    onVideoTrackBound,
    onAudioTrackBound,
    onTrackChanged,
    onVideoTrackEnded,
    logger,
    setConnectionId: (nextConnectionId: number) => {
      connectionId = nextConnectionId;
    }
  };
}

describe('useScreencastMediaTracks', () => {
  beforeEach(() => {
    vi.stubGlobal('MediaStream', TestMediaStream);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('binds a video track to the remote video stream and applies low latency hints', async () => {
    const harness = createHarness();
    const track = createTrack('video');
    const event = createTrackEvent(track);

    await harness.mediaTracks.attachRemoteTrack(event);

    expect(harness.remoteTracks.get('video')).toBe(track);
    expect(harness.getVideoStream().getTracks()).toEqual([track]);
    expect(harness.videoElement.srcObject).toBe(harness.getVideoStream());
    expect(track.contentHint).toBe('motion');
    expect((event.receiver as RTCRtpReceiver & { playoutDelayHint?: number }).playoutDelayHint).toBe(0);
    expect((event.receiver as RTCRtpReceiver & { jitterBufferTarget?: number | null }).jitterBufferTarget).toBe(0);
    expect(harness.onVideoTrackBound).toHaveBeenCalledWith(7);
    expect(harness.onTrackChanged).toHaveBeenCalledTimes(1);
  });

  it('binds an audio track to the visible and persistent audio elements', async () => {
    const harness = createHarness();
    const track = createTrack('audio');

    await harness.mediaTracks.attachRemoteTrack(createTrackEvent(track));

    expect(harness.remoteTracks.get('audio')).toBe(track);
    expect(harness.getAudioStream().getTracks()).toEqual([track]);
    expect(harness.audioElement.srcObject).toBe(harness.getAudioStream());
    expect(harness.backgroundAudioElement.srcObject).toBe(harness.getAudioStream());
    expect(harness.onAudioTrackBound).toHaveBeenCalledTimes(1);
    expect(harness.onTrackChanged).toHaveBeenCalledTimes(1);
  });

  it('clears a video track and requests recovery when the active video track ends', async () => {
    const harness = createHarness();
    const track = createTrack('video');
    await harness.mediaTracks.attachRemoteTrack(createTrackEvent(track));
    harness.setConnectionId(11);

    track.onended?.();

    expect(harness.remoteTracks.has('video')).toBe(false);
    expect(harness.videoElement.srcObject).toBeNull();
    expect(harness.getVideoStream().getTracks()).toEqual([]);
    expect(harness.onTrackChanged).toHaveBeenCalledTimes(2);
    expect(harness.logger.warn).toHaveBeenCalledWith('[WebRTC] Remote video track ended.', expect.objectContaining({
      deviceId: 'device-1',
      tabKey: 'tab-1',
      wsReadyState: WebSocket.OPEN,
      peerConnectionState: 'connected'
    }));
    expect(harness.onVideoTrackEnded).toHaveBeenCalledWith(11);
  });

  it('ignores ended events from stale replaced tracks', async () => {
    const harness = createHarness();
    const firstTrack = createTrack('video');
    const secondTrack = createTrack('video');
    await harness.mediaTracks.attachRemoteTrack(createTrackEvent(firstTrack));
    await harness.mediaTracks.attachRemoteTrack(createTrackEvent(secondTrack));

    firstTrack.onended?.();

    expect(harness.remoteTracks.get('video')).toBe(secondTrack);
    expect(harness.videoElement.srcObject).toBe(harness.getVideoStream());
    expect(harness.onVideoTrackEnded).not.toHaveBeenCalled();
  });

  it('cleans up media elements, tracks, and remote streams', async () => {
    const harness = createHarness();
    await harness.mediaTracks.attachRemoteTrack(createTrackEvent(createTrack('video')));
    await harness.mediaTracks.attachRemoteTrack(createTrackEvent(createTrack('audio')));

    harness.mediaTracks.cleanupMediaElements();

    expect(harness.videoElement.pause).toHaveBeenCalledTimes(1);
    expect(harness.audioElement.pause).toHaveBeenCalledTimes(1);
    expect(harness.backgroundAudioElement.pause).toHaveBeenCalledTimes(1);
    expect(harness.videoElement.srcObject).toBeNull();
    expect(harness.audioElement.srcObject).toBeNull();
    expect(harness.backgroundAudioElement.srcObject).toBeNull();
    expect(harness.remoteTracks.size).toBe(0);
    expect(harness.getVideoStream().getTracks()).toEqual([]);
    expect(harness.getAudioStream().getTracks()).toEqual([]);
  });

  it('ignores unsupported track kinds', async () => {
    const harness = createHarness();

    await harness.mediaTracks.attachRemoteTrack(createTrackEvent(createTrack('data')));

    expect(harness.remoteTracks.size).toBe(0);
    expect(harness.onTrackChanged).not.toHaveBeenCalled();
  });
});
