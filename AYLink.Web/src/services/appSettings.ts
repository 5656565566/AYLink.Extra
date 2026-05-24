import { readonly, ref } from 'vue';

const BACKGROUND_MUTE_KEY = 'aylink.settings.backgroundMute';
const NEW_DISPLAY_DPI_MODE_KEY = 'aylink.settings.newDisplayDpiMode';
const NEW_DISPLAY_DPI_VALUE_KEY = 'aylink.settings.newDisplayDpiValue';

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
  localStorage.setItem(BACKGROUND_MUTE_KEY, String(enabled));
}

function loadBackgroundMute() {
  return localStorage.getItem(BACKGROUND_MUTE_KEY) === 'true';
}

function setNewDisplayDpiMode(mode: NewDisplayDpiMode) {
  if (mode === 'custom') {
    newDisplayDpiMode.value = 'custom';
  } else if (mode === 'auto') {
    newDisplayDpiMode.value = 'auto';
  } else {
    newDisplayDpiMode.value = 'disabled';
  }
  localStorage.setItem(NEW_DISPLAY_DPI_MODE_KEY, newDisplayDpiMode.value);
}

function setNewDisplayDpiValue(value: number) {
  const normalized = normalizeNewDisplayDpiValue(value);
  newDisplayDpiValue.value = normalized;
  localStorage.setItem(NEW_DISPLAY_DPI_VALUE_KEY, String(normalized));
}

function loadNewDisplayDpiMode(): NewDisplayDpiMode {
  const value = localStorage.getItem(NEW_DISPLAY_DPI_MODE_KEY);
  if (value === 'custom') {
    return 'custom';
  }
  if (value === 'auto') {
    return 'auto';
  }
  return 'disabled';
}

function loadNewDisplayDpiValue() {
  return normalizeNewDisplayDpiValue(Number(localStorage.getItem(NEW_DISPLAY_DPI_VALUE_KEY) ?? 320));
}

function normalizeNewDisplayDpiValue(value: number) {
  if (!Number.isFinite(value)) {
    return 320;
  }

  return Math.max(72, Math.min(960, Math.round(value)));
}
