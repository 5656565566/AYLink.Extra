<template>
  <div class="page-container">
    <WorkspaceTabs
      :tabs="tabItems"
      :active-key="activeTabKey"
      @select="activateTab"
      @close="closeTab">
      <template #icon>
        <svg class="workspace-tab__icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5.5 3.5C4 3.5 3.5 4.5 3.5 6V7C3.5 7.5 3 8 2.5 8C3 8 3.5 8.5 3.5 9V10C3.5 11.5 4 12.5 5.5 12.5M10.5 3.5C12 3.5 12.5 4.5 12.5 6V7C12.5 7.5 13 8 13.5 8C13 8 12.5 8.5 12.5 9V10C12.5 11.5 12 12.5 10.5 12.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </template>
    </WorkspaceTabs>

    <div class="content-area">
      <div v-if="!activeTab" class="empty-state">
        <svg class="empty-state__icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M9 5C9 5 7 5 7 8C7 10 5 11 5 12C5 13 7 14 7 16C7 19 9 19 9 19M15 5C15 5 17 5 17 8C17 10 19 11 19 12C19 13 17 14 17 16C17 19 15 19 15 19" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <div class="empty-state__title">{{ t('TerminalPage.NoDeviceSelected', '未选中设备') }}</div>
        <div class="empty-state__desc">{{ t('TerminalPage.OpenFromHome', '请在首页选择一个设备来启动终端') }}</div>
      </div>

      <div
        v-for="tab in tabs"
        :key="tab.key"
        v-show="tab.key === activeTabKey"
        class="terminal-panel"
      >
        <div class="terminal-host" :ref="(el) => setTerminalHost(tab.key, el)"></div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" src="./TerminalView.ts"></script>

<style scoped src="./TerminalView.css"></style>
