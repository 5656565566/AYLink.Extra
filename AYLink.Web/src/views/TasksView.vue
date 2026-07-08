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
      <div class="task-toolbar">
        <div class="task-toolbar__filters">
          <span class="task-search-label">
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.3"/>
              <path d="M10.5 10.5L13.5 13.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
            </svg>
            <span>{{ t('TaskPage.SearchLabel', '搜索') }}</span>
          </span>
          <input
            v-model="searchText"
            class="task-search"
            type="search"
            :placeholder="t('TaskPage.SearchWatermark', '搜索任务名称或任务来源...')" />
          <FluentDropdown
            v-model="statusFilter"
            :options="statusOptions"
            width="140px" />
          <div class="task-toolbar__separator" aria-hidden="true"></div>
          <button class="task-command" type="button" @click="clearFilters">
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
            </svg>
            <span>{{ t('TaskPage.ClearFilter', '清空条件') }}</span>
          </button>
          <button class="task-command" type="button" @click="createNewTab">
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M4 2.5H10.5L13 5V13.5H4V2.5Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
              <path d="M10.5 2.5V5H13M6.5 9H10.5M8.5 7V11" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
            </svg>
            <span>{{ t('TaskPage.CreateNewTab', '新标签页') }}</span>
          </button>
          <button class="task-command" type="button" @click="refreshTasks">
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M11.5 4.5H14V2M13.5 4.25C12.4 2.9 10.8 2 9 2C5.7 2 3 4.7 3 8M4.5 11.5H2V14M2.5 11.75C3.6 13.1 5.2 14 7 14C10.3 14 13 11.3 13 8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span>{{ t('TasksView.Refresh', '刷新') }}</span>
          </button>
        </div>
      </div>

      <div class="task-table-frame">
        <div class="task-table-header">
          <div>{{ t('TaskPage.ColumnTitle', '任务名称') }}</div>
          <div>{{ t('TaskPage.ColumnSource', '任务来源') }}</div>
          <div>{{ t('TaskPage.ColumnStatus', '状态') }}</div>
          <div>{{ t('TaskPage.ColumnProgress', '进度') }}</div>
          <div>{{ t('TaskPage.ColumnDetail', '详情') }}</div>
        </div>

        <div v-if="!hasTasks" class="empty-state">
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.2"/>
            <path d="M8 4.5V8.5L10.5 10.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
          </svg>
          <p>{{ t('TasksView.EmptyOverview', '当前没有可显示的任务') }}</p>
        </div>

        <div v-else class="task-table-body">
          <div
            v-for="task in filteredTasks"
            :key="task.id"
            class="task-table-row"
            :class="{ selected: selectedTask?.id === task.id }"
            @click="selectTask(task)"
            @contextmenu.prevent="onTaskContextMenu($event, task)">
            <div class="task-cell task-title">{{ task.title }}</div>
            <div class="task-cell">{{ task.source }}</div>
            <div class="task-cell task-status" :class="statusClass(task.status)">{{ statusLabel(task.status) }}</div>
            <div class="task-cell task-progress-cell">
              <span>{{ formatProgress(task) }}</span>
              <div class="task-progress" :class="{ indeterminate: task.isIndeterminate && task.status === 'running' }">
                <div
                  class="task-progress__bar"
                  :style="{ width: task.isIndeterminate && task.status === 'running' ? '38%' : `${task.progress}%` }">
                </div>
              </div>
            </div>
            <div class="task-cell task-detail">{{ task.detail }}</div>
          </div>
        </div>
      </div>

      <div class="task-status-bar">
        <span>{{ summaryText }}</span>
      </div>

      <Teleport to="body">
        <div
          v-if="contextMenu.show"
          class="task-context-menu"
          :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
          @click.stop>
          <button v-if="contextMenu.task?.isCancelable" type="button" @click="cancelSelectedTask">
            {{ t('TaskPage.CancelTask', '取消任务') }}
          </button>
          <button v-if="contextMenu.task && contextMenu.task.status !== 'running'" type="button" @click="removeSelectedTask">
            {{ t('TaskPage.RemoveTask', '移除任务') }}
          </button>
          <div class="task-context-menu__separator"></div>
          <button type="button" @click="fillSourceFilter">
            {{ t('TaskPage.FillSourceFilter', '按选中来源过滤') }}
          </button>
          <button type="button" @click="fillStatusFilter">
            {{ t('TaskPage.FillStatusFilter', '按选中状态过滤') }}
          </button>
          <button type="button" @click="clearInactiveFromMenu">
            {{ t('TaskPage.ClearInactiveTasks', '清空未活跃事件') }}
          </button>
        </div>
      </Teleport>
    </div>
  </div>
</template>

<script lang="ts" src="./TasksView.ts"></script>

<style scoped src="./TasksView.css"></style>
