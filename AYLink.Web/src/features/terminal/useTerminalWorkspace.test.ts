import { createApp, defineComponent, nextTick, reactive, ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const routeState = reactive({
  name: 'terminal',
  query: {} as Record<string, string>
});

const routerReplace = vi.fn(async () => undefined);
const consumeWorkspaceOpenMock = vi.fn();

vi.mock('vue-router', () => ({
  useRoute: () => routeState,
  useRouter: () => ({
    replace: routerReplace
  })
}));

vi.mock('../../composables/useI18n', () => ({
  useI18n: () => ({
    t: (_key: string, fallback = '') => fallback
  })
}));

vi.mock('../../services/theme', () => ({
  useTheme: () => ({
    resolvedTheme: ref('dark')
  })
}));

vi.mock('../../services/auth', () => ({
  getAccessToken: () => ''
}));

vi.mock('../../services/workspaceNavigation', () => ({
  consumeWorkspaceOpen: (...args: unknown[]) => consumeWorkspaceOpenMock(...args)
}));

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    loadAddon() {}
    open() {}
    write() {}
    onData() { return { dispose() {} }; }
    onResize() { return { dispose() {} }; }
    dispose() {}
  }
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {}
  }
}));

import { useTerminalWorkspace } from './useTerminalWorkspace';

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
    unmount: () => app.unmount()
  };
}

describe('useTerminalWorkspace', () => {
  let unmount: (() => void) | null = null;

  beforeEach(() => {
    window.sessionStorage.clear();
    routeState.name = 'terminal';
    routeState.query = {};
    routerReplace.mockClear();
    consumeWorkspaceOpenMock.mockReset();
  });

  afterEach(() => {
    unmount?.();
    unmount = null;
  });

  it('does not rewrite unrelated routes when kept alive and route query changes', async () => {
    const mounted = mountComposable(() => useTerminalWorkspace());
    unmount = mounted.unmount;
    await nextTick();

    routerReplace.mockClear();
    consumeWorkspaceOpenMock.mockClear();
    routeState.name = 'input-mapping-profiles';
    routeState.query = { mode: 'manage' };
    await nextTick();

    expect(routerReplace).not.toHaveBeenCalled();
    expect(consumeWorkspaceOpenMock).not.toHaveBeenCalledWith('terminal');
  });
});
