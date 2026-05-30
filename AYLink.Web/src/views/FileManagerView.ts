import { defineComponent } from 'vue';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import WorkspaceTabs from '../components/WorkspaceTabs.vue';
import { useFileManagerTabs } from '../features/files/useFileManagerTabs';
import type { FileEntry } from '../types/files';
import { apiFetch, readApiErrorMessage } from '../utils/api';
import { useI18n } from '../composables/useI18n';

export default defineComponent({
  name: 'FileManagerView',
  components: {
    WorkspaceTabs
  },
  setup() {
    const { t } = useI18n();

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

    const {
      route,
      router,
      tabs,
      activeTabKey,
      isFilesRouteActive,
      activeTab,
      currentPath,
      canGoUp,
      tabItems,
      buildTabKey,
      normalizePath,
      joinRemotePath,
      parentPath,
      persistTabs,
      updateActiveTabPath,
      upsertTab,
      createTabFromRoute,
      createTabFromRequest,
      syncRouteToActiveTab,
      openTab,
      loadPersistedTabs,
      consumeIncomingTab,
      activateTab,
      closeTab,
    } = useFileManagerTabs(
      () => t('FilePage.Title', '文件管理'),
      async () => loadFiles(),
    );

    const visibleEntries = computed(() => entries.value.filter((entry) => entry.Name !== '.' && entry.Name !== '..'));
    const activeDeviceId = computed(() => activeTab.value?.deviceId ?? '');

    const getEntryPath = (entry: FileEntry) => {
      const path = `${normalizePath(currentPath.value)}${entry.Name}`;
      return entry.IsDirectory ? normalizePath(path) : path.replace(/\/+/g, '/');
    };

    const getResponseErrorMessage = async (response: Response, fallback: string) => {
      return readApiErrorMessage(response, fallback);
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

    const refreshFiles = async () => {
      await loadFiles();
    };

    onMounted(() => {
      document.addEventListener('click', closeContextMenu);
    });

    onUnmounted(() => {
      document.removeEventListener('click', closeContextMenu);
    });

    return {
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
      refreshFiles,
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
