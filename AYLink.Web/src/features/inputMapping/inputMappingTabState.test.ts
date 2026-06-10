import { beforeEach, describe, expect, it } from 'vitest';
import { storageKeys } from '../../core/storage/keys';
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
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

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

  it('uses session storage by default instead of persistent local storage', () => {
    localStorage.setItem(storageKeys.inputMapping.tabStates, JSON.stringify({
      'device-a::screen': {
        activeProfileId: 'local-profile',
        enabled: true
      }
    }));

    expect(getInputMappingTabState('device-a::screen')).toEqual({
      activeProfileId: '',
      enabled: false
    });

    setInputMappingTabState('device-a::screen', {
      activeProfileId: 'session-profile',
      enabled: true
    });

    expect(getInputMappingTabState('device-a::screen')).toEqual({
      activeProfileId: 'session-profile',
      enabled: true
    });
    expect(localStorage.getItem(storageKeys.inputMapping.tabStates)).toContain('local-profile');
    expect(sessionStorage.getItem(storageKeys.inputMapping.tabStates)).toContain('session-profile');
  });
});
