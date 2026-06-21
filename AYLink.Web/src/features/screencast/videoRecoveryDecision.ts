export type UnifiedVideoStreamState =
  | 'idle'
  | 'connecting'
  | 'observing'
  | 'stable'
  | 'degraded'
  | 'stalled'
  | 'recovering'
  | 'detached';

export type UnifiedVideoHealthOrigin =
  | 'unknown'
  | 'source'
  | 'sender'
  | 'transport'
  | 'client';

export type UnifiedVideoRecoveryAction =
  | 'observe'
  | 'keyframe_replay'
  | 'source_refresh'
  | 'signaling_reattach'
  | 'renegotiate'
  | 'ice_restart'
  | 'reconnect';

export interface AgentVideoHealthSnapshot {
  state?: string;
  origin?: string;
  reason?: string;
  source?: {
    state?: string;
    reason?: string;
  };
  sender?: {
    state?: string;
    peerConnected?: boolean;
  };
  transport?: {
    peerConnectionState?: string;
    signalingAttached?: boolean;
    sessionClosed?: boolean;
  };
}

export interface ClientVideoHealthSnapshot {
  state: string;
  reason: string;
  signalingAttached: boolean;
  peerConnectionState: RTCPeerConnectionState | null;
}

export interface UnifiedVideoRecoveryDecision {
  state: UnifiedVideoStreamState;
  origin: UnifiedVideoHealthOrigin;
  action: UnifiedVideoRecoveryAction;
  reason: string;
}

export function decideVideoRecovery(
  client: ClientVideoHealthSnapshot,
  agent: AgentVideoHealthSnapshot | null
): UnifiedVideoRecoveryDecision {
  const agentOrigin = normalizeOrigin(agent?.origin);
  const agentState = String(agent?.state || '').toLowerCase();
  const agentReason = String(agent?.reason || agent?.source?.reason || agent?.source?.state || '').trim();

  if (agentOrigin === 'source' || agentState === 'stalled') {
    return {
      state: 'stalled',
      origin: 'source',
      action: 'source_refresh',
      reason: agentReason || client.reason
    };
  }

  if (agentOrigin === 'transport' || client.peerConnectionState === 'failed' || client.peerConnectionState === 'disconnected') {
    return {
      state: 'degraded',
      origin: 'transport',
      action: client.signalingAttached ? 'ice_restart' : 'signaling_reattach',
      reason: agentReason || client.reason
    };
  }

  if (!client.signalingAttached) {
    return {
      state: 'detached',
      origin: 'transport',
      action: 'signaling_reattach',
      reason: client.reason
    };
  }

  if (agentOrigin === 'sender') {
    return {
      state: 'recovering',
      origin: 'sender',
      action: 'keyframe_replay',
      reason: agentReason || client.reason
    };
  }

  if (client.state === 'client_decode_stalled_confirmed') {
    return {
      state: 'stalled',
      origin: 'client',
      action: 'renegotiate',
      reason: client.reason
    };
  }

  return {
    state: 'stalled',
    origin: 'client',
    action: 'keyframe_replay',
    reason: client.reason
  };
}

function normalizeOrigin(value: string | undefined): UnifiedVideoHealthOrigin {
  const normalized = (value || '').toLowerCase();
  switch (normalized) {
    case 'source':
    case 'sender':
    case 'transport':
    case 'client':
      return normalized;
    default:
      return 'unknown';
  }
}
