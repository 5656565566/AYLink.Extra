import { apiFetch } from '../../utils/api';
import { getAccessToken } from '../../services/auth';

interface Registration { sessionId: string; deviceId: string; tabKey: string; slot: number; open: boolean }

// 前两字节记录编号范围 新登记响应未返回时 旧位图不会关闭后端刚分配的槽位
export function encodeCastBitmap(registrations: Iterable<{ slot: number; open: boolean }>) {
  const slots = [...registrations];
  const count = slots.reduce((maximum, item) => Math.max(maximum, item.slot + 1), 0);
  const bytes = new Uint8Array(2 + Math.ceil(count / 8));
  new DataView(bytes.buffer).setUint16(0, count, true);
  for (const item of slots) if (item.open) bytes[2 + (item.slot >> 3)]! |= 1 << (item.slot % 8);
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function createCastPageHeartbeat(onExpired: () => void) {
  const registrations = new Map<number, Registration>();
  const tabRevisions = new Map<string, number>();
  let pageId = '';
  let pagePromise: Promise<string> | null = null;
  let sequence = 0;
  let epoch = 0;
  let pendingRegistrations = 0;
  let timer: number | null = null;
  let inFlight: Promise<void> | null = null;
  let dirty = false;
  let ticketQueue: Promise<unknown> = Promise.resolve();

  const reset = () => {
    epoch++;
    pageId = '';
    pagePromise = null;
    registrations.clear();
    tabRevisions.clear();
    if (timer !== null) window.clearInterval(timer);
    timer = null;
    window.removeEventListener('pagehide', onPageHide);
  };

  const ensurePage = () => {
    if (pageId) return Promise.resolve(pageId);
    if (pagePromise) return pagePromise;
    const generation = epoch;
    const pending = (async () => {
      const response = await apiFetch('/api/scrcpy-sessions/page', { method: 'POST' });
      if (!response.ok) throw new Error('Failed to register cast page');
      const payload = await response.json() as { p: string };
      if (generation !== epoch) throw new DOMException('Cast page closed', 'AbortError');
      pageId = payload.p;
      sequence = 0;
      window.addEventListener('pagehide', onPageHide);
      return pageId;
    })();
    pagePromise = pending;
    void pending.finally(() => { if (pagePromise === pending) pagePromise = null; }).catch(() => {});
    return pending;
  };

  const flush = (): Promise<void> => {
    dirty = true;
    if (inFlight) return inFlight;
    const pending = (async () => {
      while (dirty && pageId) {
        dirty = false;
        const generation = epoch;
        // 页面标记跟随整个网页 全零位图关闭最后一个标签 也允许新标签同时登记
        const bitmap = encodeCastBitmap(registrations.values());
        const response = await apiFetch('/api/scrcpy-sessions/heartbeat', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ p: pageId, v: ++sequence, b: bitmap }), timeoutMs: 15_000,
        });
        if (generation !== epoch) return;
        if (!response.ok) {
          if ([401, 403, 404].includes(response.status)) { reset(); onExpired(); }
          throw new Error(`Cast heartbeat failed: ${response.status}`);
        }
      }
    })();
    inFlight = pending;
    void pending.finally(() => { if (inFlight === pending) inFlight = null; }).catch(() => {});
    return pending;
  };

  const scheduleHeartbeat = () => {
    void flush().catch((error: unknown) => console.warn('Cast page heartbeat failed:', error));
    if (timer === null && pageId) timer = window.setInterval(() => {
      void flush().catch((error: unknown) => console.warn('Cast page heartbeat failed:', error));
    }, 15_000);
  };

  const issueTicket = async (body: Record<string, unknown>, generation: number, tabKey: string, revision: number) => {
    try {
      if (generation !== epoch) throw new DOMException('Cast page closed', 'AbortError');
      const id = await ensurePage();
      const response = await apiFetch('/api/webrtc-ticket', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, pageId: id }), timeoutMs: 15_000,
      });
      if (generation !== epoch) throw new DOMException('Cast page closed', 'AbortError');
      if (response.ok) {
        const payload = await response.clone().json() as { sessionId: string; slot: number };
        if (generation !== epoch) throw new DOMException('Cast page closed', 'AbortError');
        if (!Number.isInteger(payload.slot) || payload.slot < 0 || payload.slot >= 4096) throw new Error('Invalid cast slot');
        const open = revision === (tabRevisions.get(tabKey) ?? 0);
        registrations.set(payload.slot, { sessionId: payload.sessionId, deviceId: String(body.deviceId), tabKey, slot: payload.slot, open });
        scheduleHeartbeat();
        if (!open) throw new DOMException('Cast tab closed', 'AbortError');
      } else if (response.status === 404) { reset(); onExpired(); }
      return response;
    } finally {
      pendingRegistrations--;
      if (pendingRegistrations === 0 && pageId && ![...registrations.values()].some((item) => item.open)) scheduleHeartbeat();
    }
  };

  const requestTicket = (body: Record<string, unknown>, tabKey: string) => {
    pendingRegistrations++;
    const generation = epoch;
    const revision = tabRevisions.get(tabKey) ?? 0;
    const pending = ticketQueue.then(() => issueTicket(body, generation, tabKey, revision));
    ticketQueue = pending.catch(() => {});
    return pending;
  };

  const releaseSession = async (deviceId: string, sessionId: string) => {
    for (const entry of registrations.values()) {
      if (entry.deviceId === deviceId && entry.sessionId === sessionId) entry.open = false;
    }
    if (pageId) await flush();
  };

  const releaseTab = async (tabKey: string) => {
    tabRevisions.set(tabKey, (tabRevisions.get(tabKey) ?? 0) + 1);
    for (const entry of registrations.values()) if (entry.tabKey === tabKey) entry.open = false;
    if (pageId) await flush();
  };

  const releasePage = (unloading = false) => {
    if (pageId) {
      const body = JSON.stringify({ p: pageId, v: ++sequence, b: '' });
      if (unloading) {
        // 关闭网页时不能等待刷新凭据；发送失败由后端租约到期回收。
        void fetch('/api/scrcpy-sessions/heartbeat', {
          method: 'POST', keepalive: true,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAccessToken()}` }, body,
        }).catch(() => {});
      } else {
        void apiFetch('/api/scrcpy-sessions/heartbeat', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
        }).catch((error: unknown) => console.warn('Cast page release failed:', error));
      }
    }
    reset();
  };

  function onPageHide() { releasePage(true); onExpired(); }

  return { requestTicket, releaseSession, releaseTab, releasePage, start: scheduleHeartbeat };
}
