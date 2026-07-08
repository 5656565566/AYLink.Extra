import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTaskService } from './tasks';

describe('task service', () => {
  const taskService = useTaskService();

  beforeEach(() => {
    taskService.tasks.value.splice(0);
  });

  it('starts and completes a task', () => {
    const task = taskService.start({
      title: '下载文件',
      description: '准备下载',
      source: '文件管理',
      isIndeterminate: false
    });

    taskService.update(task, {
      progress: 42,
      detail: '正在下载'
    });
    taskService.complete(task, '下载完成');

    expect(taskService.tasks.value).toHaveLength(1);
    expect(task.progress).toBe(100);
    expect(task.status).toBe('completed');
    expect(task.detail).toBe('下载完成');
    expect(task.finishedAt).toEqual(expect.any(Number));
  });

  it('requests cancellation through the task callback', () => {
    const cancelAction = vi.fn();
    const task = taskService.start({
      title: '上传 APK',
      description: '正在上传',
      isCancelable: true,
      cancelAction
    });

    taskService.requestCancel(task);

    expect(cancelAction).toHaveBeenCalledTimes(1);
    expect(task.isCancelable).toBe(false);
    expect(task.detail).toBe('正在取消...');
  });

  it('clears inactive tasks while keeping running tasks', () => {
    const running = taskService.start({ title: '运行中', description: '处理中' });
    const failed = taskService.start({ title: '失败', description: '失败中' });
    taskService.fail(failed, '失败');

    taskService.clearInactive();

    expect(taskService.tasks.value).toEqual([running]);
  });
});
