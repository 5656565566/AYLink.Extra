import { describe, expect, it } from 'vitest';
import { buildSignalTicketRequestBody, buildSignalWebSocketBaseUrl, buildSignalWebSocketUrl } from './screencastSignaling';

describe('screencastSignaling', () => {
  it('uses an explicit websocket override when provided', () => {
    expect(buildSignalWebSocketBaseUrl({ protocol: 'https:', host: 'example.test' }, { overrideUrl: 'ws://127.0.0.1:5501/webrtc' })).toBe('ws://127.0.0.1:5501/webrtc');
  });

  it('uses the current origin by default', () => {
    expect(buildSignalWebSocketBaseUrl({ protocol: 'https:', host: 'example.test' })).toBe('wss://example.test/webrtc');
    expect(buildSignalWebSocketBaseUrl({ protocol: 'http:', host: 'example.test' })).toBe('ws://example.test/webrtc');
  });

  it('builds ticket request bodies without empty optional strings', () => {
    expect(buildSignalTicketRequestBody({
      deviceId: 'device-1',
      sessionId: '',
      appPackage: '',
      appName: '',
      newDisplay: true,
      newDisplayWidth: 1280,
      newDisplayHeight: 720,
      newDisplayDpi: 160
    })).toEqual({
      deviceId: 'device-1',
      sessionId: undefined,
      appPackage: undefined,
      appName: undefined,
      newDisplay: true,
      newDisplayWidth: 1280,
      newDisplayHeight: 720,
      newDisplayDpi: 160
    });
  });

  it('encodes ticket values in websocket URLs', () => {
    expect(buildSignalWebSocketUrl('ws://localhost/webrtc', 'a b+c')).toBe('ws://localhost/webrtc?ticket=a%20b%2Bc');
  });
});
