import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { createTerminalConnection } from './terminal';

const { acquire } = vi.hoisted(() => ({ acquire: vi.fn() }));
vi.mock('./connection', () => ({ deviceConnectionPool: { acquire } }));
vi.mock('../../services/auth', () => ({ ensureAuthenticatedSession: async () => true, getAccessToken: () => 'fresh-token' }));

let created: FakeSocket[];
class FakeSocket {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  send = vi.fn(); close = vi.fn();
  constructor(_url: string) { created.push(this); }
}
beforeEach(() => { vi.clearAllMocks(); created = []; vi.stubGlobal('WebSocket', FakeSocket); });
afterEach(() => vi.unstubAllGlobals());

describe('terminal transport', () => {
  it('uses WS only after RTC establishment failure', async () => {
    acquire.mockResolvedValue(null);
    const terminal = createTerminalConnection('1', () => 'ws://localhost/terminal');
    const opened = vi.fn(); terminal.onopen = opened;
    await flushPromises();
    expect(created).toHaveLength(1);
    created[0].onopen?.();
    expect(opened).toHaveBeenCalledOnce();
    terminal.send('{"type":"input","data":"ls"}');
    expect(created[0].send).toHaveBeenCalledWith('{"type":"input","data":"ls"}');
    terminal.close();
  });

  it('does not fall back to WS after the RTC terminal request starts', async () => {
    acquire.mockResolvedValue({ request: vi.fn().mockRejectedValue(new Error('peer lost')) });
    const terminal = createTerminalConnection('1', () => 'ws://localhost/terminal');
    const error = vi.fn(); terminal.onerror = error;
    await flushPromises();
    expect(error).toHaveBeenCalledOnce();
    expect(terminal.readyState).toBe(3);
    expect(created).toHaveLength(0);
  });

  it('parses split output messages and sends terminal input as NDJSON', async () => {
    let output!: ReadableStreamDefaultController<Uint8Array>;
    let input!: ReadableStream<Uint8Array>;
    const request = vi.fn(async (_url: string, init: RequestInit) => {
      input = init.body as ReadableStream<Uint8Array>;
      expect(new Headers(init.headers).get('Authorization')).toBe('Bearer fresh-token');
      return new Response(new ReadableStream<Uint8Array>({ start(controller) { output = controller; } }));
    });
    acquire.mockResolvedValue({ request });
    const terminal = createTerminalConnection('1', () => 'ws://localhost/terminal');
    const messages = vi.fn(); terminal.onmessage = messages;
    await flushPromises();
    const encoded = new TextEncoder().encode('{"type":"ready"}\n{"type":"output","data":"你好"}\n');
    output.enqueue(encoded.slice(0, 35)); output.enqueue(encoded.slice(35));
    await flushPromises();
    expect(messages.mock.calls.map(([event]) => JSON.parse(event.data))).toEqual([{ type: 'ready' }, { type: 'output', data: '你好' }]);
    terminal.send('{"type":"resize","cols":80,"rows":24}');
    const reader = input.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('{"type":"resize","cols":80,"rows":24}\n');
    reader.releaseLock();
    output.close();
    await flushPromises();
    expect(terminal.readyState).toBe(3);
    expect(created).toHaveLength(0);
  });
});
