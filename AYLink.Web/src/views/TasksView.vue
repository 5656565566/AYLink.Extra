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

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import WorkspaceTabs from '../components/WorkspaceTabs.vue';

interface SimpleTab {
  key: string;
  title: string;
}

const STORAGE_KEY = 'aylink_task_tabs';
const ACTIVE_KEY = 'aylink_task_active_tab';

const tabs = ref<SimpleTab[]>([]);
const activeTabKey = ref('');

const activeTab = computed(() => tabs.value.find((tab) => tab.key === activeTabKey.value) ?? null);
const tabItems = computed(() => tabs.value);

const persistTabs = () => {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(tabs.value));
  sessionStorage.setItem(ACTIVE_KEY, activeTabKey.value);
};

const ensureDefaultTab = () => {
  if (tabs.value.length === 0) {
    tabs.value = [{ key: 'tasks-default', title: '任务管理' }];
    activeTabKey.value = 'tasks-default';
    persistTabs();
  }
};

const activateTab = (tabKey: string) => {
  activeTabKey.value = tabKey;
  persistTabs();
};

const closeTab = (tabKey: string) => {
  const index = tabs.value.findIndex((tab) => tab.key === tabKey);
  if (index < 0) return;
  tabs.value.splice(index, 1);
  activeTabKey.value = tabs.value[index]?.key ?? tabs.value[index - 1]?.key ?? '';
  persistTabs();
};

onMounted(() => {
  try {
    const rawTabs = sessionStorage.getItem(STORAGE_KEY);
    const rawActive = sessionStorage.getItem(ACTIVE_KEY) ?? '';
    const parsedTabs = rawTabs ? JSON.parse(rawTabs) : [];
    if (Array.isArray(parsedTabs)) {
      tabs.value = parsedTabs.filter((item): item is SimpleTab => !!item && typeof item.key === 'string' && typeof item.title === 'string');
    }
    activeTabKey.value = tabs.value.some((tab) => tab.key === rawActive) ? rawActive : tabs.value[0]?.key ?? '';
  } catch {
    tabs.value = [];
    activeTabKey.value = '';
  }
  ensureDefaultTab();
});
</script>

<style scoped>
.page-container { display: flex; flex-direction: column; height: 100%; }
.content-area { flex: 1; position: relative; }
.empty-state { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; color: var(--fluent-text-secondary); gap: 8px; }
.subtle { font-size: 13px; color: var(--fluent-text-tertiary); }
</style>
