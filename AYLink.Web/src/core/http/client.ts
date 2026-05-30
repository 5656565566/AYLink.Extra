import { useNotification } from '../../services/notification';
import { t } from '../../services/i18n';

export interface ApiRequestOptions extends RequestInit {
  requiresAuth?: boolean;
  retryOnUnauthorized?: boolean;
  handleUnauthorized?: boolean;
  handleForbidden?: boolean;
}

interface AuthSessionHandlers {
  clearSession: () => void;
  getAccessToken: () => string;
  hasActiveAccessToken: () => boolean;
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

export async function sendApiRequest(url: string, options: ApiRequestOptions = {}, isRetry = false): Promise<Response> {
  const {
    requiresAuth = true,
    retryOnUnauthorized = true,
    handleUnauthorized = true,
    handleForbidden = true,
    ...requestInit
  } = options;

  if (requiresAuth && !authSessionHandlers) {
    throw new Error('Auth session handlers are not registered.');
  }

  if (requiresAuth && !authSessionHandlers?.getAccessToken()) {
    authSessionHandlers?.syncSessionFromStorage();
  }

  const token = requiresAuth ? authSessionHandlers?.getAccessToken() || '' : '';
  const headers = new Headers(requestInit.headers || {});
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(url, {
    ...requestInit,
    headers,
  });

  if (
    requiresAuth &&
    response.status === 401 &&
    retryOnUnauthorized &&
    !isRetry &&
    !url.startsWith('/api/login') &&
    !url.startsWith('/api/auth/refresh')
  ) {
    if (token && token !== authSessionHandlers?.getAccessToken()) {
      return sendApiRequest(url, options, true);
    }

    const refreshed = await authSessionHandlers?.refreshAccessToken();
    if (refreshed) {
      return sendApiRequest(url, options, true);
    }

    authSessionHandlers?.syncSessionFromStorage();
    if (token && token !== authSessionHandlers?.getAccessToken()) {
      return sendApiRequest(url, options, true);
    }

    if (authSessionHandlers?.hasActiveAccessToken()) {
      return response;
    }

    if (handleUnauthorized) {
      authSessionHandlers?.clearSession();
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
}
