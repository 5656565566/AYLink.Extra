export interface LanguageOption {
  locale: string;
  name: string;
}

export interface LocalePayload {
  locale?: string;
  Locale?: string;
}

export interface LanguagePayload {
  locale?: string;
  Locale?: string;
  name?: string;
  Name?: string;
}

export type MessageTree = Record<string, unknown>;
