<template>
  <div class="page-container" @click="closeContextMenu">
    <WorkspaceTabs
      :tabs="tabItems"
      :active-key="activeTabKey"
      @select="activateTab"
      @close="closeTab">
      <template #icon>
        <svg class="workspace-tab__icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1.5 3C1.5 2.17157 2.17157 1.5 3 1.5H5.80155C6.19266 1.5 6.5685 1.65215 6.84928 1.9242L8.25667 3.28781C8.35026 3.3785 8.47554 3.42928 8.60533 3.42928H13C13.8284 3.42928 14.5 4.10085 14.5 4.92928V12C14.5 12.8284 13.8284 13.5 13 13.5H3C2.17157 13.5 1.5 12.8284 1.5 12V3ZM3 2.5C2.72386 2.5 2.5 2.72386 2.5 3V12C2.5 12.2761 2.72386 12.5 3 12.5H13C13.2761 12.5 13.5 12.2761 13.5 12V4.92928C13.5 4.65314 13.2761 4.42928 13 4.42928H8.39467C8.13506 4.42928 7.8845 4.32773 7.69733 4.14652L6.15072 2.64966C6.05713 2.55896 5.93185 2.50818 5.80206 2.50818H3Z" fill="currentColor" stroke="currentColor" stroke-width="0.5"/></svg>
      </template>
    </WorkspaceTabs>

    <div class="toolbar">
      <div class="path-bar">
        <button class="icon-button" type="button" :disabled="!canGoUp || loading" title="返回上级" @click="goUp">
          <svg viewBox="0 0 16 16" fill="none">
            <path d="M8 3.5L3.5 8M3.5 8L8 12.5M3.5 8H13" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <input
          class="path-input"
          type="text"
          :value="currentPath"
          :disabled="!activeTab"
          @keyup.enter="openTypedPath"
          @change="openTypedPath"
        />
        <button class="transparent" type="button" :disabled="!activeTab || loading" @click="loadFiles">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M12.5 8C12.5 10.4853 10.4853 12.5 8 12.5C5.51472 12.5 3.5 10.4853 3.5 8C3.5 6.42557 4.30823 4.98188 5.61868 4.14811C5.85042 3.99818 5.92617 3.68412 5.77977 3.44759C5.63336 3.21106 5.32356 3.12933 5.09182 3.27926C3.4116 4.35627 2.5 6.13601 2.5 8C2.5 11.0376 4.96243 13.5 8 13.5C11.0376 13.5 13.5 11.0376 13.5 8C13.5 5.56611 11.9567 3.5042 9.77121 2.76634C9.51347 2.67931 9.22744 2.82522 9.13886 3.08055C9.05027 3.33588 9.19163 3.61908 9.44937 3.70611C11.2389 4.30799 12.5 6.00287 12.5 8Z"/></svg>
          {{ loading ? t('Common.Refreshing', '刷新中...') : t('Common.Refresh', '刷新') }}
        </button>
      </div>
    </div>

    <div class="content-area" @scroll="closeContextMenu">
      <div v-if="loading" class="empty-state">
        <div class="spinner"></div>
        <p>{{ t('FilePage.LoadingFiles', '正在加载文件列表...') }}</p>
      </div>
      <div v-else-if="!activeTab" class="empty-state">
        <p>{{ t('FilePage.OpenFromHome', '请从首页选择一个设备打开文件管理') }}</p>
      </div>
      <div v-else-if="errorMessage" class="empty-state">
        <p>{{ errorMessage }}</p>
      </div>
      <div v-else-if="visibleEntries.length === 0" class="empty-state">
        <p>{{ t('FilePage.EmptyDirectory', '当前目录为空') }}</p>
      </div>
      <table v-else class="file-table">
        <thead>
          <tr>
            <th>{{ t('FilePage.NameHeader', '名称') }}</th>
            <th>{{ t('FilePage.TypeHeader', '类型') }}</th>
            <th>{{ t('FilePage.SizeHeader', '大小') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="canGoUp" class="file-row" @dblclick="goUp">
            <td>
              <div class="file-name">
                <span class="file-icon">..</span>
                <span>{{ t('FilePage.ParentDirectory', '上级目录') }}</span>
              </div>
            </td>
            <td>{{ t('FilePage.Directory', '目录') }}</td>
            <td>-</td>
          </tr>
          <tr
            v-for="entry in visibleEntries"
            :key="entry.Name"
            class="file-row"
            :class="{ selected: selectedEntry?.Name === entry.Name }"
            @click="selectEntry(entry)"
            @dblclick="openEntry(entry)"
            @contextmenu.prevent="onContextMenu($event, entry)"
          >
            <td>
              <div class="file-name">
                <span class="file-icon">{{ entry.IsDirectory ? 'DIR' : 'FILE' }}</span>
                <span>{{ entry.Name }}</span>
              </div>
            </td>
            <td>{{ entry.IsDirectory ? t('FilePage.Directory', '目录') : t('FilePage.File', '文件') }}</td>
            <td>{{ entry.IsDirectory ? '-' : formatFileSize(entry.Size) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="footer-bar">
      {{ activeTab ? t('FilePage.ItemCount', '{0} 个项目', visibleEntries.length) : t('FilePage.NoDeviceSelected', '未选择设备') }}
    </div>

    <Teleport to="body">
      <div
        v-if="contextMenu.show"
        class="context-menu"
        :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
        @click.stop
      >
        <div v-if="contextMenu.entry?.IsDirectory" class="context-menu-item" @click="handleContextAction('open')">
          {{ t('FilePage.ActionOpen', '打开') }}
        </div>
        <div v-if="!contextMenu.entry?.IsDirectory" class="context-menu-item" @click="handleContextAction('download')">
          {{ t('FilePage.ActionDownload', '下载') }}
        </div>
        <div class="context-menu-item" @click="handleContextAction('copy-path')">
          {{ t('FilePage.ActionCopyPath', '复制路径') }}
        </div>
        <div class="context-menu-item" @click="handleContextAction('rename')">
          {{ t('FilePage.ActionRename', '重命名') }}
        </div>
        <div class="context-menu-item danger" @click="handleContextAction('delete')">
          {{ t('FilePage.ActionDelete', '删除') }}
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, onActivated, onMounted, onUnmounted, watch, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import WorkspaceTabs from '../components/WorkspaceTabs.vue';
import { consumeWorkspaceOpen, type WorkspaceOpenRequest } from '../services/workspaceNavigation';
import { apiFetch } from '../utils/api';
import { useI18n } from '../composables/useI18n';

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
  try {
    const payload = await response.json();
    return payload?.error?.message || payload?.message || fallback;
  } catch {
    return fallback;
  }
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
</script>

<style scoped>
.page-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.toolbar {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 24px;
  border-bottom: 1px solid var(--fluent-stroke-default);
  flex-shrink: 0;
}

.path-bar {
  display: flex;
  align-items: center;
  gap: 8px;
}

.path-input {
  flex: 1;
  min-width: 0;
}

.icon-button {
  width: 32px;
  height: 32px;
  padding: 0;
}

.icon-button svg {
  width: 16px;
  height: 16px;
}

.content-area {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  position: relative;
}

.empty-state {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--fluent-text-secondary);
  gap: 10px;
  font-size: 14px;
}

.spinner {
  width: 24px;
  height: 24px;
  border: 3px solid var(--fluent-control-fill-secondary);
  border-top-color: var(--fluent-accent-default);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.file-table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
}

.file-table th,
.file-table td {
  padding: 10px 24px;
  border-bottom: 1px solid var(--fluent-stroke-default);
  font-size: 14px;
}

.file-table th {
  color: var(--fluent-text-secondary);
  font-weight: 600;
  position: sticky;
  top: 0;
  background-color: var(--fluent-bg-layer);
  z-index: 1;
}

.file-row {
  cursor: default;
  transition: background-color 0.1s ease;
}

.file-row:hover {
  background-color: var(--fluent-control-fill-secondary);
}

.file-row.selected {
  background-color: rgba(138, 43, 226, 0.24);
}

.file-name {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.file-icon {
  width: 36px;
  color: var(--fluent-text-tertiary);
  font-size: 11px;
  font-weight: 700;
}

.footer-bar {
  padding: 8px 24px;
  font-size: 12px;
  color: var(--fluent-text-tertiary);
  border-top: 1px solid var(--fluent-stroke-default);
  text-align: right;
  background-color: var(--fluent-bg-layer);
  flex-shrink: 0;
}

.context-menu {
  position: fixed;
  z-index: 1000;
  min-width: 160px;
  padding: 4px;
  background-color: var(--fluent-bg-layer);
  border: 1px solid var(--fluent-stroke-default);
  border-radius: 8px;
  box-shadow: 0 8px 16px rgba(0, 0, 0, 0.2);
}

.context-menu-item {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  border-radius: 4px;
  color: var(--fluent-text-primary);
  cursor: pointer;
  font-size: 14px;
  transition: background-color 0.1s;
}

.context-menu-item:hover {
  background-color: var(--fluent-control-fill-secondary);
}

.context-menu-item.danger:hover {
  background-color: rgba(255, 69, 58, 0.2);
  color: #ff453a;
}
</style>
