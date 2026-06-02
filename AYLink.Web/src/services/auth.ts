import { computed, ref } from 'vue';
import { registerAuthSessionHandlers, sendApiRequest } from '../core/http/client';
import { readLocalJson, readLocalString, removeLocalValue, writeLocalJson, writeLocalString } from '../core/storage/browserStorage';
import { storageKeys } from '../core/storage/keys';
import type { AuthMePayload, AuthResponsePayload, AuthUser } from '../types/auth';

const ACCESS_TOKEN_KEY = storageKeys.auth.accessToken;
const ACCESS_TOKEN_EXPIRES_AT_KEY = storageKeys.auth.accessTokenExpiresAt;
const REFRESH_TOKEN_KEY = storageKeys.auth.refreshToken;
const REFRESH_TOKEN_EXPIRES_AT_KEY = storageKeys.auth.refreshTokenExpiresAt;
const USER_KEY = storageKeys.auth.user;
const PERMISSIONS_KEY = storageKeys.auth.permissions;

const accessToken = ref<string>(readLocalString(ACCESS_TOKEN_KEY) || '');
const accessTokenExpiresAt = ref<string>(readLocalString(ACCESS_TOKEN_EXPIRES_AT_KEY) || '');
const refreshToken = ref<string>(readLocalString(REFRESH_TOKEN_KEY) || '');
const refreshTokenExpiresAt = ref<string>(readLocalString(REFRESH_TOKEN_EXPIRES_AT_KEY) || '');
const currentUser = ref<AuthUser | null>(readStoredUser());
const permissions = ref<string[]>(readStoredPermissions());
const initialized = ref(false);

let initializePromise: Promise<void> | null = null;
let refreshPromise: Promise<boolean> | null = null;
let storageSyncInitialized = false;
const trackedStorageKeys: readonly string[] = [
  ACCESS_TOKEN_KEY,
  ACCESS_TOKEN_EXPIRES_AT_KEY,
  REFRESH_TOKEN_KEY,
  REFRESH_TOKEN_EXPIRES_AT_KEY,
  USER_KEY,
  PERMISSIONS_KEY,
];
const accessTokenRefreshSkewMs = 30_000;

export function useAuth() {
  return {
    accessToken: computed(() => accessToken.value),
    refreshToken: computed(() => refreshToken.value),
    currentUser: computed(() => currentUser.value),
    permissions: computed(() => permissions.value),
    isAuthenticated: computed(() => !!currentUser.value),
    isInitialized: computed(() => initialized.value),
    hasPermission,
    logout,
  };
}

export function getAccessToken() {
  return accessToken.value;
}

export function getRefreshToken() {
  return refreshToken.value;
}

export function hasPermission(permission: string) {
  return permissions.value.includes(permission);
}

export function getDefaultAuthorizedRoute() {
  if (hasPermission('devices.view')) return { name: 'home' as const };
  if (hasPermission('files.access')) return { name: 'files' as const };
  if (hasPermission('devices.control')) return { name: 'screencast' as const };
  if (hasPermission('terminal.access')) return { name: 'terminal' as const };
  if (currentUser.value) return { name: 'settings' as const };
  return { name: 'login' as const };
}

export async function initializeAuth() {
  ensureStorageSync();

  if (initialized.value) {
    return;
  }

  if (initializePromise) {
    return initializePromise;
  }

  initializePromise = (async () => {
    if (!accessToken.value && !refreshToken.value) {
      initialized.value = true;
      return;
    }

    const meLoaded = await fetchMe();
    if (!meLoaded) {
      const refreshed = await refreshAccessToken();
      if (!refreshed || !(await fetchMe())) {
        clearSession();
      }
    }

    initialized.value = true;
    initializePromise = null;
  })();

  return initializePromise;
}

export function applyAuthResponse(payload: AuthResponsePayload) {
  accessToken.value = payload.accessToken || '';
  accessTokenExpiresAt.value = payload.accessTokenExpiresAt || '';
  refreshToken.value = payload.refreshToken || '';
  refreshTokenExpiresAt.value = payload.refreshTokenExpiresAt || '';
  currentUser.value = payload.user || null;
  permissions.value = payload.permissions || payload.user?.Permissions || [];

  writeLocalString(ACCESS_TOKEN_KEY, accessToken.value);
  writeLocalString(ACCESS_TOKEN_EXPIRES_AT_KEY, accessTokenExpiresAt.value);
  writeLocalString(REFRESH_TOKEN_KEY, refreshToken.value);
  writeLocalString(REFRESH_TOKEN_EXPIRES_AT_KEY, refreshTokenExpiresAt.value);
  writeLocalJson(USER_KEY, currentUser.value);
  writeLocalJson(PERMISSIONS_KEY, permissions.value);
  initialized.value = true;
}

export async function ensureFreshAccessToken() {
  ensureStorageSync();

  if (!accessToken.value && refreshToken.value) {
    await refreshAccessToken();
    return;
  }

  if (!isTokenExpiredOrNearExpiry(accessTokenExpiresAt.value, accessTokenRefreshSkewMs)) {
    return;
  }

  if (isTokenExpiredOrNearExpiry(refreshTokenExpiresAt.value, 0)) {
    return;
  }

  await refreshAccessToken();
}

export async function refreshAccessToken() {
  ensureStorageSync();
  if (!refreshToken.value) {
    syncSessionFromStorage();
  }

  if (!refreshToken.value) {
    return false;
  }

  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    const attemptedRefreshToken = refreshToken.value;

    try {
      const response = await sendApiRequest('/api/auth/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ refreshToken: attemptedRefreshToken }),
        requiresAuth: false,
        retryOnUnauthorized: false,
        handleUnauthorized: false,
        handleForbidden: false
      });

      if (!response.ok) {
        syncSessionFromStorage();
        if (refreshToken.value && refreshToken.value !== attemptedRefreshToken) {
          return fetchMe();
        }
        return false;
      }

      const payload = await response.json() as AuthResponsePayload;
      applyAuthResponse(payload);
      return true;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export async function fetchMe() {
  ensureStorageSync();
  if (!accessToken.value) {
    syncSessionFromStorage();
  }

  if (!accessToken.value) {
    return false;
  }

  try {
    const response = await sendApiRequest('/api/auth/me', {
      handleUnauthorized: false,
      handleForbidden: false
    });

    if (!response.ok) {
      return false;
    }

    const payload = await response.json() as AuthMePayload;
    currentUser.value = payload.user || null;
    permissions.value = payload.permissions || payload.user?.Permissions || [];
    writeLocalJson(USER_KEY, currentUser.value);
    writeLocalJson(PERMISSIONS_KEY, permissions.value);
    return true;
  } catch {
    return false;
  }
}

export async function logout() {
  const activeAccessToken = accessToken.value;
  const activeRefreshToken = refreshToken.value;

  try {
    if (activeAccessToken || activeRefreshToken) {
      await sendApiRequest('/api/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ refreshToken: activeRefreshToken || null }),
        retryOnUnauthorized: false,
        handleUnauthorized: false,
        handleForbidden: false
      });
    }
  } catch {
    // Ignore logout request failures because local session cleanup must still complete.
  } finally {
    clearSession();
  }
}

export function clearSession() {
  accessToken.value = '';
  accessTokenExpiresAt.value = '';
  refreshToken.value = '';
  refreshTokenExpiresAt.value = '';
  currentUser.value = null;
  permissions.value = [];
  removeLocalValue(ACCESS_TOKEN_KEY);
  removeLocalValue(ACCESS_TOKEN_EXPIRES_AT_KEY);
  removeLocalValue(REFRESH_TOKEN_KEY);
  removeLocalValue(REFRESH_TOKEN_EXPIRES_AT_KEY);
  removeLocalValue(USER_KEY);
  removeLocalValue(PERMISSIONS_KEY);
}

export function hasActiveAccessToken() {
  return !!accessToken.value;
}

export function syncSessionFromStorage() {
  accessToken.value = readLocalString(ACCESS_TOKEN_KEY) || '';
  accessTokenExpiresAt.value = readLocalString(ACCESS_TOKEN_EXPIRES_AT_KEY) || '';
  refreshToken.value = readLocalString(REFRESH_TOKEN_KEY) || '';
  refreshTokenExpiresAt.value = readLocalString(REFRESH_TOKEN_EXPIRES_AT_KEY) || '';
  currentUser.value = readStoredUser();
  permissions.value = readStoredPermissions();
}

function isTokenExpiredOrNearExpiry(value: string, skewMs: number) {
  if (!value) {
    return true;
  }

  const expiresAt = Date.parse(value);
  if (!Number.isFinite(expiresAt)) {
    return true;
  }

  return Date.now() + skewMs >= expiresAt;
}

function ensureStorageSync() {
  if (storageSyncInitialized || typeof window === 'undefined') {
    return;
  }

  storageSyncInitialized = true;
  window.addEventListener('storage', (event) => {
    if (!trackedStorageKeys.includes(event.key ?? '')) {
      return;
    }

    syncSessionFromStorage();
  });
}

function readStoredUser() {
  return readLocalJson<AuthUser>(USER_KEY);
}

function readStoredPermissions() {
  return readLocalJson<string[]>(PERMISSIONS_KEY) || [];
}

export async function login(username: string, password: string) {
  const response = await sendApiRequest('/api/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ username, password }),
    requiresAuth: false,
    retryOnUnauthorized: false,
    handleUnauthorized: false,
    handleForbidden: false
  });

  const payload = await response.json().catch(() => null) as AuthResponsePayload | null;
  const ok = response.ok && payload?.success !== false;

  if (ok && payload) {
    applyAuthResponse(payload);
  }

  return {
    ok,
    response,
    payload,
  };
}

registerAuthSessionHandlers({
  clearSession,
  ensureFreshAccessToken,
  getAccessToken,
  hasActiveAccessToken,
  refreshAccessToken,
  syncSessionFromStorage,
});
