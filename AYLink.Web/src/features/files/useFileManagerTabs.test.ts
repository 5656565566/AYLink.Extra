import { createApp, defineComponent, nextTick, reactive } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const routeState = reactive({
  name: 'files',
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

import { useFileManagerTabs } from './useFileManagerTabs';

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

describe('useFileManagerTabs', () => {
  let unmount: (() => void) | null = null;

  beforeEach(() => {
    window.sessionStorage.clear();
    routeState.name = 'files';
    routeState.query = {};
    routerReplace.mockClear();
    consumeWorkspaceOpenMock.mockReset();
  });

  afterEach(() => {
    unmount?.();
    unmount = null;
  });

  it('normalizes and updates active tab paths', () => {
    const mounted = mountComposable(() => useFileManagerTabs(
      () => '文件管理',
      async () => undefined,
    ));
    unmount = mounted.unmount;

    mounted.result.upsertTab({
      key: '1::files',
      deviceId: '1',
      deviceName: 'Phone',
      path: '/sdcard/'
    });
    mounted.result.activeTabKey.value = '1::files';
    mounted.result.updateActiveTabPath('sdcard\\Download');

    expect(mounted.result.currentPath.value).toBe('/sdcard/Download/');
    expect(mounted.result.canGoUp.value).toBe(true);
    expect(mounted.result.parentPath('/sdcard/Download/')).toBe('/sdcard/');
  });

  it('creates tabs from route query with default path', async () => {
    routeState.query = {
      deviceId: '12',
      deviceName: 'Pixel'
    };

    const mounted = mountComposable(() => useFileManagerTabs(
      () => '文件管理',
      async () => undefined,
    ));
    unmount = mounted.unmount;

    await nextTick();

    expect(mounted.result.tabs.value).toEqual([
      { key: '12::files', deviceId: '12', deviceName: 'Pixel', path: '/sdcard/' }
    ]);
    expect(mounted.result.activeTabKey.value).toBe('12::files');
  });

  it('restores persisted tabs and normalizes stored path values', () => {
    window.sessionStorage.setItem('aylink_file_tabs', JSON.stringify([
      { key: '1::files', deviceId: '1', deviceName: 'Phone', path: 'sdcard\\Download' }
    ]));
    window.sessionStorage.setItem('aylink_file_active_tab', '1::files');

    const mounted = mountComposable(() => useFileManagerTabs(
      () => '文件管理',
      async () => undefined,
    ));
    unmount = mounted.unmount;

    mounted.result.loadPersistedTabs();

    expect(mounted.result.tabs.value[0]?.path).toBe('/sdcard/Download/');
    expect(mounted.result.currentPath.value).toBe('/sdcard/Download/');
  });
});
