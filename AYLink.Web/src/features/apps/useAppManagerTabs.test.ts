import { createApp, defineComponent, nextTick, reactive } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const routeState = reactive({
  name: 'apps',
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

import { useAppManagerTabs } from './useAppManagerTabs';

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

describe('useAppManagerTabs', () => {
  let unmount: (() => void) | null = null;

  beforeEach(() => {
    window.sessionStorage.clear();
    routeState.name = 'apps';
    routeState.query = {};
    routerReplace.mockClear();
    consumeWorkspaceOpenMock.mockReset();
  });

  afterEach(() => {
    unmount?.();
    unmount = null;
  });

  it('creates tabs from route query and syncs active device id', async () => {
    routeState.query = {
      deviceId: '42',
      deviceName: 'Pixel'
    };

    const mounted = mountComposable(() => useAppManagerTabs(
      () => '应用管理',
      async () => undefined,
    ));
    unmount = mounted.unmount;

    await nextTick();

    expect(mounted.result.appTabs.value).toEqual([
      { key: '42::apps', deviceId: '42', deviceName: 'Pixel' }
    ]);
    expect(mounted.result.activeTabKey.value).toBe('42::apps');
    expect(mounted.result.deviceId.value).toBe('42');
    expect(routerReplace).toHaveBeenCalled();
  });

  it('restores persisted tabs and falls back active key to first tab', () => {
    window.sessionStorage.setItem('aylink_app_tabs', JSON.stringify([
      { key: 'a::apps', deviceId: 'a', deviceName: 'A' },
      { key: 'b::apps', deviceId: 'b', deviceName: 'B' }
    ]));
    window.sessionStorage.setItem('aylink_app_active_tab', 'missing');

    const mounted = mountComposable(() => useAppManagerTabs(
      () => '应用管理',
      async () => undefined,
    ));
    unmount = mounted.unmount;

    mounted.result.loadPersistedTabs();

    expect(mounted.result.appTabs.value).toHaveLength(2);
    expect(mounted.result.activeTabKey.value).toBe('a::apps');
    expect(mounted.result.deviceId.value).toBe('a');
  });

  it('consumes workspace open requests into tabs', async () => {
    consumeWorkspaceOpenMock.mockReturnValueOnce({
      deviceId: '77',
      deviceName: 'Tablet'
    });

    const onTabChanged = vi.fn(async () => undefined);
    const mounted = mountComposable(() => useAppManagerTabs(
      () => '应用管理',
      onTabChanged,
    ));
    unmount = mounted.unmount;

    await nextTick();

    expect(mounted.result.activeTabKey.value).toBe('77::apps');
    expect(mounted.result.deviceId.value).toBe('77');
    expect(onTabChanged).toHaveBeenCalled();
  });
});
