import { t } from '../../services/i18n';

export type ApiErrorObject = {
  code?: string;
  messageKey?: string;
  message?: string;
  error?: unknown;
};

function isApiErrorObject(value: unknown): value is ApiErrorObject {
  return value !== null && typeof value === 'object';
}

export function resolveApiErrorMessage(payload: unknown, fallback: string): string {
  if (typeof payload === 'string') {
    return payload || fallback;
  }

  if (!isApiErrorObject(payload)) {
    return fallback;
  }

  if (typeof payload.error === 'string' && payload.error) {
    return payload.error;
  }

  if (payload.error !== null && payload.error !== undefined && payload.error !== payload) {
    const nestedMessage = resolveApiErrorMessage(payload.error, '');
    if (nestedMessage) {
      return nestedMessage;
    }
  }

  if (typeof payload.messageKey === 'string' && payload.messageKey) {
    return t(payload.messageKey, payload.message || fallback);
  }

  if (typeof payload.message === 'string' && payload.message) {
    return payload.message;
  }

  return fallback;
}

function resolveHttpFallback(response: Response, fallback: string) {
  if (fallback) {
    return fallback;
  }

  const statusText = response.statusText ? ` ${response.statusText}` : '';
  return `请求失败（HTTP ${response.status}${statusText}）`;
}

export async function readApiErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const contentType = response.headers.get('Content-Type') || '';
    if (contentType.includes('application/json')) {
      return resolveApiErrorMessage(await response.json(), resolveHttpFallback(response, fallback));
    }

    if (contentType.startsWith('text/plain')) {
      const text = await response.text();
      return text || resolveHttpFallback(response, fallback);
    }

    return resolveHttpFallback(response, fallback);
  } catch {
    return resolveHttpFallback(response, fallback);
  }
}
