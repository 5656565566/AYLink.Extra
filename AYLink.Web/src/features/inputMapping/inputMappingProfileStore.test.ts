import { describe, expect, it } from 'vitest';
import { storageKeys } from '../../core/storage/keys';
import { createEmptyInputMappingProfile } from './inputMappingSchema';
import { createLocalInputMappingProfileStore } from './inputMappingProfileStore';

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();

  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    key(index: number) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    }
  };
}

describe('inputMappingProfileStore', () => {
  it('saves, lists, and loads local profiles', async () => {
    const storage = createMemoryStorage();
    const store = createLocalInputMappingProfileStore(storage);
    const profile = createEmptyInputMappingProfile('测试方案');

    await store.save(profile);

    expect(storage.getItem(storageKeys.inputMapping.profiles)).toContain('测试方案');
    expect(await store.list()).toEqual([
      expect.objectContaining({
        id: profile.id,
        name: '测试方案',
        bindingCount: 0
      })
    ]);
    expect(await store.get(profile.id)).toEqual(expect.objectContaining({
      id: profile.id,
      name: '测试方案'
    }));
  });

  it('imports and exports json profiles', async () => {
    const store = createLocalInputMappingProfileStore(createMemoryStorage());
    const profile = createEmptyInputMappingProfile('导出方案');
    const exported = store.export(profile);

    await expect(store.import(exported)).resolves.toEqual(expect.objectContaining({
      id: profile.id,
      name: '导出方案'
    }));
  });

  it('rejects unsupported profile versions', async () => {
    const store = createLocalInputMappingProfileStore(createMemoryStorage());

    await expect(store.import(JSON.stringify({
      schemaVersion: 99,
      id: 'future',
      name: 'future',
      target: {
        orientation: 'landscape',
        orientationPolicy: 'responsive'
      },
      bindings: []
    }))).rejects.toThrow('schemaVersion');
  });

  it('ignores malformed persisted data and keeps valid stored profiles usable', async () => {
    const storage = createMemoryStorage();
    const validProfile = createEmptyInputMappingProfile('有效方案');
    storage.setItem(storageKeys.inputMapping.profiles, JSON.stringify({
      schemaVersion: 1,
      profiles: [
        validProfile,
        {
          schemaVersion: 1,
          id: '',
          name: '',
          target: {},
          bindings: []
        }
      ]
    }));

    const store = createLocalInputMappingProfileStore(storage);

    await expect(store.list()).resolves.toEqual([
      expect.objectContaining({ id: validProfile.id, name: '有效方案' })
    ]);

    storage.setItem(storageKeys.inputMapping.profiles, '{not-json');
    await expect(store.list()).resolves.toEqual([]);
  });
});
