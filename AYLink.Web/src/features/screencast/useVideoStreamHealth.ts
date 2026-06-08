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

export interface InboundVideoStatsSnapshot {
  packetsReceived: number | null;
  bytesReceived: number | null;
  framesDecoded: number | null;
  framesDropped: number | null;
  timestamp: number | null;
}

export interface VideoPlaybackSnapshot {
  readyState: number | null;
  paused: boolean | null;
  ended: boolean | null;
  seeking: boolean | null;
  currentTime: number | null;
  trackMuted: boolean;
  renderedFrameAgeMs: number | null;
}

export interface VideoStreamStallDetails {
  reason: string;
  status: VideoStreamHealthStatus;
  connectionId: number;
  deviceId: string;
  tabKey: string;
  consecutiveVideoStreamStallDetections: number;
  confirmationThreshold: number;
  peerConnectionState: RTCPeerConnectionState | null;
  signalingAttached: boolean;
  inboundVideoStats: InboundVideoStatsSnapshot | null;
  playback: VideoPlaybackSnapshot;
}

export type VideoStreamHealthStatus =
  | 'not_monitored'
  | 'warming_up'
  | 'advancing'
  | 'within_stall_threshold'
  | 'static_playback_ok'
  | 'source_packet_idle_observed'
  | 'browser_playback_starved_pending'
  | 'browser_playback_starved_confirmed'
  | 'browser_decode_stalled_pending'
  | 'browser_decode_stalled_confirmed';

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
  const sourceIdleGraceMs = Math.max(options.stallThresholdMs * 3, 10000);

  let frameCallbackHandle: number | null = null;
  let watchdogTimer: number | null = null;
  let signalingDetachTimer: number | null = null;
  let watchdogCheckSeq = 0;
  let detachedSignalingConnectionId = 0;
  let expectedSignalingCloseConnectionId = 0;
  let lastVideoStreamPacketAt = 0;
  let lastVideoStreamDiagnosticAt = 0;
  let lastInboundVideoPacketsReceived: number | null = null;
  let lastInboundVideoBytesReceived: number | null = null;
  let lastInboundVideoFramesDecoded: number | null = null;
  let consecutiveVideoStreamStallDetections = 0;
  let consecutiveVideoDecodeStallDetections = 0;
  let hasLoggedIdleStaticVideo = false;
  let lastRenderedVideoFrameAt = 0;

  const stopVideoFrameCaptureLoop = () => {
    const videoElement = options.getVideoElement();
    if (frameCallbackHandle === null || !videoElement || typeof videoElement.cancelVideoFrameCallback !== 'function') {
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
    if (watchdogTimer !== null) {
      window.clearTimeout(watchdogTimer);
      watchdogTimer = null;
    }
  };

  const clearPendingSignalingDetach = () => {
    if (signalingDetachTimer !== null) {
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
    watchdogCheckSeq += 1;
    resetVideoStreamStateMachine(stateMachine);
    lastVideoStreamPacketAt = 0;
    lastVideoStreamDiagnosticAt = 0;
    lastInboundVideoPacketsReceived = null;
    lastInboundVideoBytesReceived = null;
    lastInboundVideoFramesDecoded = null;
    consecutiveVideoStreamStallDetections = 0;
    consecutiveVideoDecodeStallDetections = 0;
    hasLoggedIdleStaticVideo = false;
    lastRenderedVideoFrameAt = 0;
  };

  const isVideoPlaybackStarved = () => {
    const haveCurrentData =
      typeof HTMLMediaElement !== 'undefined' && typeof HTMLMediaElement.HAVE_CURRENT_DATA === 'number'
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

  const isVideoDecodeRenderStalled = (playback: VideoPlaybackSnapshot, framesDecodedStalled: boolean) => {
    if (!framesDecodedStalled) {
      return false;
    }
    if (playback.paused || playback.ended || playback.seeking || playback.trackMuted) {
      return false;
    }
    if (playback.renderedFrameAgeMs === null) {
      return false;
    }
    return playback.renderedFrameAgeMs >= options.stallThresholdMs;
  };

  const getVideoPlaybackSnapshot = (): VideoPlaybackSnapshot => {
    const videoElement = options.getVideoElement();
    const videoTrack = options.getVideoTrack();
    return {
      readyState: videoElement?.readyState ?? null,
      paused: videoElement?.paused ?? null,
      ended: videoElement?.ended ?? null,
      seeking: videoElement?.seeking ?? null,
      currentTime: videoElement?.currentTime ?? null,
      trackMuted: videoTrack?.muted === true,
      renderedFrameAgeMs: lastRenderedVideoFrameAt <= 0 ? null : Math.max(0, performance.now() - lastRenderedVideoFrameAt)
    };
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
      if (report.type !== 'inbound-rtp' || (report.kind !== null && report.kind !== undefined && report.kind !== 'video')) {
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

  const observeInboundVideoStream = (snapshot: InboundVideoStatsSnapshot | null) => {
    if (!snapshot) {
      return {
        hasBaseline: false,
        hasAdvanced: false,
        framesDecodedStalled: false
      };
    }

    const packetsReceived = typeof snapshot.packetsReceived === 'number' ? snapshot.packetsReceived : null;
    const bytesReceived = typeof snapshot.bytesReceived === 'number' ? snapshot.bytesReceived : null;
    const framesDecoded = typeof snapshot.framesDecoded === 'number' ? snapshot.framesDecoded : null;
    const hasBaseline = lastInboundVideoPacketsReceived !== null || lastInboundVideoBytesReceived !== null;
    const hasFramesDecodedBaseline = lastInboundVideoFramesDecoded !== null;
    const hasAdvanced =
      (packetsReceived !== null && lastInboundVideoPacketsReceived !== null && packetsReceived > lastInboundVideoPacketsReceived) ||
      (bytesReceived !== null && lastInboundVideoBytesReceived !== null && bytesReceived > lastInboundVideoBytesReceived);
    const framesDecodedAdvanced = framesDecoded !== null && lastInboundVideoFramesDecoded !== null && framesDecoded > lastInboundVideoFramesDecoded;
    const framesDecodedStalled = framesDecoded !== null && hasFramesDecodedBaseline && !framesDecodedAdvanced;

    lastInboundVideoPacketsReceived = packetsReceived;
    lastInboundVideoBytesReceived = bytesReceived;
    lastInboundVideoFramesDecoded = framesDecoded;
    return {
      hasBaseline,
      hasAdvanced: !hasBaseline || hasAdvanced,
      framesDecodedStalled
    };
  };

  const resetStallConfirmations = () => {
    consecutiveVideoStreamStallDetections = 0;
    consecutiveVideoDecodeStallDetections = 0;
  };

  const buildStallDetails = (
    connectionId: number,
    reason: string,
    status: VideoStreamHealthStatus,
    inboundVideoStats: InboundVideoStatsSnapshot | null,
    playback: VideoPlaybackSnapshot
  ): VideoStreamStallDetails => {
    return {
      reason,
      status,
      connectionId,
      deviceId: options.getDeviceId(),
      tabKey: options.getTabKey(),
      consecutiveVideoStreamStallDetections,
      confirmationThreshold: options.stallConfirmationCount,
      peerConnectionState: options.getPeerConnection()?.connectionState ?? null,
      signalingAttached: !!options.getSignalingSocket() && options.getSignalingSocket()?.readyState === WebSocket.OPEN,
      inboundVideoStats,
      playback
    };
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

  const markRenderedFrameAdvanced = (connectionId: number, now: number) => {
    if (!shouldMonitorVideoStream(connectionId)) {
      return;
    }

    markVideoStreamAdvanced(stateMachine, connectionId, now);
    lastVideoStreamPacketAt = now;
    lastVideoStreamDiagnosticAt = 0;
    resetStallConfirmations();
    hasLoggedIdleStaticVideo = false;
    scheduleSignalingDetach(connectionId);
  };

  const scheduleSignalingDetach = (connectionId: number) => {
    if (signalingDetachTimer !== null || detachedSignalingConnectionId === connectionId) {
      return;
    }
    const socket = options.getSignalingSocket();
    const peerConnection = options.getPeerConnection();
    if (!socket || socket.readyState !== WebSocket.OPEN || !peerConnection || peerConnection.connectionState !== 'connected' || !options.hasVideoTrack()) {
      return;
    }

    const detachDelayMs = getVideoStreamDetachDelay(stateMachine, connectionId, performance.now(), options.stableDetachMs);
    if (detachDelayMs === null) {
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
      if (currentDetachDelayMs === null) {
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

  const scheduleWatchdog = (connectionId: number, delayMs: number, reason: string) => {
    stopWatchdog();
    if (connectionId !== options.getActiveConnectionId()) {
      return;
    }

    watchdogTimer = window.setTimeout(() => {
      watchdogTimer = null;
      void runScheduledWatchdog(connectionId, reason);
    }, Math.max(0, delayMs));
  };

  const getNextWatchdogDelay = () => {
    if (lastVideoStreamPacketAt <= 0) {
      return options.watchdogIntervalMs;
    }

    const packetAgeMs = Math.max(0, performance.now() - lastVideoStreamPacketAt);
    const timeUntilStallMs = options.stallThresholdMs - packetAgeMs;
    if (timeUntilStallMs <= 0) {
      return options.watchdogIntervalMs;
    }
    return Math.min(options.watchdogIntervalMs, timeUntilStallMs);
  };

  const handleWatchdog = async (connectionId: number, reason: string) => {
    const checkSeq = ++watchdogCheckSeq;
    if (!shouldMonitorVideoStream(connectionId)) {
      resetStallConfirmations();
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
    if (checkSeq !== watchdogCheckSeq || connectionId !== options.getActiveConnectionId()) {
      return;
    }

    const inboundObservation = observeInboundVideoStream(inboundVideoStats);
    const playback = getVideoPlaybackSnapshot();
    const decodeRenderStalled = inboundObservation.hasBaseline && inboundObservation.hasAdvanced && isVideoDecodeRenderStalled(playback, inboundObservation.framesDecodedStalled);

    if (inboundObservation.hasAdvanced && !decodeRenderStalled) {
      markVideoStreamAdvanced(stateMachine, connectionId, now);
      lastVideoStreamPacketAt = now;
      lastVideoStreamDiagnosticAt = 0;
      resetStallConfirmations();
      hasLoggedIdleStaticVideo = false;
      scheduleSignalingDetach(connectionId);
      return;
    }

    if (decodeRenderStalled) {
      const playbackStarved = isVideoPlaybackStarved();
      consecutiveVideoDecodeStallDetections += 1;
      consecutiveVideoStreamStallDetections = consecutiveVideoDecodeStallDetections;
      if (consecutiveVideoDecodeStallDetections < options.stallConfirmationCount || !playbackStarved) {
        const message = playbackStarved
          ? '[WebRTC] Inbound video RTP is advancing but browser decoded/rendered frames are not advancing, waiting for consecutive confirmation.'
          : '[WebRTC] Inbound video RTP is advancing while rendered frames are unchanged; treating as possible static content unless playback becomes starved.';
        logger.debug(message, {
          reason,
          deviceId: options.getDeviceId(),
          tabKey: options.getTabKey(),
          consecutiveVideoStreamStallDetections,
          confirmationThreshold: options.stallConfirmationCount,
          inboundVideoStats,
          playback,
          playbackStarved
        });
        return;
      }

      const stallDetails = buildStallDetails(connectionId, reason, 'browser_decode_stalled_confirmed', inboundVideoStats, playback);
      markUnstable(connectionId, 'browser_decode_stalled');
      options.onVideoStreamStalledConfirmed?.(stallDetails);
      if (now - lastVideoStreamDiagnosticAt >= options.diagnosticIntervalMs) {
        lastVideoStreamDiagnosticAt = now;
        logger.debug('[WebRTC] Browser decode/render appears stalled while inbound video RTP is still advancing.', {
          ...stallDetails
        });
      }
      return;
    }

    if (lastVideoStreamPacketAt <= 0) {
      lastVideoStreamPacketAt = now;
      return;
    }

    if (now - lastVideoStreamPacketAt < options.stallThresholdMs) {
      resetStallConfirmations();
      return;
    }

    if (!isVideoPlaybackStarved()) {
      if (!hasLoggedIdleStaticVideo) {
        hasLoggedIdleStaticVideo = true;
        logger.debug('[WebRTC] Inbound video RTP stream is idle without playback starvation; treating the frame as intentionally static.', {
          reason,
          connectionId,
          deviceId: options.getDeviceId(),
          tabKey: options.getTabKey(),
          inboundVideoStats,
          playback,
          idleDurationMs: Math.max(0, now - lastVideoStreamPacketAt),
          sourceIdleGraceMs
        });
      }

      if (now - lastVideoStreamPacketAt < sourceIdleGraceMs) {
        resetStallConfirmations();
        return;
      }

      consecutiveVideoStreamStallDetections = 0;
      consecutiveVideoDecodeStallDetections = 0;
      if (now - lastVideoStreamDiagnosticAt >= options.diagnosticIntervalMs) {
        lastVideoStreamDiagnosticAt = now;
        const stallDetails = buildStallDetails(connectionId, reason, 'source_packet_idle_observed', inboundVideoStats, playback);
        logger.debug('[WebRTC] Inbound video RTP remains idle beyond static grace; keeping the held frame because frontend cannot distinguish static content from source idle.', {
          ...stallDetails,
          reason,
          deviceId: options.getDeviceId(),
          tabKey: options.getTabKey(),
          idleDurationMs: Math.max(0, now - lastVideoStreamPacketAt),
          sourceIdleGraceMs
        });
      }
      return;
    }

    consecutiveVideoStreamStallDetections += 1;
    consecutiveVideoDecodeStallDetections = 0;
    if (consecutiveVideoStreamStallDetections < options.stallConfirmationCount) {
      logger.debug('[WebRTC] Browser playback is starved while inbound video RTP is not advancing, waiting for consecutive confirmation.', {
        reason,
        deviceId: options.getDeviceId(),
        tabKey: options.getTabKey(),
        consecutiveVideoStreamStallDetections,
        confirmationThreshold: options.stallConfirmationCount,
        inboundVideoStats
      });
      return;
    }

    const stallDetails = buildStallDetails(connectionId, reason, 'browser_playback_starved_confirmed', inboundVideoStats, playback);
    markUnstable(connectionId, 'browser_playback_starved');
    options.onVideoStreamStalledConfirmed?.(stallDetails);
    if (now - lastVideoStreamDiagnosticAt < options.diagnosticIntervalMs) {
      return;
    }

    lastVideoStreamDiagnosticAt = now;
    logger.debug('[WebRTC] Browser playback remains starved while peer connection is still connected.', {
      ...stallDetails
    });
  };

  const runScheduledWatchdog = async (connectionId: number, reason: string) => {
    await handleWatchdog(connectionId, reason);
    if (shouldMonitorVideoStream(connectionId)) {
      scheduleWatchdog(connectionId, getNextWatchdogDelay(), 'inbound_rtp_watchdog');
    }
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
        const now = performance.now();
        lastRenderedVideoFrameAt = now;
        options.syncVideoFrameSize();
        markRenderedFrameAdvanced(connectionId, now);
        scheduleWatchdog(connectionId, options.stallThresholdMs, 'rendered_frame_timeout');
        scheduleNextFrame();
      });
    };

    scheduleNextFrame();
    scheduleWatchdog(connectionId, options.watchdogIntervalMs, 'inbound_rtp_watchdog');
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
