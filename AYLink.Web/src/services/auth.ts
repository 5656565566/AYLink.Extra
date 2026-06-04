import { computed, ref } from 'vue';
import { registerAuthSessionHandlers, sendApiRequest } from '../core/http/client';
import { readLocalJson, readLocalString, removeLocalValue, writeLocalJson, writeLocalString } from '../core/storage/browserStorage';
import { storageKeys } from '../core/storage/keys';
import type { AuthMePayload, AuthResponsePayload, AuthUser } from '../types/auth';

type SessionStatus = 'anonymous' | 'restoring' | 'authenticated';

const ACCESS_TOKEN_KEY = storageKeys.auth.accessToken;
const ACCESS_TOKEN_EXPIRES_AT_KEY = storageKeys.auth.accessTokenExpiresAt;
const REFRESH_TOKEN_KEY = storageKeys.auth.refreshToken;
const REFRESH_TOKEN_EXPIRES_AT_KEY = storageKeys.auth.refreshTokenExpiresAt;
const USER_KEY = storageKeys.auth.user;
const PERMISSIONS_KEY = storageKeys.auth.permissions;

const accessToken = ref('');
const accessTokenExpiresAt = ref('');
const refreshToken = ref('');
const refreshTokenExpiresAt = ref('');
const currentUser = ref<AuthUser | null>(null);
const permissions = ref<string[]>([]);
const initialized = ref(false);
const sessionStatus = ref<SessionStatus>('anonymous');

let initializePromise: Promise<void> | null = null;
let restorePromise: Promise<boolean> | null = null;
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

hydrateSessionFromStorage();

export function useAuth() {
  return {
    accessToken: computed(() => accessToken.value),
    refreshToken: computed(() => refreshToken.value),
    currentUser: computed(() => currentUser.value),
    permissions: computed(() => permissions.value),
    isAuthenticated: computed(() => sessionStatus.value === 'authenticated'),
    isInitialized: computed(() => initialized.value),
    sessionStatus: computed(() => sessionStatus.value),
    hasPermission,
    logout,
    logoutAll,
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
    await restoreSession(true);
    initialized.value = true;
    initializePromise = null;
  })();

  return initializePromise;
}

export async function ensureAuthenticatedSession() {
  ensureStorageSync();
  await initializeAuth();
  return restoreSession(true);
}

export function applyAuthResponse(payload: AuthResponsePayload) {
  accessToken.value = payload.accessToken || '';
  accessTokenExpiresAt.value = payload.accessTokenExpiresAt || '';
  refreshToken.value = payload.refreshToken || '';
  refreshTokenExpiresAt.value = payload.refreshTokenExpiresAt || '';
  currentUser.value = payload.user || null;
  permissions.value = payload.permissions || payload.user?.Permissions || [];
  sessionStatus.value = currentUser.value ? 'authenticated' : 'anonymous';
  persistSession();
  initialized.value = true;
}

export async function ensureFreshAccessToken() {
  ensureStorageSync();
  hydrateSessionFromStorage();

  if (!hasSessionTokens()) {
    clearSession();
    return false;
  }

  if (hasUsableAccessToken()) {
    return true;
  }

  if (!hasUsableRefreshToken()) {
    clearSession();
    return false;
  }

  return refreshAccessToken();
}

export async function refreshAccessToken() {
  ensureStorageSync();
  hydrateSessionFromStorage();

  if (!hasUsableRefreshToken()) {
    clearSession();
    return false;
  }

  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    const response = await requestRefreshToken(refreshToken.value);
    if (!response.ok) {
      clearSession();
      return false;
    }

    const payload = await response.json() as AuthResponsePayload;
    applyAuthResponse(payload);
    return true;
  })()
    .catch(() => {
      clearSession();
      return false;
    })
    .finally(() => {
      refreshPromise = null;
    });

  return refreshPromise;
}

export async function fetchMe() {
  ensureStorageSync();
  hydrateSessionFromStorage();

  if (!hasAccessToken()) {
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
    sessionStatus.value = currentUser.value ? 'authenticated' : 'anonymous';
    persistSession();
    return sessionStatus.value === 'authenticated';
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

export async function logoutAll() {
  const activeAccessToken = accessToken.value;
  const activeRefreshToken = refreshToken.value;

  if (!activeAccessToken && !activeRefreshToken) {
    clearSession();
    return;
  }

  await sendApiRequest('/api/logout-all', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    retryOnUnauthorized: false,
    handleUnauthorized: false,
    handleForbidden: false
  });

  clearSession();
}

export function clearSession() {
  accessToken.value = '';
  accessTokenExpiresAt.value = '';
  refreshToken.value = '';
  refreshTokenExpiresAt.value = '';
  currentUser.value = null;
  permissions.value = [];
  sessionStatus.value = 'anonymous';
  removeLocalValue(ACCESS_TOKEN_KEY);
  removeLocalValue(ACCESS_TOKEN_EXPIRES_AT_KEY);
  removeLocalValue(REFRESH_TOKEN_KEY);
  removeLocalValue(REFRESH_TOKEN_EXPIRES_AT_KEY);
  removeLocalValue(USER_KEY);
  removeLocalValue(PERMISSIONS_KEY);
}

export function hasActiveAccessToken() {
  return hasAccessToken();
}

export function syncSessionFromStorage() {
  hydrateSessionFromStorage();
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

async function restoreSession(forceRemoteUser: boolean) {
  ensureStorageSync();

  if (restorePromise) {
    return restorePromise;
  }

  restorePromise = (async () => {
    hydrateSessionFromStorage();

    if (!hasSessionTokens()) {
      clearSession();
      return false;
    }

    sessionStatus.value = 'restoring';

    if (hasUsableAccessToken()) {
      if (!forceRemoteUser && currentUser.value) {
        sessionStatus.value = 'authenticated';
        return true;
      }

      const meLoaded = await fetchMe();
      if (meLoaded) {
        return true;
      }
    }

    if (!hasUsableRefreshToken()) {
      clearSession();
      return false;
    }

    const refreshed = await refreshAccessToken();
    if (refreshed) {
      return true;
    }

    clearSession();
    return false;
  })()
    .finally(() => {
      if (sessionStatus.value === 'restoring') {
        sessionStatus.value = currentUser.value ? 'authenticated' : 'anonymous';
      }
      restorePromise = null;
    });

  return restorePromise;
}

async function requestRefreshToken(token: string) {
  return sendApiRequest('/api/auth/refresh', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ refreshToken: token }),
    requiresAuth: false,
    retryOnUnauthorized: false,
    handleUnauthorized: false,
    handleForbidden: false
  });
}

function hydrateSessionFromStorage() {
  accessToken.value = readLocalString(ACCESS_TOKEN_KEY) || '';
  accessTokenExpiresAt.value = readLocalString(ACCESS_TOKEN_EXPIRES_AT_KEY) || '';
  refreshToken.value = readLocalString(REFRESH_TOKEN_KEY) || '';
  refreshTokenExpiresAt.value = readLocalString(REFRESH_TOKEN_EXPIRES_AT_KEY) || '';
  currentUser.value = readStoredUser();
  permissions.value = readStoredPermissions();

  if (!hasSessionTokens() && (currentUser.value || permissions.value.length > 0)) {
    clearSession();
    return;
  }

  sessionStatus.value = currentUser.value && hasSessionTokens() ? 'authenticated' : 'anonymous';
}

function persistSession() {
  writeLocalString(ACCESS_TOKEN_KEY, accessToken.value);
  writeLocalString(ACCESS_TOKEN_EXPIRES_AT_KEY, accessTokenExpiresAt.value);
  writeLocalString(REFRESH_TOKEN_KEY, refreshToken.value);
  writeLocalString(REFRESH_TOKEN_EXPIRES_AT_KEY, refreshTokenExpiresAt.value);
  writeLocalJson(USER_KEY, currentUser.value);
  writeLocalJson(PERMISSIONS_KEY, permissions.value);
}

function hasSessionTokens() {
  return hasAccessToken() || hasRefreshToken();
}

function hasAccessToken() {
  return !!accessToken.value;
}

function hasRefreshToken() {
  return !!refreshToken.value;
}

function hasUsableAccessToken() {
  return hasAccessToken() && !isTokenExpiredOrNearExpiry(accessTokenExpiresAt.value, accessTokenRefreshSkewMs);
}

function hasUsableRefreshToken() {
  return hasRefreshToken() && !isTokenExpiredOrNearExpiry(refreshTokenExpiresAt.value, 0);
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

    hydrateSessionFromStorage();
  });
}

function readStoredUser() {
  return readLocalJson<AuthUser>(USER_KEY);
}

function readStoredPermissions() {
  return readLocalJson<string[]>(PERMISSIONS_KEY) || [];
}

registerAuthSessionHandlers({
  ensureFreshAccessToken,
  getAccessToken,
  refreshAccessToken,
  syncSessionFromStorage,
});
