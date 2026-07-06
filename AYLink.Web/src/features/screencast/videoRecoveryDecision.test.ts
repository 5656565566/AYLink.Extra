import { describe, expect, it } from 'vitest';
import { decideVideoRecovery } from './videoRecoveryDecision';

describe('decideVideoRecovery', () => {
  it('reattaches signaling when static source is paired with detached transport', () => {
    const decision = decideVideoRecovery({
      state: 'client_render_stalled_confirmed',
      reason: 'client_render_stalled',
      signalingAttached: false,
      peerConnectionState: 'connected'
    }, {
      state: 'detached',
      origin: 'transport',
      reason: 'signaling_detached',
      source: {
        state: 'static_but_alive',
        reason: 'holding_last_frame'
      },
      sender: {
        state: 'ready',
        peerConnected: true
      },
      transport: {
        peerConnectionState: 'connected',
        signalingAttached: false,
        sessionClosed: false
      }
    });

    expect(decision).toEqual({
      state: 'degraded',
      origin: 'transport',
      action: 'signaling_reattach',
      reason: 'signaling_detached'
    });
  });

  it('keeps healthy static sources under observation for client render stalls', () => {
    const decision = decideVideoRecovery({
      state: 'client_render_stalled_confirmed',
      reason: 'client_render_stalled',
      signalingAttached: true,
      peerConnectionState: 'connected'
    }, {
      state: 'observing',
      origin: 'sender',
      reason: 'ready',
      source: {
        state: 'static_but_alive',
        reason: 'static_packets_alive'
      },
      sender: {
        state: 'ready',
        peerConnected: true
      },
      transport: {
        peerConnectionState: 'connected',
        signalingAttached: true,
        sessionClosed: false
      }
    });

    expect(decision).toEqual({
      state: 'observing',
      origin: 'source',
      action: 'observe',
      reason: 'ready'
    });
  });

  it('reattaches signaling for decode stalls when transport is detached', () => {
    const decision = decideVideoRecovery({
      state: 'client_decode_stalled_confirmed',
      reason: 'client_decode_stalled',
      signalingAttached: false,
      peerConnectionState: 'connected'
    }, {
      state: 'detached',
      origin: 'transport',
      reason: 'signaling_detached',
      source: {
        state: 'healthy',
        reason: 'packet_pts_advancing'
      }
    });

    expect(decision).toEqual({
      state: 'degraded',
      origin: 'transport',
      action: 'signaling_reattach',
      reason: 'signaling_detached'
    });
  });

  it('prefers client renegotiation for decode stalls when source and transport are healthy', () => {
    const decision = decideVideoRecovery({
      state: 'client_decode_stalled_confirmed',
      reason: 'client_decode_stalled',
      signalingAttached: true,
      peerConnectionState: 'connected'
    }, {
      state: 'observing',
      origin: 'sender',
      reason: 'ready',
      source: {
        state: 'healthy',
        reason: 'packet_pts_advancing'
      },
      sender: {
        state: 'ready',
        peerConnected: true
      },
      transport: {
        peerConnectionState: 'connected',
        signalingAttached: true,
        sessionClosed: false
      }
    });

    expect(decision).toEqual({
      state: 'stalled',
      origin: 'client',
      action: 'renegotiate',
      reason: 'client_decode_stalled'
    });
  });

  it('requests source refresh for packet-idle sources after confirmed client stalls', () => {
    const decision = decideVideoRecovery({
      state: 'client_render_stalled_confirmed',
      reason: 'client_render_stalled',
      signalingAttached: true,
      peerConnectionState: 'connected'
    }, {
      state: 'observing',
      origin: 'sender',
      reason: 'ready',
      source: {
        state: 'packet_idle',
        reason: 'holding_last_frame_packet_idle'
      }
    });

    expect(decision).toEqual({
      state: 'stalled',
      origin: 'source',
      action: 'source_refresh',
      reason: 'holding_last_frame_packet_idle'
    });
  });
});
