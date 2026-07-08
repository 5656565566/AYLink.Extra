import { computed, ref } from 'vue';

export type TaskItemStatus = 'running' | 'completed' | 'cancelled' | 'failed';

export interface TaskItem {
  id: number;
  title: string;
  description: string;
  detail: string;
  source: string;
  status: TaskItemStatus;
  progress: number;
  isIndeterminate: boolean;
  isCancelable: boolean;
  createdAt: number;
  finishedAt: number | null;
  cancelAction?: () => void;
}

export interface TaskStartOptions {
  title: string;
  description: string;
  source?: string;
  isIndeterminate?: boolean;
  isCancelable?: boolean;
  cancelAction?: () => void;
}

export interface TaskUpdateOptions {
  progress?: number;
  detail?: string;
  isIndeterminate?: boolean;
  isCancelable?: boolean;
}

const tasks = ref<TaskItem[]>([]);
let nextTaskId = 1;

function clampProgress(value: number) {
  return Math.min(100, Math.max(0, value));
}

function findTask(taskOrId: TaskItem | number | null | undefined) {
  const id = typeof taskOrId === 'number' ? taskOrId : taskOrId?.id;
  return tasks.value.find((task) => task.id === id) ?? null;
}

function finish(taskOrId: TaskItem | number | null | undefined, status: Exclude<TaskItemStatus, 'running'>, detail?: string) {
  const task = findTask(taskOrId);
  if (!task || task.status !== 'running') {
    return;
  }

  task.status = status;
  task.finishedAt = Date.now();
  task.isCancelable = false;
  task.isIndeterminate = false;
  task.cancelAction = undefined;

  if (status === 'completed') {
    task.progress = 100;
  }

  if (detail !== undefined) {
    task.detail = detail;
  }
}

export function useTaskService() {
  const start = (options: TaskStartOptions) => {
    const task: TaskItem = {
      id: nextTaskId++,
      title: options.title,
      description: options.description,
      detail: options.description,
      source: options.source || 'Task',
      status: 'running',
      progress: 0,
      isIndeterminate: options.isIndeterminate ?? true,
      isCancelable: options.isCancelable ?? !!options.cancelAction,
      createdAt: Date.now(),
      finishedAt: null,
      cancelAction: options.cancelAction,
    };

    tasks.value.unshift(task);
    return task;
  };

  const update = (taskOrId: TaskItem | number | null | undefined, options: TaskUpdateOptions) => {
    const task = findTask(taskOrId);
    if (!task || task.status !== 'running') {
      return;
    }

    if (options.progress !== undefined) {
      task.progress = clampProgress(options.progress);
    }
    if (options.detail !== undefined) {
      task.detail = options.detail;
    }
    if (options.isIndeterminate !== undefined) {
      task.isIndeterminate = options.isIndeterminate;
    }
    if (options.isCancelable !== undefined) {
      task.isCancelable = options.isCancelable;
    }
  };

  const complete = (taskOrId: TaskItem | number | null | undefined, detail?: string) => {
    finish(taskOrId, 'completed', detail);
  };

  const fail = (taskOrId: TaskItem | number | null | undefined, detail?: string) => {
    finish(taskOrId, 'failed', detail);
  };

  const cancel = (taskOrId: TaskItem | number | null | undefined, detail?: string) => {
    finish(taskOrId, 'cancelled', detail);
  };

  const requestCancel = (taskOrId: TaskItem | number | null | undefined) => {
    const task = findTask(taskOrId);
    if (!task || task.status !== 'running' || !task.isCancelable) {
      return;
    }

    task.isCancelable = false;
    task.detail = '正在取消...';
    task.cancelAction?.();
  };

  const remove = (taskOrId: TaskItem | number | null | undefined) => {
    const task = findTask(taskOrId);
    if (!task || task.status === 'running') {
      return;
    }

    const index = tasks.value.findIndex((item) => item.id === task.id);
    if (index >= 0) {
      tasks.value.splice(index, 1);
    }
  };

  const clearInactive = () => {
    tasks.value = tasks.value.filter((task) => task.status === 'running');
  };

  return {
    tasks,
    runningCount: computed(() => tasks.value.filter((task) => task.status === 'running').length),
    start,
    update,
    complete,
    fail,
    cancel,
    requestCancel,
    remove,
    clearInactive,
  };
}
