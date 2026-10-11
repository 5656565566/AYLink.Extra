import { describe, expect, it, vi } from 'vitest';
import { requestOnChannel, RTC_CHUNK_BYTES, RTC_WINDOW_BYTES } from './channel';

function wire(onSend: (data: string | ArrayBuffer) => void) {
  const channel = {
    readyState: 'open', binaryType: 'arraybuffer',
    onmessage: null as ((event: { data: string | ArrayBuffer }) => void) | null,
    onclose: null as (() => void) | null,
    onerror: null as (() => void) | null,
    send: vi.fn((data: string | ArrayBuffer) => onSend(data)),
    close: vi.fn(),
  };
  return channel;
}

describe('RTC request channel', () => {
  it('streams a download larger than the receive window without losing bytes', async () => {
    const payload = new Uint8Array(RTC_WINDOW_BYTES * 3 + 123).map((_, i) => i % 251);
    let position = 0;
    let credit = RTC_WINDOW_BYTES;
    let started = false;
    const send = () => {
      while (position < payload.length && credit > 0) {
        const size = Math.min(RTC_CHUNK_BYTES, credit, payload.length - position);
        const data = payload.slice(position, position + size);
        position += size;
        credit -= size;
        channel.onmessage?.({ data: data.buffer });
      }
      if (position === payload.length && !started) { started = true; channel.onmessage?.({ data: JSON.stringify({ type: 'end' }) }); }
    };
    const channel = wire((data) => {
      if (typeof data !== 'string') return;
      const message = JSON.parse(data);
      if (message.type === 'request') {
        channel.onmessage?.({ data: JSON.stringify({ type: 'response', status: 200 }) });
        send();
      } else if (message.type === 'credit') { credit += message.bytes; send(); }
    });
    const response = await requestOnChannel(channel as unknown as RTCDataChannel, '/api/devices/1/files/download', {});
    expect(position).toBe(RTC_WINDOW_BYTES);
    const actual = new Uint8Array(await response.arrayBuffer());
    expect(actual.byteLength).toBe(payload.byteLength);
    expect(actual.every((byte, index) => byte === payload[index])).toBe(true);
    expect(channel.close).toHaveBeenCalledOnce();
  });

  it('rejects over-credit frames and reports failure after headers', async () => {
    const channel = wire(() => {});
    const pending = requestOnChannel(channel as unknown as RTCDataChannel, '/api/devices/1/files/download', {});
    channel.onmessage?.({ data: JSON.stringify({ type: 'response', status: 200 }) });
    const response = await pending;
    channel.onmessage?.({ data: new ArrayBuffer(RTC_CHUNK_BYTES + 1) });
    await expect(response.arrayBuffer()).rejects.toThrow('receive window');
    expect(channel.close).toHaveBeenCalledOnce();
  });

  it('aborts while waiting for response headers and releases the channel', async () => {
    const controller = new AbortController();
    const channel = wire(() => {});
    const pending = requestOnChannel(channel as unknown as RTCDataChannel, '/api/devices/1/files/upload', { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(channel.close).toHaveBeenCalledOnce();
  });

  it('sends a streaming multipart body matching its declared boundary', async () => {
    const frames: Uint8Array[] = [];
    let headers: Record<string, string> = {};
    const channel = wire((data) => {
      if (typeof data !== 'string') { frames.push(new Uint8Array(data)); return; }
      const message = JSON.parse(data);
      if (message.type === 'request') headers = message.headers;
      if (message.type === 'end') {
        channel.onmessage?.({ data: JSON.stringify({ type: 'response', status: 200 }) });
        channel.onmessage?.({ data: JSON.stringify({ type: 'end' }) });
      }
    });
    const form = new FormData();
    form.append('file', new File(['content\x00bytes'], 'test.apk'));
    const progress = vi.fn();
    const response = await requestOnChannel(channel as unknown as RTCDataChannel, '/api/devices/1/apps/install', { method: 'POST', body: form }, progress);
    await response.arrayBuffer();
    const data = await new Blob(frames as BlobPart[]).text();
    const boundary = new Headers(headers).get('Content-Type')!.split('boundary=')[1];
    expect(data).toContain(`--${boundary}`);
    expect(data).toContain('filename="test.apk"');
    expect(data).toContain('content\x00bytes');
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ progress: 100 }));
  });
});
