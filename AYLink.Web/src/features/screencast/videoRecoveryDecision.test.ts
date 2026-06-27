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
});
