import { describe, expect, it, vi } from 'vitest';
import { normalizeIceCandidate } from './iceCandidate';

describe('normalizeIceCandidate', () => {
  it('adds the candidate prefix to plain candidate strings', () => {
    expect(normalizeIceCandidate('1 1 udp 1 127.0.0.1 9 typ host')).toEqual({
      candidate: 'candidate:1 1 udp 1 127.0.0.1 9 typ host',
      sdpMLineIndex: 0
    });
  });

  it('keeps metadata from JSON candidate payloads', () => {
    expect(normalizeIceCandidate(JSON.stringify({
      candidate: 'candidate:1 1 udp 1 127.0.0.1 9 typ host',
      sdpMid: '0',
      sdpMLineIndex: 1,
      usernameFragment: 'user'
    }))).toEqual({
      candidate: 'candidate:1 1 udp 1 127.0.0.1 9 typ host',
      sdpMid: '0',
      sdpMLineIndex: 1,
      usernameFragment: 'user'
    });
  });

  it('normalizes backend payloads with PascalCase keys and numeric indexes encoded as strings', () => {
    expect(normalizeIceCandidate({
      Candidate: '1 1 udp 1 127.0.0.1 9 typ host',
      SdpMid: 'video',
      SdpMLineIndex: '2',
      UsernameFragment: 'ufrag'
    })).toEqual({
      candidate: 'candidate:1 1 udp 1 127.0.0.1 9 typ host',
      sdpMid: 'video',
      sdpMLineIndex: 2,
      usernameFragment: 'ufrag'
    });
  });

  it('unwraps nested JSON candidate text', () => {
    expect(normalizeIceCandidate({
      candidate: JSON.stringify({ candidate: '1 1 udp 1 127.0.0.1 9 typ host' })
    })).toEqual({
      candidate: 'candidate:1 1 udp 1 127.0.0.1 9 typ host',
      sdpMLineIndex: 0
    });
  });

  it('returns null for missing candidate text', () => {
    expect(normalizeIceCandidate({ sdpMid: '0' })).toBeNull();
  });

  it('warns and returns null for invalid payload types', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(normalizeIceCandidate(123)).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith('Invalid ICE candidate payload:', 123);

    warnSpy.mockRestore();
  });
});
