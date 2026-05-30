import { createRouter, createWebHashHistory } from 'vue-router';
import { registerUnauthorizedHandler } from '../core/http/client';
import HomeView from '../views/HomeView.vue';
import { getDefaultAuthorizedRoute, hasPermission, initializeAuth, useAuth } from '../services/auth';
import { useNotification } from '../services/notification';
import { t } from '../services/i18n';

const notifications = useNotification();

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('../views/LoginView.vue')
    },
    {
      path: '/',
      name: 'home',
      component: HomeView,
      meta: { requiresAuth: true, permission: 'devices.view' }
    },
    {
      path: '/screencast',
      name: 'screencast',
      component: () => import('../views/ScreenCastView.vue'),
      meta: { requiresAuth: true, permission: 'devices.control' }
    },
    {
      path: '/apps',
      name: 'apps',
      component: () => import('../views/AppManagerView.vue'),
      meta: { requiresAuth: true, permission: 'devices.control' }
    },
    {
      path: '/files',
      name: 'files',
      component: () => import('../views/FileManagerView.vue'),
      meta: { requiresAuth: true, permission: 'files.access' }
    },
    {
      path: '/terminal',
      name: 'terminal',
      component: () => import('../views/TerminalView.vue'),
      meta: { requiresAuth: true, permission: 'terminal.access' }
    },
    {
      path: '/tasks',
      name: 'tasks',
      component: () => import('../views/TasksView.vue'),
      meta: { requiresAuth: true }
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('../views/SettingsView.vue'),
      meta: { requiresAuth: true }
    },
    {
      path: '/settings/accounts',
      name: 'account-settings',
      component: () => import('../views/AccountManagementView.vue'),
      meta: { requiresAuth: true, permission: 'accounts.manage' }
    },
    {
      path: '/device-settings/:id',
      name: 'device-settings',
      component: () => import('../views/DeviceSettingsView.vue'),
      meta: { requiresAuth: true, permission: 'devices.manage' }
    },
  ]
});

registerUnauthorizedHandler(() => {
  void router.push({ name: 'login', query: { redirect: router.currentRoute.value.fullPath } });
});

router.beforeEach(async (to, _from, next) => {
  await initializeAuth();
  const { isAuthenticated } = useAuth();

  if (to.meta.requiresAuth && !isAuthenticated.value) {
    next({ name: 'login', query: { redirect: to.fullPath } });
    return;
  }

  if (to.name === 'login' && isAuthenticated.value) {
    next(getDefaultAuthorizedRoute());
    return;
  }

  const requiredPermission = typeof to.meta.permission === 'string' ? to.meta.permission : '';
  if (requiredPermission && !hasPermission(requiredPermission)) {
    notifications.show({
      type: 'warning',
      title: t('Common.PermissionDenied', '权限不足'),
      message: t('Common.PermissionDeniedPage', '当前账号没有访问这个页面的权限。')
    });
    next(getDefaultAuthorizedRoute());
    return;
  }

  next();
});

export default router;
