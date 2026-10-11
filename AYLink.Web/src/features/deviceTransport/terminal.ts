import { ensureAuthenticatedSession, getAccessToken } from '../../services/auth';
import { deviceConnectionPool } from './connection';
import { abortError } from './channel';

// 终端页面通过此接口收发事件 无需区分底层使用 WebSocket 还是 RTC
export interface TerminalConnection {
  readonly readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
  send(data: string): void;
  close(): void;
}

export function createTerminalConnection(deviceID: string, fallbackURL: () => string): TerminalConnection {
  const controller = new AbortController();
  let state = 0;
  let socket: WebSocket | undefined;
  let input: ReadableStreamDefaultController<Uint8Array> | undefined;
  const encoder = new TextEncoder();
  const close = () => {
    if (state === 3) return;
    state = 3;
    controller.abort();
    socket?.close();
    transport.onclose?.();
  };
  const transport: TerminalConnection = {
    get readyState() { return state; },
    onopen: null, onmessage: null, onerror: null, onclose: null,
    send(data) {
      if (state !== 1) return;
      if (socket) socket.send(data);
      else if (input) {
        const bytes = encoder.encode(`${data}\n`);
        if ((input.desiredSize ?? 0) < bytes.byteLength) { transport.onerror?.(); close(); return; }
        input.enqueue(bytes);
      }
    },
    close,
  };

  const connect = async () => {
    try {
      if (!await ensureAuthenticatedSession()) throw new Error('Terminal authentication expired');
      const connection = await deviceConnectionPool.acquire(deviceID, controller.signal);
      if (controller.signal.aborted) throw abortError();
      if (!connection) {
        socket = new WebSocket(fallbackURL());
        socket.onopen = () => { if (state !== 3) { state = 1; transport.onopen?.(); } };
        socket.onmessage = (event) => transport.onmessage?.({ data: String(event.data) });
        socket.onerror = () => transport.onerror?.();
        socket.onclose = close;
        return;
      }
      const body = new ReadableStream<Uint8Array>({ start(value) { input = value; } }, {
        highWaterMark: 256 * 1024, size: (chunk) => chunk.byteLength,
      });
      const response = await connection.request(`/api/devices/${encodeURIComponent(deviceID)}/terminal/stream`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-ndjson', Authorization: `Bearer ${getAccessToken()}` },
        body, signal: controller.signal,
      });
      if (!response.ok || !response.body) throw new Error(`Terminal request failed (${response.status})`);
      if (state === 3) { await response.body.cancel(); return; }
      state = 1;
      transport.onopen?.();
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = '';
      try {
        while (!controller.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          pending += decoder.decode(value, { stream: true });
          let newline: number;
          while ((newline = pending.indexOf('\n')) >= 0) {
            transport.onmessage?.({ data: pending.slice(0, newline) });
            pending = pending.slice(newline + 1);
          }
          if (pending.length > 1024 * 1024) throw new Error('Terminal message exceeds size limit');
        }
      } finally { reader.releaseLock(); }
      close();
    } catch {
      if (state !== 3) { transport.onerror?.(); close(); }
    }
  };
  void connect();
  return transport;
}
