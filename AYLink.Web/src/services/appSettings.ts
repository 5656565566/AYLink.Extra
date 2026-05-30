import { readonly, ref } from 'vue';
import { readLocalBoolean, readLocalString, writeLocalBoolean, writeLocalString } from '../core/storage/browserStorage';
import { storageKeys } from '../core/storage/keys';

const BACKGROUND_MUTE_KEY = storageKeys.app.backgroundMute;
const NEW_DISPLAY_DPI_MODE_KEY = storageKeys.app.newDisplayDpiMode;
const NEW_DISPLAY_DPI_VALUE_KEY = storageKeys.app.newDisplayDpiValue;

export type NewDisplayDpiMode = 'disabled' | 'auto' | 'custom';

const backgroundMute = ref(loadBackgroundMute());
const newDisplayDpiMode = ref<NewDisplayDpiMode>(loadNewDisplayDpiMode());
const newDisplayDpiValue = ref(loadNewDisplayDpiValue());

export function useAppSettings() {
  return {
    backgroundMute: readonly(backgroundMute),
    newDisplayDpiMode: readonly(newDisplayDpiMode),
    newDisplayDpiValue: readonly(newDisplayDpiValue),
    setBackgroundMute,
    setNewDisplayDpiMode,
    setNewDisplayDpiValue,
  };
}

function setBackgroundMute(enabled: boolean) {
  backgroundMute.value = enabled;
  writeLocalBoolean(BACKGROUND_MUTE_KEY, enabled);
}

function loadBackgroundMute() {
  return readLocalBoolean(BACKGROUND_MUTE_KEY);
}

function setNewDisplayDpiMode(mode: NewDisplayDpiMode) {
  if (mode === 'custom') {
    newDisplayDpiMode.value = 'custom';
  } else if (mode === 'auto') {
    newDisplayDpiMode.value = 'auto';
  } else {
    newDisplayDpiMode.value = 'disabled';
  }
  writeLocalString(NEW_DISPLAY_DPI_MODE_KEY, newDisplayDpiMode.value);
}

function setNewDisplayDpiValue(value: number) {
  const normalized = normalizeNewDisplayDpiValue(value);
  newDisplayDpiValue.value = normalized;
  writeLocalString(NEW_DISPLAY_DPI_VALUE_KEY, String(normalized));
}

function loadNewDisplayDpiMode(): NewDisplayDpiMode {
  const value = readLocalString(NEW_DISPLAY_DPI_MODE_KEY);
  if (value === 'custom') {
    return 'custom';
  }
  if (value === 'auto') {
    return 'auto';
  }
  return 'disabled';
}

function loadNewDisplayDpiValue() {
  return normalizeNewDisplayDpiValue(Number(readLocalString(NEW_DISPLAY_DPI_VALUE_KEY) ?? 320));
}

function normalizeNewDisplayDpiValue(value: number) {
  if (!Number.isFinite(value)) {
    return 320;
  }

  return Math.max(72, Math.min(960, Math.round(value)));
}
