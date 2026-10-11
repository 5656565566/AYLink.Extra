// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { requestOnChannel } from './channel';

// 使用原生 Fetch 验证响应头 避免模拟 DOM 宽松的字符校验掩盖浏览器报错
describe('RTC download headers with native Fetch', () => {
  it.each([
    ['/api/devices/1/files/download', '季度 报告.txt'],
    ['/api/devices/1/apps/download', '应用🚀.apk'],
  ])('accepts an encoded Unicode filename from %s and consumes the response', async (url, filename) => {
    const disposition = `attachment; filename*=utf-8''${encodeURIComponent(filename)}`;
    const channel = {
      readyState: 'open',
      onmessage: null as ((event: { data: string | ArrayBuffer }) => void) | null,
      send: vi.fn((data: string | ArrayBuffer) => {
        if (typeof data !== 'string' || JSON.parse(data).type !== 'request') return;
        channel.onmessage?.({ data: JSON.stringify({ type: 'response', status: 200, headers: { 'Content-Disposition': disposition } }) });
        channel.onmessage?.({ data: new TextEncoder().encode('file-content').buffer });
        channel.onmessage?.({ data: JSON.stringify({ type: 'end' }) });
      }),
      close: vi.fn(),
    };
    const response = await requestOnChannel(channel as unknown as RTCDataChannel, url, {});
    expect(decodeURIComponent(response.headers.get('Content-Disposition')!.split("utf-8''")[1]!)).toBe(filename);
    expect(await response.text()).toBe('file-content');
    expect(channel.close).toHaveBeenCalledOnce();
  });
});
