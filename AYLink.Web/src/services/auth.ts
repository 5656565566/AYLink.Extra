import { computed, ref } from 'vue';

const ACCESS_TOKEN_KEY = 'aylink.auth.accessToken';
const REFRESH_TOKEN_KEY = 'aylink.auth.refreshToken';
const USER_KEY = 'aylink.auth.user';
const PERMISSIONS_KEY = 'aylink.auth.permissions';

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

const accessToken = ref<string>(localStorage.getItem(ACCESS_TOKEN_KEY) || '');
const refreshToken = ref<string>(localStorage.getItem(REFRESH_TOKEN_KEY) || '');
const currentUser = ref<AuthUser | null>(readStoredUser());
const permissions = ref<string[]>(readStoredPermissions());
const initialized = ref(false);

let initializePromise: Promise<void> | null = null;
let refreshPromise: Promise<boolean> | null = null;
let storageSyncInitialized = false;

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

  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken.value);
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken.value);
  localStorage.setItem(USER_KEY, JSON.stringify(currentUser.value));
  localStorage.setItem(PERMISSIONS_KEY, JSON.stringify(permissions.value));
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
    localStorage.setItem(USER_KEY, JSON.stringify(currentUser.value));
    localStorage.setItem(PERMISSIONS_KEY, JSON.stringify(permissions.value));
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
  } finally {
    clearSession();
  }
}

export function clearSession() {
  accessToken.value = '';
  refreshToken.value = '';
  currentUser.value = null;
  permissions.value = [];
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(PERMISSIONS_KEY);
}

export function hasActiveAccessToken() {
  return !!accessToken.value;
}

export function syncSessionFromStorage() {
  accessToken.value = localStorage.getItem(ACCESS_TOKEN_KEY) || '';
  refreshToken.value = localStorage.getItem(REFRESH_TOKEN_KEY) || '';
  currentUser.value = readStoredUser();
  permissions.value = readStoredPermissions();
}

function ensureStorageSync() {
  if (storageSyncInitialized || typeof window === 'undefined') {
    return;
  }

  storageSyncInitialized = true;
  window.addEventListener('storage', (event) => {
    if (![ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY, USER_KEY, PERMISSIONS_KEY].includes(event.key ?? '')) {
      return;
    }

    syncSessionFromStorage();
  });
}

function readStoredUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) as AuthUser : null;
  } catch {
    return null;
  }
}

function readStoredPermissions() {
  try {
    const raw = localStorage.getItem(PERMISSIONS_KEY);
    return raw ? JSON.parse(raw) as string[] : [];
  } catch {
    return [];
  }
}
