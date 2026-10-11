import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeviceConnectionPool, type DeviceConnection } from './connection';

const connection = (): DeviceConnection => ({ isOpen: true, request: vi.fn(), close: vi.fn() });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('DeviceConnectionPool', () => {
  it('shares concurrent establishment and reuses the device connection', async () => {
    let resolve!: (value: DeviceConnection) => void;
    const connect = vi.fn(() => new Promise<DeviceConnection>((done) => { resolve = done; }));
    const pool = new DeviceConnectionPool(connect, () => 'user-a');
    const first = pool.acquire('1');
    const second = pool.acquire('1');
    const peer = connection();
    resolve(peer);
    expect(await first).toBe(peer);
    expect(await second).toBe(peer);
    expect(await pool.acquire('1')).toBe(peer);
    expect(connect).toHaveBeenCalledTimes(1);
    pool.close();
    expect(peer.close).toHaveBeenCalledOnce();
  });

  it('shares establishment failure without retrying each file', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const connect = vi.fn().mockRejectedValueOnce(new Error('ICE failed')).mockResolvedValue(connection());
    const pool = new DeviceConnectionPool(connect, () => 'user-a');
    expect(await pool.acquire('1')).toBeNull();
    expect(await pool.acquire('1')).toBeNull();
    expect(connect).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30_001);
    expect(await pool.acquire('1')).not.toBeNull();
    pool.close();
  });

  it('cancels one waiter without cancelling another shared attempt', async () => {
    let resolve!: (value: DeviceConnection) => void;
    const pool = new DeviceConnectionPool(() => new Promise((done) => { resolve = done; }), () => 'user-a');
    const abort = new AbortController();
    const cancelled = pool.acquire('1', abort.signal);
    const other = pool.acquire('1');
    abort.abort();
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    const peer = connection();
    resolve(peer);
    expect(await other).toBe(peer);
    pool.close();
  });

  it('discards a connection that completes after the account changes', async () => {
    let scope = 'user-a';
    let resolve!: (value: DeviceConnection) => void;
    const connect = vi.fn().mockImplementationOnce(() => new Promise((done) => { resolve = done; })).mockResolvedValue(connection());
    const pool = new DeviceConnectionPool(connect, () => scope);
    const old = pool.acquire('1');
    scope = 'user-b';
    await pool.acquire('1');
    const stale = connection();
    resolve(stale);
    await expect(old).rejects.toMatchObject({ name: 'AbortError' });
    expect(stale.close).toHaveBeenCalledOnce();
    pool.close();
  });
});
