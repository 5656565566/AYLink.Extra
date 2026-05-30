import { createApp, defineComponent, reactive } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const routeState = reactive({
  name: 'screencast',
  query: {} as Record<string, string>,
});

const routerReplace = vi.fn(async () => undefined);
const routerState = {
  replace: routerReplace,
};

const consumeWorkspaceOpenMock = vi.fn();

vi.mock('vue-router', () => ({
  useRoute: () => routeState,
  useRouter: () => routerState,
}));

vi.mock('../../services/workspaceNavigation', () => ({
  consumeWorkspaceOpen: (...args: unknown[]) => consumeWorkspaceOpenMock(...args),
}));

import { useCastTabs } from './useCastTabs';

function mountComposable<T>(factory: () => T) {
  let result!: T;
  const app = createApp(defineComponent({
    setup() {
      result = factory();
      return () => null;
    }
  }));

  const host = document.createElement('div');
  app.mount(host);

  return {
    result,
    unmount: () => app.unmount(),
  };
}

describe('useCastTabs', () => {
  let unmount: (() => void) | null = null;

  beforeEach(() => {
    window.sessionStorage.clear();
    routeState.name = 'screencast';
    routeState.query = {};
    routerReplace.mockClear();
    consumeWorkspaceOpenMock.mockReset();
  });

  afterEach(() => {
    unmount?.();
    unmount = null;
  });

  it('builds distinct tab keys for app and new display modes', () => {
    const mounted = mountComposable(() => useCastTabs((tab) => tab.deviceName));
    unmount = mounted.unmount;

    expect(mounted.result.buildTabKey({ deviceId: '1', appPackageName: '', newDisplay: false })).toBe('1::screen');
    expect(mounted.result.buildTabKey({ deviceId: '1', appPackageName: 'pkg.demo', newDisplay: false })).toBe('1::screen::pkg.demo');
    expect(mounted.result.buildTabKey({ deviceId: '1', appPackageName: '', newDisplay: true })).toBe('1::new-display');
  });

  it('creates tabs from route query and preserves display mode flags', () => {
    routeState.query = {
      deviceId: '88',
      appPackage: 'pkg.demo',
      appName: 'Demo App',
      newDisplay: '1'
    };

    const mounted = mountComposable(() => useCastTabs((tab) => tab.deviceName));
    unmount = mounted.unmount;

    const tab = mounted.result.createTabFromQuery('Current Device', '设备投屏');

    expect(tab).toEqual({
      key: '88::new-display::pkg.demo',
      deviceId: '88',
      appPackageName: 'pkg.demo',
      appDisplayName: 'Demo App',
      deviceName: '设备投屏',
      newDisplay: true
    });
  });

  it('loads persisted tabs and resolves the active tab key', () => {
    window.sessionStorage.setItem('aylink_cast_tabs', JSON.stringify([
      { key: '1::screen', deviceId: '1', appPackageName: '', appDisplayName: '', deviceName: 'Phone', newDisplay: false }
    ]));
    window.sessionStorage.setItem('aylink_cast_active_tab', '1::screen');

    const mounted = mountComposable(() => useCastTabs((tab) => tab.deviceName));
    unmount = mounted.unmount;

    const syncRefsFromActiveTab = vi.fn();
    mounted.result.loadPersistedTabs(syncRefsFromActiveTab, '设备投屏');

    expect(mounted.result.activeTabKey.value).toBe('1::screen');
    expect(mounted.result.castTabs.value).toHaveLength(1);
    expect(syncRefsFromActiveTab).toHaveBeenCalled();
  });

  it('consumes workspace open requests into active cast tabs', async () => {
    consumeWorkspaceOpenMock.mockReturnValueOnce({
      deviceId: '55',
      deviceName: 'Phone',
      appPackageName: 'pkg.demo',
      appDisplayName: 'Demo',
      newDisplay: true
    });

    const mounted = mountComposable(() => useCastTabs((tab) => tab.deviceName));
    unmount = mounted.unmount;

    const syncRefsFromActiveTab = vi.fn();
    const onTabOpened = vi.fn(async () => undefined);
    const consumed = await mounted.result.consumeIncomingTab('Current Device', '设备投屏', syncRefsFromActiveTab, onTabOpened);

    expect(consumed).toBe(true);
    expect(mounted.result.activeTabKey.value).toBe('55::new-display::pkg.demo');
    expect(onTabOpened).toHaveBeenCalled();
    expect(syncRefsFromActiveTab).toHaveBeenCalled();
  });
});
