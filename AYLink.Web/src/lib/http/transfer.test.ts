import { describe, expect, it, vi } from 'vitest';

const { sendApiRequestWithTransportMock } = vi.hoisted(() => ({
  sendApiRequestWithTransportMock: vi.fn(async () => new Response(null, { status: 204 }))
}));

vi.mock('../../core/http/client', () => ({
  sendApiRequestWithTransport: sendApiRequestWithTransportMock
}));

import { readResponseBlobWithProgress, uploadFormDataWithProgress } from './transfer';

describe('transfer', () => {
  it('cancels response body reads after headers are received', async () => {
    const controller = new AbortController();
    const progressEvents: Array<{ loaded: number }> = [];
    const response = new Response(new ReadableStream<Uint8Array>({
      start(streamController) {
        streamController.enqueue(new TextEncoder().encode('first'));
      }
    }), {
      headers: {
        'Content-Length': '10',
        'Content-Type': 'text/plain'
      }
    });

    const readPromise = readResponseBlobWithProgress(response, {
      signal: controller.signal,
      onProgress: (progress) => {
        progressEvents.push({ loaded: progress.loaded });
        controller.abort();
      }
    });

    await expect(readPromise).rejects.toMatchObject({ name: 'AbortError' });
    expect(progressEvents).toEqual([{ loaded: 5 }]);
  });

  it('delegates uploads to the shared authenticated HTTP client', async () => {
    const controller = new AbortController();
    const formData = new FormData();
    formData.append('file', new Blob(['content']), 'file.txt');

    const response = await uploadFormDataWithProgress('/api/devices/1/files/upload', formData, {
      method: 'PUT',
      headers: { 'X-Upload': '1' },
      signal: controller.signal
    });

    expect(response.status).toBe(204);
    expect(sendApiRequestWithTransportMock).toHaveBeenCalledTimes(1);
    expect(sendApiRequestWithTransportMock).toHaveBeenCalledWith(
      '/api/devices/1/files/upload',
      expect.objectContaining({
        method: 'PUT',
        headers: { 'X-Upload': '1' },
        signal: controller.signal,
        body: formData
      }),
      expect.any(Function)
    );
  });
});
