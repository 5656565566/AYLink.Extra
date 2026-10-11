import { computed, ref } from 'vue';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FileManagerView from './FileManagerView.vue';
import type { FileEntry, FileManagerTab } from '../types/files';

enableAutoUnmount(afterEach);

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
  writeResponseFileWithProgress,
} = vi.hoisted(() => ({
  notificationShow: vi.fn(),
  notificationShowProgress: vi.fn(() => 1),
  notificationUpdate: vi.fn(),
  notificationDismiss: vi.fn(),
  dialogConfirm: vi.fn(async () => true),
  dialogPrompt: vi.fn(async () => 'renamed.txt'),
  apiFetch: vi.fn(),
  readApiErrorMessage: vi.fn(async (_response: Response, fallback: string) => fallback),
  uploadFormDataWithProgress: vi.fn(async (_url: string, _formData: FormData, options?: { signal?: AbortSignal; onProgress?: (progress: { loaded: number; total: number | null; progress: number | null }) => void }) => {
    options?.onProgress?.({ loaded: 12, total: 12, progress: 100 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }),
  activateTabSpy: vi.fn(async () => {}),
  closeTabSpy: vi.fn(async () => {}),
  loadFilesSpy: vi.fn(async () => {}),
  writeResponseFileWithProgress: vi.fn(async () => {}),
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

vi.mock('../features/deviceTransport/requests', () => ({
  requestDevice: apiFetch,
  uploadDeviceFile: uploadFormDataWithProgress,
}));

vi.mock('../lib/http/transfer', () => ({
  formatBytes: (value: number) => `${value} B`,
  readResponseBlobWithProgress: vi.fn(),
  writeResponseFileWithProgress,
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
    updateActiveTabPath: vi.fn((path: string) => {
      if (activeTabRef.value) activeTabRef.value.path = path;
    }),
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
  afterEach(() => { vi.unstubAllGlobals(); });
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

  it('streams large downloads through the device transport when a writable file is available', async () => {
    const target = { write: vi.fn(), close: vi.fn(), abort: vi.fn(async () => {}) };
    const picker = vi.fn(async () => ({ createWritable: async () => target }));
    vi.stubGlobal('showSaveFilePicker', picker);
    const wrapper = mountView();
    const response = new Response('streamed data');
    apiFetch.mockResolvedValueOnce(response);

    const download = (wrapper.vm as unknown as { browserDownloadEntry: (entry: FileEntry) => Promise<void> }).browserDownloadEntry({
      Name: 'large.bin', IsDirectory: false, Size: 129 * 1024 * 1024,
    });
    expect(picker).toHaveBeenCalledWith({ suggestedName: 'large.bin' });
    expect(apiFetch).not.toHaveBeenCalled();
    await download;

    expect(apiFetch).toHaveBeenCalledExactlyOnceWith('/api/devices/device-a/files/download', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ path: '/sdcard/large.bin' }),
    }));
    expect(writeResponseFileWithProgress).toHaveBeenCalledWith(response, target, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(target.abort).not.toHaveBeenCalled();
  });

  it('does not begin a transfer when the save picker is canceled', async () => {
    vi.stubGlobal('showSaveFilePicker', vi.fn(async () => { throw new DOMException('Canceled', 'AbortError'); }));
    const wrapper = mountView();
    await (wrapper.vm as unknown as { browserDownloadEntry: (entry: FileEntry) => Promise<void> }).browserDownloadEntry({
      Name: 'large.bin', IsDirectory: false, Size: 129 * 1024 * 1024,
    });
    expect(apiFetch).not.toHaveBeenCalled();
    expect(notificationShowProgress).not.toHaveBeenCalled();
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

  const loadDirectory = async (wrapper: ReturnType<typeof mountView>, items: FileEntry[]) => {
    apiFetch.mockResolvedValueOnce(new Response(JSON.stringify({ path: currentPathRef.value, items }), { status: 200 }));
    await (wrapper.vm as unknown as { loadFiles: () => Promise<void> }).loadFiles();
    await flushPromises();
  };

  const sampleEntries: FileEntry[] = [
    { Name: 'photo10.png', IsDirectory: false, Size: 100 },
    { Name: 'Download', IsDirectory: true, Size: 0 },
    { Name: 'photo2.png', IsDirectory: false, Size: 200 },
    { Name: '..', IsDirectory: true, Size: 0 },
  ];

  it('sorts names naturally with directories first and filters only the current listing', async () => {
    const wrapper = mountView();
    await loadDirectory(wrapper, sampleEntries);
    const names = () => wrapper.findAll('.file-row .file-name__text').map((item) => item.text());

    expect(names()).toEqual(['Download', 'photo2.png', 'photo10.png']);
    const requests = apiFetch.mock.calls.length;
    await wrapper.find('.search-button').trigger('click');
    await wrapper.find('.file-search input').setValue('PHOTO');
    expect(names()).toEqual(['photo2.png', 'photo10.png']);
    expect(apiFetch).toHaveBeenCalledTimes(requests);
    await wrapper.find('.sort-size').trigger('click');
    expect(names()).toEqual(['photo10.png', 'photo2.png']);
    await wrapper.find('.sort-size').trigger('click');
    expect(names()).toEqual(['photo2.png', 'photo10.png']);
    await wrapper.find('.search-button').trigger('click');
    await wrapper.find('.search-clear').trigger('click');
    expect(names()).toEqual(['Download', 'photo2.png', 'photo10.png']);
  });

  it('distinguishes an empty directory from no search results', async () => {
    const wrapper = mountView();
    await loadDirectory(wrapper, sampleEntries);
    await wrapper.find('.search-button').trigger('click');
    await wrapper.find('.file-search input').setValue('missing');
    expect(wrapper.find('.empty-state').text()).toContain('没有匹配的文件');
    await wrapper.find('.empty-state button').trigger('click');
    expect(wrapper.findAll('.file-row')).toHaveLength(3);
    await loadDirectory(wrapper, []);
    expect(wrapper.find('.empty-state').text()).toContain('当前目录为空');
    expect(wrapper.find('.empty-state button').text()).toBe('上传文件');
  });

  it('expands search with input focus and preserves the filter when collapsed', async () => {
    const wrapper = mountView();
    await loadDirectory(wrapper, sampleEntries);
    const trigger = wrapper.find('.search-button');
    expect(wrapper.find('.file-search').exists()).toBe(false);
    await trigger.trigger('click');
    expect(trigger.attributes('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(wrapper.find('.file-search input').element);
    await wrapper.find('.file-search input').setValue('photo');
    await wrapper.find('.file-search input').trigger('keydown', { key: 'Escape' });
    expect(wrapper.find('.file-search').exists()).toBe(false);
    expect(trigger.attributes('aria-expanded')).toBe('false');
    expect(trigger.classes()).toContain('is-active');
    expect(document.activeElement).toBe(trigger.element);
    expect(wrapper.findAll('.file-row')).toHaveLength(2);
    await trigger.trigger('click');
    expect((wrapper.find('.file-search input').element as HTMLInputElement).value).toBe('photo');
    await wrapper.find('.search-clear').trigger('click');
    expect(wrapper.findAll('.file-row')).toHaveLength(3);
    await trigger.trigger('click');
    expect(trigger.classes()).not.toContain('is-active');
  });

  it('collapses search on an outside click or when opening upload actions', async () => {
    const wrapper = mountView();
    await loadDirectory(wrapper, sampleEntries);
    await wrapper.find('.search-button').trigger('click');
    await wrapper.find('.file-search input').setValue('photo');
    await wrapper.find('.file-row').trigger('click');
    expect(wrapper.find('.file-search').exists()).toBe(false);
    expect(wrapper.findAll('.file-row')).toHaveLength(2);
    await wrapper.find('.search-button').trigger('click');
    await wrapper.find('.upload-button').trigger('click');
    await flushPromises();
    expect(wrapper.find('.file-search').exists()).toBe(false);
    expect(wrapper.findAll('[role="menuitem"]').map((item) => item.text())).toEqual(['上传文件', '上传文件夹']);
  });

  it('opens a breadcrumb ancestor with the correct remote path', async () => {
    activeTabRef.value!.path = '/sdcard/Download/reports/';
    const wrapper = mountView();
    apiFetch.mockResolvedValueOnce(new Response(JSON.stringify({ path: '/sdcard/Download/', items: [] }), { status: 200 }));
    const ancestor = wrapper.findAll('.breadcrumb-button').find((item) => item.text() === 'Download');
    expect(ancestor).toBeDefined();
    await ancestor!.trigger('click');
    await flushPromises();
    expect(apiFetch).toHaveBeenCalledWith('/api/devices/device-a/files/list', expect.objectContaining({
      body: JSON.stringify({ path: '/sdcard/Download/' })
    }));
  });

  it('submits an edited path once on Enter and cancels edits on Escape', async () => {
    const wrapper = mountView();
    await wrapper.find('.path-edit-button').trigger('click');
    await wrapper.find('.path-input').setValue('/sdcard/Pictures');
    apiFetch.mockResolvedValueOnce(new Response(JSON.stringify({ path: '/sdcard/Pictures/', items: [] }), { status: 200 }));
    await wrapper.find('.path-input').trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch).toHaveBeenCalledWith('/api/devices/device-a/files/list', expect.objectContaining({
      body: JSON.stringify({ path: '/sdcard/Pictures/' })
    }));
    await wrapper.find('.path-edit-button').trigger('click');
    await wrapper.find('.path-input').setValue('/changed');
    await wrapper.find('.path-input').trigger('keydown', { key: 'Escape' });
    expect(wrapper.find('.path-input').exists()).toBe(false);
    expect(currentPathRef.value).toBe('/sdcard/Pictures/');
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it('opens row actions with keyboard focus and returns focus on Escape', async () => {
    const wrapper = mountView();
    await loadDirectory(wrapper, [sampleEntries[0]]);
    const trigger = wrapper.find('.row-actions');
    await trigger.trigger('click');
    await flushPromises();
    const items = wrapper.findAll('[role="menuitem"]');
    expect(items.map((item) => item.text())).toContain('重命名');
    expect(document.activeElement).toBe(items[0].element);
    await items[0].trigger('keydown', { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1].element);
    await items[1].trigger('keydown', { key: 'Escape' });
    expect(wrapper.find('.context-menu').exists()).toBe(false);
    expect(document.activeElement).toBe(trigger.element);
  });

  it('offers both upload pickers from the upload menu', async () => {
    const wrapper = mountView();
    const inputClick = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    await wrapper.find('.upload-button').trigger('click');
    await flushPromises();
    expect(wrapper.findAll('[role="menuitem"]').map((item) => item.text())).toEqual(['上传文件', '上传文件夹']);
    await wrapper.findAll('[role="menuitem"]')[1].trigger('click');
    expect(inputClick).toHaveBeenCalledTimes(1);
    expect(inputClick.mock.instances[0]).toBe(wrapper.find('input[webkitdirectory]').element);
    expect(wrapper.find('.context-menu').exists()).toBe(false);
  });

  it('keeps the listing visible during refresh and hides it when the directory changes', async () => {
    const wrapper = mountView();
    await loadDirectory(wrapper, [sampleEntries[0]]);
    let resolve!: (response: Response) => void;
    apiFetch.mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done; }));
    const refresh = (wrapper.vm as unknown as { loadFiles: () => Promise<void> }).loadFiles();
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.file-table').exists()).toBe(true);
    expect(wrapper.find('.refresh-indicator').exists()).toBe(true);
    expect(wrapper.find('.row-actions').attributes('disabled')).toBeDefined();
    resolve(new Response(JSON.stringify({ path: '/sdcard/', items: [sampleEntries[0]] }), { status: 200 }));
    await refresh;

    apiFetch.mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done; }));
    const navigate = (wrapper.vm as unknown as { navigateToPath: (path: string) => Promise<void> }).navigateToPath('/sdcard/Download/');
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.file-table').exists()).toBe(false);
    expect(wrapper.find('.empty-state').text()).toContain('正在加载文件列表');
    resolve(new Response(JSON.stringify({ path: '/sdcard/Download/', items: [] }), { status: 200 }));
    await navigate;
  });

  it('hides the old listing and clears search when switching devices at the same path', async () => {
    const wrapper = mountView();
    await loadDirectory(wrapper, [sampleEntries[0]]);
    await wrapper.find('.search-button').trigger('click');
    await wrapper.find('.file-search input').setValue('photo');
    tabsRef.value[1].path = '/sdcard/';
    activeTabKeyRef.value = 'device-b::files';
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.file-table').exists()).toBe(false);
    expect(wrapper.find('.file-search').exists()).toBe(false);
    expect(wrapper.find('.search-button').classes()).not.toContain('is-active');
    await wrapper.find('.search-button').trigger('click');
    expect((wrapper.find('.file-search input').element as HTMLInputElement).value).toBe('');
  });

  it('offers retry after a listing error', async () => {
    const wrapper = mountView();
    apiFetch.mockResolvedValueOnce(new Response(null, { status: 403 }));
    await (wrapper.vm as unknown as { loadFiles: () => Promise<void> }).loadFiles();
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.empty-state').text()).toContain('无法读取当前目录');
    apiFetch.mockResolvedValueOnce(new Response(JSON.stringify({ path: '/sdcard/', items: sampleEntries }), { status: 200 }));
    await wrapper.find('.retry-button').trigger('click');
    await flushPromises();
    expect(wrapper.findAll('.file-row')).toHaveLength(3);
  });

  it('ignores an old response body that finishes after a device switch', async () => {
    const wrapper = mountView();
    let resolveOldBody!: (body: unknown) => void;
    const oldResponse = new Response(null, { status: 200 });
    vi.spyOn(oldResponse, 'json').mockImplementation(() => new Promise((resolve) => { resolveOldBody = resolve; }));
    apiFetch.mockResolvedValueOnce(oldResponse);
    const oldLoad = (wrapper.vm as unknown as { loadFiles: () => Promise<void> }).loadFiles();
    await flushPromises();
    activeTabKeyRef.value = 'device-b::files';
    await loadDirectory(wrapper, [{ Name: 'new.txt', IsDirectory: false, Size: 8 }]);
    resolveOldBody({ path: '/sdcard/', items: sampleEntries });
    await oldLoad;
    expect(currentPathRef.value).toBe('/sdcard/Download/');
    expect(wrapper.findAll('.file-name__text').map((item) => item.text())).toEqual(['new.txt']);
  });

  it('keeps notification progress and cancellation without a duplicate page transfer bar', async () => {
    const wrapper = mountView();
    let signal: AbortSignal | undefined;
    uploadFormDataWithProgress.mockImplementationOnce((_url, _formData, options) => {
      signal = options?.signal;
      options?.onProgress?.({ loaded: 5, total: 10, progress: 50 });
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      });
    });
    const upload = (wrapper.vm as unknown as { uploadSelectedFiles: (files: File[], preserve: boolean) => Promise<void> })
      .uploadSelectedFiles([new File(['0123456789'], 'sample.txt')], false);
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.transfer-bar').exists()).toBe(false);
    expect(notificationUpdate).toHaveBeenCalledWith(1, expect.objectContaining({ progress: 50, isCancelable: true }));
    const [notification] = notificationShowProgress.mock.calls[0] as unknown as [{ onCancel: () => void }];
    notification.onCancel();
    await upload;
    await flushPromises();
    expect(signal?.aborted).toBe(true);
    expect(wrapper.find('.transfer-bar').exists()).toBe(false);
  });
});
