import { beforeEach, describe, expect, it } from 'vitest';
import { restoreSessionTabs, persistSessionTabs } from './sessionTabs';

interface TestTab {
  key: string;
  title: string;
}

function isTestTab(value: unknown): value is TestTab {
  return !!value
    && typeof value === 'object'
    && typeof (value as TestTab).key === 'string'
    && typeof (value as TestTab).title === 'string';
}

describe('sessionTabs', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('persists tabs and active tab key', () => {
    persistSessionTabs<TestTab>('tabs', 'active', [{ key: 'a', title: 'A' }], 'a');

    const restored = restoreSessionTabs<TestTab>('tabs', 'active', isTestTab);
    expect(restored.tabs).toEqual([{ key: 'a', title: 'A' }]);
    expect(restored.activeTabKey).toBe('a');
  });

  it('falls back to first tab when active key is missing', () => {
    window.sessionStorage.setItem('tabs', JSON.stringify([{ key: 'a', title: 'A' }, { key: 'b', title: 'B' }]));
    window.sessionStorage.setItem('active', 'missing');

    const restored = restoreSessionTabs<TestTab>('tabs', 'active', isTestTab);
    expect(restored.activeTabKey).toBe('a');
  });

  it('filters out invalid tab payloads', () => {
    window.sessionStorage.setItem('tabs', JSON.stringify([{ key: 'a', title: 'A' }, { bad: true }]));

    const restored = restoreSessionTabs<TestTab>('tabs', 'active', isTestTab);
    expect(restored.tabs).toEqual([{ key: 'a', title: 'A' }]);
  });

  it('returns empty state when persisted data is invalid', () => {
    window.sessionStorage.setItem('tabs', '{');

    const restored = restoreSessionTabs<TestTab>('tabs', 'active', isTestTab);
    expect(restored.tabs).toEqual([]);
    expect(restored.activeTabKey).toBe('');
  });
});
