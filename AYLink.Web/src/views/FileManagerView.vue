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
        <button class="icon-button" type="button" :disabled="!canGoUp || loading" :title="t('FilePage.GoUp', '返回上级')" @click="goUp">
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
        <button class="transparent" type="button" :disabled="!activeTab || uploading" @click="triggerUploadFiles">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M8 11.5V3.5M8 3.5L5 6.5M8 3.5L11 6.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M3 10.5V12.5C3 13.0523 3.44772 13.5 4 13.5H12C12.5523 13.5 13 13.0523 13 12.5V10.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
          </svg>
          {{ t('FilePage.UploadFiles', '上传文件') }}
        </button>
        <button class="transparent" type="button" :disabled="!activeTab || uploading" @click="triggerUploadFolder">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M2.5 4.5C2.5 3.94772 2.94772 3.5 3.5 3.5H6.1L7.1 4.75H12.5C13.0523 4.75 13.5 5.19772 13.5 5.75V12C13.5 12.5523 13.0523 13 12.5 13H3.5C2.94772 13 2.5 12.5523 2.5 12V4.5Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
            <path d="M8 11V7M8 7L6.5 8.5M8 7L9.5 8.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          {{ t('FilePage.UploadFolder', '上传文件夹') }}
        </button>
        <input ref="fileInput" class="file-upload-input" type="file" multiple @change="handleFilesSelected" />
        <input ref="folderInput" class="file-upload-input" type="file" multiple webkitdirectory @change="handleFolderSelected" />
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
        <div v-if="canUseBlobDownload(contextMenu.entry)" class="context-menu-item" @click="handleContextAction('download')">
          {{ t('FilePage.ActionDownload', '下载') }}
        </div>
        <div v-if="!contextMenu.entry?.IsDirectory" class="context-menu-item" @click="handleContextAction('browser-download')">
          {{ t('FilePage.ActionBrowserDownload', '浏览器下载') }}
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

<script lang="ts" src="./FileManagerView.ts"></script>

<style scoped src="./FileManagerView.css"></style>
