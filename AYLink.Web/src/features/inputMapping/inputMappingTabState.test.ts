import { describe, expect, it } from 'vitest';
import { getInputMappingTabState, setInputMappingTabState } from './inputMappingTabState';

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

describe('inputMappingTabState', () => {
  it('stores input mapping state independently for each cast tab', () => {
    const storage = createMemoryStorage();

    setInputMappingTabState('device-a::screen', {
      activeProfileId: 'profile-a',
      enabled: true
    }, storage);
    setInputMappingTabState('device-b::screen', {
      activeProfileId: 'profile-b',
      enabled: false
    }, storage);

    expect(getInputMappingTabState('device-a::screen', storage)).toEqual({
      activeProfileId: 'profile-a',
      enabled: true
    });
    expect(getInputMappingTabState('device-b::screen', storage)).toEqual({
      activeProfileId: 'profile-b',
      enabled: false
    });
  });
});
