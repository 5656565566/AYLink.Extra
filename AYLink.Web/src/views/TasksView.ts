import { defineComponent } from 'vue';
import { computed, onMounted, ref } from 'vue';
import WorkspaceTabs from '../components/WorkspaceTabs.vue';
import { persistSessionTabs, restoreSessionTabs } from '../features/workspace/sessionTabs';
import type { SessionTabItem } from '../types/workspace';

export default defineComponent({
  name: 'TasksView',
  components: {
    WorkspaceTabs
  },
  setup() {
    interface SimpleTab extends SessionTabItem {
      title: string;
    }

    const STORAGE_KEY = 'aylink_task_tabs';
    const ACTIVE_KEY = 'aylink_task_active_tab';

    const tabs = ref<SimpleTab[]>([]);
    const activeTabKey = ref('');

    const activeTab = computed(() => tabs.value.find((tab) => tab.key === activeTabKey.value) ?? null);
    const tabItems = computed(() => tabs.value);

    const isSimpleTab = (item: unknown): item is SimpleTab => {
      return !!item
        && typeof item === 'object'
        && typeof (item as SimpleTab).key === 'string'
        && typeof (item as SimpleTab).title === 'string';
    };

    const persistTabs = () => {
      persistSessionTabs(STORAGE_KEY, ACTIVE_KEY, tabs.value, activeTabKey.value);
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
        const restored = restoreSessionTabs(STORAGE_KEY, ACTIVE_KEY, isSimpleTab);
        tabs.value = restored.tabs;
        activeTabKey.value = restored.activeTabKey;
      } catch {
        tabs.value = [];
        activeTabKey.value = '';
      }

      ensureDefaultTab();
    });

    return {
      STORAGE_KEY,
      ACTIVE_KEY,
      tabs,
      activeTabKey,
      activeTab,
      tabItems,
      persistTabs,
      ensureDefaultTab,
      activateTab,
      closeTab
    };
  }
});
