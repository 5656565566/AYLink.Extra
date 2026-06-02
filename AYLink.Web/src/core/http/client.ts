import { useNotification } from '../../services/notification';
import { t } from '../../services/i18n';

export interface ApiRequestOptions extends RequestInit {
  requiresAuth?: boolean;
  retryOnUnauthorized?: boolean;
  handleUnauthorized?: boolean;
  handleForbidden?: boolean;
  timeoutMs?: number;
}

interface AuthSessionHandlers {
  ensureFreshAccessToken: () => Promise<boolean>;
  getAccessToken: () => string;
  refreshAccessToken: () => Promise<boolean>;
  syncSessionFromStorage: () => void;
}

const notifications = useNotification();

let unauthorizedHandler: (() => void) | null = null;
let authSessionHandlers: AuthSessionHandlers | null = null;

export function registerAuthSessionHandlers(handlers: AuthSessionHandlers) {
  authSessionHandlers = handlers;
}

export function registerUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler;
}

function createAbortError() {
  return new DOMException('The operation was aborted.', 'AbortError');
}

function createAbortSignal(requestInit: RequestInit, timeoutMs?: number) {
  const cleanupCallbacks: Array<() => void> = [];
  const externalSignal = requestInit.signal;

  if (!externalSignal && (!timeoutMs || timeoutMs <= 0)) {
    return {
      signal: undefined,
      cleanup: () => {}
    };
  }

  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted) {
      controller.abort(createAbortError());
    }
  };

  if (externalSignal) {
    if (externalSignal.aborted) {
      abort();
    } else {
      const onAbort = () => abort();
      externalSignal.addEventListener('abort', onAbort, { once: true });
      cleanupCallbacks.push(() => externalSignal.removeEventListener('abort', onAbort));
    }
  }

  if (timeoutMs && timeoutMs > 0) {
    const timeoutHandle = globalThis.setTimeout(() => abort(), timeoutMs);
    cleanupCallbacks.push(() => globalThis.clearTimeout(timeoutHandle));
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      cleanupCallbacks.forEach((callback) => callback());
    }
  };
}

export async function sendApiRequest(url: string, options: ApiRequestOptions = {}, isRetry = false): Promise<Response> {
  const {
    requiresAuth = true,
    retryOnUnauthorized = true,
    handleUnauthorized = true,
    handleForbidden = true,
    timeoutMs,
    ...requestInit
  } = options;

  if (requiresAuth && !authSessionHandlers) {
    throw new Error('Auth session handlers are not registered.');
  }

  if (requiresAuth) {
    const ensured = await authSessionHandlers?.ensureFreshAccessToken?.();
    if (ensured === false) {
      if (handleUnauthorized) {
        unauthorizedHandler?.();
      }
      return new Response(null, { status: 401 });
    }
  }

  if (requiresAuth && !authSessionHandlers?.getAccessToken()) {
    authSessionHandlers?.syncSessionFromStorage();
  }

  const token = requiresAuth ? authSessionHandlers?.getAccessToken() || '' : '';
  const headers = new Headers(requestInit.headers || {});
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const { signal, cleanup } = createAbortSignal(requestInit, timeoutMs);

  try {
    const response = await fetch(url, {
      ...requestInit,
      headers,
      signal,
    });

    if (
      requiresAuth &&
      response.status === 401 &&
      retryOnUnauthorized &&
      !isRetry &&
      !url.startsWith('/api/login') &&
      !url.startsWith('/api/auth/refresh')
    ) {
      if (signal?.aborted) {
        throw createAbortError();
      }

      if (token && token !== authSessionHandlers?.getAccessToken()) {
        return sendApiRequest(url, options, true);
      }

      const refreshed = await authSessionHandlers?.refreshAccessToken();
      if (signal?.aborted) {
        throw createAbortError();
      }
      if (refreshed) {
        return sendApiRequest(url, options, true);
      }

      authSessionHandlers?.syncSessionFromStorage();
      if (token && token !== authSessionHandlers?.getAccessToken()) {
        return sendApiRequest(url, options, true);
      }

      if (handleUnauthorized) {
        unauthorizedHandler?.();
      }
    } else if (handleForbidden && response.status === 403) {
      notifications.show({
        type: 'warning',
        title: t('Common.PermissionDenied', '权限不足'),
        message: t('Common.PermissionDeniedAction', '当前账号没有执行这个操作的权限。'),
      });
    }

    return response;
  } finally {
    cleanup();
  }
}
