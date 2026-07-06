import { describe, expect, it } from 'vitest';
import { decideVideoRecovery } from './videoRecoveryDecision';

describe('decideVideoRecovery', () => {
  it('keeps confirmed static source under observation for client render stalls', () => {
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
      }
    });

    expect(decision).toEqual({
      state: 'observing',
      origin: 'source',
      action: 'observe',
      reason: 'signaling_detached'
    });
  });

  it('prefers client recovery for decode stalls when source is not static', () => {
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
