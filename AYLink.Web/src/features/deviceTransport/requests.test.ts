import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerAuthSessionHandlers } from '../../core/http/client';
import { requestDevice, uploadDeviceFile } from './requests';
import { setLocalWebRtcFileTransferPreferred } from '../../services/webrtcSettings';

const { acquire, fallbackUpload, auth } = vi.hoisted(() => ({ acquire: vi.fn(), fallbackUpload: vi.fn(), auth: { currentUser: { value: { Id: 1 } } } }));
vi.mock('./connection', () => ({ deviceConnectionPool: { acquire } }));
vi.mock('../../services/auth', () => ({ useAuth: () => auth }));
vi.mock('../../lib/http/transfer', () => ({ uploadWithProgressTransport: () => fallbackUpload }));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  auth.currentUser.value.Id = 1;
  registerAuthSessionHandlers({
    ensureFreshAccessToken: async () => true, getAccessToken: () => 'token-a', refreshAccessToken: async () => false, syncSessionFromStorage: () => {},
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('preferred device requests', () => {
  it('uses RTC with the original URL, request body and authorization', async () => {
    const request = vi.fn(async () => new Response('file'));
    acquire.mockResolvedValue({ request });
    const fallback = vi.fn(); vi.stubGlobal('fetch', fallback);
    const response = await requestDevice('/api/devices/1/files/download', { method: 'POST', body: '{"path":"/sdcard/test"}' });
    expect(await response.text()).toBe('file');
    const [url, init] = request.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/devices/1/files/download');
    expect(init.body).toBe('{"path":"/sdcard/test"}');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer token-a');
    expect(fallback).not.toHaveBeenCalled();
  });

  it('uses HTTP only when RTC establishment is unavailable', async () => {
    acquire.mockResolvedValue(null);
    const fallback = vi.fn(async () => new Response('fallback')); vi.stubGlobal('fetch', fallback);
    expect(await (await requestDevice('/api/devices/1/files/download')).text()).toBe('fallback');
    expect(fallback).toHaveBeenCalledOnce();
  });

  it.each([
    ['/api/devices/1/files/download', '/api/devices/1/files/upload'],
    ['/api/devices/1/apps/download', '/api/devices/1/apps/install'],
  ])('uses HTTP directly for %s and its upload when the preference is off', async (downloadURL, uploadURL) => {
    setLocalWebRtcFileTransferPreferred(false, '1');
    const fallback = vi.fn(async () => new Response('http-file')); vi.stubGlobal('fetch', fallback);
    fallbackUpload.mockResolvedValue(new Response('{"ok":true}'));
    expect(await (await requestDevice(downloadURL)).text()).toBe('http-file');
    const form = new FormData(); form.append('file', new File(['file'], 'test.bin'));
    expect(await (await uploadDeviceFile(uploadURL, form)).json()).toEqual({ ok: true });
    expect(acquire).not.toHaveBeenCalled();
    expect(fallback).toHaveBeenCalledOnce();
    expect(fallbackUpload).toHaveBeenCalledOnce();
  });

  it('loads the current account preference for every new transfer', async () => {
    setLocalWebRtcFileTransferPreferred(false, '1');
    const fallback = vi.fn(async () => new Response('http-file')); vi.stubGlobal('fetch', fallback);
    const request = vi.fn(async () => new Response('rtc-file'));
    acquire.mockResolvedValue({ request });
    const url = '/api/devices/1/files/download';
    expect(await (await requestDevice(url)).text()).toBe('http-file');
    auth.currentUser.value.Id = 2;
    expect(await (await requestDevice(url)).text()).toBe('rtc-file');
    auth.currentUser.value.Id = 1;
    setLocalWebRtcFileTransferPreferred(true, '1');
    expect(await (await requestDevice(url)).text()).toBe('rtc-file');
    expect(fallback).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('never replays a started RTC operation over HTTP after failure', async () => {
    const request = vi.fn().mockRejectedValue(new Error('peer lost after upload started'));
    acquire.mockResolvedValue({ request });
    vi.stubGlobal('fetch', vi.fn());
    await expect(requestDevice('/api/devices/1/files/download')).rejects.toThrow('peer lost');
    const form = new FormData(); form.append('file', new File(['apk'], 'app.apk'));
    await expect(uploadDeviceFile('/api/devices/1/apps/install', form)).rejects.toThrow('peer lost');
    expect(fetch).not.toHaveBeenCalled();
    expect(fallbackUpload).not.toHaveBeenCalled();
  });

  it('retains XHR progress on fallback and consumes successful upload responses', async () => {
    acquire.mockResolvedValue(null);
    fallbackUpload.mockResolvedValue(new Response('{"ok":true}', { headers: { 'Content-Type': 'application/json' } }));
    const form = new FormData(); form.append('file', new File(['file'], 'test.txt'));
    expect(await (await uploadDeviceFile('/api/devices/1/files/upload', form)).json()).toEqual({ ok: true });
    expect(fallbackUpload).toHaveBeenCalledOnce();
  });
});
