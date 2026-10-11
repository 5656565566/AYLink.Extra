export const RTC_CHUNK_BYTES = 16 * 1024;
export const RTC_WINDOW_BYTES = 256 * 1024;

interface ControlMessage {
  type: string;
  status?: number;
  headers?: Record<string, string>;
  bytes?: number;
  error?: string;
}

export interface UploadProgress {
  loaded: number;
  total: number | null;
  progress: number | null;
}

export function abortError() { return new DOMException('The operation was aborted.', 'AbortError'); }

export function waitWithSignal<T>(promise: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const abort = () => reject(abortError());
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

// 每个可靠通道仅承载一次请求 通过应用层发送额度限制缓冲区大小
// 避免对端消费缓慢时仅依赖 SCTP 缓冲而持续占用内存
export function requestOnChannel(
  channel: RTCDataChannel,
  url: string,
  init: RequestInit,
  onProgress?: (progress: UploadProgress) => void,
  onFinished: () => void = () => {},
): Promise<Response> {
  channel.binaryType = 'arraybuffer';
  const queue: Uint8Array[] = [];
  let allowance = RTC_WINDOW_BYTES;
  let credit = RTC_WINDOW_BYTES;
  let wakeCredit: (() => void) | undefined;
  let wakeRead: (() => void) | undefined;
  let ended = false;
  let finished = false;
  let failed: Error | undefined;
  let responseStarted = false;
  let bodyReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let bodyController: ReadableStreamDefaultController<Uint8Array> | undefined;
  let resolveResponse!: (response: Response) => void;
  let rejectResponse!: (error: Error) => void;
  const response = new Promise<Response>((resolve, reject) => { resolveResponse = resolve; rejectResponse = reject; });

  const finish = (error?: Error) => {
    if (finished) return;
    finished = true;
    failed = error;
    void bodyReader?.cancel().catch(() => {});
    init.signal?.removeEventListener('abort', onAbort);
    wakeCredit?.();
    wakeRead?.();
    channel.onopen = null;
    channel.onclose = null;
    channel.onerror = null;
    channel.onmessage = null;
    channel.close();
    if (error) { rejectResponse(error); bodyController?.error(error); }
    onFinished();
  };
  const sendControl = (message: object) => {
    if (finished || channel.readyState !== 'open') throw failed ?? new Error('WebRTC data channel closed');
    const encoded = JSON.stringify(message);
    if (new TextEncoder().encode(encoded).byteLength > RTC_CHUNK_BYTES) throw new Error('WebRTC control message too large');
    channel.send(encoded);
  };
  const onAbort = () => finish(abortError());
  init.signal?.addEventListener('abort', onAbort, { once: true });

  channel.onclose = () => finish(new Error('WebRTC data channel closed during request'));
  channel.onerror = () => finish(new Error('WebRTC data channel failed'));
  channel.onmessage = (event) => {
    try {
      if (typeof event.data !== 'string') {
        const chunk = new Uint8Array(event.data as ArrayBuffer);
        if (!responseStarted || ended || chunk.byteLength === 0 || chunk.byteLength > RTC_CHUNK_BYTES || chunk.byteLength > allowance) {
          throw new Error('Invalid WebRTC receive window');
        }
        allowance -= chunk.byteLength;
        queue.push(chunk);
        wakeRead?.();
        return;
      }
      if (new TextEncoder().encode(event.data).byteLength > RTC_CHUNK_BYTES) throw new Error('WebRTC control message too large');
      const message = JSON.parse(event.data) as ControlMessage;
      switch (message.type) {
        case 'credit':
          if (!Number.isInteger(message.bytes) || message.bytes! <= 0 || message.bytes! > RTC_WINDOW_BYTES - credit) throw new Error('Invalid WebRTC credit');
          credit += message.bytes!;
          wakeCredit?.();
          break;
        case 'response': {
          if (responseStarted || !Number.isInteger(message.status) || message.status! < 200 || message.status! > 599) throw new Error('Invalid WebRTC response');
          responseStarted = true;
          const stream = new ReadableStream<Uint8Array>({
            start(controller) { bodyController = controller; },
            async pull(controller) {
              while (!queue.length && !ended && !finished) await new Promise<void>((resolve) => { wakeRead = resolve; });
              wakeRead = undefined;
              if (failed) return;
              const chunk = queue.shift();
              if (chunk) {
                allowance += chunk.byteLength;
                try { sendControl({ type: 'credit', bytes: chunk.byteLength }); }
                catch (error) { finish(error as Error); return; }
                controller.enqueue(chunk);
              } else if (ended) { controller.close(); finish(); }
            },
            cancel() { finish(); },
          }, { highWaterMark: 0 });
          // 原生 Response 不允许这些状态码携带响应体
          const empty = [204, 205, 304].includes(message.status!);
          resolveResponse(new Response(empty ? null : stream, { status: message.status, headers: message.headers }));
          if (empty) void stream.cancel();
          break;
        }
        case 'end':
          if (!responseStarted || ended) throw new Error('Invalid WebRTC end');
          ended = true;
          void bodyReader?.cancel().catch(() => {});
          wakeCredit?.();
          wakeRead?.();
          break;
        case 'error': throw new Error(message.error || 'WebRTC request failed');
        default: throw new Error('Unknown WebRTC message');
      }
    } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
  };

  const sendRequest = async () => {
    if (init.signal?.aborted) { finish(abortError()); return; }
    try {
      // Response 将 FormData 编码为带边界的 multipart 流
      // 后端可直接复用原有上传解析逻辑
      const headers = new Headers(init.headers);
      if (init.body instanceof FormData) {
        const multipart = new Response(init.body);
        headers.set('Content-Type', multipart.headers.get('Content-Type')!);
        bodyReader = multipart.body!.getReader();
      } else {
        const body = init.body instanceof ReadableStream ? init.body : init.body === null || init.body === undefined ? null : new Response(init.body).body;
        bodyReader = body?.getReader();
      }
      const total = init.body instanceof FormData
        ? [...init.body.values()].reduce((sum, value) => sum + (value instanceof Blob ? value.size : new TextEncoder().encode(value).byteLength), 0)
        : null;
      sendControl({ type: 'request', method: init.method || 'GET', url, headers: Object.fromEntries(headers) });
      let loaded = 0;
      while (bodyReader && !ended && !finished) {
        const { done, value } = await bodyReader.read();
        if (done) break;
        let offset = 0;
        while (offset < value.byteLength && !ended && !finished) {
          while (credit === 0 && !ended && !finished) await new Promise<void>((resolve) => { wakeCredit = resolve; });
          wakeCredit = undefined;
          if (ended || finished) break;
          const size = Math.min(RTC_CHUNK_BYTES, credit, value.byteLength - offset);
          credit -= size;
          channel.send(value.slice(offset, offset + size).buffer);
          offset += size;
          loaded += size;
          onProgress?.({ loaded: total ? Math.min(loaded, total) : loaded, total, progress: total ? Math.min(99, loaded / total * 100) : null });
        }
      }
      if (!ended && !finished) {
        sendControl({ type: 'end' });
        onProgress?.({ loaded: total ?? loaded, total: total ?? loaded, progress: 100 });
      }
    } catch (error) { if (!ended && !finished) finish(error instanceof Error ? error : new Error(String(error))); }
  };
  if (channel.readyState === 'open') void sendRequest();
  else channel.onopen = () => { channel.onopen = null; void sendRequest(); };
  return response;
}
