import { readonly, ref } from 'vue';

export type ThemeMode = 'system' | 'dark' | 'light';

const THEME_MODE_KEY = 'aylink.theme.mode';
const ACCENT_COLOR_KEY = 'aylink.theme.accentColor';
const DEFAULT_THEME_MODE: ThemeMode = 'system';
const DEFAULT_ACCENT_COLOR = '#8A2BE2';
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

const themeMode = ref<ThemeMode>(loadThemeMode());
const accentColor = ref(loadAccentColor());
const resolvedTheme = ref<'dark' | 'light'>(getSystemTheme());

let mediaQuery: MediaQueryList | undefined;
let isInitialized = false;

export function initializeTheme() {
  if (isInitialized) {
    applyTheme();
    return;
  }

  isInitialized = true;
  mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  resolvedTheme.value = resolveTheme(themeMode.value);
  mediaQuery.addEventListener('change', handleSystemThemeChange);
  applyTheme();
}

export function useTheme() {
  return {
    themeMode: readonly(themeMode),
    accentColor: readonly(accentColor),
    resolvedTheme: readonly(resolvedTheme),
    setThemeMode,
    setAccentColor,
    resetTheme,
  };
}

function setThemeMode(mode: ThemeMode) {
  themeMode.value = mode;
  localStorage.setItem(THEME_MODE_KEY, mode);
  applyTheme();
}

function setAccentColor(color: string) {
  if (!HEX_COLOR_PATTERN.test(color)) {
    return;
  }

  accentColor.value = color.toUpperCase();
  localStorage.setItem(ACCENT_COLOR_KEY, accentColor.value);
  applyTheme();
}

function resetTheme() {
  themeMode.value = DEFAULT_THEME_MODE;
  accentColor.value = DEFAULT_ACCENT_COLOR;
  localStorage.removeItem(THEME_MODE_KEY);
  localStorage.removeItem(ACCENT_COLOR_KEY);
  applyTheme();
}

function loadThemeMode(): ThemeMode {
  const savedMode = localStorage.getItem(THEME_MODE_KEY);
  return isThemeMode(savedMode) ? savedMode : DEFAULT_THEME_MODE;
}

function loadAccentColor() {
  const savedColor = localStorage.getItem(ACCENT_COLOR_KEY);
  return savedColor && HEX_COLOR_PATTERN.test(savedColor)
    ? savedColor.toUpperCase()
    : DEFAULT_ACCENT_COLOR;
}

function isThemeMode(value: string | null): value is ThemeMode {
  return value === 'system' || value === 'dark' || value === 'light';
}

function handleSystemThemeChange() {
  if (themeMode.value === 'system') {
    applyTheme();
  }
}

function applyTheme() {
  const root = document.documentElement;
  const theme = resolveTheme(themeMode.value);
  const accent = accentColor.value;

  resolvedTheme.value = theme;
  root.dataset.theme = theme;
  root.dataset.themeMode = themeMode.value;
  root.style.colorScheme = theme;
  root.style.setProperty('--fluent-accent-default', accent);
  root.style.setProperty('--fluent-control-fill-accent-default', accent);
  root.style.setProperty('--fluent-control-fill-accent-hover', darkenHex(accent, 0.1));
  root.style.setProperty('--fluent-control-fill-accent-active', darkenHex(accent, 0.18));
  root.style.setProperty('--fluent-text-on-accent', getReadableTextColor(accent));
}

function resolveTheme(mode: ThemeMode) {
  return mode === 'system' ? getSystemTheme() : mode;
}

function getSystemTheme(): 'dark' | 'light' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function darkenHex(hexColor: string, amount: number) {
  const { red, green, blue } = hexToRgb(hexColor);
  return rgbToHex(
    Math.round(red * (1 - amount)),
    Math.round(green * (1 - amount)),
    Math.round(blue * (1 - amount)),
  );
}

function getReadableTextColor(hexColor: string) {
  const { red, green, blue } = hexToRgb(hexColor);
  const luminance = getRelativeLuminance(red, green, blue);
  const whiteContrast = (1.05) / (luminance + 0.05);
  const blackContrast = (luminance + 0.05) / 0.05;

  return whiteContrast >= blackContrast ? '#FFFFFF' : '#000000';
}

function getRelativeLuminance(red: number, green: number, blue: number) {
  const [r, g, b] = [red, green, blue].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function hexToRgb(hexColor: string) {
  const value = hexColor.replace('#', '');

  return {
    red: Number.parseInt(value.slice(0, 2), 16),
    green: Number.parseInt(value.slice(2, 4), 16),
    blue: Number.parseInt(value.slice(4, 6), 16),
  };
}

function rgbToHex(red: number, green: number, blue: number) {
  return `#${[red, green, blue]
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
}
