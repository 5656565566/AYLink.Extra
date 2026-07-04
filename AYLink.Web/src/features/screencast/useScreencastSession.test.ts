import { ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { createCastConnectionSchedulerState } from './connectionScheduler';
import { useScreencastSession, type UseScreencastSessionOptions } from './useScreencastSession';
import type { PersistedCastConnection } from '../../types/screencast';

function createResponse(payload: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: vi.fn(async () => payload)
  } as unknown as Response;
}

function createPeerConnection(state: RTCPeerConnectionState = 'connected') {
  return {
    connectionState: state,
    close: vi.fn()
  } as unknown as RTCPeerConnection;
}

function createChannel(label: string) {
  return {
    label,
    close: vi.fn()
  } as unknown as RTCDataChannel;
}

function createPersistedConnection(overrides: Partial<PersistedCastConnection> = {}): PersistedCastConnection {
  return {
    tabKey: 'tab-1',
    deviceId: 'device-1',
    appPackageName: '',
    appDisplayName: '',
    newDisplay: false,
    sessionId: 'session-1',
    persistedAt: 1000,
    peerConnection: createPeerConnection('connected'),
    ws: null,
    dataChannel: createChannel('control'),
    metaControlChannel: createChannel('control-meta'),
    pointerMoveChannel: createChannel('pointer-move'),
    remoteTracks: new Map(),
    remoteVideoStream: new MediaStream(),
    remoteAudioStream: new MediaStream(),
    pendingCandidates: [],
    ...overrides
  };
}

function createHarness(overrides: Partial<UseScreencastSessionOptions> = {}) {
  const runtime = {
    peerConnection: null as RTCPeerConnection | null,
    ws: null as WebSocket | null,
    dataChannel: null as RTCDataChannel | null,
    metaControlChannel: null as RTCDataChannel | null,
    pointerMoveChannel: null as RTCDataChannel | null,
    pendingCandidates: [] as RTCIceCandidateInit[],
    remoteTracks: new Map<'audio' | 'video', MediaStreamTrack>(),
    remoteVideoStream: new MediaStream(),
    remoteAudioStream: new MediaStream(),
    currentScrcpySessionId: '',
    activeConnectionId: 0,
    isIceRestartInFlight: false,
    lastDisplayResizeRequest: null as { width: number; height: number } | null
  };
  const schedulerState = createCastConnectionSchedulerState();
  const videoElement = { srcObject: null, pause: vi.fn() } as unknown as HTMLVideoElement;
  const audioElement = { srcObject: null, pause: vi.fn() } as unknown as HTMLAudioElement;
  const backgroundAudioElement = { srcObject: null } as unknown as HTMLAudioElement;
  const persistedConnections = new Map<string, PersistedCastConnection>();
  const socket = {
    onopen: null,
    onclose: null,
    send: vi.fn(),
    close: vi.fn()
  } as unknown as WebSocket;
  const previousWebSocket = globalThis.WebSocket;
  const WebSocketMock = vi.fn(function WebSocketMock() {
    return socket;
  });
  vi.stubGlobal('WebSocket', WebSocketMock);
  Object.assign(WebSocketMock, { OPEN: 1, CLOSING: 2 });

  const options: UseScreencastSessionOptions = {
    state: {
      isConnected: ref(false),
      isConnecting: ref(false),
      status: ref(''),
      videoStream: runtime.remoteVideoStream,
      audioStream: runtime.remoteAudioStream
    },
    controls: { sendAndroidCommand: vi.fn() },
    refs: {
      getStageElement: () => null,
      getVideoElement: () => videoElement,
      getAudioElement: () => audioElement
    },
    runtime,
    schedulerState,
    getActiveTabKey: () => 'tab-1',
    getDeviceId: () => 'device-1',
    getAppPackageName: () => '',
    getAppDisplayName: () => '',
    getIsNewDisplayMode: () => false,
    getCurrentStatusText: (key) => key,
    getAccessToken: () => 'token',
    redirectToLogin: vi.fn(),
    hasLiveConnection: () => !!runtime.peerConnection && runtime.peerConnection.connectionState !== 'closed',
    getSessionReleaseTarget: () => ({ deviceId: 'device-1', sessionId: '' }),
    postScrcpySessionAction: vi.fn(),
    stopScrcpySessionHeartbeat: vi.fn(),
    startScrcpySessionHeartbeat: vi.fn(),
    disposeAllPersistedConnections: vi.fn(() => persistedConnections.clear()),
    getPersistedConnection: (tabKey) => persistedConnections.get(tabKey) ?? null,
    disposePersistedConnection: vi.fn((tabKey) => persistedConnections.delete(tabKey)),
    persistCastConnectionSnapshot: vi.fn((tabKey, snapshot) => persistedConnections.set(tabKey, snapshot)),
    clearPersistedConnection: vi.fn((tabKey = 'tab-1') => persistedConnections.delete(tabKey)),
    wireBackgroundPersistedConnectionHandlers: vi.fn(),
    staleDisconnectedGraceMs: 12000,
    buildSignalWebSocketBaseUrl: () => 'ws://localhost/webrtc',
    requestSignalTicket: vi.fn(async () => ({ ticketResponse: createResponse({ sessionId: 'session-1', ticket: 'ticket 1' }) })),
    loadRtcConfiguration: vi.fn(async () => ({})),
    createPeerOfferSession: vi.fn(async (_configuration, offerOptions) => {
      const offerSession = {
        peerConnection: createPeerConnection('new'),
        channels: {
          controlChannel: createChannel('control'),
          metaControlChannel: createChannel('control-meta'),
          pointerMoveChannel: createChannel('pointer-move')
        },
        localDescription: { type: 'offer', sdp: 'offer-sdp' } as RTCSessionDescription
      };
      offerOptions?.beforeSetLocalDescription?.({
        peerConnection: offerSession.peerConnection,
        channels: offerSession.channels
      });
      return offerSession;
    }),
    wirePeerConnectionEventHandlers: vi.fn(),
    wireWebSocketEventHandlers: vi.fn(),
    setupControlChannel: vi.fn(),
    setupMetaControlChannel: vi.fn(),
    setupPointerMoveChannel: vi.fn(),
    clearStartConnectionState: vi.fn(() => {
      schedulerState.isStartConnectionInFlight = false;
      schedulerState.activeConnectionTargetKey = '';
    }),
    enableAutoReconnect: vi.fn(),
    scheduleReconnect: vi.fn(),
    resetSignalingDetachState: vi.fn(),
    resetVideoStreamWatchdogState: vi.fn(),
    stopFlexDisplayHeartbeat: vi.fn(),
    stopVideoStreamWatchdog: vi.fn(),
    clearPendingDisplayResize: vi.fn(),
    releaseInputMapping: vi.fn(),
    resetAllPointerState: vi.fn(),
    clearAllPointerState: vi.fn(),
    clearInputMappingPointerKeys: vi.fn(),
    clearPendingPointerControlPayloads: vi.fn(),
    stopVideoFrameCaptureLoop: vi.fn(),
    stopPointerControlFlushLoop: vi.fn(),
    stopPointerReleaseFlushLoop: vi.fn(),
    clearPendingIceRestartFallback: vi.fn(),
    clearPendingVideoRecovery: vi.fn(),
    clearPendingVideoStreamStallObservation: vi.fn(),
    clearPendingReconnect: vi.fn(),
    clearPendingStartConnection: vi.fn(),
    captureCurrentVideoFrame: vi.fn(),
    showLastFrameOverlayForTab: vi.fn(),
    releaseHidDevices: vi.fn(),
    cleanupMediaStream: vi.fn(),
    getPersistentAudioElement: () => backgroundAudioElement,
    scheduleResumeMediaPlayback: vi.fn(),
    startVideoFrameMonitor: vi.fn(),
    ...overrides
  };

  const session = useScreencastSession(options);
  return {
    session,
    options,
    runtime,
    schedulerState,
    socket,
    persistedConnections,
    videoElement,
    audioElement,
    backgroundAudioElement,
    restoreWebSocket: () => vi.stubGlobal('WebSocket', previousWebSocket)
  };
}

describe('useScreencastSession', () => {
  it('starts a connection and creates the offer when the websocket opens', async () => {
    const harness = createHarness();

    await harness.session.lifecycle.start();
    await harness.socket.onopen?.({} as Event);

    expect(harness.options.requestSignalTicket).toHaveBeenCalled();
    expect(harness.options.createPeerOfferSession).toHaveBeenCalled();
    expect(harness.options.setupControlChannel).toHaveBeenCalled();
    expect(harness.options.wirePeerConnectionEventHandlers).toHaveBeenCalledWith(harness.runtime.activeConnectionId, harness.runtime.peerConnection);
    expect(harness.socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'offer', sdp: 'offer-sdp' }));
    expect(harness.runtime.currentScrcpySessionId).toBe('session-1');
    harness.restoreWebSocket();
  });

  it('restores active persisted snapshots into runtime state and media elements', () => {
    const harness = createHarness();
    const persisted = createPersistedConnection();
    harness.persistedConnections.set('tab-1', persisted);

    expect(harness.session.lifecycle.restore('tab-1')).toBe(true);

    expect(harness.runtime.peerConnection).toBe(persisted.peerConnection);
    expect(harness.videoElement.srcObject).toBe(persisted.remoteVideoStream);
    expect(harness.audioElement.srcObject).toBe(persisted.remoteAudioStream);
    expect(harness.backgroundAudioElement.srcObject).toBe(persisted.remoteAudioStream);
    expect(harness.options.wirePeerConnectionEventHandlers).toHaveBeenCalled();
    expect(harness.options.startVideoFrameMonitor).toHaveBeenCalledWith(1);
    harness.restoreWebSocket();
  });

  it('disposes stale persisted snapshots instead of restoring them', () => {
    const harness = createHarness();
    harness.persistedConnections.set('tab-1', createPersistedConnection({
      peerConnection: createPeerConnection('failed')
    }));

    expect(harness.session.lifecycle.restore('tab-1')).toBe(false);
    expect(harness.options.disposePersistedConnection).toHaveBeenCalledWith('tab-1');
    harness.restoreWebSocket();
  });

  it('preserves a live connection for background use before detaching the view', () => {
    const harness = createHarness();
    harness.runtime.peerConnection = createPeerConnection('connected');
    harness.runtime.dataChannel = createChannel('control');

    harness.session.lifecycle.stop(true, 'tab-1', { disposeOtherPersistedConnections: false });

    expect(harness.options.captureCurrentVideoFrame).toHaveBeenCalledWith('tab-1');
    expect(harness.options.persistCastConnectionSnapshot).toHaveBeenCalled();
    expect(harness.options.wireBackgroundPersistedConnectionHandlers).toHaveBeenCalled();
    expect(harness.runtime.peerConnection).toBeNull();
    expect(harness.options.showLastFrameOverlayForTab).toHaveBeenCalled();
    harness.restoreWebSocket();
  });
});
