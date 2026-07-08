import { defineComponent } from 'vue';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import WorkspaceTabs from '../components/WorkspaceTabs.vue';
import { useFileManagerTabs } from '../features/files/useFileManagerTabs';
import type { FileEntry } from '../types/files';
import { apiFetch, readApiErrorMessage } from '../utils/api';
import { useI18n } from '../composables/useI18n';
import { useDialog } from '../services/dialog';
import { useNotification } from '../services/notification';
import { useTaskService } from '../services/tasks';
import { isAbortError } from '../lib/async/abort';
import { createLatestRequestController } from '../lib/async/latestRequest';
import { triggerBlobDownload, writeClipboardText } from '../lib/browser/operations';
import { formatBytes, readResponseBlobWithProgress } from '../lib/http/transfer';
import { normalizeDeviceId, normalizeRemotePath } from '../lib/input/normalize';

export default defineComponent({
  name: 'FileManagerView',
  components: {
    WorkspaceTabs
  },
  setup() {
    const { t } = useI18n();
    const dialogService = useDialog();
    const notifications = useNotification();
    const taskService = useTaskService();

    const entries = ref<FileEntry[]>([]);
    const loading = ref(false);
    const errorMessage = ref('');
    const filesRequest = createLatestRequestController();
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
    const normalizedActiveDeviceId = computed(() => normalizeDeviceId(activeDeviceId.value));

    const getEntryPath = (entry: FileEntry) => {
      const path = `${normalizePath(currentPath.value)}${entry.Name}`;
      return entry.IsDirectory ? normalizePath(path) : normalizeRemotePath(path);
    };

    const getResponseErrorMessage = async (response: Response, fallback: string) => {
      return readApiErrorMessage(response, fallback);
    };

    const loadFiles = async () => {
      const { requestId, signal } = filesRequest.begin();
      const tab = activeTab.value;
      const targetDeviceId = normalizeDeviceId(tab?.deviceId ?? '');
      if (!tab) {
        entries.value = [];
        filesRequest.finalize(requestId);
        return;
      }
      if (!targetDeviceId) {
        errorMessage.value = t('Common.InvalidDevice', '无效的设备标识');
        entries.value = [];
        filesRequest.finalize(requestId);
        return;
      }

      loading.value = true;
      errorMessage.value = '';
      try {
        const response = await apiFetch(`/api/devices/${targetDeviceId}/files/list`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: normalizePath(tab.path) }),
          signal,
          timeoutMs: 15000,
        });
        if (!filesRequest.isLatest(requestId)) {
          return;
        }

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
        if (!isAbortError(error)) {
          console.error('Failed to load files', error);
          errorMessage.value = t('FilePage.LoadFailed', '文件列表加载失败');
          entries.value = [];
        }
      } finally {
        if (filesRequest.isLatest(requestId)) {
          loading.value = false;
        }
        filesRequest.finalize(requestId);
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
      const targetDeviceId = normalizedActiveDeviceId.value;
      if (!targetDeviceId) {
        throw new Error(t('Common.InvalidDevice', '无效的设备标识'));
      }

      const fileName = entry.Name || 'download.bin';
      const title = t('FilePage.DownloadTitle', '下载文件');
      const preparingMessage = t('FilePage.DownloadPreparing', '准备下载 {0}', fileName);
      const controller = new AbortController();
      const task = taskService.start({
        title,
        description: preparingMessage,
        source: t('FilePage.Title', '文件管理'),
        isIndeterminate: true,
        isCancelable: true,
        cancelAction: () => controller.abort()
      });
      const toastId = notifications.showProgress({
        type: 'info',
        title,
        message: preparingMessage,
        isIndeterminate: true,
        isCancelable: true,
        onCancel: () => taskService.requestCancel(task)
      });

      try {
        const response = await apiFetch(`/api/devices/${targetDeviceId}/files/download`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: getEntryPath(entry) }),
          signal: controller.signal
        });
        if (!response.ok) {
          throw new Error(await getResponseErrorMessage(response, t('FilePage.DownloadFailed', '下载失败')));
        }

        const blob = await readResponseBlobWithProgress(response, {
          onProgress: (progress) => {
            const message = progress.total
              ? t('FilePage.DownloadingBytes', '正在下载 {0} / {1}', formatBytes(progress.loaded), formatBytes(progress.total))
              : t('FilePage.DownloadingBytesUnknown', '正在下载 {0}', formatBytes(progress.loaded));
            taskService.update(task, {
              detail: message,
              progress: progress.progress ?? task.progress,
              isIndeterminate: progress.progress === null
            });
            notifications.update(toastId, {
              message,
              progress: progress.progress ?? 0,
              isIndeterminate: progress.progress === null
            });
          }
        });
        triggerBlobDownload(blob, fileName, 'download.bin');
        const completedMessage = t('FilePage.DownloadComplete', '{0} 下载完成', fileName);
        taskService.complete(task, completedMessage);
        notifications.dismiss(toastId);
      } catch (error) {
        notifications.dismiss(toastId);
        if (isAbortError(error)) {
          const cancelledMessage = t('FilePage.DownloadCancelled', '下载已取消');
          taskService.cancel(task, cancelledMessage);
          notifications.show({
            type: 'warning',
            title,
            message: cancelledMessage
          });
          return;
        }

        taskService.fail(task, error instanceof Error ? error.message : t('FilePage.DownloadFailed', '下载失败'));
        throw error;
      }
    };

    const renameEntry = async (entry: FileEntry) => {
      const nextName = (await dialogService.prompt(
        t('FilePage.RenameTitle', '重命名'),
        t('FilePage.RenamePrompt', '请输入新名称'),
        entry.Name,
        t('FilePage.RenamePlaceholder', '请输入新名称'),
        t('Common.Save', '保存'),
        t('Common.Cancel', '取消')
      ))?.trim();
      if (!nextName || nextName === entry.Name) {
        return;
      }

      const targetDeviceId = normalizedActiveDeviceId.value;
      if (!targetDeviceId) {
        throw new Error(t('Common.InvalidDevice', '无效的设备标识'));
      }

      const response = await apiFetch(`/api/devices/${targetDeviceId}/files/rename`, {
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
      const confirmed = await dialogService.confirm(
        t('FilePage.DeleteTitle', '删除项目'),
        t('FilePage.DeleteConfirm', '确认删除该项目？'),
        t('Common.Delete', '删除'),
        t('Common.Cancel', '取消')
      );
      if (!confirmed) {
        return;
      }

      const targetDeviceId = normalizedActiveDeviceId.value;
      if (!targetDeviceId) {
        throw new Error(t('Common.InvalidDevice', '无效的设备标识'));
      }

      const response = await apiFetch(`/api/devices/${targetDeviceId}/files/delete`, {
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
            await writeClipboardText(getEntryPath(entry));
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
        notifications.show({
          type: 'error',
          title: t('Common.OperationFailed', '操作失败'),
          message: error instanceof Error ? error.message : t('Common.OperationFailed', '操作失败')
        });
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
      filesRequest.dispose();
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
