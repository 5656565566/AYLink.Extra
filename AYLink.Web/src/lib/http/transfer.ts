import { sendApiRequestWithTransport } from '../../core/http/client';
import type { FileDownloadTarget } from '../browser/operations';

export interface TransferProgress {
  loaded: number;
  total: number | null;
  progress: number | null;
}

export interface DownloadBlobOptions {
  signal?: AbortSignal;
  onProgress?: (progress: TransferProgress) => void;
}

export interface UploadFormDataOptions {
  method?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  onProgress?: (progress: TransferProgress) => void;
}

export function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function parseContentLength(response: Response) {
  const raw = response.headers.get('Content-Length');
  if (!raw) {
    return null;
  }

  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function createAbortError() {
  return new DOMException('The operation was aborted.', 'AbortError');
}

function parseResponseHeaders(rawHeaders: string) {
  const headers = new Headers();
  rawHeaders.trim().split(/[\r\n]+/).forEach((line) => {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex <= 0) {
      return;
    }

    headers.append(line.slice(0, separatorIndex).trim(), line.slice(separatorIndex + 1).trim());
  });
  return headers;
}

export function uploadWithProgressTransport(onProgress?: (progress: TransferProgress) => void) {
  return (url: string, init: RequestInit) => new Promise<Response>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const cleanupCallbacks: Array<() => void> = [];

    xhr.open(init.method || 'POST', url);

    new Headers(init.headers || {}).forEach((value, key) => {
      xhr.setRequestHeader(key, value);
    });

    xhr.upload.onprogress = (event) => {
      const total = event.lengthComputable && event.total > 0 ? event.total : null;
      onProgress?.({
        loaded: event.loaded,
        total,
        progress: total ? event.loaded / total * 100 : null,
      });
    };

    xhr.onload = () => {
      cleanupCallbacks.forEach((callback) => callback());
      resolve(new Response(xhr.responseText, {
        status: xhr.status,
        statusText: xhr.statusText,
        headers: parseResponseHeaders(xhr.getAllResponseHeaders()),
      }));
    };

    xhr.onerror = () => {
      cleanupCallbacks.forEach((callback) => callback());
      reject(new Error('上传请求失败'));
    };

    xhr.onabort = () => {
      cleanupCallbacks.forEach((callback) => callback());
      reject(createAbortError());
    };

    if (init.signal) {
      if (init.signal.aborted) {
        xhr.abort();
        return;
      }

      const onAbort = () => xhr.abort();
      init.signal.addEventListener('abort', onAbort, { once: true });
      cleanupCallbacks.push(() => init.signal?.removeEventListener('abort', onAbort));
    }

    xhr.send(init.body as XMLHttpRequestBodyInit | null);
  });
}

async function consumeResponseChunks(response: Response, options: DownloadBlobOptions, consume: (chunk: Uint8Array) => void | Promise<void>) {
  const total = parseContentLength(response);
  if (options.signal?.aborted) {
    throw createAbortError();
  }

  if (!response.body) {
    const blob = await response.blob();
    if (options.signal?.aborted) {
      throw createAbortError();
    }
    await consume(new Uint8Array(await blob.arrayBuffer()));
    options.onProgress?.({
      loaded: blob.size,
      total: total ?? blob.size,
      progress: 100,
    });
    return;
  }

  const reader = response.body.getReader();
  let loaded = 0;
  let aborted = false;
  const abortRead = () => {
    aborted = true;
    void reader.cancel(createAbortError()).catch(() => {});
  };

  options.signal?.addEventListener('abort', abortRead, { once: true });

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (aborted || options.signal?.aborted) {
        throw createAbortError();
      }
      if (done) {
        break;
      }

      if (value) {
        await consume(value);
        loaded += value.byteLength;
        options.onProgress?.({
          loaded,
          total,
          progress: total ? loaded / total * 100 : null,
        });
      }
    }

    options.onProgress?.({
      loaded,
      total,
      progress: 100,
    });
  } catch (error) {
    // 消费端失败时（例如磁盘已满）同步停止上游数据传输
    await reader.cancel(error).catch(() => {});
    throw error;
  } finally {
    options.signal?.removeEventListener('abort', abortRead);
    reader.releaseLock();
  }
}

export async function readResponseBlobWithProgress(response: Response, options: DownloadBlobOptions = {}) {
  const chunks: BlobPart[] = [];
  await consumeResponseChunks(response, options, (chunk) => { chunks.push(chunk as BlobPart); });
  return new Blob(chunks, { type: response.headers.get('Content-Type') || 'application/octet-stream' });
}

export async function writeResponseFileWithProgress(response: Response, target: FileDownloadTarget, options: DownloadBlobOptions = {}) {
  await consumeResponseChunks(response, options, (chunk) => target.write(chunk));
  if (options.signal?.aborted) throw createAbortError();
  await target.close();
}

export async function uploadFormDataWithProgress(url: string, formData: FormData, options: UploadFormDataOptions = {}) {
  return sendApiRequestWithTransport(url, {
    method: options.method || 'POST',
    headers: options.headers,
    signal: options.signal,
    body: formData,
  }, uploadWithProgressTransport(options.onProgress));
}
