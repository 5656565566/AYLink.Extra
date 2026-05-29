<template>
  <div class="page-container">
    <WorkspaceTabs
      :tabs="tabItems"
      :active-key="activeTabKey"
      @select="activateTab"
      @close="closeTab">
      <template #icon>
        <svg class="workspace-tab__icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.2"/><path d="M8 4.5V8.5L10.5 10.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
      </template>
    </WorkspaceTabs>

    <div class="content-area">
      <div class="empty-state">
        <p>任务标签页已就绪</p>
        <p class="subtle">当前标签：{{ activeTab?.title || '空标签页' }}</p>
      </div>
    </div>
  </div>
</template>

<script lang="ts" src="./TasksView.ts"></script>

<style scoped src="./TasksView.css"></style>
