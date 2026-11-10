import { beforeEach, describe, expect, it, vi } from 'vitest';
import { storageKeys } from '../core/storage/keys';

describe('active cast session count', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('defaults to one and restores the locally saved count', async () => {
    const { useAppSettings } = await import('./appSettings');
    const settings = useAppSettings();
    expect(settings.activeCastSessionCount.value).toBe(1);
    settings.setActiveCastSessionCount(3);
    expect(localStorage.getItem(storageKeys.app.activeCastSessionCount)).toBe('3');
    vi.resetModules();
    const restored = (await import('./appSettings')).useAppSettings();
    expect(restored.activeCastSessionCount.value).toBe(3);
  });

  it('normalizes counts and accepts zero without enabling unlimited connections', async () => {
    const settings = (await import('./appSettings')).useAppSettings();
    for (const [input, expected] of [[0, 0], [-2, 0], [2.6, 3], [NaN, 1], [Infinity, 1]]) {
      settings.setActiveCastSessionCount(input!);
      expect(settings.activeCastSessionCount.value).toBe(expected);
    }
  });
});
