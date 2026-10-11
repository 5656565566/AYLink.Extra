<template>
  <div class="page-container" @click="closeContextMenu()">
    <WorkspaceTabs
      :tabs="tabItems"
      :active-key="activeTabKey"
      @select="activateTab"
      @close="closeTab">
      <template #icon>
        <Folder20Regular class="workspace-tab__icon" aria-hidden="true" />
      </template>
    </WorkspaceTabs>

    <div class="toolbar">
      <div class="path-bar">
        <button
          class="path-back-button icon-button transparent"
          type="button"
          :disabled="!canGoUp || loading"
          :title="t('FilePage.GoUp', '返回上级')"
          :aria-label="t('FilePage.GoUp', '返回上级')"
          @click="goUp">
          <ArrowLeft20Regular aria-hidden="true" />
        </button>
        <div class="path-address" :title="activeTab ? currentPath : undefined" @click.self="beginPathEdit">
          <input
            v-if="pathEditing"
            ref="pathInput"
            v-model="pathDraft"
            class="path-input"
            type="text"
            :aria-label="t('FilePage.EditPath', '输入目录路径')"
            @keydown.enter.prevent="openTypedPath"
            @keydown.esc.prevent="pathEditing = false"
            @blur="pathEditing = false"
          />
          <nav
            v-else
            class="breadcrumbs"
            :aria-label="t('FilePage.CurrentDirectory', '当前目录')"
            @click.self="beginPathEdit">
            <template v-for="(crumb, index) in breadcrumbs" :key="crumb.path">
              <ChevronRight16Regular v-if="index" class="breadcrumb-separator" aria-hidden="true" />
              <button
                class="breadcrumb-button transparent"
                type="button"
                :disabled="!activeTab || loading"
                :aria-current="index === breadcrumbs.length - 1 ? 'page' : undefined"
                :aria-label="index === 0 ? t('FilePage.RootDirectory', '根目录') : undefined"
                @click.stop="navigateToPath(crumb.path)">
                {{ crumb.name }}
              </button>
            </template>
          </nav>
        </div>
        <div class="path-actions">
          <button
            v-if="!pathEditing"
            class="path-edit-button icon-button transparent"
            type="button"
            :disabled="!activeTab || loading"
            :title="t('FilePage.EditPath', '输入目录路径')"
            :aria-label="t('FilePage.EditPath', '输入目录路径')"
            @click="beginPathEdit">
            <Edit20Regular aria-hidden="true" />
          </button>
          <button
            class="icon-button transparent refresh-button"
            type="button"
            :disabled="!activeTab || loading"
            :title="t('Common.Refresh', '刷新')"
            :aria-label="t('Common.Refresh', '刷新')"
            @click="loadFiles">
            <ArrowClockwise20Regular :class="{ spinning: loading }" aria-hidden="true" />
          </button>
          <div ref="searchControl" class="search-control">
            <button
              ref="searchButton"
              class="search-button icon-button transparent"
              :class="{ 'is-active': searchExpanded || searchQuery.trim() }"
              type="button"
              :disabled="!activeTab"
              :title="t('FilePage.SearchDirectory', '搜索当前目录')"
              :aria-label="t('FilePage.SearchDirectory', '搜索当前目录')"
              :aria-expanded="searchExpanded"
              :aria-controls="searchExpanded ? 'file-search-panel' : undefined"
              @click.stop="toggleSearch">
              <Search20Regular aria-hidden="true" />
            </button>
            <div
              v-if="searchExpanded"
              id="file-search-panel"
              class="file-search"
              role="search"
              @click.stop
              @keydown.esc.prevent.stop="closeSearch(true)">
              <Search20Regular aria-hidden="true" />
              <input
                ref="searchInput"
                v-model="searchQuery"
                type="search"
                :placeholder="t('FilePage.SearchDirectory', '搜索当前目录')"
                :aria-label="t('FilePage.SearchDirectory', '搜索当前目录')"
              />
              <button
                v-if="searchQuery"
                class="search-clear icon-button transparent"
                type="button"
                :aria-label="t('FilePage.ClearSearch', '清除搜索')"
                @click="searchQuery = ''">
                <Dismiss16Regular aria-hidden="true" />
              </button>
            </div>
          </div>
          <button
            class="upload-button icon-button transparent"
            type="button"
            :disabled="!activeTab || uploading || loading"
            :title="t('FilePage.Upload', '上传')"
            :aria-label="t('FilePage.Upload', '上传')"
            aria-haspopup="menu"
            :aria-expanded="contextMenu.show && contextMenu.kind === 'upload'"
            :aria-controls="contextMenu.show && contextMenu.kind === 'upload' ? 'file-action-menu' : undefined"
            @click.stop="showMenu($event, null)"
            @keydown.down.prevent.stop="showMenu($event, null)">
            <ArrowUpload20Regular aria-hidden="true" />
          </button>
        </div>
      </div>
      <input ref="fileInput" class="file-upload-input" type="file" multiple @change="handleFilesSelected" />
      <input ref="folderInput" class="file-upload-input" type="file" multiple webkitdirectory @change="handleFolderSelected" />
    </div>

    <div class="content-area" :aria-busy="loading" @scroll="closeContextMenu()">
      <div v-if="loading && hasCurrentListing" class="refresh-indicator" role="status">
        <span class="sr-only">{{ t('Common.Refreshing', '刷新中...') }}</span>
      </div>
      <div v-if="loading && !hasCurrentListing" class="empty-state" role="status">
        <div class="spinner"></div>
        <p>{{ t('FilePage.LoadingFiles', '正在加载文件列表...') }}</p>
      </div>
      <div v-else-if="!activeTab" class="empty-state">
        <PlugDisconnected24Regular class="empty-state__icon" aria-hidden="true" />
        <p class="empty-state__title">{{ t('FilePage.NoDeviceSelected', '未选择设备') }}</p>
        <p>{{ t('FilePage.OpenFromHome', '请从首页选择一个设备打开文件管理') }}</p>
      </div>
      <div v-else-if="errorMessage" class="empty-state" role="alert">
        <ErrorCircle24Regular class="empty-state__icon" aria-hidden="true" />
        <p class="empty-state__title">{{ t('FilePage.ReadFailed', '无法读取当前目录') }}</p>
        <p>{{ errorMessage }}</p>
        <button class="retry-button" type="button" :disabled="loading" @click="loadFiles">
          <ArrowClockwise20Regular aria-hidden="true" />
          {{ t('FilePage.Retry', '重试') }}
        </button>
      </div>
      <div v-else-if="visibleEntries.length === 0" class="empty-state">
        <Search24Regular v-if="searchQuery.trim()" class="empty-state__icon" aria-hidden="true" />
        <FolderOpen24Regular v-else class="empty-state__icon" aria-hidden="true" />
        <p class="empty-state__title">
          {{ searchQuery.trim() ? t('FilePage.NoSearchResults', '没有匹配的文件') : t('FilePage.EmptyDirectory', '当前目录为空') }}
        </p>
        <button v-if="searchQuery.trim()" type="button" @click="searchQuery = ''">
          {{ t('FilePage.ClearSearch', '清除搜索') }}
        </button>
        <button v-else type="button" :disabled="uploading || loading" @click="triggerUploadFiles">
          <ArrowUpload20Regular aria-hidden="true" />
          {{ t('FilePage.UploadFiles', '上传文件') }}
        </button>
      </div>
      <table v-else class="file-table" :aria-label="t('FilePage.Title', '文件管理')">
        <colgroup>
          <col />
          <col class="type-column" />
          <col class="size-column" />
          <col class="actions-column" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col" :aria-sort="sortField === 'name' ? sortDirection : 'none'">
              <button class="sort-name sort-button transparent" type="button" @click="setSort('name')">
                {{ t('FilePage.NameHeader', '名称') }}
                <ChevronDown16Regular
                  class="sort-arrow"
                  :class="{ 'is-active': sortField === 'name', 'is-ascending': sortDirection === 'ascending' }"
                  aria-hidden="true" />
              </button>
            </th>
            <th scope="col" class="type-cell">{{ t('FilePage.TypeHeader', '类型') }}</th>
            <th scope="col" class="size-cell" :aria-sort="sortField === 'size' ? sortDirection : 'none'">
              <button class="sort-size sort-button transparent" type="button" @click="setSort('size')">
                {{ t('FilePage.SizeHeader', '大小') }}
                <ChevronDown16Regular
                  class="sort-arrow"
                  :class="{ 'is-active': sortField === 'size', 'is-ascending': sortDirection === 'ascending' }"
                  aria-hidden="true" />
              </button>
            </th>
            <th scope="col"><span class="sr-only">{{ t('FilePage.MoreActions', '更多操作') }}</span></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="entry in visibleEntries"
            :key="entry.Name"
            class="file-row"
            :class="{ selected: selectedEntry?.Name === entry.Name }"
            tabindex="0"
            @click="selectEntry(entry)"
            @dblclick="openEntry(entry)"
            @keydown.enter.prevent="openEntry(entry)"
            @keydown.shift.f10.prevent.stop="onContextMenu($event, entry)"
            @contextmenu.prevent.stop="onContextMenu($event, entry)">
            <td>
              <div class="file-name">
                <span class="file-icon" :class="'file-icon--' + getFileKind(entry)">
                  <component :is="fileIcons[getFileKind(entry)]" aria-hidden="true" />
                </span>
                <span class="file-name__text" :title="entry.Name">{{ entry.Name }}</span>
              </div>
            </td>
            <td class="type-cell">{{ getFileType(entry) }}</td>
            <td class="size-cell">{{ entry.IsDirectory ? '—' : formatFileSize(entry.Size) }}</td>
            <td class="actions-cell">
              <button
                class="row-actions icon-button transparent"
                type="button"
                :disabled="loading"
                :title="t('FilePage.MoreActions', '更多操作')"
                :aria-label="t('FilePage.EntryActions', '更多操作：{0}', entry.Name)"
                aria-haspopup="menu"
                :aria-expanded="contextMenu.show && contextMenu.kind === 'entry' && contextMenu.entry?.Name === entry.Name"
                :aria-controls="contextMenu.show && contextMenu.kind === 'entry' && contextMenu.entry?.Name === entry.Name ? 'file-action-menu' : undefined"
                @click.stop="onContextMenu($event, entry)"
                @dblclick.stop
                @keydown.enter.stop
                @keydown.down.prevent.stop="onContextMenu($event, entry)">
                <MoreHorizontal20Regular aria-hidden="true" />
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="footer-bar">
      <span v-if="activeTab">
        {{ searchQuery.trim()
          ? t('FilePage.FilteredCount', '显示 {0} / {1} 个项目', visibleEntries.length, directoryEntries.length)
          : t('FilePage.ItemCount', '{0} 个项目', directoryEntries.length) }}
      </span>
      <span v-else>{{ t('FilePage.NoDeviceSelected', '未选择设备') }}</span>
      <span v-if="selectedEntry" class="selection-summary" :title="selectedEntry.Name">{{ selectedEntry.Name }}</span>
    </div>

    <Teleport to="body">
      <div
        v-if="contextMenu.show"
        id="file-action-menu"
        ref="menuElement"
        class="context-menu"
        role="menu"
        :aria-label="contextMenu.kind === 'upload' ? t('FilePage.Upload', '上传') : t('FilePage.MoreActions', '更多操作')"
        :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
        @click.stop
        @keydown="onMenuKeydown">
        <button
          v-for="item in menuActions"
          :key="item.action"
          class="context-menu-item"
          :class="{ danger: item.action === 'delete' }"
          type="button"
          role="menuitem"
          tabindex="-1"
          @click="handleContextAction(item.action)">
          <component :is="item.icon" aria-hidden="true" />
          {{ item.label }}
        </button>
      </div>
    </Teleport>
  </div>
</template>

<script lang="ts" src="./FileManagerView.ts"></script>

<style scoped src="./FileManagerView.css"></style>
