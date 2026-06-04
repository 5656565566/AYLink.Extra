import { readonly, ref } from 'vue';
import { sendApiRequest } from '../core/http/client';
import { readLocalString, writeLocalString } from '../core/storage/browserStorage';
import { storageKeys } from '../core/storage/keys';
import type { LanguageOption, LanguagePayload, MessageTree } from '../types/i18n';

const LANGUAGE_STORAGE_KEY = storageKeys.app.language;
const DEFAULT_LOCALE = 'zh-CN';

const storedLocale = readLocalString(LANGUAGE_STORAGE_KEY);
const currentLocale = ref(storedLocale || detectBrowserLocale());
const messages = ref<MessageTree>({});
const languages = ref<LanguageOption[]>([]);
const isLoadingLanguage = ref(false);

export function useI18n() {
  return {
    currentLocale: readonly(currentLocale),
    languages: readonly(languages),
    isLoadingLanguage: readonly(isLoadingLanguage),
    t,
    setLocale,
    loadLanguages,
  };
}

function detectBrowserLocale() {
  if (typeof navigator === 'undefined') {
    return DEFAULT_LOCALE;
  }

  const preferredLocales = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const locale of preferredLocales) {
    const normalizedLocale = normalizeBrowserLocale(locale);
    if (normalizedLocale) {
      return normalizedLocale;
    }
  }

  return DEFAULT_LOCALE;
}

function normalizeBrowserLocale(locale?: string) {
  if (!locale) {
    return '';
  }

  const normalized = locale.replace('_', '-');
  if (/^zh(?:-|$)/i.test(normalized)) {
    return 'zh-CN';
  }
  if (/^en(?:-|$)/i.test(normalized)) {
    return 'en-US';
  }
  if (/^[a-z]{2}-[A-Z]{2}$/.test(normalized)) {
    return normalized;
  }

  return '';
}

function updateDocumentTitle(locale: string) {
  if (locale.toLowerCase().startsWith('zh')) {
    document.title = '安易连';
  } else {
    document.title = 'AYLink';
  }
}

export async function initializeI18n() {
  updateDocumentTitle(currentLocale.value);
  await Promise.all([
    loadLanguages(),
    loadLocaleMessages(currentLocale.value),
  ]);
}

export function t(key: string, fallback = '', ...args: Array<string | number>): string {
  const value = getMessageValue(key);
  return formatMessage(typeof value === 'string' ? value : fallback || key, args);
}

export async function setLocale(locale: string) {
  if (!locale || locale === currentLocale.value) {
    return;
  }

  await loadLocaleMessages(locale);
  currentLocale.value = locale;
  writeLocalString(LANGUAGE_STORAGE_KEY, locale);
  updateDocumentTitle(locale);
}

async function loadLanguages() {
  const response = await sendApiRequest('/api/i18n/languages', {
    requiresAuth: false,
    retryOnUnauthorized: false,
    handleUnauthorized: false,
    handleForbidden: false,
  });
  if (!response.ok) {
    languages.value = [
      { locale: 'zh-CN', name: '中文（简体）' },
      { locale: 'en-US', name: 'English' },
    ];
    return;
  }

  const payload = await response.json() as LanguagePayload[];
  languages.value = payload.map((item) => ({
    locale: item.locale ?? item.Locale ?? DEFAULT_LOCALE,
    name: item.name ?? item.Name ?? item.locale ?? item.Locale ?? DEFAULT_LOCALE,
  }));
}

async function loadLocaleMessages(locale: string) {
  isLoadingLanguage.value = true;
  try {
    const response = await sendApiRequest(`/api/i18n/${encodeURIComponent(locale)}`, {
      requiresAuth: false,
      retryOnUnauthorized: false,
      handleUnauthorized: false,
      handleForbidden: false,
    });
    if (response.ok) {
      messages.value = await response.json() as MessageTree;
    } else if (locale !== DEFAULT_LOCALE) {
      await loadLocaleMessages(DEFAULT_LOCALE);
    }
  } finally {
    isLoadingLanguage.value = false;
  }
}

function getMessageValue(key: string) {
  return key.split('.').reduce<unknown>((current, part) => {
    if (!current || typeof current !== 'object') {
      return undefined;
    }

    return (current as MessageTree)[part];
  }, messages.value);
}

function formatMessage(message: string, args: Array<string | number>) {
  let result = message;
  args.forEach((arg, index) => {
    result = result.replaceAll(`{${index}}`, String(arg));
  });
  return result;
}
