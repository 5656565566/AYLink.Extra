import { computed, ref, watch, onActivated, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { persistSessionTabs, restoreSessionTabs } from '../workspace/sessionTabs';
import { consumeWorkspaceOpen, type WorkspaceOpenRequest } from '../../services/workspaceNavigation';
import type { AppManagerTab } from '../../types/apps';

const APP_TABS_STORAGE_KEY = 'aylink_app_tabs';
const APP_ACTIVE_TAB_STORAGE_KEY = 'aylink_app_active_tab';

function isAppManagerTab(item: unknown): item is AppManagerTab {
  return !!item
    && typeof item === 'object'
    && typeof (item as AppManagerTab).key === 'string'
    && typeof (item as AppManagerTab).deviceId === 'string';
}

export function useAppManagerTabs(
  getTitle: () => string,
  onTabChanged: () => Promise<void>,
) {
  const route = useRoute();
  const router = useRouter();

  const appTabs = ref<AppManagerTab[]>([]);
  const activeTabKey = ref('');
  const deviceId = ref('');

  const isAppsRouteActive = computed(() => route.name === 'apps');
  const activeTab = computed(() => appTabs.value.find((tab) => tab.key === activeTabKey.value) ?? null);
  const tabItems = computed(() => appTabs.value.map((tab) => ({
    key: tab.key,
    title: tab.deviceName || getTitle(),
  })));

  const buildTabKey = (nextDeviceId: string) => `${nextDeviceId}::apps`;

  const persistTabs = () => {
    persistSessionTabs(APP_TABS_STORAGE_KEY, APP_ACTIVE_TAB_STORAGE_KEY, appTabs.value, activeTabKey.value);
  };

  const syncRefsFromActiveTab = () => {
    deviceId.value = activeTab.value?.deviceId ?? '';
  };

  const upsertTab = (tab: AppManagerTab) => {
    const index = appTabs.value.findIndex((item) => item.key === tab.key);
    if (index >= 0) {
      appTabs.value[index] = { ...appTabs.value[index], ...tab };
    } else {
      appTabs.value.push(tab);
    }
    persistTabs();
  };

  const createTabFromRoute = () => {
    if (!isAppsRouteActive.value) return null;

    const nextDeviceId = String(route.query.deviceId ?? '').trim();
    if (!nextDeviceId) return null;

    return {
      key: buildTabKey(nextDeviceId),
      deviceId: nextDeviceId,
      deviceName: String(route.query.deviceName ?? '').trim() || getTitle(),
    } satisfies AppManagerTab;
  };

  const createTabFromRequest = (request: WorkspaceOpenRequest) => ({
    key: buildTabKey(request.deviceId),
    deviceId: request.deviceId,
    deviceName: request.deviceName || getTitle(),
  }) satisfies AppManagerTab;

  const syncRouteToActiveTab = async () => {
    if (!isAppsRouteActive.value) {
      return;
    }

    if (Object.keys(route.query).length > 0) {
      await router.replace({ name: 'apps', query: {} });
    }
  };

  const openTab = async (tab: AppManagerTab) => {
    upsertTab(tab);
    activeTabKey.value = tab.key;
    syncRefsFromActiveTab();
    persistTabs();
    await syncRouteToActiveTab();
    await onTabChanged();
  };

  const loadPersistedTabs = () => {
    try {
      const restored = restoreSessionTabs(APP_TABS_STORAGE_KEY, APP_ACTIVE_TAB_STORAGE_KEY, isAppManagerTab);
      appTabs.value = restored.tabs.map((item) => ({
        key: item.key,
        deviceId: item.deviceId,
        deviceName: item.deviceName ?? getTitle(),
      }));
      activeTabKey.value = restored.activeTabKey;
      syncRefsFromActiveTab();
    } catch (error) {
      console.warn('Failed to restore app manager tabs:', error);
      appTabs.value = [];
      activeTabKey.value = '';
      syncRefsFromActiveTab();
    }
  };

  const consumeIncomingTab = async () => {
    const pendingTab = consumeWorkspaceOpen('apps');
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

  const activateTab = async (tabKey: string) => {
    if (tabKey === activeTabKey.value) {
      return;
    }

    const tab = appTabs.value.find((item) => item.key === tabKey);
    if (!tab) {
      return;
    }

    activeTabKey.value = tab.key;
    syncRefsFromActiveTab();
    persistTabs();
    await syncRouteToActiveTab();
    await onTabChanged();
  };

  const closeTab = async (tabKey: string) => {
    const closingActive = tabKey === activeTabKey.value;
    const closingIndex = appTabs.value.findIndex((item) => item.key === tabKey);
    if (closingIndex < 0) {
      return;
    }

    appTabs.value.splice(closingIndex, 1);
    if (!closingActive) {
      persistTabs();
      return;
    }

    const nextTab = appTabs.value[closingIndex] ?? appTabs.value[closingIndex - 1] ?? null;
    activeTabKey.value = nextTab?.key ?? '';
    syncRefsFromActiveTab();
    persistTabs();
    await syncRouteToActiveTab();
    await onTabChanged();
  };

  watch(
    () => route.query,
    async () => {
      if (!isAppsRouteActive.value) {
        return;
      }

      await consumeIncomingTab();
    },
  );

  onMounted(async () => {
    loadPersistedTabs();
    if (!isAppsRouteActive.value) {
      return;
    }

    const consumed = await consumeIncomingTab();
    if (!consumed) {
      await onTabChanged();
    }
  });

  onActivated(async () => {
    if (isAppsRouteActive.value) {
      await consumeIncomingTab();
    }
  });

  return {
    route,
    router,
    appTabs,
    activeTabKey,
    deviceId,
    isAppsRouteActive,
    activeTab,
    tabItems,
    buildTabKey,
    persistTabs,
    syncRefsFromActiveTab,
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
