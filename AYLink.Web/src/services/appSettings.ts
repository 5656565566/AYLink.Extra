import { readonly, ref } from 'vue';
import { readLocalBoolean, readLocalString, writeLocalBoolean, writeLocalString } from '../core/storage/browserStorage';
import { storageKeys } from '../core/storage/keys';

const ADAPTIVE_POINTER_SAMPLING_KEY = storageKeys.app.adaptivePointerSampling;
const BACKGROUND_MUTE_KEY = storageKeys.app.backgroundMute;
const NEW_DISPLAY_DPI_MODE_KEY = storageKeys.app.newDisplayDpiMode;
const NEW_DISPLAY_DPI_VALUE_KEY = storageKeys.app.newDisplayDpiValue;
const POINTER_SAMPLING_RATE_KEY = storageKeys.app.pointerSamplingRateHz;
const PREVIEW_REFRESH_INTERVAL_KEY = storageKeys.app.previewRefreshInterval;
const WEAK_NETWORK_MODE_KEY = storageKeys.app.weakNetworkMode;

export type NewDisplayDpiMode = 'disabled' | 'auto' | 'custom';
export type PointerSamplingRateHz = 120 | 60 | 30;

const adaptivePointerSampling = ref(loadAdaptivePointerSampling());
const backgroundMute = ref(loadBackgroundMute());
const newDisplayDpiMode = ref<NewDisplayDpiMode>(loadNewDisplayDpiMode());
const newDisplayDpiValue = ref(loadNewDisplayDpiValue());
const pointerSamplingRateHz = ref<PointerSamplingRateHz>(loadPointerSamplingRateHz());
const previewRefreshInterval = ref(loadPreviewRefreshInterval());
const weakNetworkMode = ref(loadWeakNetworkMode());

export function useAppSettings() {
  return {
    adaptivePointerSampling: readonly(adaptivePointerSampling),
    backgroundMute: readonly(backgroundMute),
    newDisplayDpiMode: readonly(newDisplayDpiMode),
    newDisplayDpiValue: readonly(newDisplayDpiValue),
    pointerSamplingRateHz: readonly(pointerSamplingRateHz),
    previewRefreshInterval: readonly(previewRefreshInterval),
    weakNetworkMode: readonly(weakNetworkMode),
    setAdaptivePointerSampling,
    setBackgroundMute,
    setNewDisplayDpiMode,
    setNewDisplayDpiValue,
    setPointerSamplingRateHz,
    setPreviewRefreshInterval,
    setWeakNetworkMode,
  };
}

function setAdaptivePointerSampling(enabled: boolean) {
  adaptivePointerSampling.value = enabled;
  writeLocalBoolean(ADAPTIVE_POINTER_SAMPLING_KEY, enabled);
}

function loadAdaptivePointerSampling() {
  return readLocalBoolean(ADAPTIVE_POINTER_SAMPLING_KEY, true);
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

function setPointerSamplingRateHz(value: number) {
  const normalized = normalizePointerSamplingRateHz(value);
  pointerSamplingRateHz.value = normalized;
  writeLocalString(POINTER_SAMPLING_RATE_KEY, String(normalized));
}

function loadPointerSamplingRateHz() {
  return normalizePointerSamplingRateHz(Number(readLocalString(POINTER_SAMPLING_RATE_KEY) ?? 120));
}

function setPreviewRefreshInterval(value: number) {
  const normalized = normalizePreviewRefreshInterval(value);
  previewRefreshInterval.value = normalized;
  writeLocalString(PREVIEW_REFRESH_INTERVAL_KEY, String(normalized));
}

function loadPreviewRefreshInterval() {
  return normalizePreviewRefreshInterval(Number(readLocalString(PREVIEW_REFRESH_INTERVAL_KEY) ?? 5));
}

function setWeakNetworkMode(enabled: boolean) {
  weakNetworkMode.value = enabled;
  writeLocalBoolean(WEAK_NETWORK_MODE_KEY, enabled);
}

function loadWeakNetworkMode() {
  return readLocalBoolean(WEAK_NETWORK_MODE_KEY, false);
}

function normalizeNewDisplayDpiValue(value: number) {
  if (!Number.isFinite(value)) {
    return 320;
  }

  return Math.max(72, Math.min(960, Math.round(value)));
}

function normalizePointerSamplingRateHz(value: number): PointerSamplingRateHz {
  if (value === 60 || value === 30) {
    return value;
  }

  return 120;
}

function normalizePreviewRefreshInterval(value: number) {
  if (!Number.isFinite(value)) {
    return 5;
  }

  return Math.max(2, Math.min(300, Math.round(value)));
}
