import { beforeEach, describe, expect, it, vi } from 'vitest';

const routerTestState = vi.hoisted(() => ({
  isAuthenticated: false,
  permissions: [] as string[],
  unauthorizedHandler: null as null | (() => void),
  notificationShow: vi.fn(),
  initializeAuth: vi.fn(async () => {}),
  getDefaultAuthorizedRoute: vi.fn(() => ({ name: 'home' })),
}));

vi.mock('../core/http/client', () => ({
  registerUnauthorizedHandler: (handler: (() => void) | null) => {
    routerTestState.unauthorizedHandler = handler;
  }
}));

vi.mock('../services/notification', () => ({
  useNotification: () => ({
    show: routerTestState.notificationShow
  })
}));

vi.mock('../services/i18n', () => ({
  t: (_key: string, fallback = '') => fallback
}));

vi.mock('../services/auth', () => ({
  initializeAuth: routerTestState.initializeAuth,
  ensureAuthenticatedSession: vi.fn(async () => routerTestState.isAuthenticated),
  hasPermission: (permission: string) => routerTestState.permissions.includes(permission),
  getDefaultAuthorizedRoute: routerTestState.getDefaultAuthorizedRoute,
  useAuth: () => ({
    isAuthenticated: {
      value: routerTestState.isAuthenticated
    },
    hasPermission: (permission: string) => routerTestState.permissions.includes(permission)
  })
}));

vi.mock('../views/HomeView.vue', () => ({
  default: {
    name: 'HomeViewStub',
    template: '<div>home</div>'
  }
}));

vi.mock('../views/LoginView.vue', () => ({
  default: {
    name: 'LoginViewStub',
    template: '<div>login</div>'
  }
}));

async function importFreshRouter() {
  vi.resetModules();
  const module = await import('./index');
  return module.default;
}

describe('router auth flows', () => {
  beforeEach(() => {
    routerTestState.isAuthenticated = false;
    routerTestState.permissions = [];
    routerTestState.unauthorizedHandler = null;
    routerTestState.notificationShow.mockReset();
    routerTestState.initializeAuth.mockClear();
    routerTestState.getDefaultAuthorizedRoute.mockClear();
    window.location.hash = '#/';
  });

  it('redirects unauthorized users to login with redirect query', async () => {
    const router = await importFreshRouter();

    await router.push('/files');

    expect(router.currentRoute.value.name).toBe('login');
    expect(router.currentRoute.value.query.redirect).toBe('/files');
  });

  it('shows a warning and redirects when the user lacks page permission', async () => {
    routerTestState.isAuthenticated = true;
    routerTestState.permissions = ['devices.view'];

    const router = await importFreshRouter();

    await router.push('/files');

    expect(routerTestState.notificationShow).toHaveBeenCalledWith(expect.objectContaining({
      type: 'warning',
      message: '当前账号没有访问这个页面的权限。'
    }));
    expect(router.currentRoute.value.name).toBe('home');
  });

});
