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
          <button class="fluent-btn" :disabled="!isInputMappingEnabled" @click="disableInputMapping">{{ t('InputMapping.DisableMapping', '关闭映射') }}</button>
          <input ref="fileInput" class="hidden-file-input" type="file" accept="application/json,.json,.aylink-input-map.json" @change="handleImportFile" />
        </div>
      </div>
    </div>

    <div class="input-mapping-table-shell">
      <div class="input-mapping-table-header">
        <div>{{ t('InputMapping.ProfileName', '名称') }}</div>
        <div>{{ t('InputMapping.PackageName', '包名') }}</div>
        <div>{{ t('InputMapping.BindingCountHeader', '绑定') }}</div>
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
          <div class="profile-muted">{{ t('InputMapping.BindingCount', '{0} 个绑定', profile.bindingCount) }}</div>
          <div class="profile-muted">{{ formatUpdatedAt(profile) }}</div>
          <div class="row-actions">
            <button class="fluent-btn compact" @click="setActiveProfile(profile.id)">
              {{ isInputMappingEnabled && profile.id === activeProfileId ? t('InputMapping.Selected', '已选择') : t('InputMapping.Select', '选择') }}
            </button>
            <button class="fluent-btn compact" @click="editProfileInScreencast(profile)">{{ t('Common.Edit', '编辑') }}</button>
            <button class="fluent-btn compact" @click="exportProfile(profile)">{{ t('InputMapping.ExportJson', '导出') }}</button>
            <button class="fluent-btn compact danger" @click="deleteProfile(profile)">{{ t('Common.Delete', '删除') }}</button>
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
  </div>
</template>

<script lang="ts" src="./InputMappingProfilesView.ts"></script>

<style scoped src="./InputMappingProfilesView.css"></style>
