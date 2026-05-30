import { computed, ref } from 'vue';
import { readLocalJson, readLocalString, removeLocalValue, writeLocalJson, writeLocalString } from '../core/storage/browserStorage';
import { storageKeys } from '../core/storage/keys';

const ACCESS_TOKEN_KEY = storageKeys.auth.accessToken;
const REFRESH_TOKEN_KEY = storageKeys.auth.refreshToken;
const USER_KEY = storageKeys.auth.user;
const PERMISSIONS_KEY = storageKeys.auth.permissions;

export interface RoleSummary {
  Id: number;
  Name: string;
  Description: string;
}

export interface AuthUser {
  Id: number;
  Username: string;
  IsActive: boolean;
  LastLoginAt?: string | null;
  Roles: RoleSummary[];
  Permissions: string[];
}

interface AuthResponsePayload {
  accessToken?: string;
  accessTokenExpiresAt?: string;
  refreshToken?: string;
  refreshTokenExpiresAt?: string;
  user?: AuthUser;
  permissions?: string[];
}

const accessToken = ref<string>(readLocalString(ACCESS_TOKEN_KEY) || '');
const refreshToken = ref<string>(readLocalString(REFRESH_TOKEN_KEY) || '');
const currentUser = ref<AuthUser | null>(readStoredUser());
const permissions = ref<string[]>(readStoredPermissions());
const initialized = ref(false);

let initializePromise: Promise<void> | null = null;
let refreshPromise: Promise<boolean> | null = null;
let storageSyncInitialized = false;
const trackedStorageKeys: readonly string[] = [ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY, USER_KEY, PERMISSIONS_KEY];

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
  refreshToken.value = payload.refreshToken || '';
  currentUser.value = payload.user || null;
  permissions.value = payload.permissions || payload.user?.Permissions || [];

  writeLocalString(ACCESS_TOKEN_KEY, accessToken.value);
  writeLocalString(REFRESH_TOKEN_KEY, refreshToken.value);
  writeLocalJson(USER_KEY, currentUser.value);
  writeLocalJson(PERMISSIONS_KEY, permissions.value);
  initialized.value = true;
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
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ refreshToken: attemptedRefreshToken })
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
    const response = await fetch('/api/auth/me', {
      headers: {
        Authorization: `Bearer ${accessToken.value}`
      }
    });

    if (!response.ok) {
      return false;
    }

    const payload = await response.json() as { user?: AuthUser; permissions?: string[] };
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
      await fetch('/api/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(activeAccessToken ? { Authorization: `Bearer ${activeAccessToken}` } : {})
        },
        body: JSON.stringify({ refreshToken: activeRefreshToken || null })
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
  refreshToken.value = '';
  currentUser.value = null;
  permissions.value = [];
  removeLocalValue(ACCESS_TOKEN_KEY);
  removeLocalValue(REFRESH_TOKEN_KEY);
  removeLocalValue(USER_KEY);
  removeLocalValue(PERMISSIONS_KEY);
}

export function hasActiveAccessToken() {
  return !!accessToken.value;
}

export function syncSessionFromStorage() {
  accessToken.value = readLocalString(ACCESS_TOKEN_KEY) || '';
  refreshToken.value = readLocalString(REFRESH_TOKEN_KEY) || '';
  currentUser.value = readStoredUser();
  permissions.value = readStoredPermissions();
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
