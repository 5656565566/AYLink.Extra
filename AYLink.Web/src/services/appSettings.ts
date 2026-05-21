import { readonly, ref } from 'vue';

const BACKGROUND_MUTE_KEY = 'aylink.settings.backgroundMute';

const backgroundMute = ref(loadBackgroundMute());

export function useAppSettings() {
  return {
    backgroundMute: readonly(backgroundMute),
    setBackgroundMute,
  };
}

function setBackgroundMute(enabled: boolean) {
  backgroundMute.value = enabled;
  localStorage.setItem(BACKGROUND_MUTE_KEY, String(enabled));
}

function loadBackgroundMute() {
  return localStorage.getItem(BACKGROUND_MUTE_KEY) === 'true';
}
