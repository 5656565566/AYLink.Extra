import { ref } from 'vue';

export function useAsyncAction() {
  const isRunning = ref(false);

  const run = async <T>(action: () => Promise<T>) => {
    isRunning.value = true;
    try {
      return await action();
    } finally {
      isRunning.value = false;
    }
  };

  return {
    isRunning,
    run,
  };
}
