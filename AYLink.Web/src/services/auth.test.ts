import { beforeEach, describe, expect, it, vi } from 'vitest';
import { storageKeys } from '../core/storage/keys';

const sendApiRequestMock = vi.fn();
const registerAuthSessionHandlersMock = vi.fn();

vi.mock('../core/http/client', () => ({
  sendApiRequest: sendApiRequestMock,
  registerAuthSessionHandlers: registerAuthSessionHandlersMock,
}));

describe('auth service', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it('applies auth responses into state and storage', async () => {
    const authModule = await import('./auth');

    authModule.applyAuthResponse({
      accessToken: 'access',
      refreshToken: 'refresh',
      user: {
        Id: 1,
        Username: 'demo',
        IsActive: true,
        Roles: [],
        Permissions: ['devices.view']
      },
      permissions: ['devices.view', 'files.access']
    });

    expect(authModule.getAccessToken()).toBe('access');
    expect(authModule.getRefreshToken()).toBe('refresh');
    expect(authModule.hasPermission('files.access')).toBe(true);
    expect(window.localStorage.getItem(storageKeys.auth.accessToken)).toBe('access');
    expect(window.localStorage.getItem(storageKeys.auth.accessTokenExpiresAt)).toBe('');
    expect(window.localStorage.getItem(storageKeys.auth.refreshToken)).toBe('refresh');
  });

  it('refreshes access token with singleflight behavior', async () => {
    window.localStorage.setItem(storageKeys.auth.refreshToken, 'refresh-token');
    window.localStorage.setItem(storageKeys.auth.refreshTokenExpiresAt, new Date(Date.now() + 60_000).toISOString());

    let resolveRefresh: undefined | ((value: Response) => void);
    sendApiRequestMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveRefresh = resolve;
        })
    );

    const authModule = await import('./auth');

    const first = authModule.refreshAccessToken();
    const second = authModule.refreshAccessToken();

    expect(sendApiRequestMock).toHaveBeenCalledTimes(1);

    if (typeof resolveRefresh === 'function') {
      resolveRefresh(
        new Response(
          JSON.stringify({
            accessToken: 'new-access',
            refreshToken: 'new-refresh',
            user: {
              Id: 1,
              Username: 'demo',
              IsActive: true,
              Roles: [],
              Permissions: ['devices.view']
            },
            permissions: ['devices.view']
          }),
          { status: 200 }
        )
      );
    }

    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    expect(authModule.getAccessToken()).toBe('new-access');
  });

  it('updates current user and permissions from fetchMe', async () => {
    window.localStorage.setItem(storageKeys.auth.accessToken, 'access-token');
    sendApiRequestMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          user: {
            Id: 7,
            Username: 'operator',
            IsActive: true,
            Roles: [],
            Permissions: ['terminal.access']
          },
          permissions: ['terminal.access']
        }),
        { status: 200 }
      )
    );

    const authModule = await import('./auth');
    const auth = authModule.useAuth();

    await expect(authModule.fetchMe()).resolves.toBe(true);
    expect(auth.currentUser.value?.Username).toBe('operator');
    expect(auth.permissions.value).toEqual(['terminal.access']);
  });

  it('clears local session state on logout even when request fails', async () => {
    sendApiRequestMock.mockRejectedValue(new Error('network'));

    const authModule = await import('./auth');
    authModule.applyAuthResponse({
      accessToken: 'access',
      refreshToken: 'refresh',
      user: {
        Id: 1,
        Username: 'demo',
        IsActive: true,
        Roles: [],
        Permissions: []
      },
      permissions: []
    });

    await authModule.logout();

    expect(authModule.getAccessToken()).toBe('');
    expect(authModule.getRefreshToken()).toBe('');
    expect(window.localStorage.getItem(storageKeys.auth.accessToken)).toBeNull();
    expect(window.localStorage.getItem(storageKeys.auth.accessTokenExpiresAt)).toBeNull();
    expect(window.localStorage.getItem(storageKeys.auth.refreshToken)).toBeNull();
    expect(window.localStorage.getItem(storageKeys.auth.refreshTokenExpiresAt)).toBeNull();
  });

  it('clears local session state after signing out all sessions', async () => {
    sendApiRequestMock.mockResolvedValue(new Response(null, { status: 200 }));

    const authModule = await import('./auth');
    authModule.applyAuthResponse({
      accessToken: 'access',
      refreshToken: 'refresh',
      user: {
        Id: 1,
        Username: 'demo',
        IsActive: true,
        Roles: [],
        Permissions: []
      },
      permissions: []
    });

    await authModule.logoutAll();

    expect(sendApiRequestMock).toHaveBeenCalledWith('/api/logout-all', expect.objectContaining({
      method: 'POST'
    }));
    expect(authModule.getAccessToken()).toBe('');
    expect(authModule.getRefreshToken()).toBe('');
    expect(window.localStorage.getItem(storageKeys.auth.accessToken)).toBeNull();
    expect(window.localStorage.getItem(storageKeys.auth.refreshToken)).toBeNull();
  });

  it('preserves local session state when sign out all sessions fails', async () => {
    sendApiRequestMock.mockRejectedValue(new Error('network'));

    const authModule = await import('./auth');
    authModule.applyAuthResponse({
      accessToken: 'access',
      refreshToken: 'refresh',
      user: {
        Id: 1,
        Username: 'demo',
        IsActive: true,
        Roles: [],
        Permissions: []
      },
      permissions: []
    });

    await expect(authModule.logoutAll()).rejects.toThrow('network');
    expect(authModule.getAccessToken()).toBe('access');
    expect(authModule.getRefreshToken()).toBe('refresh');
    expect(window.localStorage.getItem(storageKeys.auth.accessToken)).toBe('access');
    expect(window.localStorage.getItem(storageKeys.auth.refreshToken)).toBe('refresh');
  });

  it('clears stale stored identity when no tokens are available during initialization', async () => {
    window.localStorage.setItem(storageKeys.auth.user, JSON.stringify({
      Id: 9,
      Username: 'stale-user',
      IsActive: true,
      Roles: [],
      Permissions: ['accounts.manage']
    }));
    window.localStorage.setItem(storageKeys.auth.permissions, JSON.stringify(['accounts.manage']));

    const authModule = await import('./auth');
    const auth = authModule.useAuth();

    await authModule.initializeAuth();

    expect(auth.isAuthenticated.value).toBe(false);
    expect(auth.currentUser.value).toBeNull();
    expect(window.localStorage.getItem(storageKeys.auth.user)).toBeNull();
    expect(window.localStorage.getItem(storageKeys.auth.permissions)).toBeNull();
  });

  it('fails authenticated session check and clears session when access and refresh both fail', async () => {
    window.localStorage.setItem(storageKeys.auth.accessToken, 'expired-access');
    window.localStorage.setItem(storageKeys.auth.refreshToken, 'expired-refresh');
    window.localStorage.setItem(storageKeys.auth.user, JSON.stringify({
      Id: 1,
      Username: 'demo',
      IsActive: true,
      Roles: [],
      Permissions: ['devices.view']
    }));
    window.localStorage.setItem(storageKeys.auth.permissions, JSON.stringify(['devices.view']));

    sendApiRequestMock
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));

    const authModule = await import('./auth');
    const auth = authModule.useAuth();

    await expect(authModule.ensureAuthenticatedSession()).resolves.toBe(false);
    expect(auth.isAuthenticated.value).toBe(false);
    expect(auth.currentUser.value).toBeNull();
    expect(window.localStorage.getItem(storageKeys.auth.accessToken)).toBeNull();
    expect(window.localStorage.getItem(storageKeys.auth.refreshToken)).toBeNull();
  });
});
