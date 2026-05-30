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
          <button class="transparent" @click="refreshApps" :disabled="loading || !deviceId">
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

<script lang="ts" src="./AppManagerView.ts"></script>

<style scoped src="./AppManagerView.css"></style>
