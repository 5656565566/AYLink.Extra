import { defineComponent } from 'vue';
import { computed, onMounted, ref } from 'vue';
import WorkspaceTabs from '../components/WorkspaceTabs.vue';

export default defineComponent({
  name: 'TasksView',
  components: {
    WorkspaceTabs
  },
  setup() {
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
