import router from '../router';
import { clearSession, getAccessToken, hasActiveAccessToken, refreshAccessToken, syncSessionFromStorage } from '../services/auth';
import { useNotification } from '../services/notification';
import { t } from '../services/i18n';

const notifications = useNotification();

export const apiFetch = async (url: string, options: RequestInit = {}, isRetry = false): Promise<Response> => {
  if (!getAccessToken()) {
    syncSessionFromStorage();
  }

  const token = getAccessToken();
  const headers = new Headers(options.headers || {});
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(url, {
    ...options,
    headers
  });

  if (response.status === 401 && !isRetry && !url.startsWith('/api/login') && !url.startsWith('/api/auth/refresh')) {
    if (token && token !== getAccessToken()) {
      return apiFetch(url, options, true);
    }

    const refreshed = await refreshAccessToken();
    if (refreshed) {
      return apiFetch(url, options, true);
    }

    syncSessionFromStorage();
    if (token && token !== getAccessToken()) {
      return apiFetch(url, options, true);
    }
    if (hasActiveAccessToken()) {
      return response;
    }

    clearSession();
    router.push({ name: 'login', query: { redirect: router.currentRoute.value.fullPath } });
  } else if (response.status === 403) {
    notifications.show({
      type: 'warning',
      title: t('Common.PermissionDenied', '权限不足'),
      message: t('Common.PermissionDeniedAction', '当前账号没有执行这个操作的权限。')
    });
  }

  return response;
};
