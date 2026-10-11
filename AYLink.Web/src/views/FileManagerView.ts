import { defineComponent } from 'vue';
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import {
  ArrowClockwise20Regular, ArrowDownload20Regular, ArrowLeft20Regular, ArrowUpload20Regular,
  ChevronDown16Regular, ChevronRight16Regular, Copy20Regular, Delete20Regular,
  Dismiss16Regular, Document20Regular, DocumentText20Regular, Edit20Regular,
  ErrorCircle24Regular, Folder20Regular, FolderOpen24Regular, FolderZip20Regular,
  Image20Regular, MoreHorizontal20Regular, PlugDisconnected24Regular, Search20Regular, Search24Regular,
} from '@vicons/fluent';
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
import { selectDownloadFile, triggerBlobDownload, triggerUrlDownload, writeClipboardText, type FileDownloadTarget } from '../lib/browser/operations';
import { formatBytes, readResponseBlobWithProgress, writeResponseFileWithProgress, type TransferProgress } from '../lib/http/transfer';
import { requestDevice, uploadDeviceFile } from '../features/deviceTransport/requests';
import { normalizeDeviceId, normalizeRemotePath } from '../lib/input/normalize';

const BLOB_DOWNLOAD_MAX_BYTES = 128 * 1024 * 1024;
type FileKind = 'folder' | 'image' | 'archive' | 'document' | 'file';
type MenuAction = 'open' | 'download' | 'browser-download' | 'copy-path' | 'rename' | 'delete' | 'upload-files' | 'upload-folder';

export default defineComponent({
  name: 'FileManagerView',
  components: {
    WorkspaceTabs,
    ArrowClockwise20Regular, ArrowLeft20Regular, ArrowUpload20Regular,
    ChevronDown16Regular, ChevronRight16Regular, Dismiss16Regular, Edit20Regular,
    ErrorCircle24Regular, Folder20Regular, FolderOpen24Regular,
    MoreHorizontal20Regular, PlugDisconnected24Regular, Search20Regular, Search24Regular,
  },
  setup() {
    const { t } = useI18n();
    const dialogService = useDialog();
    const notifications = useNotification();
    const taskService = useTaskService();

    const entries = ref<FileEntry[]>([]);
    const loading = ref(false);
    const uploading = ref(false);
    const errorMessage = ref('');
    const filesRequest = createLatestRequestController();
    const selectedEntry = ref<FileEntry | null>(null);
    const fileInput = ref<HTMLInputElement | null>(null);
    const folderInput = ref<HTMLInputElement | null>(null);
    const pathInput = ref<HTMLInputElement | null>(null);
    const pathEditing = ref(false);
    const pathDraft = ref('');
    const searchQuery = ref('');
    const searchExpanded = ref(false);
    const searchInput = ref<HTMLInputElement | null>(null);
    const searchButton = ref<HTMLButtonElement | null>(null);
    const searchControl = ref<HTMLElement | null>(null);
    const sortField = ref<'name' | 'size'>('name');
    const sortDirection = ref<'ascending' | 'descending'>('ascending');
    const loadedTabKey = ref('');
    const loadedPath = ref('');
    const menuElement = ref<HTMLElement | null>(null);
    let menuTrigger: HTMLElement | null = null;
    const contextMenu = ref({
      show: false,
      x: 0,
      y: 0,
      kind: 'entry' as 'entry' | 'upload',
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

    const hasCurrentListing = computed(() => !!activeTab.value
      && loadedTabKey.value === activeTabKey.value
      && loadedPath.value === normalizePath(currentPath.value));
    const directoryEntries = computed(() => hasCurrentListing.value
      ? entries.value.filter((entry) => entry.Name !== '.' && entry.Name !== '..')
      : []);
    const nameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    const visibleEntries = computed(() => {
      const query = searchQuery.value.trim().toLocaleLowerCase();
      return directoryEntries.value
        .filter((entry) => !query || entry.Name.toLocaleLowerCase().includes(query))
        .sort((left, right) => {
          if (left.IsDirectory !== right.IsDirectory) return left.IsDirectory ? -1 : 1;
          const order = sortField.value === 'size' && !left.IsDirectory
            ? left.Size - right.Size || nameCollator.compare(left.Name, right.Name)
            : nameCollator.compare(left.Name, right.Name);
          return sortDirection.value === 'ascending' ? order : -order;
        });
    });
    const breadcrumbs = computed(() => {
      const parts = normalizePath(currentPath.value).split('/').filter(Boolean);
      return [
        { name: '/', path: '/' },
        ...parts.map((name, index) => ({ name, path: `/${parts.slice(0, index + 1).join('/')}/` })),
      ];
    });
    const fileIcons = {
      folder: Folder20Regular, image: Image20Regular, archive: FolderZip20Regular,
      document: DocumentText20Regular, file: Document20Regular,
    };
    const getFileKind = (entry: FileEntry): FileKind => {
      if (entry.IsDirectory) return 'folder';
      const dot = entry.Name.lastIndexOf('.');
      const extension = dot > 0 ? entry.Name.slice(dot + 1).toLowerCase() : '';
      if (/^(png|jpe?g|gif|webp|svg|bmp|heic|avif)$/.test(extension)) return 'image';
      if (/^(zip|rar|7z|tar|gz|bz2|xz|tgz)$/.test(extension)) return 'archive';
      if (/^(txt|md|pdf|docx?|xlsx?|pptx?|csv|odt)$/.test(extension)) return 'document';
      return 'file';
    };
    const getFileType = (entry: FileEntry) => {
      switch (getFileKind(entry)) {
        case 'folder': return t('FilePage.Directory', '目录');
        case 'image': return t('FilePage.Image', '图片');
        case 'archive': return t('FilePage.Archive', '压缩包');
        case 'document': return t('FilePage.Document', '文档');
        default: return t('FilePage.File', '文件');
      }
    };
    const setSort = (field: 'name' | 'size') => {
      sortDirection.value = sortField.value === field && sortDirection.value === 'ascending' ? 'descending' : 'ascending';
      sortField.value = field;
    };
    const activeDeviceId = computed(() => activeTab.value?.deviceId ?? '');
    const normalizedActiveDeviceId = computed(() => normalizeDeviceId(activeDeviceId.value));

    const getEntryPath = (entry: FileEntry) => {
      const path = `${normalizePath(currentPath.value)}${entry.Name}`;
      return entry.IsDirectory ? normalizePath(path) : normalizeRemotePath(path);
    };

    const getResponseErrorMessage = async (response: Response, fallback: string) => {
      return readApiErrorMessage(response, fallback);
    };

    const canUseBlobDownload = (entry: FileEntry | null | undefined) => {
      return !!entry && !entry.IsDirectory && Number.isFinite(entry.Size) && entry.Size <= BLOB_DOWNLOAD_MAX_BYTES;
    };

    const loadFiles = async () => {
      closeContextMenu();
      const { requestId, signal } = filesRequest.begin();
      const tab = activeTab.value;
      const targetDeviceId = normalizeDeviceId(tab?.deviceId ?? '');
      if (!tab) {
        entries.value = [];
        selectedEntry.value = null;
        errorMessage.value = '';
        loading.value = false;
        loadedTabKey.value = '';
        filesRequest.finalize(requestId);
        return;
      }
      if (!targetDeviceId) {
        errorMessage.value = t('Common.InvalidDevice', '无效的设备标识');
        entries.value = [];
        loading.value = false;
        loadedTabKey.value = '';
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
        if (!filesRequest.isLatest(requestId)) return;
        updateActiveTabPath(payload.path ?? tab.path);
        entries.value = Array.isArray(payload.items) ? payload.items : [];
        loadedTabKey.value = tab.key;
        loadedPath.value = normalizePath(payload.path ?? tab.path);
        selectedEntry.value = null;
      } catch (error) {
        if (filesRequest.isLatest(requestId) && !isAbortError(error)) {
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
      if (!entry.IsDirectory || loading.value) return;

      await navigateToPath(joinRemotePath(currentPath.value, entry.Name));
    };

    const selectEntry = (entry: FileEntry) => {
      selectedEntry.value = entry;
    };

    const showMenu = async (event: MouseEvent | KeyboardEvent, entry: FileEntry | null) => {
      if (!activeTab.value || loading.value || (!entry && uploading.value)) return;
      closeSearch();
      if (event.type === 'click' && contextMenu.value.show && menuTrigger === event.currentTarget) {
        closeContextMenu(true);
        return;
      }
      if (entry) selectedEntry.value = entry;
      menuTrigger = event.currentTarget as HTMLElement;
      const bounds = menuTrigger.getBoundingClientRect();
      const atPointer = event.type === 'contextmenu' && event instanceof MouseEvent;
      contextMenu.value = {
        show: true,
        x: atPointer ? event.clientX : bounds.left,
        y: atPointer ? event.clientY : bounds.bottom + 4,
        kind: entry ? 'entry' : 'upload',
        entry
      };
      await nextTick();
      if (!contextMenu.value.show || !menuElement.value) return;
      const menuBounds = menuElement.value.getBoundingClientRect();
      contextMenu.value.x = Math.max(8, Math.min(contextMenu.value.x, window.innerWidth - menuBounds.width - 8));
      contextMenu.value.y = Math.max(8, Math.min(contextMenu.value.y, window.innerHeight - menuBounds.height - 8));
      // 等待菜单定位和渲染完成后再移动焦点。
      await nextTick();
      if (contextMenu.value.show) menuElement.value?.querySelector<HTMLButtonElement>('button')?.focus();
    };

    const onContextMenu = (event: MouseEvent | KeyboardEvent, entry: FileEntry) => showMenu(event, entry);

    const closeContextMenu = (restoreFocus = false) => {
      if (!contextMenu.value.show) return;
      contextMenu.value.show = false;
      if (restoreFocus && menuTrigger?.isConnected) menuTrigger.focus();
    };

    const onMenuKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Tab') {
        if (event.key === 'Escape') event.preventDefault();
        event.stopPropagation();
        closeContextMenu(true);
        return;
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const items = Array.from(menuElement.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
      if (!items.length) return;
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
        : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
      items[nextIndex]?.focus();
    };

    const menuActions = computed(() => {
      if (contextMenu.value.kind === 'upload') {
        return [
          { action: 'upload-files' as MenuAction, label: t('FilePage.UploadFiles', '上传文件'), icon: ArrowUpload20Regular },
          { action: 'upload-folder' as MenuAction, label: t('FilePage.UploadFolder', '上传文件夹'), icon: Folder20Regular },
        ];
      }
      const entry = contextMenu.value.entry;
      if (!entry) return [];
      const actions: { action: MenuAction; label: string; icon: typeof Folder20Regular }[] = [];
      if (entry.IsDirectory) actions.push({ action: 'open', label: t('FilePage.ActionOpen', '打开'), icon: Folder20Regular });
      if (canUseBlobDownload(entry)) actions.push({ action: 'download', label: t('FilePage.ActionDownload', '下载'), icon: ArrowDownload20Regular });
      if (!entry.IsDirectory) actions.push({ action: 'browser-download', label: t('FilePage.ActionBrowserDownload', '浏览器下载'), icon: ArrowDownload20Regular });
      actions.push(
        { action: 'copy-path', label: t('FilePage.ActionCopyPath', '复制路径'), icon: Copy20Regular },
        { action: 'rename', label: t('FilePage.ActionRename', '重命名'), icon: Edit20Regular },
        { action: 'delete', label: t('FilePage.ActionDelete', '删除'), icon: Delete20Regular },
      );
      return actions;
    });

    const downloadEntry = async (entry: FileEntry, target?: FileDownloadTarget) => {
      if (!target && !canUseBlobDownload(entry)) {
        await browserDownloadEntry(entry);
        return;
      }

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
        const response = await requestDevice(`/api/devices/${targetDeviceId}/files/download`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: getEntryPath(entry) }),
          signal: controller.signal
        });
        if (!response.ok) {
          throw new Error(await getResponseErrorMessage(response, t('FilePage.DownloadFailed', '下载失败')));
        }

        const options = {
          signal: controller.signal,
          onProgress: (progress: TransferProgress) => {
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
        };
        if (target) await writeResponseFileWithProgress(response, target, options);
        else {
          const blob = await readResponseBlobWithProgress(response, options);
          triggerBlobDownload(blob, fileName, 'download.bin');
        }
        const completedMessage = t('FilePage.DownloadComplete', '{0} 下载完成', fileName);
        taskService.complete(task, completedMessage);
        notifications.dismiss(toastId);
      } catch (error) {
        await target?.abort(error).catch((cleanupError: unknown) => console.warn('Failed to discard incomplete download', cleanupError));
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

    const browserDownloadEntry = async (entry: FileEntry) => {
      const targetDeviceId = normalizedActiveDeviceId.value;
      if (!targetDeviceId) {
        throw new Error(t('Common.InvalidDevice', '无效的设备标识'));
      }

      const fileName = entry.Name || 'download.bin';
      let target: FileDownloadTarget | null;
      try { target = await selectDownloadFile(fileName, 'download.bin'); }
      catch (error) { if (isAbortError(error)) return; throw error; }
      if (target) { await downloadEntry(entry, target); return; }
      const response = await apiFetch(`/api/devices/${targetDeviceId}/files/download-ticket`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: getEntryPath(entry) })
      });
      if (!response.ok) {
        throw new Error(await getResponseErrorMessage(response, t('FilePage.DownloadFailed', '下载失败')));
      }

      const payload = await response.json() as { url?: string };
      if (!payload.url) {
        throw new Error(t('FilePage.DownloadFailed', '下载失败'));
      }

      triggerUrlDownload(payload.url, fileName, 'download.bin');
      notifications.show({
        type: 'success',
        title: t('FilePage.DownloadTitle', '下载文件'),
        message: t('FilePage.BrowserDownloadStarted', '已交给浏览器下载')
      });
    };

    const triggerUploadFiles = () => {
      if (!activeTab.value || uploading.value) {
        return;
      }

      fileInput.value?.click();
    };

    const triggerUploadFolder = () => {
      if (!activeTab.value || uploading.value) {
        return;
      }

      folderInput.value?.click();
    };

    const buildUploadUrl = (targetDeviceId: string, uploadDirectory: string, relativePath: string) => {
      const query = new URLSearchParams({
        path: normalizePath(uploadDirectory)
      });
      if (relativePath) {
        query.set('relativePath', relativePath);
      }
      return `/api/devices/${targetDeviceId}/files/upload?${query.toString()}`;
    };

    const uploadSelectedFiles = async (files: File[], preserveRelativePath: boolean) => {
      const targetDeviceId = normalizedActiveDeviceId.value;
      const uploadDirectory = currentPath.value;
      const uploadItems = files.filter((file) => file.size >= 0);
      if (!targetDeviceId || uploadItems.length === 0) {
        return;
      }

      uploading.value = true;
      const totalBytes = uploadItems.reduce((sum, file) => sum + file.size, 0);
      const title = uploadItems.length > 1
        ? t('FilePage.UploadFilesTitle', '上传文件')
        : t('FilePage.UploadFileTitle', '上传文件');
      const preparingMessage = uploadItems.length > 1
        ? t('FilePage.UploadPreparingMultiple', '准备上传 {0} 个文件', uploadItems.length)
        : t('FilePage.UploadPreparing', '准备上传 {0}', uploadItems[0]?.name ?? '');
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

      let completedBytes = 0;
      try {
        for (let index = 0; index < uploadItems.length; index += 1) {
          const file = uploadItems[index];
          const relativePath = preserveRelativePath ? file.webkitRelativePath || file.name : '';
          const formData = new FormData();
          formData.append('file', file, file.name);

          const response = await uploadDeviceFile(buildUploadUrl(targetDeviceId, uploadDirectory, relativePath), formData, {
            signal: controller.signal,
            onProgress: (progress) => {
              const currentFileLoaded = progress.progress !== null
                ? file.size * progress.progress / 100
                : Math.min(progress.loaded, file.size);
              const uploadedBytes = Math.min(totalBytes, completedBytes + currentFileLoaded);
              const overallProgress = totalBytes > 0 ? uploadedBytes / totalBytes * 100 : progress.progress;
              const uploadComplete = progress.progress !== null && progress.progress >= 100;
              const prefix = uploadItems.length > 1
                ? t('FilePage.UploadingFileIndex', '正在上传 {0}/{1}: {2}', index + 1, uploadItems.length, file.name)
                : t('FilePage.UploadingFileName', '正在上传 {0}', file.name);
              const message = uploadComplete
                ? uploadItems.length > 1
                  ? t('FilePage.UploadWritingDeviceIndex', '正在写入设备 {0}/{1}: {2}', index + 1, uploadItems.length, file.name)
                  : t('FilePage.UploadWritingDevice', '上传完成，正在写入设备...')
                : progress.total
                  ? `${prefix} ${formatBytes(progress.loaded)} / ${formatBytes(progress.total)}`
                  : `${prefix} ${formatBytes(progress.loaded)}`;
              taskService.update(task, {
                detail: message,
                progress: overallProgress ?? task.progress,
                isIndeterminate: overallProgress === null || uploadComplete,
                isCancelable: !uploadComplete
              });
              notifications.update(toastId, {
                message,
                progress: overallProgress ?? 0,
                isIndeterminate: overallProgress === null || uploadComplete,
                isCancelable: !uploadComplete
              });
            }
          });
          if (!response.ok) {
            throw new Error(await getResponseErrorMessage(response, t('FilePage.UploadFailed', '上传失败')));
          }

          completedBytes += file.size;
        }

        const completedMessage = uploadItems.length > 1
          ? t('FilePage.UploadMultipleComplete', '{0} 个文件上传完成', uploadItems.length)
          : t('FilePage.UploadComplete', '{0} 上传完成', uploadItems[0]?.name ?? '');
        taskService.complete(task, completedMessage);
        notifications.dismiss(toastId);
        notifications.show({
          type: 'success',
          title,
          message: completedMessage
        });
        await loadFiles();
      } catch (error) {
        notifications.dismiss(toastId);
        if (isAbortError(error)) {
          const cancelledMessage = t('FilePage.UploadCancelled', '上传已取消');
          taskService.cancel(task, cancelledMessage);
          notifications.show({
            type: 'warning',
            title,
            message: cancelledMessage
          });
          return;
        }

        taskService.fail(task, error instanceof Error ? error.message : t('FilePage.UploadFailed', '上传失败'));
        throw error;
      } finally {
        uploading.value = false;
      }
    };

    const handleFilesSelected = async (event: Event) => {
      const input = event.target as HTMLInputElement;
      const files = Array.from(input.files ?? []);
      input.value = '';
      if (files.length === 0) {
        return;
      }

      try {
        await uploadSelectedFiles(files, false);
      } catch (error) {
        console.error('Failed to upload files', error);
        notifications.show({
          type: 'error',
          title: t('Common.OperationFailed', '操作失败'),
          message: error instanceof Error ? error.message : t('FilePage.UploadFailed', '上传失败')
        });
      }
    };

    const handleFolderSelected = async (event: Event) => {
      const input = event.target as HTMLInputElement;
      const files = Array.from(input.files ?? []);
      input.value = '';
      if (files.length === 0) {
        return;
      }

      try {
        await uploadSelectedFiles(files, true);
      } catch (error) {
        console.error('Failed to upload folder', error);
        notifications.show({
          type: 'error',
          title: t('Common.OperationFailed', '操作失败'),
          message: error instanceof Error ? error.message : t('FilePage.UploadFailed', '上传失败')
        });
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

    const handleContextAction = async (action: MenuAction) => {
      const entry = contextMenu.value.entry;
      closeContextMenu(true);
      if (action === 'upload-files') { triggerUploadFiles(); return; }
      if (action === 'upload-folder') { triggerUploadFolder(); return; }
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
          case 'browser-download':
            await browserDownloadEntry(entry);
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
    };

    const navigateToPath = async (path: string) => {
      if (!activeTab.value || loading.value) return;
      updateActiveTabPath(normalizePath(path));
      await loadFiles();
    };

    const goUp = async () => {
      if (canGoUp.value) await navigateToPath(parentPath(currentPath.value));
    };

    const beginPathEdit = async () => {
      if (!activeTab.value || loading.value) return;
      closeSearch();
      pathDraft.value = currentPath.value;
      pathEditing.value = true;
      await nextTick();
      pathInput.value?.focus();
      pathInput.value?.select();
    };

    const openTypedPath = async () => {
      const path = pathDraft.value.trim();
      pathEditing.value = false;
      if (path) await navigateToPath(path);
    };

    const closeSearch = (restoreFocus = false) => {
      searchExpanded.value = false;
      if (restoreFocus) searchButton.value?.focus();
    };

    const toggleSearch = async () => {
      if (!activeTab.value) return;
      if (searchExpanded.value) {
        closeSearch();
        return;
      }
      closeContextMenu();
      searchExpanded.value = true;
      await nextTick();
      searchInput.value?.focus();
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

    watch([activeTabKey, currentPath], () => {
      searchQuery.value = '';
      closeSearch();
      selectedEntry.value = null;
      pathEditing.value = false;
      closeContextMenu();
    }, { flush: 'sync' });

    watch(searchQuery, () => {
      selectedEntry.value = null;
      closeContextMenu();
    });

    const onDocumentClick = (event: Event) => {
      closeContextMenu();
      if (!(event.target instanceof Node) || !searchControl.value?.contains(event.target)) closeSearch();
    };
    onMounted(() => {
      document.addEventListener('click', onDocumentClick);
      window.addEventListener('resize', onDocumentClick);
    });

    onUnmounted(() => {
      filesRequest.dispose();
      document.removeEventListener('click', onDocumentClick);
      window.removeEventListener('resize', onDocumentClick);
    });

    return {
      route,
      router,
      t,
      tabs,
      activeTabKey,
      entries,
      loading,
      uploading,
      errorMessage,
      selectedEntry,
      contextMenu,
      fileInput,
      folderInput,
      isFilesRouteActive,
      activeTab,
      currentPath,
      canGoUp,
      visibleEntries,
      directoryEntries,
      hasCurrentListing,
      breadcrumbs,
      pathInput,
      pathEditing,
      pathDraft,
      beginPathEdit,
      navigateToPath,
      searchQuery,
      searchExpanded,
      searchInput,
      searchButton,
      searchControl,
      toggleSearch,
      closeSearch,
      sortField,
      sortDirection,
      setSort,
      fileIcons,
      getFileKind,
      getFileType,
      menuElement,
      menuActions,
      showMenu,
      onMenuKeydown,
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
      canUseBlobDownload,
      downloadEntry,
      browserDownloadEntry,
      triggerUploadFiles,
      triggerUploadFolder,
      uploadSelectedFiles,
      handleFilesSelected,
      handleFolderSelected,
      renameEntry,
      deleteEntry,
      handleContextAction,
      goUp,
      openTypedPath,
      formatFileSize
    };
  }
});
