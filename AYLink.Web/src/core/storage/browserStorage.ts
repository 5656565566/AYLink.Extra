type BrowserStorageKind = 'local' | 'session';

function getStorage(kind: BrowserStorageKind): Storage | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return kind === 'local' ? window.localStorage : window.sessionStorage;
}

function readString(kind: BrowserStorageKind, key: string): string | null {
  try {
    return getStorage(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeString(kind: BrowserStorageKind, key: string, value: string) {
  try {
    getStorage(kind)?.setItem(key, value);
  } catch {
    // Ignore storage write failures so transient browser limits do not break the UI flow.
  }
}

function remove(kind: BrowserStorageKind, key: string) {
  try {
    getStorage(kind)?.removeItem(key);
  } catch {
    // Ignore storage removal failures because callers already keep in-memory state.
  }
}

function readJson<T>(kind: BrowserStorageKind, key: string): T | null {
  const raw = readString(kind, key);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson(kind: BrowserStorageKind, key: string, value: unknown) {
  writeString(kind, key, JSON.stringify(value));
}

export function readLocalString(key: string) {
  return readString('local', key);
}

export function writeLocalString(key: string, value: string) {
  writeString('local', key, value);
}

export function removeLocalValue(key: string) {
  remove('local', key);
}

export function readLocalBoolean(key: string, fallback = false) {
  const raw = readLocalString(key);
  return raw === null ? fallback : raw === 'true';
}

export function writeLocalBoolean(key: string, value: boolean) {
  writeLocalString(key, String(value));
}

export function readLocalJson<T>(key: string) {
  return readJson<T>('local', key);
}

export function writeLocalJson(key: string, value: unknown) {
  writeJson('local', key, value);
}

export function readSessionString(key: string) {
  return readString('session', key);
}

export function writeSessionString(key: string, value: string) {
  writeString('session', key, value);
}

export function removeSessionValue(key: string) {
  remove('session', key);
}

export function readSessionJson<T>(key: string) {
  return readJson<T>('session', key);
}

export function writeSessionJson(key: string, value: unknown) {
  writeJson('session', key, value);
}
