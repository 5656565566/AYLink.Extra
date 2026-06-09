<template>
  <div class="input-mapping-page">
    <div class="input-mapping-header">
      <div class="input-mapping-title-row">
        <button class="transparent icon-btn input-mapping-back-btn" @click="goBack">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M10.5 3.5L6 8L10.5 12.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span>{{ t('Common.Back', '返回') }}</span>
        </button>
        <label class="search-box">
          <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M7.25 12.5C10.1495 12.5 12.5 10.1495 12.5 7.25C12.5 4.35051 10.1495 2 7.25 2C4.35051 2 2 4.35051 2 7.25C2 10.1495 4.35051 12.5 7.25 12.5Z" stroke="currentColor" stroke-width="1.4"/>
            <path d="M11 11L14 14" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
          </svg>
          <input :value="searchKeyword" type="search" :placeholder="t('InputMapping.SearchPlaceholder', '搜索名称、包名或备注')" @input="updateSearchKeyword" />
        </label>
        <div class="input-mapping-actions">
          <button class="fluent-btn" @click="triggerImport">{{ t('InputMapping.ImportProfile', '导入方案') }}</button>
          <button class="fluent-btn primary" @click="createSampleProfile">{{ t('InputMapping.CreateProfile', '新增方案') }}</button>
          <input ref="fileInput" class="hidden-file-input" type="file" accept="application/json,.json,.aylink-input-map.json" @change="handleImportFile" />
        </div>
      </div>
    </div>

    <div class="input-mapping-table-shell">
      <div class="input-mapping-table-header">
        <div>{{ t('InputMapping.ProfileName', '名称') }}</div>
        <div>{{ t('InputMapping.PackageName', '包名') }}</div>
        <div>{{ t('InputMapping.Author', '作者') }}</div>
        <div>{{ t('InputMapping.UpdatedAt', '更新时间') }}</div>
        <div>{{ t('HomeView.Actions', '操作') }}</div>
      </div>

      <div v-if="pagedProfiles.length === 0" class="input-mapping-empty">
        {{ profiles.length === 0 ? t('InputMapping.EmptyProfiles', '暂无按键映射方案') : t('InputMapping.NoSearchResults', '没有匹配的方案') }}
      </div>

      <div v-else class="input-mapping-table-body">
        <div v-for="profile in pagedProfiles" :key="profile.id" class="input-mapping-table-row" :class="{ active: isInputMappingEnabled && profile.id === activeProfileId }">
          <div class="profile-main-cell">
            <span class="profile-name">{{ profile.name }}</span>
            <span v-if="profile.description" class="profile-description">{{ profile.description }}</span>
          </div>
          <div class="profile-muted">{{ profile.packageName || '-' }}</div>
          <div class="profile-muted">{{ profile.author || '-' }}</div>
          <div class="profile-muted">{{ formatUpdatedAt(profile) }}</div>
          <div class="row-actions">
            <button
              v-if="isSelectionControlsVisible"
              class="icon-action-btn"
              :class="{ 'is-active': isInputMappingEnabled && profile.id === activeProfileId }"
              :disabled="isInputMappingEnabled && profile.id === activeProfileId"
              :title="isInputMappingEnabled && profile.id === activeProfileId ? t('InputMapping.Selected', '已选择') : t('InputMapping.Select', '选择')"
              @click="setActiveProfile(profile.id)"
            >
              <CheckmarkCircle20Regular />
            </button>
            <button class="icon-action-btn" :title="t('InputMapping.EditProfileInfo', '编辑信息')" @click="openProfileInfoDialog(profile)">
              <Edit20Regular />
            </button>
            <button class="icon-action-btn" :title="t('InputMapping.ExportJson', '导出')" @click="exportProfile(profile)">
              <ArrowDownload20Regular />
            </button>
            <button class="icon-action-btn danger" :title="t('Common.Delete', '删除')" @click="deleteProfile(profile)">
              <Delete20Regular />
            </button>
          </div>
        </div>
      </div>

      <div class="input-mapping-pagination">
        <span>{{ t('InputMapping.TotalProfiles', '共 {0} 个方案', filteredProfiles.length) }}</span>
        <label>
          {{ t('InputMapping.PageSize', '每页') }}
          <select :value="pageSize" @change="updatePageSize">
            <option v-for="size in pageSizeOptions" :key="size" :value="size">{{ size }}</option>
          </select>
        </label>
        <button class="fluent-btn compact" :disabled="pageIndex <= 1" @click="previousPage">{{ t('Common.Previous', '上一页') }}</button>
        <span>{{ pageIndex }} / {{ totalPages }}</span>
        <button class="fluent-btn compact" :disabled="pageIndex >= totalPages" @click="nextPage">{{ t('Common.Next', '下一页') }}</button>
      </div>
    </div>

    <div v-if="isProfileInfoDialogVisible" class="profile-info-dialog-backdrop" @click.self="closeProfileInfoDialog">
      <div class="profile-info-dialog">
        <div class="profile-info-dialog__header">
          <div class="profile-info-dialog__title">{{ t('InputMapping.EditProfileInfo', '编辑信息') }}</div>
          <button type="button" class="profile-info-dialog__close" @click="closeProfileInfoDialog">
            <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
        <div class="profile-info-dialog__body">
          <label>
            <span>{{ t('InputMapping.ProfileName', '名称') }}</span>
            <input v-model="profileInfoForm.name" type="text" maxlength="40" />
          </label>
          <label>
            <span>{{ t('InputMapping.Author', '作者') }}</span>
            <input v-model="profileInfoForm.author" type="text" maxlength="32" />
          </label>
          <label>
            <span>{{ t('InputMapping.PackageName', '包名') }}</span>
            <input v-model="profileInfoForm.packageName" type="text" maxlength="120" />
          </label>
          <label>
            <span>{{ t('Common.Description', '说明') }}</span>
            <textarea v-model="profileInfoForm.description" maxlength="160" rows="3" />
          </label>
        </div>
        <div class="profile-info-dialog__footer">
          <button type="button" class="fluent-btn" @click="closeProfileInfoDialog">{{ t('Common.Cancel', '取消') }}</button>
          <button type="button" class="fluent-btn primary" @click="saveProfileInfo">{{ t('Common.Save', '保存') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" src="./InputMappingProfilesView.ts"></script>

<style scoped src="./InputMappingProfilesView.css"></style>
