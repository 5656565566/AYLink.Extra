<template>
  <div class="page-container" @click="closeContextMenu">
    <WorkspaceTabs
      :tabs="tabItems"
      :active-key="activeTabKey"
      @select="activateTab"
      @close="closeTab">
      <template #icon>
        <svg class="workspace-tab__icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 4.5H13M6 8H13M6 11.5H13M3 4.5H3.01M3 8H3.01M3 11.5H3.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </template>
    </WorkspaceTabs>
    <div class="header" v-if="deviceId">
      <div class="title-bar">
        <div class="search-container">
            <svg class="search-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                <path d="M6.5 2C8.98528 2 11 4.01472 11 6.5C11 7.6226 10.5882 8.6487 9.91427 9.4284L13.8536 13.3678C14.0488 13.563 14.0488 13.8796 13.8536 14.0749C13.6583 14.2701 13.3417 14.2701 13.1464 14.0749L9.20712 10.1355C8.42738 10.8095 7.40128 11.2213 6.27868 11.2213C3.7934 11.2213 1.77869 9.20658 1.77869 6.72131C1.77869 4.23604 3.7934 2 6.27868 2ZM6.5 3C4.567 3 3 4.567 3 6.5C3 8.433 4.567 10 6.5 10C8.433 10 10 8.433 10 6.5C10 4.567 8.433 3 6.5 3Z"/>
            </svg>
            <input
              type="text"
              class="search-input"
              :placeholder="t('AppPage.SearchWatermark', '搜索应用名称或包名...')"
              v-model="searchQuery"
            />
        </div>
        <div class="actions">
          <button class="transparent" @click="triggerInstallApk" :disabled="loading || actionInProgress || !deviceId">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M7.5 14V8.5H2V7.5H7.5V2H8.5V7.5H14V8.5H8.5V14H7.5Z"/></svg>
            {{ t('AppPage.InstallApk', '安装 APK') }}
          </button>
          <button class="transparent" @click="loadApps" :disabled="loading || !deviceId">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M12.4497 3.55025L10.3284 5.67157C10.1332 5.86684 9.81658 5.86684 9.62132 5.67157C9.42606 5.47631 9.42606 5.15973 9.62132 4.96447L11.5858 3.00001L9.62134 1.03554C9.42607 0.840277 9.42607 0.523694 9.62134 0.328432C9.8166 -0.109477 10.1332 -0.109477 10.3284 0.328432L12.4497 2.44975C12.7535 2.75351 12.7535 3.24649 12.4497 3.55025ZM4.41421 15.0001L6.37868 16.9645C6.57394 17.1598 6.89052 17.1598 7.08579 16.9645C7.28105 16.7693 7.28105 16.4527 7.08579 16.2574L5.12132 14.293L7.08577 12.3285C7.28104 12.1332 7.28104 11.8167 7.08577 11.6214C6.89051 11.4261 6.57393 11.4261 6.37866 11.6214L4.41421 13.5858C4.11046 13.8896 4.11046 14.3826 4.41421 14.6863ZM12.5 8C12.5 10.4853 10.4853 12.5 8 12.5C5.51472 12.5 3.5 10.4853 3.5 8C3.5 6.42557 4.30823 4.98188 5.61868 4.14811C5.85042 3.99818 5.92617 3.68412 5.77977 3.44759C5.63336 3.21106 5.32356 3.12933 5.09182 3.27926C3.4116 4.35627 2.5 6.13601 2.5 8C2.5 11.0376 4.96243 13.5 8 13.5C11.0376 13.5 13.5 11.0376 13.5 8C13.5 5.56611 11.9567 3.5042 9.77121 2.76634C9.51347 2.67931 9.22744 2.82522 9.13886 3.08055C9.05027 3.33588 9.19163 3.61908 9.44937 3.70611C11.2389 4.30799 12.5 6.00287 12.5 8Z"/></svg>
            {{ loading ? t('Common.Refreshing', '刷新中...') : t('Common.Refresh', '刷新') }}
          </button>
        </div>
      </div>
    </div>
    
    <div class="content-area" @scroll="closeContextMenu">
      <div v-if="loading" class="empty-state">
        <div class="spinner"></div>
        <p>{{ t('AppPage.LoadingApps', '正在加载应用列表...') }}</p>
      </div>
      <div v-else-if="!deviceId" class="empty-state">
        <svg class="empty-state__icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="6" cy="6" r="2" stroke="currentColor" stroke-width="1.5"/>
          <circle cx="6" cy="12" r="2" stroke="currentColor" stroke-width="1.5"/>
          <circle cx="6" cy="18" r="2" stroke="currentColor" stroke-width="1.5"/>
          <path d="M11 6H19M11 12H19M11 18H19" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <div class="empty-state__title">{{ t('AppPage.NoDeviceSelected', '未选中设备') }}</div>
        <div class="empty-state__desc">{{ t('AppPage.OpenFromHome', '请在首页选择一个设备来管理应用') }}</div>
      </div>
      <div v-else-if="filteredApps.length === 0" class="empty-state">
        <p>{{ t('AppPage.NoAppsFound', '未找到应用') }}</p>
      </div>
      <table v-else class="fluent-table">
        <thead>
          <tr>
            <th>{{ t('AppPage.AppNameHeader', '应用名称') }}</th>
            <th>{{ t('AppPage.PackageNameHeader', '包名') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr 
            v-for="(app, index) in filteredApps" 
            :key="index"
            :class="{ 'selected': selectedApp?.PackageName === app.PackageName }"
            @click="selectApp(app)"
            @contextmenu.prevent="onContextMenu($event, app)"
          >
            <td>{{ app.Name }}</td>
            <td>{{ app.PackageName }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="footer-bar">
      {{ t('AppPage.AppCount', '共 {0} 个应用', filteredApps.length) }}
    </div>
    <input
      ref="apkInput"
      class="hidden-file-input"
      type="file"
      accept=".apk,application/vnd.android.package-archive"
      @change="handleApkSelected"
    />

    <!-- Context Menu -->
    <Teleport to="body">
      <div 
        v-if="contextMenu.show" 
        class="context-menu" 
        :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
        @click.stop
      >
        <div class="context-menu-item" @click="handleContextAction('launch')">
          {{ t('AppPage.ActionLaunch', '启动应用') }}
        </div>
        <div class="context-menu-item" @click="handleContextAction('launch-new')">
          {{ t('AppPage.ActionLaunchNew', '新建屏幕启动') }}
        </div>
        <div class="context-menu-item" @click="handleContextAction('download')">
          {{ t('AppPage.ActionDownload', '下载 APK 到本地') }}
        </div>
        <div class="context-menu-item" @click="handleContextAction('copy-pkg')">
          {{ t('AppPage.ActionCopyPkg', '复制包名') }}
        </div>
        <div class="context-menu-item danger" @click="handleContextAction('uninstall')">
          {{ t('AppPage.ActionUninstall', '卸载') }}
        </div>
        <div class="context-menu-item" @click="handleContextAction('info')">
          {{ t('AppPage.ActionInfo', '应用信息') }}
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="appInfoDialog.show" class="dialog-backdrop" @click="closeAppInfo">
        <div class="app-info-dialog" @click.stop>
          <div class="app-info-dialog__header">
            <div>
              <div class="app-info-dialog__title">{{ appInfoDialog.info?.packageName || t('AppPage.ActionInfo', '应用信息') }}</div>
              <div class="app-info-dialog__subtitle">{{ appInfoDialog.appName }}</div>
            </div>
            <button class="icon-button" type="button" @click="closeAppInfo" aria-label="Close">
              <svg viewBox="0 0 16 16" fill="none">
                <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              </svg>
            </button>
          </div>
          <div v-if="appInfoDialog.loading" class="app-info-dialog__loading">
            <div class="spinner"></div>
            <span>{{ t('AppPage.LoadingAppInfo', '正在加载应用信息...') }}</span>
          </div>
          <div v-else-if="appInfoDialog.info" class="app-info-grid">
            <div class="app-info-row">
              <span class="app-info-label">{{ t('AppPage.PackageNameHeader', '包名') }}</span>
              <span class="app-info-value">{{ appInfoDialog.info.packageName || '-' }}</span>
            </div>
            <div class="app-info-row">
              <span class="app-info-label">{{ t('AppPage.VersionName', '版本名称') }}</span>
              <span class="app-info-value">{{ appInfoDialog.info.versionName || '-' }}</span>
            </div>
            <div class="app-info-row">
              <span class="app-info-label">{{ t('AppPage.VersionCode', '版本号') }}</span>
              <span class="app-info-value">{{ appInfoDialog.info.versionCode || '-' }}</span>
            </div>
            <div class="app-info-row">
              <span class="app-info-label">{{ t('AppPage.FirstInstallTime', '首次安装时间') }}</span>
              <span class="app-info-value">{{ appInfoDialog.info.firstInstallTime || '-' }}</span>
            </div>
            <div class="app-info-row">
              <span class="app-info-label">{{ t('AppPage.LastUpdateTime', '最后更新时间') }}</span>
              <span class="app-info-value">{{ appInfoDialog.info.lastUpdateTime || '-' }}</span>
            </div>
            <div class="app-info-row">
              <span class="app-info-label">{{ t('AppPage.InstallerPackage', '安装来源包名') }}</span>
              <span class="app-info-value">{{ appInfoDialog.info.installerPackageName || '-' }}</span>
            </div>
            <div class="app-info-row">
              <span class="app-info-label">{{ t('AppPage.PrimaryApkPath', '主 APK 路径') }}</span>
              <span class="app-info-value app-info-value--mono">{{ appInfoDialog.info.primaryApkPath || '-' }}</span>
            </div>
            <div class="app-info-row app-info-row--stacked">
              <span class="app-info-label">{{ t('AppPage.ApkPaths', 'APK 路径') }}</span>
              <div class="app-info-path-list">
                <div v-for="apkPath in appInfoDialog.info.apkPaths" :key="apkPath" class="app-info-value app-info-value--mono">{{ apkPath }}</div>
                <div v-if="appInfoDialog.info.apkPaths.length === 0" class="app-info-value">-</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onActivated, onMounted, onUnmounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { apiFetch } from '../utils/api';
import WorkspaceTabs from '../components/WorkspaceTabs.vue';
import { useI18n } from '../composables/useI18n';
import { consumeWorkspaceOpen, requestWorkspaceOpen, type WorkspaceOpenRequest } from '../services/workspaceNavigation';
import { useNotification } from '../services/notification';

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
  try {
    const payload = await response.json();
    return payload?.error?.message || payload?.message || fallback;
  } catch {
    return fallback;
  }
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
</script>

<style scoped>
.page-container {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.header {
  padding: 12px 24px;
}

.title-bar {
  display: flex;
  align-items: center;
  gap: 24px;
}

.search-container {
  position: relative;
  display: flex;
  align-items: center;
  width: 300px;
}

.search-icon {
  position: absolute;
  left: 10px;
  color: var(--fluent-text-secondary);
  pointer-events: none;
}

.search-input {
  width: 100%;
  padding-left: 32px !important;
}

.actions {
  display: flex;
  gap: 8px;
}

.hidden-file-input {
  display: none;
}

.content-area {
  flex: 1;
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
  z-index: 10;
  background: var(--fluent-bg-layer);
}

.empty-state__icon {
  width: 64px;
  height: 64px;
  margin-bottom: 16px;
  color: var(--fluent-text-tertiary);
}

.empty-state__title {
  font-size: 18px;
  font-weight: 600;
  color: var(--fluent-text-primary);
  margin-bottom: 8px;
}

.empty-state__desc {
  font-size: 13px;
  color: var(--fluent-text-secondary);
}

.spinner {
  width: 24px;
  height: 24px;
  border: 3px solid var(--fluent-control-fill-secondary);
  border-top-color: var(--fluent-accent-default);
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 12px;
}

.dialog-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.24);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  z-index: 1000;
}

.app-info-dialog {
  width: min(720px, calc(100vw - 48px));
  max-height: min(80vh, 720px);
  overflow: auto;
  background: var(--fluent-bg-card);
  border: 1px solid var(--fluent-border-subtle);
  border-radius: 18px;
  box-shadow: 0 24px 72px rgba(15, 23, 42, 0.2);
  padding: 20px;
}

.app-info-dialog__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 18px;
}

.app-info-dialog__title {
  font-size: 18px;
  font-weight: 700;
  color: var(--fluent-text-primary);
  word-break: break-all;
}

.app-info-dialog__subtitle {
  margin-top: 6px;
  font-size: 13px;
  color: var(--fluent-text-secondary);
}

.app-info-dialog__loading {
  min-height: 180px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--fluent-text-secondary);
}

.app-info-grid {
  display: grid;
  gap: 12px;
}

.app-info-row {
  display: grid;
  grid-template-columns: 140px minmax(0, 1fr);
  gap: 16px;
  align-items: start;
  padding: 12px 0;
  border-top: 1px solid var(--fluent-border-subtle);
}

.app-info-row--stacked {
  grid-template-columns: 1fr;
}

.app-info-label {
  font-size: 13px;
  color: var(--fluent-text-secondary);
}

.app-info-value {
  font-size: 13px;
  color: var(--fluent-text-primary);
  word-break: break-all;
}

.app-info-value--mono {
  font-family: "Consolas", "SFMono-Regular", monospace;
}

.app-info-path-list {
  display: grid;
  gap: 6px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.fluent-table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
}

.fluent-table th, .fluent-table td {
  padding: 10px 24px;
  border-bottom: 1px solid var(--fluent-stroke-default);
  font-size: 14px;
  user-select: none;
}

.fluent-table th {
  color: var(--fluent-text-secondary);
  font-weight: 600;
  position: sticky;
  top: 0;
  background-color: var(--fluent-bg-layer);
  z-index: 1;
}

.fluent-table tbody tr {
  transition: background-color 0.1s ease;
  cursor: pointer;
}

.fluent-table tbody tr:hover {
  background-color: var(--fluent-control-fill-secondary);
}

.fluent-table tbody tr:active {
  background-color: var(--fluent-control-fill-tertiary);
}

.fluent-table tbody tr.selected {
  background-color: rgba(138, 43, 226, 0.4);
}

.footer-bar {
  padding: 8px 24px;
  font-size: 12px;
  color: var(--fluent-text-tertiary);
  border-top: 1px solid var(--fluent-stroke-default);
  text-align: right;
  background-color: var(--fluent-bg-layer);
}

.context-menu {
  position: fixed;
  z-index: 1000;
  background-color: var(--fluent-bg-layer);
  border: 1px solid var(--fluent-stroke-default);
  border-radius: 8px;
  box-shadow: 0 8px 16px rgba(0, 0, 0, 0.2);
  padding: 4px;
  min-width: 160px;
}

.context-menu-item {
  padding: 8px 12px;
  font-size: 14px;
  cursor: pointer;
  color: var(--fluent-text-primary);
  border-radius: 4px;
  display: flex;
  align-items: center;
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
