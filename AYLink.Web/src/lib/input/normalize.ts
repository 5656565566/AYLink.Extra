const PACKAGE_NAME_SAFE_PATTERN = /[^A-Za-z0-9._$-]+/g;
const DOWNLOAD_FILE_NAME_SAFE_PATTERN = /[<>:"/\\|?*]+/g;

function stripControlCharacters(value: string) {
  let normalized = '';

  for (const character of value) {
    const code = character.charCodeAt(0);
    if ((code >= 0 && code <= 31) || code === 127) {
      continue;
    }

    normalized += character;
  }

  return normalized;
}

export function normalizeDeviceId(value: unknown) {
  return stripControlCharacters(String(value ?? ''))
    .trim();
}

export function normalizePackageName(value: unknown) {
  return stripControlCharacters(String(value ?? ''))
    .trim()
    .replace(PACKAGE_NAME_SAFE_PATTERN, '');
}

export function normalizeRemotePath(value: unknown, fallback = '/') {
  let normalized = stripControlCharacters(String(value ?? fallback))
    .replaceAll('\\', '/')
    .trim();

  if (!normalized) {
    normalized = fallback;
  }

  if (!normalized.startsWith('/')) {
    normalized = `/${normalized}`;
  }

  normalized = normalized.replace(/\/+/g, '/');
  return normalized === '/' ? normalized : normalized.replace(/\/$/, '');
}

export function sanitizeDownloadFileName(value: unknown, fallback: string) {
  const sanitized = stripControlCharacters(String(value ?? ''))
    .replace(DOWNLOAD_FILE_NAME_SAFE_PATTERN, '_')
    .trim()
    .replace(/\s+/g, ' ');

  return sanitized || fallback;
}
