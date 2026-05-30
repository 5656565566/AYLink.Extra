import { nextTick } from 'vue';
import { describe, expect, it } from 'vitest';
import { useAsyncAction } from './useAsyncAction';

describe('useAsyncAction', () => {
  it('marks running state during successful actions', async () => {
    const { isRunning, run } = useAsyncAction();

    const pending = run(async () => {
      expect(isRunning.value).toBe(true);
      return 'done';
    });

    expect(isRunning.value).toBe(true);
    await expect(pending).resolves.toBe('done');
    expect(isRunning.value).toBe(false);
  });

  it('resets running state after failures', async () => {
    const { isRunning, run } = useAsyncAction();

    const pending = run(async () => {
      throw new Error('boom');
    });

    await expect(pending).rejects.toThrow('boom');
    expect(isRunning.value).toBe(false);
  });

  it('keeps state reactive across microtasks', async () => {
    const { isRunning, run } = useAsyncAction();

    const pending = run(async () => {
      await Promise.resolve();
      return 123;
    });

    await nextTick();
    expect(isRunning.value).toBe(true);

    await expect(pending).resolves.toBe(123);
    expect(isRunning.value).toBe(false);
  });
});
