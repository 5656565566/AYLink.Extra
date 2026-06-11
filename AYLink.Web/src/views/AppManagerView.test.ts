import { computed, ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AppManagerView from './AppManagerView.vue';
import type { AppInfo, AppManagerTab } from '../types/apps';

const {
  notificationShow,
  dialogConfirm,
  apiFetch,
  readApiErrorMessage,
  activateTabSpy,
  closeTabSpy,
  runAction,
} = vi.hoisted(() => ({
  notificationShow: vi.fn(),
  dialogConfirm: vi.fn(async () => true),
  apiFetch: vi.fn(),
  readApiErrorMessage: vi.fn(async (_response: Response, fallback: string) => fallback),
  activateTabSpy: vi.fn(async () => {}),
  closeTabSpy: vi.fn(async () => {}),
  runAction: vi.fn(async <T>(action: () => Promise<T>) => action()),
}));

const appTabsRef = ref<AppManagerTab[]>([]);
const activeTabKeyRef = ref('');
const deviceIdRef = ref('device-a');
const activeTabRef = computed(() => appTabsRef.value.find((tab) => tab.key === activeTabKeyRef.value) ?? null);

vi.mock('../composables/useI18n', () => ({
  useI18n: () => ({
    t: (_key: string, fallback = '') => fallback
  })
}));

vi.mock('../services/dialog', () => ({
  useDialog: () => ({
    confirm: dialogConfirm,
  })
}));

vi.mock('../services/notification', () => ({
  useNotification: () => ({
    show: notificationShow
  })
}));

vi.mock('../services/workspaceNavigation', () => ({
  requestWorkspaceOpen: vi.fn()
}));

vi.mock('../features/async/useAsyncAction', () => ({
  useAsyncAction: () => ({
    isRunning: ref(false),
    run: runAction,
  })
}));

vi.mock('../utils/api', () => ({
  apiFetch,
  readApiErrorMessage,
}));

vi.mock('../features/apps/useAppManagerTabs', () => ({
  useAppManagerTabs: () => ({
    route: ref({ name: 'apps', query: {} }),
    router: { replace: vi.fn(), push: vi.fn() },
    appTabs: appTabsRef,
    activeTabKey: activeTabKeyRef,
    deviceId: deviceIdRef,
    isAppsRouteActive: computed(() => true),
    activeTab: activeTabRef,
    tabItems: computed(() => appTabsRef.value.map((tab) => ({
      key: tab.key,
      title: tab.deviceName,
    }))),
    buildTabKey: (deviceId: string) => `${deviceId}::apps`,
    persistTabs: vi.fn(),
    syncRefsFromActiveTab: vi.fn(),
    upsertTab: vi.fn(),
    createTabFromRoute: vi.fn(),
    createTabFromRequest: vi.fn(),
    syncRouteToActiveTab: vi.fn(),
    openTab: vi.fn(),
    loadPersistedTabs: vi.fn(),
    consumeIncomingTab: vi.fn(async () => false),
    activateTab: activateTabSpy,
    closeTab: closeTabSpy,
  })
}));

describe('AppManagerView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appTabsRef.value = [
      { key: 'device-a::apps', deviceId: 'device-a', deviceName: '设备 A' },
      { key: 'device-b::apps', deviceId: 'device-b', deviceName: '设备 B' },
    ];
    activeTabKeyRef.value = 'device-a::apps';
    deviceIdRef.value = 'device-a';
  });

  const mountView = () => mount(AppManagerView, {
    attachTo: document.body,
    global: {
      stubs: {
        Teleport: true,
        WorkspaceTabs: {
          props: ['tabs', 'activeKey'],
          emits: ['select', 'close'],
          template: `
            <div class="workspace-tabs-stub">
              <button
                v-for="tab in tabs"
                :key="tab.key"
                class="workspace-tab-button"
                @click="$emit('select', tab.key)">
                {{ tab.title }}
              </button>
            </div>
          `
        }
      }
    }
  });

  it('switches tabs through the workspace tab bar', async () => {
    const wrapper = mountView();

    const tabButtons = wrapper.findAll('.workspace-tab-button');
    await tabButtons[1].trigger('click');

    expect(activateTabSpy).toHaveBeenCalledTimes(1);
    expect(activateTabSpy).toHaveBeenCalledWith('device-b::apps');
  });

  it('shows an error notification when an app action fails', async () => {
    const wrapper = mountView();

    const component = wrapper.vm as unknown as {
      contextMenu: { show: boolean; x: number; y: number; app: AppInfo | null };
    };
    component.contextMenu.show = true;
    component.contextMenu.app = {
      Name: 'Broken App',
      PackageName: 'com.demo.broken'
    };

    apiFetch.mockResolvedValueOnce(new Response(null, { status: 500 }));
    readApiErrorMessage.mockResolvedValueOnce('APK 下载失败');

    await wrapper.vm.$nextTick();
    const actionItems = wrapper.findAll('.context-menu-item');
    await actionItems[2].trigger('click');
    await flushPromises();

    expect(notificationShow).toHaveBeenCalledWith(expect.objectContaining({
      type: 'error',
      message: 'APK 下载失败'
    }));
  });
});
