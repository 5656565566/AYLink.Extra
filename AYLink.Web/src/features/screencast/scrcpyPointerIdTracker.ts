export function createScrcpyPointerIdTracker() {
  let nextPointerId = 0n;
  const pointerIds = new Map<number, bigint>();

  const getOrCreate = (sourcePointerId: number) => {
    const existing = pointerIds.get(sourcePointerId);
    if (existing != null) {
      return existing;
    }

    const nextId = nextPointerId;
    nextPointerId += 1n;
    pointerIds.set(sourcePointerId, nextId);
    return nextId;
  };

  const get = (sourcePointerId: number) => pointerIds.get(sourcePointerId) ?? null;

  const release = (sourcePointerId: number) => {
    pointerIds.delete(sourcePointerId);
  };

  const clear = () => {
    pointerIds.clear();
  };

  const reset = () => {
    pointerIds.clear();
    nextPointerId = 0n;
  };

  return {
    getOrCreate,
    get,
    release,
    clear,
    reset,
    getNextPointerId: () => nextPointerId,
    getPointerIds: () => pointerIds
  };
}
