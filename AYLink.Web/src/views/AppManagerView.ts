import { defineComponent } from 'vue';
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { apiFetch, readApiErrorMessage } from '../utils/api';
import WorkspaceTabs from '../components/WorkspaceTabs.vue';
import { useI18n } from '../composables/useI18n';
import { useAsyncAction } from '../features/async/useAsyncAction';
import { useAppManagerTabs } from '../features/apps/useAppManagerTabs';
import { useDialog } from '../services/dialog';
import { requestWorkspaceOpen } from '../services/workspaceNavigation';
import { useNotification } from '../services/notification';
import type { AppDetails, AppInfo } from '../types/apps';
import { isAbortError } from '../lib/async/abort';
import { createLatestRequestController } from '../lib/async/latestRequest';

export default defineComponent({
  name: 'AppManagerView',
  components: {
    WorkspaceTabs
  },
  setup() {
    const apps = ref<AppInfo[]>([]);
    const searchQuery = ref('');
    const loading = ref(false);
    const appsRequest = createLatestRequestController();

    const { t } = useI18n();
    const dialogService = useDialog();
    const notifications = useNotification();
    const { isRunning: actionInProgress, run: runAction } = useAsyncAction();

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
      return apps.value.filter((app) =>
        (app.Name && app.Name.toLowerCase().includes(q))
        || (app.PackageName && app.PackageName.toLowerCase().includes(q))
      );
    });

    const loadApps = async (deviceId: string) => {
      const { requestId, signal } = appsRequest.begin();

      if (!deviceId) {
        apps.value = [];
        loading.value = false;
        appsRequest.finalize(requestId);
        return;
      }

      loading.value = true;
      apps.value = [];
      try {
        const response = await apiFetch(`/api/devices/${deviceId}/apps`, {
          signal,
          timeoutMs: 15000,
        });
        if (!appsRequest.isLatest(requestId)) {
          return;
        }

        if (response.ok) {
          apps.value = await response.json();
        }
      } catch (error) {
        if (!isAbortError(error)) {
          console.error('Failed to load apps', error);
        }
      } finally {
        if (appsRequest.isLatest(requestId)) {
          loading.value = false;
        }
        appsRequest.finalize(requestId);
      }
    };

    const {
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
    } = useAppManagerTabs(
      () => t('AppPage.Title', '应用管理'),
      async () => loadApps(deviceId.value),
    );

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

      try {
        await runAction(() => installApk(file));
        showSuccess(t('AppPage.InstallSuccess', 'APK 安装成功'));
        await loadApps(deviceId.value);
      } catch (error) {
        console.error('Failed to install apk', error);
        showError(error instanceof Error ? error.message : t('AppPage.InstallFailed', 'APK 安装失败'));
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
      const confirmed = await dialogService.confirm(
        t('AppPage.UninstallTitle', '卸载应用'),
        t('AppPage.UninstallConfirm', '确认卸载该应用？'),
        t('Common.Delete', '删除'),
        t('Common.Cancel', '取消')
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

    const refreshApps = async () => {
      await loadApps(deviceId.value);
    };

    const handleContextAction = async (action: string) => {
      const app = contextMenu.value.app;
      if (!app) return;

      closeContextMenu();
      try {
        await runAction(async () => {
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
              await loadApps(deviceId.value);
              break;
            case 'info':
              await openAppInfo(app);
              break;
          }
        });
      } catch (error) {
        console.error('App action failed', error);
        showError(error instanceof Error ? error.message : t('Common.OperationFailed', '操作失败'));
      }
    };

    onMounted(() => {
      document.addEventListener('click', closeContextMenu);
    });

    onUnmounted(() => {
      appsRequest.dispose();
      document.removeEventListener('click', closeContextMenu);
    });

    return {
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
      getResponseErrorMessage,
      triggerInstallApk,
      installApk,
      handleApkSelected,
      refreshApps,
      downloadApp,
      launchApp,
      uninstallApp,
      openAppInfo,
      closeAppInfo,
      handleContextAction
    };
  }
});
