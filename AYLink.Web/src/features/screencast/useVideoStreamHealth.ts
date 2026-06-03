import {
  createVideoStreamStateMachine,
  getVideoStreamDetachDelay,
  getVideoStreamStableDuration,
  markVideoStreamAdvanced,
  markVideoStreamConnecting,
  markVideoStreamDetached,
  markVideoStreamStable,
  markVideoStreamUnstable,
  resetVideoStreamStateMachine
} from './videoStreamStateMachine';

interface InboundVideoStatsSnapshot {
  packetsReceived: number | null;
  bytesReceived: number | null;
  framesDecoded: number | null;
  framesDropped: number | null;
  timestamp: number | null;
}

export interface VideoStreamStallDetails {
  reason: string;
  connectionId: number;
  deviceId: string;
  tabKey: string;
  consecutiveVideoStreamStallDetections: number;
  confirmationThreshold: number;
  peerConnectionState: RTCPeerConnectionState | null;
  signalingAttached: boolean;
  inboundVideoStats: InboundVideoStatsSnapshot | null;
}

interface VideoStreamHealthOptions {
  stableDetachMs: number;
  stallThresholdMs: number;
  watchdogIntervalMs: number;
  diagnosticIntervalMs: number;
  stallConfirmationCount: number;
  getActiveConnectionId: () => number;
  isAutoReconnectSuppressed: () => boolean;
  isScreencastVisible: () => boolean;
  getPeerConnection: () => RTCPeerConnection | null;
  getSignalingSocket: () => WebSocket | null;
  getVideoTrack: () => MediaStreamTrack | undefined;
  hasVideoTrack: () => boolean;
  hasVideoSource: () => boolean;
  getVideoElement: () => HTMLVideoElement | null;
  syncVideoFrameSize: () => void;
  getDeviceId: () => string;
  getTabKey: () => string;
  onVideoStreamStalledConfirmed?: (details: VideoStreamStallDetails) => void;
  logger?: Pick<Console, 'debug' | 'info' | 'warn'>;
}

export function useVideoStreamHealth(options: VideoStreamHealthOptions) {
  const logger = options.logger ?? console;
  const stateMachine = createVideoStreamStateMachine();

  let frameCallbackHandle: number | null = null;
  let watchdogTimer: number | null = null;
  let signalingDetachTimer: number | null = null;
  let detachedSignalingConnectionId = 0;
  let expectedSignalingCloseConnectionId = 0;
  let lastVideoStreamPacketAt = 0;
  let lastVideoStreamDiagnosticAt = 0;
  let lastInboundVideoPacketsReceived: number | null = null;
  let lastInboundVideoBytesReceived: number | null = null;
  let consecutiveVideoStreamStallDetections = 0;
  let hasLoggedIdleStaticVideo = false;

  const stopVideoFrameCaptureLoop = () => {
    const videoElement = options.getVideoElement();
    if (frameCallbackHandle == null || !videoElement || typeof videoElement.cancelVideoFrameCallback !== 'function') {
      frameCallbackHandle = null;
      return;
    }

    try {
      videoElement.cancelVideoFrameCallback(frameCallbackHandle);
    } catch (error) {
      logger.warn('Failed to cancel video frame callback:', error);
    }
    frameCallbackHandle = null;
  };

  const stopWatchdog = () => {
    if (watchdogTimer != null) {
      window.clearInterval(watchdogTimer);
      watchdogTimer = null;
    }
  };

  const clearPendingSignalingDetach = () => {
    if (signalingDetachTimer != null) {
      window.clearTimeout(signalingDetachTimer);
      signalingDetachTimer = null;
    }
  };

  const resetSignalingDetachState = () => {
    clearPendingSignalingDetach();
    detachedSignalingConnectionId = 0;
    expectedSignalingCloseConnectionId = 0;
  };

  const resetWatchdogState = () => {
    resetVideoStreamStateMachine(stateMachine);
    lastVideoStreamPacketAt = 0;
    lastVideoStreamDiagnosticAt = 0;
    lastInboundVideoPacketsReceived = null;
    lastInboundVideoBytesReceived = null;
    consecutiveVideoStreamStallDetections = 0;
    hasLoggedIdleStaticVideo = false;
  };

  const isVideoPlaybackStarved = () => {
    const haveCurrentData =
      typeof HTMLMediaElement !== 'undefined'
        ? HTMLMediaElement.HAVE_CURRENT_DATA
        : 2;
    const videoTrack = options.getVideoTrack();
    if (videoTrack?.muted) {
      return true;
    }

    const videoElement = options.getVideoElement();
    if (!videoElement) {
      return false;
    }
    if (videoElement.paused || videoElement.ended || videoElement.seeking) {
      return false;
    }

    return videoElement.readyState < haveCurrentData;
  };

  const shouldMonitorVideoStream = (connectionId: number) => {
    if (options.isAutoReconnectSuppressed() || connectionId !== options.getActiveConnectionId()) {
      return false;
    }
    if (!options.isScreencastVisible()) {
      return false;
    }
    const peerConnection = options.getPeerConnection();
    if (!peerConnection || peerConnection.connectionState !== 'connected') {
      return false;
    }
    const videoTrack = options.getVideoTrack();
    if (!videoTrack || videoTrack.readyState !== 'live') {
      return false;
    }
    return options.hasVideoSource();
  };

  const getInboundVideoStatsSnapshot = async (): Promise<InboundVideoStatsSnapshot | null> => {
    const videoReceiver = options.getPeerConnection()?.getReceivers().find(receiver => receiver.track?.kind === 'video');
    if (!videoReceiver || typeof videoReceiver.getStats !== 'function') {
      return null;
    }

    const stats = await videoReceiver.getStats();
    for (const report of stats.values()) {
      if (report.type !== 'inbound-rtp' || (report.kind != null && report.kind !== 'video')) {
        continue;
      }
      return {
        packetsReceived: report.packetsReceived ?? null,
        bytesReceived: report.bytesReceived ?? null,
        framesDecoded: report.framesDecoded ?? null,
        framesDropped: report.framesDropped ?? null,
        timestamp: report.timestamp ?? null
      };
    }
    return null;
  };

  const hasInboundVideoStreamAdvanced = (snapshot: InboundVideoStatsSnapshot | null) => {
    if (!snapshot) {
      return false;
    }

    const packetsReceived = typeof snapshot.packetsReceived === 'number' ? snapshot.packetsReceived : null;
    const bytesReceived = typeof snapshot.bytesReceived === 'number' ? snapshot.bytesReceived : null;
    const hasBaseline = lastInboundVideoPacketsReceived != null || lastInboundVideoBytesReceived != null;
    const hasAdvanced =
      (packetsReceived != null && lastInboundVideoPacketsReceived != null && packetsReceived > lastInboundVideoPacketsReceived) ||
      (bytesReceived != null && lastInboundVideoBytesReceived != null && bytesReceived > lastInboundVideoBytesReceived);

    lastInboundVideoPacketsReceived = packetsReceived;
    lastInboundVideoBytesReceived = bytesReceived;
    return !hasBaseline || hasAdvanced;
  };

  const markUnstable = (connectionId: number, reason: string) => {
    const isAlreadyStalled = stateMachine.connectionId === connectionId && stateMachine.state === 'stalled';
    markVideoStreamUnstable(stateMachine, connectionId, performance.now());
    clearPendingSignalingDetach();
    if (detachedSignalingConnectionId !== connectionId) {
      detachedSignalingConnectionId = 0;
    }
    if (isAlreadyStalled) {
      return;
    }
    logger.debug('[WebRTC] Video stream marked unstable; keeping signaling websocket attached.', {
      reason,
      connectionId,
      state: stateMachine.state,
      deviceId: options.getDeviceId(),
      tabKey: options.getTabKey()
    });
  };

  const scheduleSignalingDetach = (connectionId: number) => {
    if (signalingDetachTimer != null || detachedSignalingConnectionId === connectionId) {
      return;
    }
    const socket = options.getSignalingSocket();
    const peerConnection = options.getPeerConnection();
    if (!socket || socket.readyState !== WebSocket.OPEN || !peerConnection || peerConnection.connectionState !== 'connected' || !options.hasVideoTrack()) {
      return;
    }

    const detachDelayMs = getVideoStreamDetachDelay(stateMachine, connectionId, performance.now(), options.stableDetachMs);
    if (detachDelayMs == null) {
      return;
    }

    signalingDetachTimer = window.setTimeout(() => {
      signalingDetachTimer = null;
      const currentSocket = options.getSignalingSocket();
      const currentPeerConnection = options.getPeerConnection();
      if (connectionId !== options.getActiveConnectionId() || currentSocket !== socket || socket.readyState !== WebSocket.OPEN) {
        return;
      }
      if (!currentPeerConnection || currentPeerConnection.connectionState !== 'connected' || !options.hasVideoTrack()) {
        return;
      }

      const currentDetachDelayMs = getVideoStreamDetachDelay(stateMachine, connectionId, performance.now(), options.stableDetachMs);
      if (currentDetachDelayMs == null) {
        return;
      }
      if (currentDetachDelayMs > 0) {
        scheduleSignalingDetach(connectionId);
        return;
      }

      markVideoStreamStable(stateMachine, connectionId);
      logger.info('[WebRTC] Closing signaling websocket after stable connection established.', {
        connectionId,
        deviceId: options.getDeviceId(),
        tabKey: options.getTabKey(),
        stableDurationMs: getVideoStreamStableDuration(stateMachine, connectionId, performance.now())
      });
      markVideoStreamDetached(stateMachine, connectionId);
      detachedSignalingConnectionId = connectionId;
      expectedSignalingCloseConnectionId = connectionId;
      socket.close(1000, 'signaling-detached');
    }, detachDelayMs);
  };

  const handleWatchdog = async (connectionId: number, reason: string) => {
    if (!shouldMonitorVideoStream(connectionId)) {
      consecutiveVideoStreamStallDetections = 0;
      return;
    }

    const now = performance.now();
    let inboundVideoStats: InboundVideoStatsSnapshot | null = null;
    try {
      inboundVideoStats = await getInboundVideoStatsSnapshot();
    } catch (error) {
      logger.warn('[WebRTC] Failed to read inbound video stats during stream watchdog.', error);
      return;
    }

    if (hasInboundVideoStreamAdvanced(inboundVideoStats)) {
      markVideoStreamAdvanced(stateMachine, connectionId, now);
      lastVideoStreamPacketAt = now;
      lastVideoStreamDiagnosticAt = 0;
      consecutiveVideoStreamStallDetections = 0;
      hasLoggedIdleStaticVideo = false;
      scheduleSignalingDetach(connectionId);
      return;
    }

    if (lastVideoStreamPacketAt <= 0) {
      lastVideoStreamPacketAt = now;
      return;
    }

    if (now - lastVideoStreamPacketAt < options.stallThresholdMs) {
      consecutiveVideoStreamStallDetections = 0;
      return;
    }

    if (!isVideoPlaybackStarved()) {
      consecutiveVideoStreamStallDetections = 0;
      lastVideoStreamPacketAt = now;
      if (!hasLoggedIdleStaticVideo) {
        hasLoggedIdleStaticVideo = true;
        logger.debug('[WebRTC] Inbound video RTP stream is idle without playback starvation; treating the frame as intentionally static.', {
          reason,
          connectionId,
          deviceId: options.getDeviceId(),
          tabKey: options.getTabKey(),
          inboundVideoStats
        });
      }
      return;
    }

    consecutiveVideoStreamStallDetections += 1;
    if (consecutiveVideoStreamStallDetections < options.stallConfirmationCount) {
      logger.debug('[WebRTC] Inbound video RTP stream stopped advancing, waiting for consecutive confirmation.', {
        reason,
        deviceId: options.getDeviceId(),
        tabKey: options.getTabKey(),
        consecutiveVideoStreamStallDetections,
        confirmationThreshold: options.stallConfirmationCount,
        inboundVideoStats
      });
      return;
    }

    const stallDetails: VideoStreamStallDetails = {
      reason,
      connectionId,
      deviceId: options.getDeviceId(),
      tabKey: options.getTabKey(),
      consecutiveVideoStreamStallDetections,
      confirmationThreshold: options.stallConfirmationCount,
      peerConnectionState: options.getPeerConnection()?.connectionState ?? null,
      signalingAttached: !!options.getSignalingSocket() && options.getSignalingSocket()?.readyState === WebSocket.OPEN,
      inboundVideoStats
    };

    markUnstable(connectionId, 'inbound_rtp_stalled');
    options.onVideoStreamStalledConfirmed?.(stallDetails);
    if (now - lastVideoStreamDiagnosticAt < options.diagnosticIntervalMs) {
      return;
    }

    lastVideoStreamDiagnosticAt = now;
    logger.debug('[WebRTC] Inbound video RTP stream is idle while peer connection is still connected.', {
      ...stallDetails
    });
  };

  const start = (connectionId: number) => {
    stopVideoFrameCaptureLoop();
    stopWatchdog();
    resetWatchdogState();
    markVideoStreamConnecting(stateMachine, connectionId, performance.now());

    const source = options.getVideoElement();
    if (!source) {
      return;
    }

    const scheduleNextFrame = () => {
      const videoElement = options.getVideoElement();
      if (!videoElement || videoElement !== source || connectionId !== options.getActiveConnectionId()) {
        return;
      }
      if (typeof source.requestVideoFrameCallback !== 'function') {
        return;
      }
      frameCallbackHandle = source.requestVideoFrameCallback(() => {
        options.syncVideoFrameSize();
        scheduleNextFrame();
      });
    };

    scheduleNextFrame();
    watchdogTimer = window.setInterval(() => {
      void handleWatchdog(connectionId, 'inbound_rtp_watchdog');
    }, options.watchdogIntervalMs);
  };

  const consumeExpectedSignalingClose = (connectionId: number) => {
    const wasExpected = expectedSignalingCloseConnectionId === connectionId;
    expectedSignalingCloseConnectionId = 0;
    return wasExpected;
  };

  const markSignalingClosedWhileActive = (connectionId: number) => {
    detachedSignalingConnectionId = connectionId;
  };

  return {
    stateMachine,
    start,
    stopVideoFrameCaptureLoop,
    stopWatchdog,
    resetWatchdogState,
    clearPendingSignalingDetach,
    resetSignalingDetachState,
    shouldMonitorVideoStream,
    handleWatchdog,
    markUnstable,
    scheduleSignalingDetach,
    consumeExpectedSignalingClose,
    markSignalingClosedWhileActive
  };
}
