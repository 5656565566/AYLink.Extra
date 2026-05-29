<template>
  <div class="workspace-tabs">
    <button
      v-for="tab in tabs"
      :key="tab.key"
      type="button"
      class="workspace-tab"
      :class="{ 'workspace-tab--active': tab.key === activeKey }"
      @click="$emit('select', tab.key)"
    >
      <span class="workspace-tab__label">{{ tab.title }}</span>
      <span
        v-if="tab.closable !== false"
        class="workspace-tab__close"
        @click.stop="$emit('close', tab.key)"
      >
        ×
      </span>
    </button>
    <div v-if="tabs.length === 0" class="workspace-tab workspace-tab--empty">
      {{ t('Common.EmptyTabs', '新标签页') }}
    </div>
  </div>
</template>

<script lang="ts" src="./WorkspaceTabs.ts"></script>

<style scoped src="./WorkspaceTabs.css"></style>
