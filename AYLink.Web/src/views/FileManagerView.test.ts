import { computed, ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FileManagerView from './FileManagerView.vue';
import type { FileEntry, FileManagerTab } from '../types/files';

const {
  notificationShow,
  notificationShowProgress,
  notificationUpdate,
  notificationDismiss,
  dialogConfirm,
  dialogPrompt,
  apiFetch,
  readApiErrorMessage,
  uploadFormDataWithProgress,
  activateTabSpy,
  closeTabSpy,
  loadFilesSpy,
} = vi.hoisted(() => ({
  notificationShow: vi.fn(),
  notificationShowProgress: vi.fn(() => 1),
  notificationUpdate: vi.fn(),
  notificationDismiss: vi.fn(),
  dialogConfirm: vi.fn(async () => true),
  dialogPrompt: vi.fn(async () => 'renamed.txt'),
  apiFetch: vi.fn(),
  readApiErrorMessage: vi.fn(async (_response: Response, fallback: string) => fallback),
  uploadFormDataWithProgress: vi.fn(async (_url: string, _formData: FormData, options?: { onProgress?: (progress: { loaded: number; total: number | null; progress: number | null }) => void }) => {
    options?.onProgress?.({ loaded: 12, total: 12, progress: 100 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }),
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
    show: notificationShow,
    showProgress: notificationShowProgress,
    update: notificationUpdate,
    dismiss: notificationDismiss
  })
}));

vi.mock('../utils/api', () => ({
  apiFetch,
  readApiErrorMessage,
}));

vi.mock('../lib/http/transfer', () => ({
  formatBytes: (value: number) => `${value} B`,
  readResponseBlobWithProgress: vi.fn(),
  uploadFormDataWithProgress,
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

  it('creates a browser download ticket and dispatches native download', async () => {
    const wrapper = mountView();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    apiFetch.mockResolvedValueOnce(new Response(JSON.stringify({ url: '/api/file-downloads/ticket-value' }), { status: 200 }));

    await (wrapper.vm as unknown as { browserDownloadEntry: (entry: FileEntry) => Promise<void> }).browserDownloadEntry({
      Name: 'report.txt',
      IsDirectory: false,
      Size: 32,
    });

    expect(apiFetch).toHaveBeenCalledWith('/api/devices/device-a/files/download-ticket', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ path: '/sdcard/report.txt' })
    }));
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(notificationShow).toHaveBeenCalledWith(expect.objectContaining({
      type: 'success'
    }));
    clickSpy.mockRestore();
  });

  it('shows only browser download for files larger than the in-memory download limit', async () => {
    const wrapper = mountView();
    const component = wrapper.vm as unknown as {
      contextMenu: { show: boolean; x: number; y: number; entry: FileEntry | null };
    };
    component.contextMenu.show = true;
    component.contextMenu.entry = {
      Name: 'large.bin',
      IsDirectory: false,
      Size: 129 * 1024 * 1024,
    };

    await wrapper.vm.$nextTick();

    const menuTexts = wrapper.findAll('.context-menu-item').map((item) => item.text());
    expect(menuTexts).not.toContain('下载');
    expect(menuTexts).toContain('浏览器下载');
  });

  it('falls back to browser download when blob download is requested for a large file', async () => {
    const wrapper = mountView();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    apiFetch.mockResolvedValueOnce(new Response(JSON.stringify({ url: '/api/file-downloads/large-ticket' }), { status: 200 }));

    await (wrapper.vm as unknown as { downloadEntry: (entry: FileEntry) => Promise<void> }).downloadEntry({
      Name: 'large.bin',
      IsDirectory: false,
      Size: 129 * 1024 * 1024,
    });

    expect(apiFetch).toHaveBeenCalledWith('/api/devices/device-a/files/download-ticket', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ path: '/sdcard/large.bin' })
    }));
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(notificationShowProgress).not.toHaveBeenCalled();
    clickSpy.mockRestore();
  });

  it('uploads selected files to the current path', async () => {
    const wrapper = mountView();
    apiFetch.mockResolvedValueOnce(new Response(JSON.stringify({ path: '/sdcard/', items: [] }), { status: 200 }));
    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' });
    const input = {
      files: [file],
      value: 'C:\\fakepath\\hello.txt'
    } as unknown as HTMLInputElement;

    await (wrapper.vm as unknown as { handleFilesSelected: (event: Event) => Promise<void> }).handleFilesSelected({ target: input } as unknown as Event);
    await flushPromises();

    expect(uploadFormDataWithProgress).toHaveBeenCalledTimes(1);
    const [url, formData] = uploadFormDataWithProgress.mock.calls[0];
    expect(url).toBe('/api/devices/device-a/files/upload?path=%2Fsdcard%2F');
    const uploadedFile = (formData as FormData).get('file') as File;
    expect(uploadedFile.name).toBe('hello.txt');
    expect(uploadedFile.type).toBe('text/plain');
    expect(apiFetch).toHaveBeenCalledWith('/api/devices/device-a/files/list', expect.objectContaining({
      method: 'POST'
    }));
    expect(notificationShow).toHaveBeenCalledWith(expect.objectContaining({
      type: 'success'
    }));
  });

  it('preserves folder relative paths when uploading a folder', async () => {
    const wrapper = mountView();
    apiFetch.mockResolvedValueOnce(new Response(JSON.stringify({ path: '/sdcard/', items: [] }), { status: 200 }));
    const file = new File(['image'], 'photo.png', { type: 'image/png' });
    Object.defineProperty(file, 'webkitRelativePath', {
      value: 'Album/Nested/photo.png'
    });
    const input = {
      files: [file],
      value: 'C:\\fakepath\\Album'
    } as unknown as HTMLInputElement;

    await (wrapper.vm as unknown as { handleFolderSelected: (event: Event) => Promise<void> }).handleFolderSelected({ target: input } as unknown as Event);
    await flushPromises();

    expect(uploadFormDataWithProgress).toHaveBeenCalledTimes(1);
    const [url] = uploadFormDataWithProgress.mock.calls[0];
    expect(url).toBe('/api/devices/device-a/files/upload?path=%2Fsdcard%2F&relativePath=Album%2FNested%2Fphoto.png');
  });
});
