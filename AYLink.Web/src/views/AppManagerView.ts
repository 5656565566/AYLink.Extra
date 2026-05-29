import { defineComponent } from 'vue';
import { ref, computed, onActivated, onMounted, onUnmounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { apiFetch, readApiErrorMessage } from '../utils/api';
import WorkspaceTabs from '../components/WorkspaceTabs.vue';
import { useI18n } from '../composables/useI18n';
import { consumeWorkspaceOpen, requestWorkspaceOpen, type WorkspaceOpenRequest } from '../services/workspaceNavigation';
import { useNotification } from '../services/notification';

export default defineComponent({
  name: 'AppManagerView',
  components: {
    WorkspaceTabs
  },
  setup() {
    interface AppInfo {    
      Name: string;    
      PackageName: string;    
    }

    interface AppDetails {    
      packageName: string;    
      versionName: string;    
      versionCode: string;    
      firstInstallTime: string;    
      lastUpdateTime: string;    
      installerPackageName: string;    
      primaryApkPath: string;    
      apkPaths: string[];    
    }

    interface AppManagerTab {    
      key: string;    
      deviceId: string;    
      deviceName: string;    
    }

    const APP_TABS_STORAGE_KEY = 'aylink_app_tabs';

    const APP_ACTIVE_TAB_STORAGE_KEY = 'aylink_app_active_tab';

    const apps = ref<AppInfo[]>([]);

    const searchQuery = ref('');

    const loading = ref(false);

    const route = useRoute();

    const router = useRouter();

    const { t } = useI18n();

    const notifications = useNotification();

    const appTabs = ref<AppManagerTab[]>([]);

    const activeTabKey = ref('');

    const deviceId = ref<string>('');

    const isAppsRouteActive = computed(() => route.name === 'apps');

    const actionInProgress = ref(false);

    const apkInput = ref<HTMLInputElement | null>(null);

    const selectedApp = ref<AppInfo | null>(null);

    const contextMenu = ref({    
      show: false,    
      x: 0,    
      y: 0,    
      app: null as AppInfo | null    
    });

    const appInfoDialog = ref({    
      show: false,    
      loading: false,    
      appName: '',    
      info: null as AppDetails | null    
    });

    const filteredApps = computed(() => {    
      if (!searchQuery.value) return apps.value;    
      const q = searchQuery.value.toLowerCase();    
      return apps.value.filter(a =>     
        (a.Name && a.Name.toLowerCase().includes(q)) ||     
        (a.PackageName && a.PackageName.toLowerCase().includes(q))    
      );    
    });

    const activeTab = computed(() => appTabs.value.find((tab) => tab.key === activeTabKey.value) ?? null);

    const tabItems = computed(() => appTabs.value.map((tab) => ({    
      key: tab.key,    
      title: tab.deviceName || t('AppPage.Title', '应用管理')    
    })));

    const buildTabKey = (nextDeviceId: string) => `${nextDeviceId}::apps`;

    const persistTabs = () => {    
      sessionStorage.setItem(APP_TABS_STORAGE_KEY, JSON.stringify(appTabs.value));    
      sessionStorage.setItem(APP_ACTIVE_TAB_STORAGE_KEY, activeTabKey.value);    
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
        deviceName: String(route.query.deviceName ?? '').trim() || t('AppPage.Title', '应用管理')    
      } satisfies AppManagerTab;    
    };

    const createTabFromRequest = (request: WorkspaceOpenRequest) => ({    
      key: buildTabKey(request.deviceId),    
      deviceId: request.deviceId,    
      deviceName: request.deviceName || t('AppPage.Title', '应用管理')    
    }) satisfies AppManagerTab;

    const syncRouteToActiveTab = async () => {    
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
      await loadApps();    
    };

    const loadPersistedTabs = () => {    
      try {    
        const rawTabs = sessionStorage.getItem(APP_TABS_STORAGE_KEY);    
        const rawActiveTab = sessionStorage.getItem(APP_ACTIVE_TAB_STORAGE_KEY) ?? '';    
        const parsedTabs = rawTabs ? JSON.parse(rawTabs) : [];    
        if (Array.isArray(parsedTabs)) {    
          appTabs.value = parsedTabs    
            .filter((item): item is AppManagerTab => !!item && typeof item.key === 'string' && typeof item.deviceId === 'string')    
            .map((item) => ({    
              key: item.key,    
              deviceId: item.deviceId,    
              deviceName: item.deviceName ?? t('AppPage.Title', '应用管理')    
            }));    
        }    
        activeTabKey.value = appTabs.value.some((item) => item.key === rawActiveTab)    
          ? rawActiveTab    
          : appTabs.value[0]?.key ?? '';    
        syncRefsFromActiveTab();    
      } catch (error) {    
        console.warn('Failed to restore app manager tabs:', error);    
        appTabs.value = [];    
        activeTabKey.value = '';    
        syncRefsFromActiveTab();    
      }    
    };

    const loadApps = async () => {    
      if (!deviceId.value) {    
        apps.value = [];    
        loading.value = false;    
        return;    
      }    
        
      loading.value = true;    
      apps.value = [];    
      try {    
        const res = await apiFetch(`/api/devices/${deviceId.value}/apps`);    
        if (res.ok) {    
          apps.value = await res.json();    
        }    
      } catch (e) {    
        console.error('Failed to load apps', e);    
      } finally {    
        loading.value = false;    
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
      await loadApps();    
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
      await loadApps();    
    };

    // Selection and Context Menu Actions    
    const selectApp = (app: AppInfo) => {    
      selectedApp.value = app;    
    };

    const onContextMenu = (event: MouseEvent, app: AppInfo) => {    
      selectedApp.value = app;    
          
      let x = event.clientX;    
      let y = event.clientY;    
          
      const menuWidth = 180;    
      const menuHeight = 240;    
          
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
        app    
      };    
    };

    const closeContextMenu = () => {    
      if (contextMenu.value.show) {    
        contextMenu.value.show = false;    
      }    
    };

    const activeDeviceId = computed(() => deviceId.value);

    const showSuccess = (message: string) => {    
      notifications.show({    
        type: 'success',    
        title: t('Common.Success', '成功'),    
        message    
      });    
    };

    const showError = (message: string) => {    
      notifications.show({    
        type: 'error',    
        title: t('Common.OperationFailed', '操作失败'),    
        message    
      });    
    };

    const getResponseErrorMessage = async (response: Response, fallback: string) => {
    
      return readApiErrorMessage(response, fallback);
    
    };

    const triggerInstallApk = () => {    
      if (actionInProgress.value || !activeDeviceId.value) {    
        return;    
      }    
      apkInput.value?.click();    
    };

    const installApk = async (file: File) => {    
      const formData = new FormData();    
      formData.append('file', file, file.name);    
        
      const response = await apiFetch(`/api/devices/${activeDeviceId.value}/apps/install`, {    
        method: 'POST',    
        body: formData    
      });    
      if (!response.ok) {    
        throw new Error(await getResponseErrorMessage(response, t('AppPage.InstallFailed', 'APK 安装失败')));    
      }    
    };

    const handleApkSelected = async (event: Event) => {    
      const input = event.target as HTMLInputElement;    
      const file = input.files?.[0];    
      input.value = '';    
      if (!file || !activeDeviceId.value) {    
        return;    
      }    
        
      actionInProgress.value = true;    
      try {    
        await installApk(file);    
        showSuccess(t('AppPage.InstallSuccess', 'APK 安装成功'));    
        await loadApps();    
      } catch (error) {    
        console.error('Failed to install apk', error);    
        showError(error instanceof Error ? error.message : t('AppPage.InstallFailed', 'APK 安装失败'));    
      } finally {    
        actionInProgress.value = false;    
      }    
    };

    const downloadApp = async (app: AppInfo) => {    
      const response = await apiFetch(`/api/devices/${activeDeviceId.value}/apps/download`, {    
        method: 'POST',    
        headers: { 'Content-Type': 'application/json' },    
        body: JSON.stringify({ packageName: app.PackageName })    
      });    
      if (!response.ok) {    
        throw new Error(await getResponseErrorMessage(response, t('AppPage.DownloadFailed', 'APK 下载失败')));    
      }    
        
      const blob = await response.blob();    
      const url = window.URL.createObjectURL(blob);    
      const anchor = document.createElement('a');    
      anchor.href = url;    
      anchor.download = `${app.PackageName || 'app'}.apk`;    
      document.body.appendChild(anchor);    
      anchor.click();    
      anchor.remove();    
      window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);    
    };

    const launchApp = async (app: AppInfo) => {    
      const response = await apiFetch(`/api/devices/${activeDeviceId.value}/apps/launch`, {    
        method: 'POST',    
        headers: { 'Content-Type': 'application/json' },    
        body: JSON.stringify({ packageName: app.PackageName })    
      });    
      if (!response.ok) {    
        throw new Error(await getResponseErrorMessage(response, t('AppPage.LaunchFailed', '应用启动失败')));    
      }    
    };

    const uninstallApp = async (app: AppInfo) => {    
      const confirmed = window.confirm(    
        t('AppPage.UninstallConfirm', '确认卸载该应用？')    
      );    
      if (!confirmed) {    
        return;    
      }    
        
      const response = await apiFetch(`/api/devices/${activeDeviceId.value}/apps/uninstall`, {    
        method: 'POST',    
        headers: { 'Content-Type': 'application/json' },    
        body: JSON.stringify({ packageName: app.PackageName })    
      });    
      if (!response.ok) {    
        throw new Error(await getResponseErrorMessage(response, t('AppPage.UninstallFailed', '应用卸载失败')));    
      }    
        
      if (selectedApp.value?.PackageName === app.PackageName) {    
        selectedApp.value = null;    
      }    
    };

    const openAppInfo = async (app: AppInfo) => {    
      appInfoDialog.value = {    
        show: true,    
        loading: true,    
        appName: app.Name,    
        info: null    
      };    
        
      try {    
        const response = await apiFetch(`/api/devices/${activeDeviceId.value}/apps/info`, {    
          method: 'POST',    
          headers: { 'Content-Type': 'application/json' },    
          body: JSON.stringify({ packageName: app.PackageName })    
        });    
        if (!response.ok) {    
          throw new Error(await getResponseErrorMessage(response, t('AppPage.InfoLoadFailed', '应用信息加载失败')));    
        }    
        const info = await response.json() as AppDetails;    
        appInfoDialog.value = {    
          show: true,    
          loading: false,    
          appName: app.Name,    
          info    
        };    
      } catch (error) {    
        console.error('Failed to load app info', error);    
        appInfoDialog.value.loading = false;    
        showError(error instanceof Error ? error.message : t('AppPage.InfoLoadFailed', '应用信息加载失败'));    
      }    
    };

    const closeAppInfo = () => {    
      appInfoDialog.value.show = false;    
    };

    const handleContextAction = async (action: string) => {    
      const app = contextMenu.value.app;    
      if (!app) return;    
        
      closeContextMenu();    
      actionInProgress.value = true;    
      try {    
        switch (action) {    
          case 'launch':    
            await launchApp(app);    
            showSuccess(t('AppPage.LaunchSuccess', '应用已启动'));    
            break;    
          case 'launch-new':    
            if (!deviceId.value) {    
              break;    
            }    
            requestWorkspaceOpen('screencast', {    
              deviceId: deviceId.value,    
              deviceName: activeTab.value?.deviceName || t('AppPage.Title', '应用管理'),    
              appPackageName: app.PackageName,    
              appDisplayName: app.Name,    
              newDisplay: true    
            });    
            await router.push({ name: 'screencast' });    
            break;    
          case 'download':    
            await downloadApp(app);    
            showSuccess(t('AppPage.DownloadSuccess', 'APK 下载已开始'));    
            break;    
          case 'copy-pkg':    
            await navigator.clipboard.writeText(app.PackageName);    
            showSuccess(t('AppPage.CopyPkgSuccess', '包名已复制'));    
            break;    
          case 'uninstall':    
            await uninstallApp(app);    
            showSuccess(t('AppPage.UninstallSuccess', '应用已卸载'));    
            await loadApps();    
            break;    
          case 'info':    
            await openAppInfo(app);    
            break;    
        }    
      } catch (e) {    
        console.error('App action failed', e);    
        showError(e instanceof Error ? e.message : t('Common.OperationFailed', '操作失败'));    
      } finally {    
        actionInProgress.value = false;    
      }    
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
      if (!isAppsRouteActive.value) {    
        return;    
      }    
        
      const consumed = await consumeIncomingTab();    
      if (!consumed) {    
        loadApps();    
      }    
    });

    onActivated(async () => {    
      if (isAppsRouteActive.value) {    
        await consumeIncomingTab();    
      }    
    });

    onUnmounted(() => {    
      document.removeEventListener('click', closeContextMenu);    
    });

    return {
      APP_TABS_STORAGE_KEY,
      APP_ACTIVE_TAB_STORAGE_KEY,
      apps,
      searchQuery,
      loading,
      route,
      router,
      t,
      notifications,
      appTabs,
      activeTabKey,
      deviceId,
      isAppsRouteActive,
      actionInProgress,
      apkInput,
      selectedApp,
      contextMenu,
      appInfoDialog,
      filteredApps,
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
      loadApps,
      consumeIncomingTab,
      activateTab,
      closeTab,
      selectApp,
      onContextMenu,
      closeContextMenu,
      activeDeviceId,
      showSuccess,
      showError,
      getResponseErrorMessage,
      triggerInstallApk,
      installApk,
      handleApkSelected,
      downloadApp,
      launchApp,
      uninstallApp,
      openAppInfo,
      closeAppInfo,
      handleContextAction
    };
  }
});
