import { computed, defineComponent, onMounted, onUnmounted, ref, watch } from 'vue';
import FluentDropdown from '../components/FluentDropdown.vue';
import WorkspaceTabs from '../components/WorkspaceTabs.vue';
import { useI18n } from '../composables/useI18n';
import { persistSessionTabs, restoreSessionTabs } from '../features/workspace/sessionTabs';
import { useTaskService, type TaskItem, type TaskItemStatus } from '../services/tasks';
import type { SessionTabItem } from '../types/workspace';

export default defineComponent({
  name: 'TasksView',
  components: {
    FluentDropdown,
    WorkspaceTabs
  },
  setup() {
    const { t } = useI18n();
    const taskService = useTaskService();

    interface SimpleTab extends SessionTabItem {
      title: string;
      searchKeyword?: string;
      statusFilter?: TaskItemStatus | 'all';
    }

    const STORAGE_KEY = 'aylink_task_tabs';
    const ACTIVE_KEY = 'aylink_task_active_tab';

    const tabs = ref<SimpleTab[]>([]);
    const activeTabKey = ref('');
    const searchText = ref('');
    const statusFilter = ref<TaskItemStatus | 'all'>('all');
    const selectedTask = ref<TaskItem | null>(null);
    const contextMenu = ref({
      show: false,
      x: 0,
      y: 0,
      task: null as TaskItem | null
    });

    const activeTab = computed(() => tabs.value.find((tab) => tab.key === activeTabKey.value) ?? null);
    const tabItems = computed(() => tabs.value);
    const statusOptions = computed(() => [
      { value: 'all' as const, label: t('TasksView.StatusAll', '全部') },
      { value: 'running' as const, label: t('TasksView.StatusRunning', '运行中') },
      { value: 'completed' as const, label: t('TasksView.StatusCompleted', '已完成') },
      { value: 'cancelled' as const, label: t('TasksView.StatusCancelled', '已取消') },
      { value: 'failed' as const, label: t('TasksView.StatusFailed', '失败') },
    ]);
    const filteredTasks = computed(() => {
      const keyword = searchText.value.trim().toLowerCase();
      return taskService.tasks.value.filter((task) => {
        if (statusFilter.value !== 'all' && task.status !== statusFilter.value) {
          return false;
        }

        if (!keyword) {
          return true;
        }

        return task.title.toLowerCase().includes(keyword)
          || task.source.toLowerCase().includes(keyword)
          || task.detail.toLowerCase().includes(keyword);
      });
    });
    const hasTasks = computed(() => filteredTasks.value.length > 0);
    const summaryText = computed(() => t('TasksView.ResultSummary', '共 {0} 条任务', filteredTasks.value.length));
    const filterDescription = computed(() => {
      const parts: string[] = [];
      if (searchText.value.trim()) {
        parts.push(t('TaskPage.SearchTabPart', '搜索：{0}', searchText.value.trim()));
      }
      if (statusFilter.value !== 'all') {
        parts.push(t('TaskPage.StatusTabPart', '状态：{0}', statusLabel(statusFilter.value)));
      }
      return parts.length ? parts.join(' · ') : t('TasksView.FilterAll', '全部任务');
    });

    const isSimpleTab = (item: unknown): item is SimpleTab => {
      return !!item
        && typeof item === 'object'
        && typeof (item as SimpleTab).key === 'string'
        && typeof (item as SimpleTab).title === 'string';
    };

    const buildFilterTabTitle = () => {
      if (!searchText.value.trim() && statusFilter.value === 'all') {
        return t('TasksView.FilterAll', '全部任务');
      }

      return filterDescription.value;
    };

    const persistTabs = () => {
      persistSessionTabs(STORAGE_KEY, ACTIVE_KEY, tabs.value, activeTabKey.value);
    };

    const persistActiveTabFilter = () => {
      const tab = activeTab.value;
      if (!tab) {
        return;
      }

      tab.searchKeyword = searchText.value;
      tab.statusFilter = statusFilter.value;
      persistTabs();
    };

    const ensureDefaultTab = () => {
      if (tabs.value.length === 0) {
        tabs.value = [{ key: 'tasks-default', title: t('TasksView.OverviewTab', '总览'), statusFilter: 'all' }];
        activeTabKey.value = 'tasks-default';
        persistTabs();
      }
    };

    const activateTab = (tabKey: string) => {
      const tab = tabs.value.find((item) => item.key === tabKey);
      activeTabKey.value = tabKey;
      searchText.value = tab?.searchKeyword ?? '';
      statusFilter.value = tab?.statusFilter ?? 'all';
      selectedTask.value = null;
      persistTabs();
    };

    const closeTab = (tabKey: string) => {
      const index = tabs.value.findIndex((tab) => tab.key === tabKey);
      if (index < 0) return;

      tabs.value.splice(index, 1);
      activeTabKey.value = tabs.value[index]?.key ?? tabs.value[index - 1]?.key ?? '';
      persistTabs();
    };

    const clearFilters = () => {
      searchText.value = '';
      statusFilter.value = 'all';
      persistActiveTabFilter();
    };

    const statusLabel = (status: TaskItemStatus) => {
      return statusOptions.value.find((option) => option.value === status)?.label ?? status;
    };

    const statusClass = (status: TaskItemStatus) => {
      return `task-status--${status}`;
    };

    const formatProgress = (task: TaskItem) => {
      if (task.isIndeterminate && task.status === 'running') {
        return t('TasksView.ProgressIndeterminate', '处理中');
      }

      return `${Math.round(task.progress)}%`;
    };

    const formatTime = (value: number | null) => {
      if (!value) {
        return '-';
      }

      return new Intl.DateTimeFormat(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).format(value);
    };

    const refreshTasks = () => {
      selectedTask.value = null;
    };

    const createNewTab = () => {
      const key = `tasks-${Date.now()}`;
      const title = buildFilterTabTitle();
      tabs.value.push({
        key,
        title,
        searchKeyword: searchText.value,
        statusFilter: statusFilter.value
      });
      activeTabKey.value = key;
      persistTabs();
    };

    const selectTask = (task: TaskItem) => {
      selectedTask.value = task;
    };

    const onTaskContextMenu = (event: MouseEvent, task: TaskItem) => {
      selectedTask.value = task;
      contextMenu.value = {
        show: true,
        x: Math.min(event.clientX, window.innerWidth - 190),
        y: Math.min(event.clientY, window.innerHeight - 190),
        task
      };
    };

    const closeContextMenu = () => {
      contextMenu.value.show = false;
    };

    const cancelSelectedTask = () => {
      taskService.requestCancel(contextMenu.value.task ?? selectedTask.value);
      closeContextMenu();
    };

    const removeSelectedTask = () => {
      taskService.remove(contextMenu.value.task ?? selectedTask.value);
      selectedTask.value = null;
      closeContextMenu();
    };

    const fillSourceFilter = () => {
      const task = contextMenu.value.task ?? selectedTask.value;
      if (!task?.source) {
        return;
      }

      searchText.value = task.source;
      persistActiveTabFilter();
      closeContextMenu();
    };

    const fillStatusFilter = () => {
      const task = contextMenu.value.task ?? selectedTask.value;
      if (!task) {
        return;
      }

      statusFilter.value = task.status;
      persistActiveTabFilter();
      closeContextMenu();
    };

    const clearInactiveFromMenu = () => {
      taskService.clearInactive();
      selectedTask.value = null;
      closeContextMenu();
    };

    watch([searchText, statusFilter], () => {
      persistActiveTabFilter();
    });

    onMounted(() => {
      document.addEventListener('click', closeContextMenu);
      try {
        const restored = restoreSessionTabs(STORAGE_KEY, ACTIVE_KEY, isSimpleTab);
        tabs.value = restored.tabs;
        activeTabKey.value = restored.activeTabKey;
      } catch {
        tabs.value = [];
        activeTabKey.value = '';
      }

      ensureDefaultTab();
      const tab = activeTab.value;
      searchText.value = tab?.searchKeyword ?? '';
      statusFilter.value = tab?.statusFilter ?? 'all';
    });

    onUnmounted(() => {
      document.removeEventListener('click', closeContextMenu);
    });

    return {
      STORAGE_KEY,
      ACTIVE_KEY,
      t,
      tasks: taskService.tasks,
      runningCount: taskService.runningCount,
      searchText,
      statusFilter,
      statusOptions,
      filteredTasks,
      hasTasks,
      summaryText,
      selectedTask,
      contextMenu,
      tabs,
      activeTabKey,
      activeTab,
      tabItems,
      persistTabs,
      ensureDefaultTab,
      activateTab,
      closeTab,
      clearFilters,
      statusLabel,
      statusClass,
      formatProgress,
      formatTime,
      refreshTasks,
      createNewTab,
      selectTask,
      onTaskContextMenu,
      closeContextMenu,
      cancelSelectedTask,
      removeSelectedTask,
      fillSourceFilter,
      fillStatusFilter,
      clearInactiveFromMenu,
      requestCancel: taskService.requestCancel,
      removeTask: taskService.remove,
      clearInactive: taskService.clearInactive
    };
  }
});
