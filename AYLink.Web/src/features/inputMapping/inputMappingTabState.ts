import { storageKeys } from '../../core/storage/keys';

export interface InputMappingTabState {
  activeProfileId: string;
  enabled: boolean;
}

type StoredInputMappingTabStates = Record<string, Partial<InputMappingTabState>>;

const DEFAULT_TAB_STATE: InputMappingTabState = {
  activeProfileId: '',
  enabled: false
};

export function normalizeInputMappingTabKey(tabKey: string) {
  return tabKey.trim() || '__default__';
}

function readStoredTabStates(storage: Storage): StoredInputMappingTabStates {
  const raw = storage.getItem(storageKeys.inputMapping.tabStates);
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as StoredInputMappingTabStates
      : {};
  } catch {
    return {};
  }
}

function writeStoredTabStates(storage: Storage, states: StoredInputMappingTabStates) {
  storage.setItem(storageKeys.inputMapping.tabStates, JSON.stringify(states));
}

function getDefaultInputMappingTabStateStorage() {
  return sessionStorage;
}

export function getInputMappingTabState(tabKey: string, storage: Storage = getDefaultInputMappingTabStateStorage()): InputMappingTabState {
  const key = normalizeInputMappingTabKey(tabKey);
  const stored = readStoredTabStates(storage)[key];
  if (!stored) {
    return { ...DEFAULT_TAB_STATE };
  }

  return {
    activeProfileId: typeof stored.activeProfileId === 'string' ? stored.activeProfileId : '',
    enabled: stored.enabled === true
  };
}

export function setInputMappingTabState(tabKey: string, state: InputMappingTabState, storage: Storage = getDefaultInputMappingTabStateStorage()) {
  const key = normalizeInputMappingTabKey(tabKey);
  const states = readStoredTabStates(storage);
  states[key] = {
    activeProfileId: state.activeProfileId,
    enabled: state.enabled
  };
  writeStoredTabStates(storage, states);
}

export function clearInputMappingTabState(tabKey: string, storage: Storage = getDefaultInputMappingTabStateStorage()) {
  const key = normalizeInputMappingTabKey(tabKey);
  const states = readStoredTabStates(storage);
  delete states[key];
  writeStoredTabStates(storage, states);
}
