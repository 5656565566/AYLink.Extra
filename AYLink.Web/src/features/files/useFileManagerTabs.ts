import { computed, onActivated, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { restoreSessionTabs, persistSessionTabs } from '../workspace/sessionTabs';
import { consumeWorkspaceOpen, type WorkspaceOpenRequest } from '../../services/workspaceNavigation';
import type { FileManagerTab } from '../../types/files';

const FILE_TABS_STORAGE_KEY = 'aylink_file_tabs';
const FILE_ACTIVE_TAB_STORAGE_KEY = 'aylink_file_active_tab';
const DEFAULT_PATH = '/sdcard/';

function isFileManagerTab(item: unknown): item is FileManagerTab {
  return !!item
    && typeof item === 'object'
    && typeof (item as FileManagerTab).key === 'string'
    && typeof (item as FileManagerTab).deviceId === 'string';
}

export function useFileManagerTabs(
  getTitle: () => string,
  onTabChanged: () => Promise<void>,
) {
  const route = useRoute();
  const router = useRouter();

  const tabs = ref<FileManagerTab[]>([]);
  const activeTabKey = ref('');

  const isFilesRouteActive = computed(() => route.name === 'files');
  const activeTab = computed(() => tabs.value.find((tab) => tab.key === activeTabKey.value) ?? null);
  const currentPath = computed(() => activeTab.value?.path ?? DEFAULT_PATH);
  const canGoUp = computed(() => !!activeTab.value && normalizePath(currentPath.value) !== '/');
  const tabItems = computed(() => tabs.value.map((tab) => ({
    key: tab.key,
    title: tab.deviceName || getTitle(),
  })));

  function buildTabKey(deviceId: string) {
    return `${deviceId || 'empty'}::files`;
  }

  function normalizePath(path: string) {
    let normalized = (path || DEFAULT_PATH).replaceAll('\\', '/').trim();
    if (!normalized.startsWith('/')) normalized = `/${normalized}`;
    if (!normalized.endsWith('/')) normalized = `${normalized}/`;
    return normalized.replace(/\/+/g, '/');
  }

  function joinRemotePath(basePath: string, name: string) {
    return normalizePath(`${normalizePath(basePath)}${name}`);
  }

  function parentPath(path: string) {
    const normalized = normalizePath(path);
    if (normalized === '/') return '/';

    const parts = normalized.split('/').filter(Boolean);
    parts.pop();
    return parts.length === 0 ? '/' : `/${parts.join('/')}/`;
  }

  function persistTabs() {
    persistSessionTabs(FILE_TABS_STORAGE_KEY, FILE_ACTIVE_TAB_STORAGE_KEY, tabs.value, activeTabKey.value);
  }

  function updateActiveTabPath(path: string) {
    const tab = activeTab.value;
    if (!tab) return;

    tab.path = normalizePath(path);
    persistTabs();
  }

  function upsertTab(tab: FileManagerTab) {
    const index = tabs.value.findIndex((item) => item.key === tab.key);
    if (index >= 0) {
      tabs.value[index] = { ...tabs.value[index], ...tab };
    } else {
      tabs.value.push(tab);
    }
    persistTabs();
  }

  function createTabFromRoute() {
    if (!isFilesRouteActive.value) return null;

    const deviceId = String(route.query.deviceId ?? '').trim();
    const deviceName = String(route.query.deviceName ?? '').trim() || getTitle();
    if (!deviceId) return null;

    return {
      key: buildTabKey(deviceId),
      deviceId,
      deviceName,
      path: DEFAULT_PATH,
    } satisfies FileManagerTab;
  }

  function createTabFromRequest(request: WorkspaceOpenRequest) {
    return {
      key: buildTabKey(request.deviceId),
      deviceId: request.deviceId,
      deviceName: request.deviceName || getTitle(),
      path: DEFAULT_PATH,
    } satisfies FileManagerTab;
  }

  async function syncRouteToActiveTab() {
    if (Object.keys(route.query).length > 0) {
      await router.replace({ name: 'files', query: {} });
    }
  }

  async function openTab(tab: FileManagerTab) {
    upsertTab(tab);
    activeTabKey.value = tab.key;
    persistTabs();
    await syncRouteToActiveTab();
    await onTabChanged();
  }

  function loadPersistedTabs() {
    try {
      const restored = restoreSessionTabs(FILE_TABS_STORAGE_KEY, FILE_ACTIVE_TAB_STORAGE_KEY, isFileManagerTab);
      tabs.value = restored.tabs.map((item) => ({
        key: item.key,
        deviceId: item.deviceId,
        deviceName: item.deviceName ?? getTitle(),
        path: normalizePath(item.path ?? DEFAULT_PATH),
      }));
      activeTabKey.value = restored.activeTabKey;
    } catch {
      tabs.value = [];
      activeTabKey.value = '';
    }
  }

  async function consumeIncomingTab() {
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
  }

  async function activateTab(tabKey: string) {
    if (tabKey === activeTabKey.value) return;

    const tab = tabs.value.find((item) => item.key === tabKey);
    if (!tab) return;

    activeTabKey.value = tab.key;
    persistTabs();
    await syncRouteToActiveTab();
    await onTabChanged();
  }

  async function closeTab(tabKey: string) {
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
    await onTabChanged();
  }

  watch(
    () => route.query,
    async () => {
      await consumeIncomingTab();
    },
  );

  onMounted(async () => {
    loadPersistedTabs();
    if (!isFilesRouteActive.value) return;

    const consumed = await consumeIncomingTab();
    if (!consumed) {
      await onTabChanged();
    }
  });

  onActivated(async () => {
    if (!isFilesRouteActive.value) return;

    const consumed = await consumeIncomingTab();
    if (!consumed) {
      await onTabChanged();
    }
  });

  return {
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
  };
}
