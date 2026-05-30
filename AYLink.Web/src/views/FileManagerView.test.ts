import { computed, ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FileManagerView from './FileManagerView.vue';
import type { FileEntry, FileManagerTab } from '../types/files';

const {
  notificationShow,
  dialogConfirm,
  dialogPrompt,
  apiFetch,
  readApiErrorMessage,
  activateTabSpy,
  closeTabSpy,
  loadFilesSpy,
} = vi.hoisted(() => ({
  notificationShow: vi.fn(),
  dialogConfirm: vi.fn(async () => true),
  dialogPrompt: vi.fn(async () => 'renamed.txt'),
  apiFetch: vi.fn(),
  readApiErrorMessage: vi.fn(async (_response: Response, fallback: string) => fallback),
  activateTabSpy: vi.fn(async () => {}),
  closeTabSpy: vi.fn(async () => {}),
  loadFilesSpy: vi.fn(async () => {}),
}));

const tabsRef = ref<FileManagerTab[]>([]);
const activeTabKeyRef = ref('');
const activeTabRef = computed(() => tabsRef.value.find((tab) => tab.key === activeTabKeyRef.value) ?? null);
const currentPathRef = computed(() => activeTabRef.value?.path ?? '/sdcard/');
const contextMenuEntry = ref<FileEntry | null>(null);

vi.mock('../composables/useI18n', () => ({
  useI18n: () => ({
    t: (_key: string, fallback = '', value?: unknown) => {
      if (typeof value === 'number') {
        return fallback.replace('{0}', String(value));
      }

      return fallback;
    }
  })
}));

vi.mock('../services/dialog', () => ({
  useDialog: () => ({
    confirm: dialogConfirm,
    prompt: dialogPrompt,
  })
}));

vi.mock('../services/notification', () => ({
  useNotification: () => ({
    show: notificationShow
  })
}));

vi.mock('../utils/api', () => ({
  apiFetch,
  readApiErrorMessage,
}));

vi.mock('../features/files/useFileManagerTabs', () => ({
  useFileManagerTabs: (_getTitle: () => string, onTabChanged: () => Promise<void>) => ({
    route: ref({ name: 'files', query: {} }),
    router: { replace: vi.fn(), push: vi.fn() },
    tabs: tabsRef,
    activeTabKey: activeTabKeyRef,
    isFilesRouteActive: computed(() => true),
    activeTab: activeTabRef,
    currentPath: currentPathRef,
    canGoUp: computed(() => currentPathRef.value !== '/'),
    tabItems: computed(() => tabsRef.value.map((tab) => ({
      key: tab.key,
      title: tab.deviceName,
    }))),
    buildTabKey: (deviceId: string) => `${deviceId}::files`,
    normalizePath: (path: string) => {
      let normalized = (path || '/sdcard/').replaceAll('\\', '/').trim();
      if (!normalized.startsWith('/')) normalized = `/${normalized}`;
      if (!normalized.endsWith('/')) normalized = `${normalized}/`;
      return normalized.replace(/\/+/g, '/');
    },
    joinRemotePath: (basePath: string, name: string) => `${basePath}${name}/`.replace(/\/+/g, '/'),
    parentPath: (path: string) => path === '/' ? '/' : '/sdcard/',
    persistTabs: vi.fn(),
    updateActiveTabPath: vi.fn(),
    upsertTab: vi.fn(),
    createTabFromRoute: vi.fn(),
    createTabFromRequest: vi.fn(),
    syncRouteToActiveTab: vi.fn(),
    openTab: vi.fn(async () => {
      await onTabChanged();
    }),
    loadPersistedTabs: vi.fn(),
    consumeIncomingTab: vi.fn(async () => false),
    activateTab: activateTabSpy,
    closeTab: closeTabSpy,
  })
}));

describe('FileManagerView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tabsRef.value = [
      { key: 'device-a::files', deviceId: 'device-a', deviceName: '设备 A', path: '/sdcard/' },
      { key: 'device-b::files', deviceId: 'device-b', deviceName: '设备 B', path: '/sdcard/Download/' },
    ];
    activeTabKeyRef.value = 'device-a::files';
    contextMenuEntry.value = null;
    loadFilesSpy.mockResolvedValue(undefined);
  });

  const mountView = () => mount(FileManagerView, {
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
    expect(activateTabSpy).toHaveBeenCalledWith('device-b::files');
  });

  it('shows an error notification when a file action fails', async () => {
    const wrapper = mountView();

    const component = wrapper.vm as unknown as {
      contextMenu: { show: boolean; x: number; y: number; entry: FileEntry | null };
    };
    component.contextMenu.show = true;
    component.contextMenu.entry = {
      Name: 'broken.txt',
      IsDirectory: false,
      Size: 32,
    };

    apiFetch.mockResolvedValueOnce(new Response(null, { status: 500 }));
    readApiErrorMessage.mockResolvedValueOnce('下载失败');

    await wrapper.vm.$nextTick();
    await wrapper.find('.context-menu-item').trigger('click');
    await flushPromises();

    expect(notificationShow).toHaveBeenCalledWith(expect.objectContaining({
      type: 'error',
      message: '下载失败'
    }));
  });
});
