import type { Ref } from 'vue';
import type { PersistedCastConnection } from '../../types/screencast';
import type { CastConnectionSchedulerState } from './connectionScheduler';
import type { CreateScreencastPeerOfferOptions } from './screencastPeerOffer';
import { createRestoredScreencastRuntimeState, isPersistedConnectionStale } from './screencastSessionRestore';
import { buildSignalWebSocketUrl } from './screencastSignaling';

export type ScreencastSessionValue<T> = T | Ref<T>;

export interface ScreencastSessionState {
  isConnected: Ref<boolean>;
  isConnecting: Ref<boolean>;
  status: Ref<string>;
  videoStream: ScreencastSessionValue<MediaStream>;
  audioStream: ScreencastSessionValue<MediaStream>;
}

export interface ScreencastSessionStopOptions {
  disposeOtherPersistedConnections?: boolean;
}

export interface ScreencastSessionPersistOptions {
  disposeOtherConnections?: boolean;
  wireBackgroundHandlers?: boolean;
}

export interface ScreencastSessionLifecycle {
  start: (bypassStartGuard?: boolean) => Promise<void>;
  stop: (preserveForBackground?: boolean, preserveTabKey?: string, options?: ScreencastSessionStopOptions) => void;
  restore: (tabKey?: string) => boolean;
  persist: (tabKey?: string, options?: ScreencastSessionPersistOptions) => void;
  detachFromView: () => void;
}

export interface ScreencastSessionControls {
  sendAndroidCommand: (command: string) => void;
}

export interface ScreencastSessionRefs {
  getStageElement: () => HTMLDivElement | null;
  getVideoElement: () => HTMLVideoElement | null;
  getAudioElement: () => HTMLAudioElement | null;
}

export interface ScreencastSession {
  state: ScreencastSessionState;
  lifecycle: ScreencastSessionLifecycle;
  controls: ScreencastSessionControls;
  refs: ScreencastSessionRefs;
}

export interface ScreencastSessionRuntimeState {
  peerConnection: RTCPeerConnection | null;
  ws: WebSocket | null;
  dataChannel: RTCDataChannel | null;
  metaControlChannel: RTCDataChannel | null;
  pointerMoveChannel: RTCDataChannel | null;
  pendingCandidates: RTCIceCandidateInit[];
  remoteTracks: Map<'audio' | 'video', MediaStreamTrack>;
  remoteVideoStream: MediaStream;
  remoteAudioStream: MediaStream;
  currentScrcpySessionId: string;
  activeConnectionId: number;
  isIceRestartInFlight: boolean;
  lastDisplayResizeRequest: { width: number; height: number } | null;
}

export interface ScreencastSessionStartTicketResponse {
  ticketResponse: Response;
}

export interface ScreencastSessionOfferSession {
  peerConnection: RTCPeerConnection;
  channels: {
    controlChannel: RTCDataChannel;
    metaControlChannel: RTCDataChannel;
    pointerMoveChannel: RTCDataChannel;
  };
  localDescription: RTCSessionDescription | null;
}

export interface UseScreencastSessionOptions {
  state: ScreencastSessionState;
  controls: ScreencastSessionControls;
  refs: ScreencastSessionRefs;
  runtime: ScreencastSessionRuntimeState;
  schedulerState: CastConnectionSchedulerState;
  getActiveTabKey: () => string;
  getDeviceId: () => string;
  getAppPackageName: () => string;
  getAppDisplayName: () => string;
  getIsNewDisplayMode: () => boolean;
  getCurrentStatusText: (key: 'connected' | 'disconnected' | 'reconnecting' | 'connectingDevice' | 'creatingSession' | 'createCredentialFailed' | 'createOfferFailed' | 'initRetry' | 'webRtcState', ...args: (string | number)[]) => string;
  getAccessToken: () => string | null;
  redirectToLogin: () => void;
  hasLiveConnection: () => boolean;
  getSessionReleaseTarget: (tabKey?: string) => { deviceId: string; sessionId: string };
  getRestorableSessionId: (tabKey: string) => string;
  setRestorableSessionId: (tabKey: string, sessionId: string) => void;
  postScrcpySessionAction: (action: 'heartbeat' | 'release', deviceId: string, sessionId: string) => void;
  stopScrcpySessionHeartbeat: () => void;
  startScrcpySessionHeartbeat: (deviceId: string, sessionId: string) => void;
  disposeAllPersistedConnections: () => void;
  getPersistedConnection: (tabKey: string) => PersistedCastConnection | null;
  disposePersistedConnection: (tabKey: string) => void;
  persistCastConnectionSnapshot: (tabKey: string, snapshot: PersistedCastConnection, options?: { disposeOtherConnections?: boolean }) => void;
  clearPersistedConnection: (tabKey?: string) => void;
  wireBackgroundPersistedConnectionHandlers: (snapshot: PersistedCastConnection) => void;
  staleDisconnectedGraceMs: number;
  buildSignalWebSocketBaseUrl: () => string;
  requestSignalTicket: (existingSessionId?: string) => Promise<ScreencastSessionStartTicketResponse>;
  loadRtcConfiguration: () => Promise<RTCConfiguration>;
  createPeerOfferSession: (configuration: RTCConfiguration, options?: CreateScreencastPeerOfferOptions) => Promise<ScreencastSessionOfferSession>;
  wirePeerConnectionEventHandlers: (connectionId: number, peerConnection: RTCPeerConnection) => void;
  wireWebSocketEventHandlers: (connectionId: number, socket: WebSocket) => void;
  setupControlChannel: (channel: RTCDataChannel) => void;
  setupMetaControlChannel: (channel: RTCDataChannel) => void;
  setupPointerMoveChannel: (channel: RTCDataChannel) => void;
  clearStartConnectionState: () => void;
  enableAutoReconnect: () => void;
  scheduleReconnect: (reason: string) => void;
  resetSignalingDetachState: () => void;
  resetVideoStreamWatchdogState: () => void;
  stopFlexDisplayHeartbeat: () => void;
  stopVideoStreamWatchdog: () => void;
  clearPendingDisplayResize: () => void;
  releaseInputMapping: (reason: 'disconnect') => void;
  resetAllPointerState: () => void;
  clearAllPointerState: () => void;
  clearInputMappingPointerKeys: () => void;
  clearPendingPointerControlPayloads: () => void;
  stopVideoFrameCaptureLoop: () => void;
  stopPointerControlFlushLoop: () => void;
  stopPointerReleaseFlushLoop: () => void;
  clearPendingIceRestartFallback: () => void;
  clearPendingVideoRecovery: () => void;
  clearPendingVideoStreamStallObservation: () => void;
  clearPendingReconnect: () => void;
  clearPendingStartConnection: () => void;
  captureCurrentVideoFrame: (tabKey?: string) => void;
  showLastFrameOverlayForTab: (tabKey?: string) => void;
  releaseHidDevices: () => void;
  cleanupMediaStream: () => void;
  getPersistentAudioElement: () => HTMLAudioElement;
  scheduleResumeMediaPlayback: (delayMs: number) => void;
  startVideoFrameMonitor: (connectionId: number) => void;
}

export function useScreencastSession(options: UseScreencastSessionOptions): ScreencastSession {
  const { runtime, state } = options;

  const persist = (tabKey = options.getActiveTabKey(), persistOptions: ScreencastSessionPersistOptions = {}) => {
    if (!runtime.peerConnection || !tabKey) {
      return;
    }

    const previousSnapshot = options.getPersistedConnection(tabKey);
    const connectionState = runtime.peerConnection.connectionState;
    const snapshot: PersistedCastConnection = {
      tabKey,
      deviceId: options.getDeviceId(),
      appPackageName: options.getAppPackageName(),
      appDisplayName: options.getAppDisplayName(),
      newDisplay: options.getIsNewDisplayMode(),
      sessionId: runtime.currentScrcpySessionId,
      persistedAt: Date.now(),
      disconnectedAt: connectionState === 'disconnected'
        ? previousSnapshot?.disconnectedAt ?? Date.now()
        : undefined,
      peerConnection: runtime.peerConnection,
      ws: runtime.ws,
      dataChannel: runtime.dataChannel,
      metaControlChannel: runtime.metaControlChannel,
      pointerMoveChannel: runtime.pointerMoveChannel,
      remoteTracks: new Map(runtime.remoteTracks),
      remoteVideoStream: runtime.remoteVideoStream,
      remoteAudioStream: runtime.remoteAudioStream,
      pendingCandidates: [...runtime.pendingCandidates]
    };
    if (persistOptions.wireBackgroundHandlers) {
      options.wireBackgroundPersistedConnectionHandlers(snapshot);
    }

    options.persistCastConnectionSnapshot(tabKey, snapshot, persistOptions);
  };

  const restore = (tabKey = options.getActiveTabKey()) => {
    const persisted = options.getPersistedConnection(tabKey);
    if (!persisted) {
      return false;
    }

    const persistedPeerConnectionState = persisted.peerConnection.connectionState;
    if (isPersistedConnectionStale(persisted, options.staleDisconnectedGraceMs)) {
      console.warn('[WebRTC] Discarding stale persisted connection snapshot.', {
        tabKey,
        deviceId: persisted.deviceId,
        hasSocket: !!persisted.ws,
        peerConnectionState: persistedPeerConnectionState
      });
      options.disposePersistedConnection(tabKey);
      return false;
    }

    runtime.activeConnectionId++;
    options.clearStartConnectionState();
    options.schedulerState.activeConnectionTargetKey = tabKey;
    options.resetSignalingDetachState();
    const restored = createRestoredScreencastRuntimeState(persisted);
    runtime.currentScrcpySessionId = restored.sessionId;
    runtime.peerConnection = restored.peerConnection;
    runtime.ws = restored.ws;
    runtime.dataChannel = restored.dataChannel;
    runtime.metaControlChannel = restored.metaControlChannel;
    runtime.pointerMoveChannel = restored.pointerMoveChannel;
    runtime.pendingCandidates = restored.pendingCandidates;
    runtime.remoteTracks.clear();
    for (const [kind, track] of restored.remoteTracks.entries()) {
      runtime.remoteTracks.set(kind, track);
    }
    runtime.remoteVideoStream = restored.remoteVideoStream;
    runtime.remoteAudioStream = restored.remoteAudioStream;

    const connectionId = runtime.activeConnectionId;
    options.wirePeerConnectionEventHandlers(connectionId, restored.peerConnection);
    if (runtime.ws) {
      options.wireWebSocketEventHandlers(connectionId, runtime.ws);
    }
    if (runtime.dataChannel) {
      options.setupControlChannel(runtime.dataChannel);
    }
    if (runtime.metaControlChannel) {
      options.setupMetaControlChannel(runtime.metaControlChannel);
    }
    if (runtime.pointerMoveChannel) {
      options.setupPointerMoveChannel(runtime.pointerMoveChannel);
    }

    const videoElement = options.refs.getVideoElement();
    if (videoElement) {
      videoElement.srcObject = runtime.remoteVideoStream;
    }
    const audioElement = options.refs.getAudioElement();
    if (audioElement) {
      audioElement.srcObject = runtime.remoteAudioStream;
    }
    const backgroundAudioElement = options.getPersistentAudioElement();
    if (backgroundAudioElement.srcObject !== runtime.remoteAudioStream) {
      backgroundAudioElement.srcObject = runtime.remoteAudioStream;
    }

    state.isConnected.value = restored.peerConnection.connectionState === 'connected';
    state.isConnecting.value = restored.peerConnection.connectionState === 'connecting';
    state.status.value = state.isConnected.value
      ? options.getCurrentStatusText('connected')
      : state.isConnecting.value
        ? options.getCurrentStatusText('reconnecting')
        : options.getCurrentStatusText('webRtcState', restored.peerConnection.connectionState);
    options.startScrcpySessionHeartbeat(persisted.deviceId, runtime.currentScrcpySessionId);
    options.scheduleResumeMediaPlayback(0);
    options.startVideoFrameMonitor(connectionId);
    persist(tabKey, { disposeOtherConnections: false });
    return true;
  };

  const detachActiveConnectionFromView = () => {
    runtime.activeConnectionId++;
    options.stopFlexDisplayHeartbeat();
    options.clearPendingDisplayResize();
    options.releaseInputMapping('disconnect');
    options.clearAllPointerState();
    options.clearInputMappingPointerKeys();
    runtime.currentScrcpySessionId = '';
    options.clearPendingPointerControlPayloads();
    options.clearStartConnectionState();
    options.stopVideoFrameCaptureLoop();
    options.stopVideoStreamWatchdog();
    options.resetVideoStreamWatchdogState();
    options.resetSignalingDetachState();
    options.stopPointerControlFlushLoop();
    options.stopPointerReleaseFlushLoop();
    options.clearPendingIceRestartFallback();
    options.clearPendingVideoRecovery();
    options.clearPendingVideoStreamStallObservation();
    runtime.isIceRestartInFlight = false;
    runtime.peerConnection = null;
    runtime.ws = null;
    runtime.dataChannel = null;
    runtime.metaControlChannel = null;
    runtime.pointerMoveChannel = null;
    runtime.pendingCandidates = [];
    runtime.remoteTracks.clear();
    runtime.remoteVideoStream = new MediaStream();
    runtime.remoteAudioStream = new MediaStream();
    options.clearPendingReconnect();
    options.clearPendingStartConnection();
    options.clearPendingDisplayResize();
    runtime.lastDisplayResizeRequest = null;
    state.isConnected.value = false;
    state.isConnecting.value = false;
    state.status.value = options.getCurrentStatusText('disconnected');
    options.showLastFrameOverlayForTab();

    const videoElement = options.refs.getVideoElement();
    if (videoElement) {
      videoElement.pause();
      videoElement.srcObject = null;
    }

    const audioElement = options.refs.getAudioElement();
    if (audioElement) {
      audioElement.pause();
      audioElement.srcObject = null;
    }
  };

  const stop = (
    preserveForBackground = false,
    preserveTabKey = options.getActiveTabKey(),
    stopOptions: ScreencastSessionStopOptions = {}
  ) => {
    const shouldPreserveLiveConnection = preserveForBackground && options.hasLiveConnection();
    if (!shouldPreserveLiveConnection) {
      options.stopScrcpySessionHeartbeat();
    }
    options.stopFlexDisplayHeartbeat();
    options.stopVideoStreamWatchdog();
    options.clearPendingDisplayResize();
    options.releaseInputMapping('disconnect');
    options.resetAllPointerState();
    options.clearInputMappingPointerKeys();
    options.clearPendingPointerControlPayloads();
    options.clearStartConnectionState();
    options.resetSignalingDetachState();
    options.stopPointerControlFlushLoop();
    options.stopPointerReleaseFlushLoop();
    options.clearPendingIceRestartFallback();
    options.clearPendingVideoRecovery();
    options.clearPendingVideoStreamStallObservation();
    runtime.isIceRestartInFlight = false;

    if (shouldPreserveLiveConnection) {
      options.captureCurrentVideoFrame(preserveTabKey);
      persist(preserveTabKey, {
        disposeOtherConnections: stopOptions.disposeOtherPersistedConnections,
        wireBackgroundHandlers: true
      });
      detachActiveConnectionFromView();
      return;
    }

    runtime.currentScrcpySessionId = '';
    runtime.activeConnectionId++;
    options.releaseHidDevices();

    if (runtime.dataChannel) {
      runtime.dataChannel.close();
      runtime.dataChannel = null;
    }
    if (runtime.pointerMoveChannel) {
      runtime.pointerMoveChannel.close();
      runtime.pointerMoveChannel = null;
    }

    if (runtime.metaControlChannel) {
      runtime.metaControlChannel.close();
      runtime.metaControlChannel = null;
    }
    if (runtime.peerConnection) {
      runtime.peerConnection.close();
      runtime.peerConnection = null;
    }
    if (runtime.ws) {
      const socket = runtime.ws;
      runtime.ws = null;
      socket.onclose = null;
      socket.close();
    }

    options.cleanupMediaStream();
    options.clearPersistedConnection();
    runtime.pendingCandidates = [];
    options.clearPendingReconnect();
    options.clearPendingStartConnection();
    runtime.lastDisplayResizeRequest = null;
    state.isConnected.value = false;
    state.isConnecting.value = false;
    state.status.value = options.getCurrentStatusText('disconnected');
  };

  const start = async (bypassStartGuard = false) => {
    if (!options.getDeviceId()) {
      return;
    }

    const targetTabKey = options.getActiveTabKey();
    if (!targetTabKey) {
      return;
    }
    if (!bypassStartGuard
      && options.schedulerState.activeConnectionTargetKey === targetTabKey
      && (options.schedulerState.isStartConnectionInFlight || options.hasLiveConnection())) {
      return;
    }

    const token = options.getAccessToken();
    if (!token) {
      options.redirectToLogin();
      return;
    }

    const previousSession = options.getSessionReleaseTarget(targetTabKey);
    options.stopScrcpySessionHeartbeat();
    if (previousSession.sessionId) {
      options.postScrcpySessionAction('release', previousSession.deviceId, previousSession.sessionId);
    }
    options.disposeAllPersistedConnections();
    stop();
    options.enableAutoReconnect();
    options.resetSignalingDetachState();
    options.resetVideoStreamWatchdogState();
    options.schedulerState.isStartConnectionInFlight = true;
    options.schedulerState.activeConnectionTargetKey = targetTabKey;
    state.isConnecting.value = true;
    state.status.value = options.getCurrentStatusText('connectingDevice');
    runtime.pendingCandidates = [];
    const connectionId = ++runtime.activeConnectionId;

    try {
      let wsUrl = options.buildSignalWebSocketBaseUrl();
      const restorableSessionId = options.getRestorableSessionId(targetTabKey);
      let { ticketResponse } = await options.requestSignalTicket(restorableSessionId);

      if (!ticketResponse.ok && ticketResponse.status === 400 && restorableSessionId) {
        options.setRestorableSessionId(targetTabKey, '');
        ({ ticketResponse } = await options.requestSignalTicket());
      }

      if (!ticketResponse.ok) {
        state.status.value = options.getCurrentStatusText('createCredentialFailed');
        state.isConnecting.value = false;
        options.clearStartConnectionState();
        options.scheduleReconnect(`ticket_${ticketResponse.status}`);
        return;
      }
      const ticketPayload = await ticketResponse.json();
      runtime.currentScrcpySessionId = String(ticketPayload.sessionId ?? '');
      options.setRestorableSessionId(targetTabKey, runtime.currentScrcpySessionId);
      wsUrl = buildSignalWebSocketUrl(wsUrl, ticketPayload.ticket);

      runtime.ws = new WebSocket(wsUrl);
      const socket = runtime.ws;

      runtime.ws.onopen = async () => {
        if (connectionId !== runtime.activeConnectionId || runtime.ws !== socket) {
          return;
        }
        options.clearStartConnectionState();
        state.status.value = options.getCurrentStatusText('creatingSession');
        options.startScrcpySessionHeartbeat(options.getDeviceId(), runtime.currentScrcpySessionId);

        try {
          const rtcConfiguration = await options.loadRtcConfiguration();
          const offerSession = await options.createPeerOfferSession(rtcConfiguration, {
            beforeSetLocalDescription: ({ peerConnection, channels }) => {
              runtime.peerConnection = peerConnection;
              options.setupControlChannel(channels.controlChannel);
              options.setupMetaControlChannel(channels.metaControlChannel);
              options.setupPointerMoveChannel(channels.pointerMoveChannel);
              options.wirePeerConnectionEventHandlers(connectionId, peerConnection);
            }
          });
          runtime.peerConnection = offerSession.peerConnection;

          runtime.ws?.send(JSON.stringify(offerSession.localDescription));
        } catch (error) {
          console.error('Failed to create WebRTC offer:', error);
          state.status.value = options.getCurrentStatusText('createOfferFailed');
          state.isConnecting.value = false;
          options.clearStartConnectionState();
          stop();
          options.scheduleReconnect('offer_create_failed');
        }
      };

      options.wireWebSocketEventHandlers(connectionId, socket);

      persist();
    } catch (error) {
      console.error('Failed to start WebRTC connection:', error);
      state.status.value = options.getCurrentStatusText('initRetry');
      state.isConnecting.value = false;
      options.clearStartConnectionState();
      stop();
      options.scheduleReconnect('connection_bootstrap_failed');
    }
  };

  return {
    state,
    lifecycle: {
      start,
      stop,
      restore,
      persist,
      detachFromView: detachActiveConnectionFromView
    },
    controls: options.controls,
    refs: options.refs
  };
}
