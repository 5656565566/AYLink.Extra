import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCastPageHeartbeat, encodeCastBitmap } from './castPageHeartbeat';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../../utils/api', () => ({ apiFetch: request }));
vi.mock('../../services/auth', () => ({ getAccessToken: () => 'test-token' }));

describe('cast page HTTP heartbeat', () => {
  const clients: ReturnType<typeof createCastPageHeartbeat>[] = [];
  const bodies = () => request.mock.calls.filter(([url]) => url === '/api/scrcpy-sessions/heartbeat')
    .map(([, init]) => JSON.parse(init.body as string) as { p: string; v: number; b: string });
  beforeEach(() => {
    vi.useFakeTimers();
    request.mockReset();
    let slot = 0;
    request.mockImplementation(async (url: string) => {
      if (url.endsWith('/page')) return new Response(JSON.stringify({ p: 'page-1' }));
      if (url === '/api/webrtc-ticket') {
        const index = slot++;
        return new Response(JSON.stringify({ ticket: `ticket-${index}`, sessionId: `session-${index}`, slot: index }));
      }
      return new Response('{}');
    });
  });
  afterEach(() => {
    for (const client of clients.splice(0)) client.releasePage();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  const createClient = () => {
    const expired = vi.fn();
    const client = createCastPageHeartbeat(expired);
    clients.push(client);
    return { client, expired };
  };

  it('renews all open tabs in one compact request and closes exactly one tab immediately', async () => {
    const { client } = createClient();
    await Promise.all([client.requestTicket({ deviceId: '1' }, 'tab-1'), client.requestTicket({ deviceId: '2' }, 'tab-2')]);
    await vi.advanceTimersByTimeAsync(0);
    expect(request.mock.calls.filter(([url]) => url.endsWith('/page'))).toHaveLength(1);
    request.mockClear();
    await vi.advanceTimersByTimeAsync(15_000);
    const beat = bodies()[0]!;
    expect(Object.keys(beat).sort()).toEqual(['b', 'p', 'v']);
    expect(beat.b).toBe(encodeCastBitmap([{ slot: 0, open: true }, { slot: 1, open: true }]));
    expect(bodies()).toHaveLength(1);
    await client.releaseSession('1', 'session-0');
    expect(bodies().at(-1)!.b).toBe(encodeCastBitmap([{ slot: 0, open: false }, { slot: 1, open: true }]));
    expect(bodies().at(-1)!.v).toBeGreaterThan(beat.v);
    await vi.advanceTimersByTimeAsync(45_000);
    expect(bodies().at(-1)!.b).toBe(encodeCastBitmap([{ slot: 0, open: false }, { slot: 1, open: true }]));
  });

  it('releases the whole page on pagehide and stops the timer', async () => {
    const { client, expired } = createClient();
    const fetchMock = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    await client.requestTicket({ deviceId: '1' }, 'tab-1');
    await vi.advanceTimersByTimeAsync(0);
    request.mockClear();
    window.dispatchEvent(new Event('pagehide'));
    const init = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init[1].keepalive).toBe(true);
    expect(JSON.parse(init[1].body as string).b).toBe('');
    expect(expired).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(request).not.toHaveBeenCalled();
  });

  it('stops owning sessions when authentication or the page expires', async () => {
    const { client, expired } = createClient();
    await client.requestTicket({ deviceId: '1' }, 'tab-1');
    await vi.advanceTimersByTimeAsync(0);
    request.mockResolvedValue(new Response('{}', { status: 401 }));
    await vi.advanceTimersByTimeAsync(15_000);
    expect(expired).toHaveBeenCalledOnce();
    const count = request.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(request).toHaveBeenCalledTimes(count);
  });

  it('does not restart heartbeats from a ticket response received after page disposal', async () => {
    const { client } = createClient();
    let finish!: (response: Response) => void;
    const deferred = new Promise<Response>((resolve) => { finish = resolve; });
    request.mockImplementation(async (url: string) => url.endsWith('/page')
      ? new Response(JSON.stringify({ p: 'page-1' })) : deferred);
    const pending = client.requestTicket({ deviceId: '1' }, 'tab-1');
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(0);
    client.releasePage();
    finish(new Response(JSON.stringify({ sessionId: 'late', slot: 0 })));
    await rejected;
    const count = request.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(request).toHaveBeenCalledTimes(count);
  });

  it('releases a late ticket for a closed tab while other tabs keep renewing', async () => {
    const { client } = createClient();
    await client.requestTicket({ deviceId: '1' }, 'a');
    await vi.advanceTimersByTimeAsync(0);
    let finish!: (response: Response) => void;
    const deferred = new Promise<Response>((resolve) => { finish = resolve; });
    let ticketCount = 0;
    request.mockImplementation(async (url: string) => {
      if (url === '/api/webrtc-ticket') {
        if (++ticketCount === 1) return deferred;
        return new Response(JSON.stringify({ sessionId: 'session-2', slot: 2 }));
      }
      return new Response('{}');
    });
    const pending = client.requestTicket({ deviceId: '2' }, 'b');
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(0);
    await client.releaseTab('b');
    finish(new Response(JSON.stringify({ sessionId: 'session-1', slot: 1 })));
    await rejected;
    await vi.advanceTimersByTimeAsync(0);
    expect(bodies().at(-1)!.b).toBe(encodeCastBitmap([{ slot: 0, open: true }, { slot: 1, open: false }]));
    await client.requestTicket({ deviceId: '2' }, 'b');
    await vi.advanceTimersByTimeAsync(15_000);
    expect(bodies().at(-1)!.b).toBe(encodeCastBitmap([{ slot: 0, open: true }, { slot: 1, open: false }, { slot: 2, open: true }]));
  });

  it('keeps a newly opened tab when the last tab close heartbeat is still in flight', async () => {
    const { client } = createClient();
    await client.requestTicket({ deviceId: '1' }, 'a');
    await vi.advanceTimersByTimeAsync(0);
    let finish!: (response: Response) => void;
    const deferred = new Promise<Response>((resolve) => { finish = resolve; });
    request.mockImplementationOnce(() => deferred);
    const closing = client.releaseTab('a');
    await client.requestTicket({ deviceId: '2' }, 'b');
    finish(new Response('{}'));
    await closing;
    request.mockClear();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(bodies().at(-1)?.b).toBe(encodeCastBitmap([{ slot: 0, open: false }, { slot: 1, open: true }]));
    expect(request.mock.calls.filter(([url]) => url.endsWith('/page'))).toHaveLength(0);
  });

  it('ignores a ticket body decoded after page release', async () => {
    const { client } = createClient();
    let finish!: (value: unknown) => void;
    const deferred = new Promise((resolve) => { finish = resolve; });
    const response = new Response('{}');
    vi.spyOn(response, 'clone').mockReturnValue({ json: () => deferred } as Response);
    request.mockImplementation(async (url: string) => url.endsWith('/page')
      ? new Response(JSON.stringify({ p: 'page-1' })) : response);
    const pending = client.requestTicket({ deviceId: '1' }, 'a');
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(0);
    client.releasePage();
    finish({ sessionId: 'late', slot: 0 });
    await rejected;
    const count = request.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(request).toHaveBeenCalledTimes(count);
  });
});
