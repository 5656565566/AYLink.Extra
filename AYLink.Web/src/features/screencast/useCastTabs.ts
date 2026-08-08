import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { consumeWorkspaceOpen, type WorkspaceOpenRequest } from '../../services/workspaceNavigation';
import type { CastTab } from '../../types/screencast';

const CAST_TABS_STORAGE_KEY = 'aylink_cast_tabs';
const CAST_ACTIVE_TAB_STORAGE_KEY = 'aylink_cast_active_tab';

export function useCastTabs(getTabTitle: (tab: CastTab) => string) {
  const route = useRoute();
  const router = useRouter();

  const castTabs = ref<CastTab[]>([]);
  const activeTabKey = ref('');

  const activeTab = computed(() => castTabs.value.find((tab) => tab.key === activeTabKey.value) ?? null);
  const hasCastTabs = computed(() => castTabs.value.length > 0);
  const castTabItems = computed(() => castTabs.value.map((tab) => ({
    key: tab.key,
    title: getTabTitle(tab)
  })));
  const isScreencastRouteActive = computed(() => route.name === 'screencast');

  let pendingPersistTabsTimer: number | null = null;
  let lastPersistedTabsSnapshot = '';
  let lastPersistedActiveTabKey = '';

  const buildTabKey = (tab: Pick<CastTab, 'deviceId' | 'appPackageName' | 'newDisplay'>) => {
    const mode = tab.newDisplay ? 'new-display' : 'screen';
    return tab.appPackageName ? `${tab.deviceId}::${mode}::${tab.appPackageName}` : `${tab.deviceId}::${mode}`;
  };

  const flushPersistTabs = () => {
    pendingPersistTabsTimer = null;

    const tabsSnapshot = JSON.stringify(castTabs.value);
    const activeTabSnapshot = activeTabKey.value;
    if (tabsSnapshot === lastPersistedTabsSnapshot && activeTabSnapshot === lastPersistedActiveTabKey) {
      return;
    }

    sessionStorage.setItem(CAST_TABS_STORAGE_KEY, tabsSnapshot);
    sessionStorage.setItem(CAST_ACTIVE_TAB_STORAGE_KEY, activeTabSnapshot);
    lastPersistedTabsSnapshot = tabsSnapshot;
    lastPersistedActiveTabKey = activeTabSnapshot;
  };

  const schedulePersistTabs = () => {
    if (pendingPersistTabsTimer !== null) {
      return;
    }

    pendingPersistTabsTimer = window.setTimeout(flushPersistTabs, 0);
  };

  const cleanupPersistTabs = () => {
    if (pendingPersistTabsTimer !== null) {
      window.clearTimeout(pendingPersistTabsTimer);
      flushPersistTabs();
    }
  };

  const persistTabs = () => {
    schedulePersistTabs();
  };

  const syncRouteToActiveTab = async () => {
    if (!isScreencastRouteActive.value) {
      return;
    }

    const {
      deviceId: _deviceId,
      appPackage: _appPackage,
      appName: _appName,
      newDisplay: _newDisplay,
      ...preservedQuery
    } = route.query;

    if (Object.keys(route.query).length !== Object.keys(preservedQuery).length) {
      await router.replace({ name: 'screencast', query: preservedQuery });
    }
  };

  const upsertTab = (tab: CastTab) => {
    const existingIndex = castTabs.value.findIndex((item) => item.key === tab.key);
    if (existingIndex >= 0) {
      const existingTab = castTabs.value[existingIndex];
      castTabs.value[existingIndex] = {
        ...existingTab,
        ...tab,
        sessionId: tab.sessionId || existingTab.sessionId
      };
    } else {
      castTabs.value.push(tab);
    }
    persistTabs();
  };

  const createTabFromQuery = (currentSelectedDeviceName: string, defaultDeviceName: string) => {
    if (!isScreencastRouteActive.value) {
      return null;
    }

    const nextDeviceId = String(route.query.deviceId ?? '').trim();
    if (!nextDeviceId) return null;

    const nextAppPackageName = String(route.query.appPackage ?? '').trim();
    const nextAppDisplayName = String(route.query.appName ?? '').trim();
    const nextDeviceName = activeTab.value?.deviceId === nextDeviceId ? currentSelectedDeviceName : defaultDeviceName;
    const nextNewDisplay = String(route.query.newDisplay ?? '').trim() === '1';

    const nextTab: CastTab = {
      key: buildTabKey({ deviceId: nextDeviceId, appPackageName: nextAppPackageName, newDisplay: nextNewDisplay }),
      deviceId: nextDeviceId,
      appPackageName: nextAppPackageName,
      appDisplayName: nextAppDisplayName,
      deviceName: nextDeviceName,
      newDisplay: nextNewDisplay,
      sessionId: ''
    };

    return nextTab;
  };

  const createTabFromRequest = (request: WorkspaceOpenRequest, defaultDeviceName: string) => {
    const nextAppPackageName = request.appPackageName ?? '';
    const nextNewDisplay = request.newDisplay === true;
    const nextTab: CastTab = {
      key: buildTabKey({ deviceId: request.deviceId, appPackageName: nextAppPackageName, newDisplay: nextNewDisplay }),
      deviceId: request.deviceId,
      appPackageName: nextAppPackageName,
      appDisplayName: request.appDisplayName ?? '',
      deviceName: request.deviceName ?? defaultDeviceName,
      newDisplay: nextNewDisplay,
      sessionId: ''
    };

    return nextTab;
  };

  const openIncomingTab = async (
    tab: CastTab,
    syncRefsFromActiveTab: () => void,
    onTabOpened: () => Promise<void>,
  ) => {
    upsertTab(tab);
    activeTabKey.value = tab.key;
    syncRefsFromActiveTab();
    persistTabs();
    await syncRouteToActiveTab();
    await onTabOpened();
  };

  const consumeIncomingTab = async (
    currentSelectedDeviceName: string,
    defaultDeviceName: string,
    syncRefsFromActiveTab: () => void,
    onTabOpened: () => Promise<void>,
  ) => {
    const pendingTab = consumeWorkspaceOpen('screencast');
    if (pendingTab) {
      await openIncomingTab(createTabFromRequest(pendingTab, defaultDeviceName), syncRefsFromActiveTab, onTabOpened);
      return true;
    }

    const routeTab = createTabFromQuery(currentSelectedDeviceName, defaultDeviceName);
    if (routeTab) {
      await openIncomingTab(routeTab, syncRefsFromActiveTab, onTabOpened);
      return true;
    }

    await syncRouteToActiveTab();
    return false;
  };

  const loadPersistedTabs = (syncRefsFromActiveTab: () => void, defaultDeviceName: string) => {
    try {
      const rawTabs = sessionStorage.getItem(CAST_TABS_STORAGE_KEY);
      const rawActiveTab = sessionStorage.getItem(CAST_ACTIVE_TAB_STORAGE_KEY) ?? '';
      const parsedTabs = rawTabs ? JSON.parse(rawTabs) : [];
      if (Array.isArray(parsedTabs)) {
        castTabs.value = parsedTabs
          .filter((item): item is CastTab => !!item && typeof item.key === 'string' && typeof item.deviceId === 'string')
          .map((item) => ({
            key: item.key,
            deviceId: item.deviceId,
            appPackageName: item.appPackageName ?? '',
            appDisplayName: item.appDisplayName ?? '',
            deviceName: item.deviceName ?? defaultDeviceName,
            newDisplay: item.newDisplay === true,
            sessionId: typeof item.sessionId === 'string' ? item.sessionId : ''
          }));
      }
      activeTabKey.value = castTabs.value.some((item) => item.key === rawActiveTab)
        ? rawActiveTab
        : castTabs.value[0]?.key ?? '';
      syncRefsFromActiveTab();
      lastPersistedTabsSnapshot = JSON.stringify(castTabs.value);
      lastPersistedActiveTabKey = activeTabKey.value;
    } catch (error) {
      console.warn('Failed to restore cast tabs:', error);
      castTabs.value = [];
      activeTabKey.value = '';
      syncRefsFromActiveTab();
      lastPersistedTabsSnapshot = JSON.stringify(castTabs.value);
      lastPersistedActiveTabKey = activeTabKey.value;
    }
  };

  return {
    CAST_TABS_STORAGE_KEY,
    CAST_ACTIVE_TAB_STORAGE_KEY,
    route,
    router,
    castTabs,
    activeTabKey,
    activeTab,
    hasCastTabs,
    castTabItems,
    isScreencastRouteActive,
    buildTabKey,
    flushPersistTabs,
    schedulePersistTabs,
    cleanupPersistTabs,
    persistTabs,
    syncRouteToActiveTab,
    upsertTab,
    createTabFromQuery,
    createTabFromRequest,
    openIncomingTab,
    consumeIncomingTab,
    loadPersistedTabs
  };
}
