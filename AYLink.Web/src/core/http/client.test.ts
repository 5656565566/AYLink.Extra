import { beforeEach, describe, expect, it, vi } from 'vitest';

const notificationShow = vi.fn();

vi.mock('../../services/notification', () => ({
  useNotification: () => ({
    show: notificationShow
  })
}));

vi.mock('../../services/i18n', () => ({
  t: (_key: string, fallback = '') => fallback
}));

describe('http client', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('adds bearer token for authenticated requests', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-token');
      return new Response(null, { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = await import('./client');
    client.registerAuthSessionHandlers({
      clearSession: vi.fn(),
      ensureFreshAccessToken: vi.fn(async () => {}),
      getAccessToken: () => 'access-token',
      hasActiveAccessToken: () => true,
      refreshAccessToken: vi.fn(async () => false),
      syncSessionFromStorage: vi.fn(),
    });

    await client.sendApiRequest('/api/devices');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries once after a successful refresh', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const refreshAccessToken = vi.fn(async () => true);

    const client = await import('./client');
    client.registerAuthSessionHandlers({
      clearSession: vi.fn(),
      ensureFreshAccessToken: vi.fn(async () => {}),
      getAccessToken: () => 'access-token',
      hasActiveAccessToken: () => true,
      refreshAccessToken,
      syncSessionFromStorage: vi.fn(),
    });

    const response = await client.sendApiRequest('/api/devices');

    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(response.status).toBe(200);
  });

  it('clears session and calls unauthorized handler when refresh fails', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    const clearSession = vi.fn();
    const unauthorizedHandler = vi.fn();

    const client = await import('./client');
    client.registerUnauthorizedHandler(unauthorizedHandler);
    client.registerAuthSessionHandlers({
      clearSession,
      ensureFreshAccessToken: vi.fn(async () => {}),
      getAccessToken: () => 'access-token',
      hasActiveAccessToken: () => false,
      refreshAccessToken: vi.fn(async () => false),
      syncSessionFromStorage: vi.fn(),
    });

    await client.sendApiRequest('/api/devices');

    expect(clearSession).toHaveBeenCalledTimes(1);
    expect(unauthorizedHandler).toHaveBeenCalledTimes(1);
  });

  it('shows a warning notification for forbidden responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 403 })));

    const client = await import('./client');
    client.registerAuthSessionHandlers({
      clearSession: vi.fn(),
      ensureFreshAccessToken: vi.fn(async () => {}),
      getAccessToken: () => 'access-token',
      hasActiveAccessToken: () => true,
      refreshAccessToken: vi.fn(async () => false),
      syncSessionFromStorage: vi.fn(),
    });

    await client.sendApiRequest('/api/devices');

    expect(notificationShow).toHaveBeenCalledTimes(1);
    expect(notificationShow).toHaveBeenCalledWith(expect.objectContaining({
      type: 'warning'
    }));
  });

  it('aborts requests when the caller signal is cancelled', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.signal?.aborted).toBe(true);
      throw new DOMException('The operation was aborted.', 'AbortError');
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = await import('./client');
    client.registerAuthSessionHandlers({
      clearSession: vi.fn(),
      ensureFreshAccessToken: vi.fn(async () => {}),
      getAccessToken: () => 'access-token',
      hasActiveAccessToken: () => true,
      refreshAccessToken: vi.fn(async () => false),
      syncSessionFromStorage: vi.fn(),
    });

    const controller = new AbortController();
    controller.abort();

    await expect(client.sendApiRequest('/api/devices', {
      signal: controller.signal
    })).rejects.toMatchObject({
      name: 'AbortError'
    });
  });

  it('aborts requests when the timeout elapses', async () => {
    vi.useFakeTimers();

    const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      }, { once: true });
    }));
    vi.stubGlobal('fetch', fetchMock);

    const client = await import('./client');
    client.registerAuthSessionHandlers({
      clearSession: vi.fn(),
      ensureFreshAccessToken: vi.fn(async () => {}),
      getAccessToken: () => 'access-token',
      hasActiveAccessToken: () => true,
      refreshAccessToken: vi.fn(async () => false),
      syncSessionFromStorage: vi.fn(),
    });

    const requestPromise = client.sendApiRequest('/api/devices', {
      timeoutMs: 10
    });
    const expectation = expect(requestPromise).rejects.toMatchObject({
      name: 'AbortError'
    });

    await vi.advanceTimersByTimeAsync(10);

    await expectation;

    vi.useRealTimers();
  });
});
