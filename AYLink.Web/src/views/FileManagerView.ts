import { defineComponent } from 'vue';
import { computed, onActivated, onMounted, onUnmounted, watch, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import WorkspaceTabs from '../components/WorkspaceTabs.vue';
import { consumeWorkspaceOpen, type WorkspaceOpenRequest } from '../services/workspaceNavigation';
import { apiFetch, readApiErrorMessage } from '../utils/api';
import { useI18n } from '../composables/useI18n';

export default defineComponent({
  name: 'FileManagerView',
  components: {
    WorkspaceTabs
  },
  setup() {
    interface FileManagerTab {    
      key: string;    
      deviceId: string;    
      deviceName: string;    
      path: string;    
    }

    interface FileEntry {    
      Name: string;    
      IsDirectory: boolean;    
      Size: number;    
    }

    const FILE_TABS_STORAGE_KEY = 'aylink_file_tabs';

    const FILE_ACTIVE_TAB_STORAGE_KEY = 'aylink_file_active_tab';

    const DEFAULT_PATH = '/sdcard/';

    const route = useRoute();

    const router = useRouter();

    const { t } = useI18n();

    const tabs = ref<FileManagerTab[]>([]);

    const activeTabKey = ref('');

    const entries = ref<FileEntry[]>([]);

    const loading = ref(false);

    const errorMessage = ref('');

    const selectedEntry = ref<FileEntry | null>(null);

    const contextMenu = ref({    
      show: false,    
      x: 0,    
      y: 0,    
      entry: null as FileEntry | null    
    });

    const isFilesRouteActive = computed(() => route.name === 'files');

    const activeTab = computed(() => tabs.value.find((tab) => tab.key === activeTabKey.value) ?? null);

    const currentPath = computed(() => activeTab.value?.path ?? DEFAULT_PATH);

    const canGoUp = computed(() => !!activeTab.value && normalizePath(currentPath.value) !== '/');

    const visibleEntries = computed(() => entries.value.filter((entry) => entry.Name !== '.' && entry.Name !== '..'));

    const tabItems = computed(() => tabs.value.map((tab) => ({    
      key: tab.key,    
      title: tab.deviceName || t('FilePage.Title', '文件管理')    
    })));

    const buildTabKey = (deviceId: string) => `${deviceId || 'empty'}::files`;

    const normalizePath = (path: string) => {    
      let normalized = (path || DEFAULT_PATH).replaceAll('\\', '/').trim();    
      if (!normalized.startsWith('/')) normalized = `/${normalized}`;    
      if (!normalized.endsWith('/')) normalized = `${normalized}/`;    
      return normalized.replace(/\/+/g, '/');    
    };

    const joinRemotePath = (basePath: string, name: string) => normalizePath(`${normalizePath(basePath)}${name}`);

    const getEntryPath = (entry: FileEntry) => {    
      const path = `${normalizePath(currentPath.value)}${entry.Name}`;    
      return entry.IsDirectory ? normalizePath(path) : path.replace(/\/+/g, '/');    
    };

    const parentPath = (path: string) => {    
      const normalized = normalizePath(path);    
      if (normalized === '/') return '/';    
      const parts = normalized.split('/').filter(Boolean);    
      parts.pop();    
      return parts.length === 0 ? '/' : `/${parts.join('/')}/`;    
    };

    const persistTabs = () => {    
      sessionStorage.setItem(FILE_TABS_STORAGE_KEY, JSON.stringify(tabs.value));    
      sessionStorage.setItem(FILE_ACTIVE_TAB_STORAGE_KEY, activeTabKey.value);    
    };

    const updateActiveTabPath = (path: string) => {    
      const tab = activeTab.value;    
      if (!tab) return;    
      tab.path = normalizePath(path);    
      persistTabs();    
    };

    const upsertTab = (tab: FileManagerTab) => {    
      const index = tabs.value.findIndex((item) => item.key === tab.key);    
      if (index >= 0) {    
        tabs.value[index] = { ...tabs.value[index], ...tab };    
      } else {    
        tabs.value.push(tab);    
      }    
      persistTabs();    
    };

    const createTabFromRoute = () => {    
      if (!isFilesRouteActive.value) return null;    
        
      const deviceId = String(route.query.deviceId ?? '').trim();    
      const deviceName = String(route.query.deviceName ?? '').trim() || t('FilePage.Title', '文件管理');    
      if (!deviceId) return null;    
        
      return {    
        key: buildTabKey(deviceId),    
        deviceId,    
        deviceName,    
        path: DEFAULT_PATH    
      } satisfies FileManagerTab;    
    };

    const createTabFromRequest = (request: WorkspaceOpenRequest) => ({    
      key: buildTabKey(request.deviceId),    
      deviceId: request.deviceId,    
      deviceName: request.deviceName || t('FilePage.Title', '文件管理'),    
      path: DEFAULT_PATH    
    }) satisfies FileManagerTab;

    const syncRouteToActiveTab = async () => {    
      if (Object.keys(route.query).length > 0) {    
        await router.replace({ name: 'files', query: {} });    
      }    
    };

    const loadFiles = async () => {    
      const tab = activeTab.value;    
      if (!tab) {    
        entries.value = [];    
        return;    
      }    
        
      loading.value = true;    
      errorMessage.value = '';    
      try {    
        const response = await apiFetch(`/api/devices/${tab.deviceId}/files/list`, {    
          method: 'POST',    
          headers: { 'Content-Type': 'application/json' },    
          body: JSON.stringify({ path: tab.path })    
        });    
        
        if (!response.ok) {    
          errorMessage.value = await getResponseErrorMessage(response, t('FilePage.ReadFailed', '无法读取当前目录'));    
          entries.value = [];    
          return;    
        }    
        
        const payload = await response.json();    
        updateActiveTabPath(payload.path ?? tab.path);    
        entries.value = Array.isArray(payload.items) ? payload.items : [];    
        selectedEntry.value = null;    
      } catch (error) {    
        console.error('Failed to load files', error);    
        errorMessage.value = t('FilePage.LoadFailed', '文件列表加载失败');    
        entries.value = [];    
      } finally {    
        loading.value = false;    
      }    
    };

    const openTab = async (tab: FileManagerTab) => {    
      upsertTab(tab);    
      activeTabKey.value = tab.key;    
      persistTabs();    
      await syncRouteToActiveTab();    
      await loadFiles();    
    };

    const activateTab = async (tabKey: string) => {    
      if (tabKey === activeTabKey.value) return;    
      const tab = tabs.value.find((item) => item.key === tabKey);    
      if (!tab) return;    
      activeTabKey.value = tab.key;    
      persistTabs();    
      await syncRouteToActiveTab();    
      await loadFiles();    
    };

    const closeTab = async (tabKey: string) => {    
      const closingActive = tabKey === activeTabKey.value;    
      const closingIndex = tabs.value.findIndex((item) => item.key === tabKey);    
      if (closingIndex < 0) return;    
        
      tabs.value.splice(closingIndex, 1);    
      if (!closingActive) {    
        persistTabs();    
        return;    
      }    
        
      const nextTab = tabs.value[closingIndex] ?? tabs.value[closingIndex - 1] ?? null;    
      activeTabKey.value = nextTab?.key ?? '';    
      persistTabs();    
      await syncRouteToActiveTab();    
      await loadFiles();    
    };

    const loadPersistedTabs = () => {    
      try {    
        const rawTabs = sessionStorage.getItem(FILE_TABS_STORAGE_KEY);    
        const rawActive = sessionStorage.getItem(FILE_ACTIVE_TAB_STORAGE_KEY) ?? '';    
        const parsedTabs = rawTabs ? JSON.parse(rawTabs) : [];    
        if (Array.isArray(parsedTabs)) {    
          tabs.value = parsedTabs    
            .filter((item): item is FileManagerTab => !!item && typeof item.key === 'string' && typeof item.deviceId === 'string')    
            .map((item) => ({    
              key: item.key,    
              deviceId: item.deviceId,    
              deviceName: item.deviceName ?? t('FilePage.Title', '文件管理'),    
              path: normalizePath(item.path ?? DEFAULT_PATH)    
            }));    
        }    
        activeTabKey.value = tabs.value.some((item) => item.key === rawActive) ? rawActive : tabs.value[0]?.key ?? '';    
      } catch {    
        tabs.value = [];    
        activeTabKey.value = '';    
      }    
    };

    const consumeIncomingTab = async () => {    
      const pendingTab = consumeWorkspaceOpen('files');    
      if (pendingTab) {    
        await openTab(createTabFromRequest(pendingTab));    
        return true;    
      }    
        
      const routeTab = createTabFromRoute();    
      if (routeTab) {    
        await openTab(routeTab);    
        return true;    
      }    
        
      await syncRouteToActiveTab();    
      return false;    
    };

    const openEntry = async (entry: FileEntry) => {    
      if (!entry.IsDirectory) return;    
      updateActiveTabPath(joinRemotePath(currentPath.value, entry.Name));    
      await loadFiles();    
    };

    const selectEntry = (entry: FileEntry) => {    
      selectedEntry.value = entry;    
    };

    const onContextMenu = (event: MouseEvent, entry: FileEntry) => {    
      selectedEntry.value = entry;    
        
      const menuWidth = 180;    
      const menuHeight = 210;    
      let x = event.clientX;    
      let y = event.clientY;    
        
      if (x + menuWidth > window.innerWidth) {    
        x = window.innerWidth - menuWidth;    
      }    
      if (y + menuHeight > window.innerHeight) {    
        y = window.innerHeight - menuHeight;    
      }    
        
      contextMenu.value = {    
        show: true,    
        x,    
        y,    
        entry    
      };    
    };

    const closeContextMenu = () => {    
      contextMenu.value.show = false;    
    };

    const activeDeviceId = computed(() => activeTab.value?.deviceId ?? '');

    const getResponseErrorMessage = async (response: Response, fallback: string) => {
    
      return readApiErrorMessage(response, fallback);
    
    };

    const downloadEntry = async (entry: FileEntry) => {    
      const response = await apiFetch(`/api/devices/${activeDeviceId.value}/files/download`, {    
        method: 'POST',    
        headers: { 'Content-Type': 'application/json' },    
        body: JSON.stringify({ path: getEntryPath(entry) })    
      });    
      if (!response.ok) {    
        throw new Error(await getResponseErrorMessage(response, t('FilePage.DownloadFailed', '下载失败')));    
      }    
        
      const blob = await response.blob();    
      const url = window.URL.createObjectURL(blob);    
      const anchor = document.createElement('a');    
      anchor.href = url;    
      anchor.download = entry.Name || 'download.bin';    
      document.body.appendChild(anchor);    
      anchor.click();    
      anchor.remove();    
      window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);    
    };

    const renameEntry = async (entry: FileEntry) => {    
      const nextName = window.prompt(t('FilePage.RenamePrompt', '请输入新名称'), entry.Name)?.trim();    
      if (!nextName || nextName === entry.Name) {    
        return;    
      }    
        
      const response = await apiFetch(`/api/devices/${activeDeviceId.value}/files/rename`, {    
        method: 'POST',    
        headers: { 'Content-Type': 'application/json' },    
        body: JSON.stringify({    
          path: getEntryPath(entry),    
          newName: nextName    
        })    
      });    
      if (!response.ok) {    
        throw new Error(await getResponseErrorMessage(response, t('FilePage.RenameFailed', '重命名失败')));    
      }    
        
      await loadFiles();    
    };

    const deleteEntry = async (entry: FileEntry) => {    
      const confirmed = window.confirm(    
        t('FilePage.DeleteConfirm', '确认删除该项目？')    
      );    
      if (!confirmed) {    
        return;    
      }    
        
      const response = await apiFetch(`/api/devices/${activeDeviceId.value}/files/delete`, {    
        method: 'POST',    
        headers: { 'Content-Type': 'application/json' },    
        body: JSON.stringify({ path: getEntryPath(entry) })    
      });    
      if (!response.ok) {    
        throw new Error(await getResponseErrorMessage(response, t('FilePage.DeleteFailed', '删除失败')));    
      }    
        
      selectedEntry.value = null;    
      await loadFiles();    
    };

    const handleContextAction = async (action: 'open' | 'download' | 'copy-path' | 'rename' | 'delete') => {    
      const entry = contextMenu.value.entry;    
      if (!entry || !activeDeviceId.value) return;    
        
      try {    
        switch (action) {    
          case 'open':    
            await openEntry(entry);    
            break;    
          case 'copy-path':    
            await navigator.clipboard.writeText(getEntryPath(entry));    
            break;    
          case 'download':    
            await downloadEntry(entry);    
            break;    
          case 'rename':    
            await renameEntry(entry);    
            break;    
          case 'delete':    
            await deleteEntry(entry);    
            break;    
        }    
      } catch (error) {    
        console.error('File action failed', error);    
        window.alert(error instanceof Error ? error.message : t('Common.OperationFailed', '操作失败'));    
      }    
        
      closeContextMenu();    
    };

    const goUp = async () => {    
      updateActiveTabPath(parentPath(currentPath.value));    
      await loadFiles();    
    };

    const openTypedPath = async (event: Event) => {    
      const value = (event.target as HTMLInputElement).value;    
      updateActiveTabPath(value);    
      await loadFiles();    
    };

    const formatFileSize = (size: number) => {    
      if (size < 1024) return `${size} B`;    
      if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;    
      if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;    
      return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`;    
    };

    watch(    
      () => route.query,    
      async () => {    
        await consumeIncomingTab();    
      }    
    );

    onMounted(async () => {    
      document.addEventListener('click', closeContextMenu);    
      loadPersistedTabs();    
      if (!isFilesRouteActive.value) return;    
        
      const consumed = await consumeIncomingTab();    
      if (!consumed) {    
        await loadFiles();    
      }    
    });

    onActivated(async () => {    
      if (isFilesRouteActive.value) {    
        const consumed = await consumeIncomingTab();    
        if (!consumed) {    
          await loadFiles();    
        }    
      }    
    });

    onUnmounted(() => {    
      document.removeEventListener('click', closeContextMenu);    
    });

    return {
      FILE_TABS_STORAGE_KEY,
      FILE_ACTIVE_TAB_STORAGE_KEY,
      DEFAULT_PATH,
      route,
      router,
      t,
      tabs,
      activeTabKey,
      entries,
      loading,
      errorMessage,
      selectedEntry,
      contextMenu,
      isFilesRouteActive,
      activeTab,
      currentPath,
      canGoUp,
      visibleEntries,
      tabItems,
      buildTabKey,
      normalizePath,
      joinRemotePath,
      getEntryPath,
      parentPath,
      persistTabs,
      updateActiveTabPath,
      upsertTab,
      createTabFromRoute,
      createTabFromRequest,
      syncRouteToActiveTab,
      loadFiles,
      openTab,
      activateTab,
      closeTab,
      loadPersistedTabs,
      consumeIncomingTab,
      openEntry,
      selectEntry,
      onContextMenu,
      closeContextMenu,
      activeDeviceId,
      getResponseErrorMessage,
      downloadEntry,
      renameEntry,
      deleteEntry,
      handleContextAction,
      goUp,
      openTypedPath,
      formatFileSize
    };
  }
});
