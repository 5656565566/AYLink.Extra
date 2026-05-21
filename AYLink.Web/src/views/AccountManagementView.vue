<template>
  <div class="page-container">
    <div class="header">
      <div class="title-bar">
        <button class="transparent icon-btn back-btn" @click="goBack" :disabled="saving">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M10.5 3.5L6 8L10.5 12.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span class="back-text">{{ saving ? t('Settings.Saving', '保存中...') : t('Common.Back', '返回') }}</span>
        </button>
        <h2 class="title">{{ t('AccountPage.Title', '账户管理') }}</h2>
      </div>
    </div>

    <div class="content-area">
      <div v-if="loading" class="empty-state">
        <div class="spinner"></div>
        <p>{{ t('AccountPage.Loading', '正在加载账户数据...') }}</p>
      </div>

      <div v-else class="settings-content">
        <SettingSection :title="t('AccountPage.CreateUser', '创建用户')" :description="t('AccountPage.CreateUserDescription', '管理员创建本地登录账号，并绑定已有角色。')">
          <SettingItem :title="t('AccountPage.Username', '用户名')" :description="t('AccountPage.UsernameDescription', '登录时使用的账户名')">
            <input v-model.trim="newUser.username" class="fluent-input" type="text" :placeholder="t('AccountPage.Username', '用户名')" />
          </SettingItem>
          <SettingItem :title="t('AccountPage.InitialPassword', '初始密码')" :description="t('AccountPage.InitialPasswordDescription', '新建用户时设置初始密码')">
            <input v-model="newUser.password" class="fluent-input" type="password" :placeholder="t('AccountPage.InitialPasswordPlaceholder', '请输入初始密码')" />
          </SettingItem>
          <SettingItem :title="t('AccountPage.Roles', '角色')" :description="t('AccountPage.RolesDescription', '至少选择一个角色')">
            <div class="chip-list">
              <label v-for="role in roles" :key="role.Id" class="chip-option">
                <input type="checkbox" :value="role.Id" v-model="newUser.roleIds" />
                <span>{{ role.Name }}</span>
              </label>
            </div>
          </SettingItem>
          <div class="actions-row">
            <button class="primary" @click="createUser" :disabled="saving || !newUser.username || !newUser.password || newUser.roleIds.length === 0">{{ t('AccountPage.CreateUser', '创建用户') }}</button>
          </div>
        </SettingSection>

        <SettingSection :title="t('AccountPage.Users', '用户列表')" :description="t('AccountPage.UsersDescription', '启用、禁用、重置密码并调整角色归属。')">
          <div v-if="users.length === 0" class="empty-inline">{{ t('AccountPage.NoUsers', '暂无用户。') }}</div>
          <div v-for="user in users" :key="user.Id" class="account-card">
            <div class="account-card__header">
              <div>
                <div class="account-card__title">{{ user.Username }}</div>
                <div class="account-card__meta">
                  {{ t('AccountPage.Roles', '角色') }}：{{ user.Roles.map(role => role.Name).join(' / ') || t('AccountPage.Unassigned', '未分配') }} ·
                  {{ t('AccountPage.Status', '状态') }}：{{ user.IsActive ? t('AccountPage.EnabledStatus', '启用中') : t('AccountPage.DisabledStatus', '已禁用') }}
                </div>
              </div>
              <div class="status-badge" :class="{ inactive: !user.IsActive }">
                {{ user.IsActive ? t('AccountPage.Active', 'Active') : t('AccountPage.Disabled', 'Disabled') }}
              </div>
            </div>

            <div class="account-grid">
              <label class="field-block">
                <span class="field-label">{{ t('AccountPage.Username', '用户名') }}</span>
                <input v-model.trim="user.Username" class="fluent-input" type="text" />
              </label>

              <label class="field-block">
                <span class="field-label">{{ t('AccountPage.Status', '状态') }}</span>
                <select v-model="user.IsActive" class="fluent-select">
                  <option :value="true">{{ t('AccountPage.EnabledOption', '启用') }}</option>
                  <option :value="false" :disabled="isCurrentUser(user)">{{ t('AccountPage.DisabledOption', '禁用') }}</option>
                </select>
              </label>
            </div>

            <div class="field-block">
              <span class="field-label">{{ t('AccountPage.Roles', '角色') }}</span>
              <div class="chip-list">
                <label v-for="role in roles" :key="`${user.Id}-${role.Id}`" class="chip-option">
                  <input
                    type="checkbox"
                    :checked="userRoleIds(user).includes(role.Id)"
                    @change="toggleUserRole(user, role.Id, ($event.target as HTMLInputElement).checked)"
                  />
                  <span>{{ role.Name }}</span>
                </label>
              </div>
            </div>

            <div class="actions-row">
              <button class="primary" @click="saveUser(user)" :disabled="saving">{{ t('AccountPage.SaveUser', '保存') }}</button>
              <button class="transparent" @click="resetPassword(user)" :disabled="saving">{{ t('AccountPage.ResetPassword', '重置密码') }}</button>
              <button
                class="transparent"
                @click="setActive(user, !user.IsActive)"
                :disabled="saving || isCurrentUser(user)"
                :title="isCurrentUser(user) ? t('AccountPage.DisableCurrentUserHint', '当前登录账号不能被禁用') : ''"
              >
                {{ user.IsActive ? t('AccountPage.DisableAccount', '禁用账号') : t('AccountPage.EnableAccount', '启用账号') }}
              </button>
            </div>
          </div>
        </SettingSection>

        <SettingSection :title="t('AccountPage.CreateRole', '创建角色')" :description="t('AccountPage.CreateRoleDescription', '角色负责组合一组权限，用户再绑定角色。')">
          <SettingItem :title="t('AccountPage.RoleName', '角色名')" :description="t('AccountPage.RoleNameDescription', '用于后台展示')">
            <input v-model.trim="newRole.name" class="fluent-input" type="text" :placeholder="t('AccountPage.RoleName', '角色名')" />
          </SettingItem>
          <SettingItem :title="t('AccountPage.RoleDescription', '说明')" :description="t('AccountPage.RoleDescriptionHelp', '可选，用来解释角色用途')">
            <input v-model.trim="newRole.description" class="fluent-input" type="text" :placeholder="t('AccountPage.RoleDescriptionPlaceholder', '例如：仅可查看设备与状态')" />
          </SettingItem>
          <SettingItem :title="t('AccountPage.Permissions', '权限')" :description="t('AccountPage.PermissionsDescription', '按功能组勾选角色能力')">
            <div class="permission-grid">
              <label v-for="permission in availablePermissions" :key="permission.Code" class="permission-option">
                <input type="checkbox" :value="permission.Code" v-model="newRole.permissions" />
                <div>
                  <div class="permission-option__title">{{ getPermissionLabel(t, permission.Code) }}</div>
                  <div class="permission-option__desc">{{ getPermissionDescription(t, permission.Code, permission.Description) }}</div>
                </div>
              </label>
            </div>
          </SettingItem>
          <div class="actions-row">
            <button class="primary" @click="createRole" :disabled="saving || !newRole.name || newRole.permissions.length === 0">{{ t('AccountPage.CreateRole', '创建角色') }}</button>
          </div>
        </SettingSection>

        <SettingSection :title="t('AccountPage.RoleList', '角色列表')" :description="t('AccountPage.RoleListDescription', '编辑角色名称、说明和权限。保存后相关用户会被要求重新登录。')">
          <div v-if="roles.length === 0" class="empty-inline">{{ t('AccountPage.NoRoles', '暂无角色。') }}</div>
          <div v-for="role in roles" :key="role.Id" class="account-card">
            <div class="account-card__header">
              <div>
                <div class="account-card__title">{{ role.Name }}</div>
                <div class="account-card__meta">{{ role.Description || t('AccountPage.RoleDescriptionHelp', '可选，用来解释角色用途') }}</div>
              </div>
            </div>

            <div class="account-grid">
              <label class="field-block">
                <span class="field-label">{{ t('AccountPage.RoleName', '角色名') }}</span>
                <input v-model.trim="role.Name" class="fluent-input" type="text" />
              </label>

              <label class="field-block">
                <span class="field-label">{{ t('AccountPage.RoleDescription', '说明') }}</span>
                <input v-model.trim="role.Description" class="fluent-input" type="text" />
              </label>
            </div>

            <div class="field-block">
              <span class="field-label">{{ t('AccountPage.Permissions', '权限') }}</span>
              <div class="permission-grid">
                <label v-for="permission in availablePermissions" :key="`${role.Id}-${permission.Code}`" class="permission-option">
                  <input
                    type="checkbox"
                    :checked="role.Permissions.includes(permission.Code)"
                    :disabled="role.IsInternal"
                    @change="toggleRolePermission(role, permission.Code, ($event.target as HTMLInputElement).checked)"
                  />
                  <div>
                    <div class="permission-option__title">{{ getPermissionLabel(t, permission.Code) }}</div>
                    <div class="permission-option__desc">{{ getPermissionDescription(t, permission.Code, permission.Description) }}</div>
                  </div>
                </label>
              </div>
              <div v-if="role.IsInternal" class="field-help">
                {{ t('AccountPage.InternalRolePermissionsLocked', '内部角色的权限内容已锁定，只允许修改名称和说明。') }}
              </div>
            </div>

            <div class="actions-row">
              <button class="primary" @click="saveRole(role)" :disabled="saving">{{ t('AccountPage.SaveRole', '保存角色') }}</button>
            </div>
          </div>
        </SettingSection>
      </div>
    </div>

    <div v-if="false" class="i18n-scan-only" aria-hidden="true">
      {{ t('PermissionCatalog.dashboard.view.Title', '首页查看') }}
      {{ t('PermissionCatalog.dashboard.view.Description', '允许查看首页和设备状态概览') }}
      {{ t('PermissionCatalog.devices.view.Title', '设备查看') }}
      {{ t('PermissionCatalog.devices.view.Description', '允许查看设备列表、历史和设备状态') }}
      {{ t('PermissionCatalog.devices.manage.Title', '设备管理') }}
      {{ t('PermissionCatalog.devices.manage.Description', '允许新增、编辑、删除设备和设备设置') }}
      {{ t('PermissionCatalog.devices.control.Title', '设备控制') }}
      {{ t('PermissionCatalog.devices.control.Description', '允许连接设备、投屏、ADB 配对和控制操作') }}
      {{ t('PermissionCatalog.files.access.Title', '文件访问') }}
      {{ t('PermissionCatalog.files.access.Description', '允许访问设备文件管理') }}
      {{ t('PermissionCatalog.terminal.access.Title', '终端访问') }}
      {{ t('PermissionCatalog.terminal.access.Description', '允许打开设备终端') }}
      {{ t('PermissionCatalog.settings.view.Title', '远程设置查看') }}
      {{ t('PermissionCatalog.settings.view.Description', '允许查看服务端设置项，例如 WebRTC 网络配置') }}
      {{ t('PermissionCatalog.settings.manage.Title', '远程设置管理') }}
      {{ t('PermissionCatalog.settings.manage.Description', '允许修改服务端设置项，例如 WebRTC 网络配置') }}
      {{ t('PermissionCatalog.accounts.view.Title', '账户查看') }}
      {{ t('PermissionCatalog.accounts.view.Description', '允许查看账户、角色和权限配置') }}
      {{ t('PermissionCatalog.accounts.manage.Title', '账户管理') }}
      {{ t('PermissionCatalog.accounts.manage.Description', '允许管理用户、角色、权限和管理员重置密码') }}
      {{ t('PermissionCatalog.accounts.changePassword.Title', '修改本人密码') }}
      {{ t('PermissionCatalog.accounts.changePassword.Description', '允许当前登录用户修改自己的密码') }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from '../composables/useI18n';
import SettingItem from '../components/SettingItem.vue';
import SettingSection from '../components/SettingSection.vue';
import { useAuth } from '../services/auth';
import { useNotification } from '../services/notification';
import { getPermissionDescription, getPermissionLabel } from '../services/permissionCatalog';
import { apiFetch } from '../utils/api';

interface RoleSummary {
  Id: number;
  Name: string;
  Description: string;
}

interface UserItem {
  Id: number;
  Username: string;
  IsActive: boolean;
  Roles: RoleSummary[];
}

interface RoleItem {
  Id: number;
  Name: string;
  Description: string;
  IsInternal: boolean;
  Permissions: string[];
}

interface PermissionItem {
  Code: string;
  Description: string;
}

const router = useRouter();
const { t } = useI18n();
const auth = useAuth();
const notifications = useNotification();
const loading = ref(true);
const saving = ref(false);
const users = ref<UserItem[]>([]);
const roles = ref<RoleItem[]>([]);
const availablePermissions = ref<PermissionItem[]>([]);
const userRoleMap = ref<Record<number, number[]>>({});

const newUser = ref({
  username: '',
  password: '',
  roleIds: [] as number[]
});

const newRole = ref({
  name: '',
  description: '',
  permissions: [] as string[]
});

function goBack() {
  router.back();
}

function userRoleIds(user: UserItem) {
  return userRoleMap.value[user.Id] || [];
}

function isCurrentUser(user: UserItem) {
  return auth.currentUser.value?.Id === user.Id;
}

function toggleUserRole(user: UserItem, roleId: number, checked: boolean) {
  const next = new Set(userRoleIds(user));
  if (checked) {
    next.add(roleId);
  } else {
    next.delete(roleId);
  }

  userRoleMap.value[user.Id] = [...next];
}

function toggleRolePermission(role: RoleItem, permissionCode: string, checked: boolean) {
  if (role.IsInternal) {
    return;
  }

  const next = new Set(role.Permissions);
  if (checked) {
    next.add(permissionCode);
  } else {
    next.delete(permissionCode);
  }

  role.Permissions = [...next].sort();
}

async function loadData() {
  loading.value = true;
  try {
    const [usersResponse, rolesResponse] = await Promise.all([
      apiFetch('/api/accounts/users'),
      apiFetch('/api/accounts/roles')
    ]);

    if (!usersResponse.ok || !rolesResponse.ok) {
      throw new Error(t('AccountPage.LoadFailedMessage', '账户管理数据加载失败，请稍后重试。'));
    }

    const usersPayload = await usersResponse.json() as { users?: UserItem[]; roles?: RoleItem[] };
    const rolesPayload = await rolesResponse.json() as { roles?: RoleItem[]; availablePermissions?: PermissionItem[] };

    users.value = usersPayload.users || [];
    roles.value = rolesPayload.roles || usersPayload.roles || [];
    availablePermissions.value = rolesPayload.availablePermissions || [];
    userRoleMap.value = Object.fromEntries(
      users.value.map((user) => [user.Id, user.Roles.map((role) => role.Id)])
    );
  } catch (error) {
    notifications.show({
      type: 'error',
      title: t('AccountPage.LoadFailedTitle', '加载失败'),
      message: t('AccountPage.LoadFailedMessage', '账户管理数据加载失败，请稍后重试。')
    });
  } finally {
    loading.value = false;
  }
}

async function createUser() {
  saving.value = true;
  try {
    const response = await apiFetch('/api/accounts/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        username: newUser.value.username,
        password: newUser.value.password,
        roleIds: newUser.value.roleIds
      })
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Failed to create user');
    }

    notifications.show({
      type: 'success',
      title: t('AccountPage.CreateUserSuccessTitle', '创建成功'),
      message: t('AccountPage.CreateUserSuccessMessage', '已创建账号 {0}。', payload.user?.Username || newUser.value.username)
    });
    newUser.value = { username: '', password: '', roleIds: [] };
    await loadData();
  } catch (error) {
    notifications.show({
      type: 'error',
      title: t('Common.LoadFailed', '加载失败'),
      message: error instanceof Error ? error.message : t('AccountPage.CreateUserFailed', '创建用户失败。')
    });
  } finally {
    saving.value = false;
  }
}

async function saveUser(user: UserItem) {
  saving.value = true;
  try {
    const response = await apiFetch(`/api/accounts/users/${user.Id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        username: user.Username,
        isActive: user.IsActive,
        roleIds: userRoleIds(user)
      })
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Failed to save user');
    }

    notifications.show({
      type: 'success',
      title: t('AccountPage.SaveUserSuccessTitle', '保存成功'),
      message: t('AccountPage.SaveUserSuccessMessage', '已更新账号 {0}。', payload.user?.Username || user.Username)
    });
    await loadData();
  } catch (error) {
    notifications.show({
      type: 'error',
      title: t('Common.SaveFailed', '保存失败'),
      message: error instanceof Error ? error.message : t('AccountPage.SaveUserFailed', '保存用户失败。')
    });
  } finally {
    saving.value = false;
  }
}

async function setActive(user: UserItem, isActive: boolean) {
  saving.value = true;
  try {
    const response = await apiFetch(`/api/accounts/users/${user.Id}/${isActive ? 'activate' : 'deactivate'}`, {
      method: 'POST'
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Failed to update user state');
    }

    notifications.show({
      type: 'success',
      title: isActive ? t('AccountPage.EnableSuccessTitle', '账号已启用') : t('AccountPage.DisableSuccessTitle', '账号已禁用'),
      message: t('AccountPage.UpdateStateSuccessMessage', '{0} 的状态已更新。', user.Username)
    });
    await loadData();
  } catch (error) {
    notifications.show({
      type: 'error',
      title: t('Common.SaveFailed', '保存失败'),
      message: error instanceof Error ? error.message : t('AccountPage.UpdateStateFailed', '更新账号状态失败。')
    });
  } finally {
    saving.value = false;
  }
}

async function resetPassword(user: UserItem) {
  const newPassword = window.prompt(t('AccountPage.ResetPasswordPrompt', '为 {0} 输入新密码。\n留空则自动生成随机密码。', user.Username), '');
  if (newPassword === null) {
    return;
  }

  saving.value = true;
  try {
    const response = await apiFetch(`/api/accounts/users/${user.Id}/reset-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        newPassword: newPassword.trim() || null
      })
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Failed to reset password');
    }

    notifications.show({
      type: 'success',
      title: t('AccountPage.ResetPasswordSuccessTitle', '密码已重置'),
      message: t('AccountPage.ResetPasswordSuccessMessage', '{0} 的新密码：{1}', user.Username, payload.password)
    });
  } catch (error) {
    notifications.show({
      type: 'error',
      title: t('Common.SaveFailed', '保存失败'),
      message: error instanceof Error ? error.message : t('AccountPage.ResetPasswordFailed', '重置密码失败。')
    });
  } finally {
    saving.value = false;
  }
}

async function createRole() {
  saving.value = true;
  try {
    const response = await apiFetch('/api/accounts/roles', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(newRole.value)
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Failed to create role');
    }

    notifications.show({
      type: 'success',
      title: t('AccountPage.CreateRoleSuccessTitle', '角色已创建'),
      message: t('AccountPage.CreateRoleSuccessMessage', '已创建角色 {0}。', payload.role?.Name || newRole.value.name)
    });
    newRole.value = { name: '', description: '', permissions: [] };
    await loadData();
  } catch (error) {
    notifications.show({
      type: 'error',
      title: t('Common.LoadFailed', '加载失败'),
      message: error instanceof Error ? error.message : t('AccountPage.CreateRoleFailed', '创建角色失败。')
    });
  } finally {
    saving.value = false;
  }
}

async function saveRole(role: RoleItem) {
  saving.value = true;
  try {
    const response = await apiFetch(`/api/accounts/roles/${role.Id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: role.Name,
        description: role.Description,
        permissions: role.Permissions
      })
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Failed to save role');
    }

    notifications.show({
      type: 'success',
      title: t('AccountPage.SaveRoleSuccessTitle', '角色已保存'),
      message: t('AccountPage.SaveRoleSuccessMessage', '已更新角色 {0}。', payload.role?.Name || role.Name)
    });
    await loadData();
  } catch (error) {
    notifications.show({
      type: 'error',
      title: t('Common.SaveFailed', '保存失败'),
      message: error instanceof Error ? error.message : t('AccountPage.SaveRoleFailed', '保存角色失败。')
    });
  } finally {
    saving.value = false;
  }
}

onMounted(() => {
  void loadData();
});
</script>

<style scoped>
.page-container {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.header {
  padding: 16px 24px;
  border-bottom: 1px solid var(--fluent-stroke-default);
}

.title-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}

.back-btn {
  position: absolute;
  left: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: 4px;
}

.back-text {
  font-size: 14px;
}

.title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--fluent-text-primary);
}

.content-area {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}

.settings-content {
  max-width: 980px;
  margin: 0 auto;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--fluent-text-secondary);
}

.spinner {
  width: 24px;
  height: 24px;
  border: 3px solid var(--fluent-control-fill-secondary);
  border-top-color: var(--fluent-accent-default);
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 12px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.empty-inline {
  color: var(--fluent-text-secondary);
  font-size: 14px;
}

.account-card {
  border: 1px solid var(--fluent-stroke-default);
  border-radius: 12px;
  padding: 18px;
  background: var(--fluent-control-fill-default, rgba(255, 255, 255, 0.03));
  margin-bottom: 16px;
}

.account-card__header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.account-card__title {
  font-size: 16px;
  font-weight: 600;
  color: var(--fluent-text-primary);
}

.account-card__meta {
  font-size: 13px;
  color: var(--fluent-text-secondary);
  margin-top: 4px;
}

.status-badge {
  align-self: flex-start;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(106, 226, 138, 0.14);
  color: #80e89d;
  font-size: 12px;
}

.status-badge.inactive {
  background: rgba(255, 107, 107, 0.14);
  color: #ffb2b2;
}

.account-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 16px;
}

.field-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 16px;
}

.field-label {
  font-size: 13px;
  color: var(--fluent-text-secondary);
}

.field-help {
  margin-top: 8px;
  font-size: 12px;
  color: var(--fluent-text-secondary);
}

.chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.chip-option {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 999px;
  background: var(--fluent-control-fill-secondary, rgba(255, 255, 255, 0.06));
  border: 1px solid var(--fluent-stroke-default, rgba(255, 255, 255, 0.08));
  font-size: 13px;
}

.permission-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px;
}

.permission-option {
  display: flex;
  gap: 10px;
  padding: 12px;
  border-radius: 10px;
  border: 1px solid var(--fluent-stroke-default, rgba(255, 255, 255, 0.08));
  background: var(--fluent-bg-solid, rgba(255, 255, 255, 0.02));
}

.permission-option__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--fluent-text-primary);
}

.permission-option__desc {
  font-size: 12px;
  color: var(--fluent-text-secondary);
  margin-top: 4px;
}

.actions-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 8px;
}

.fluent-input,
.fluent-select {
  width: 100%;
  background-color: var(--fluent-control-fill-default, rgba(255, 255, 255, 0.05));
  color: var(--fluent-text-primary);
  border: 1px solid var(--fluent-stroke-default, rgba(255, 255, 255, 0.08));
  padding: 10px 12px;
  border-radius: 8px;
  outline: none;
  font-size: 14px;
  box-sizing: border-box;
}

.fluent-input:focus,
.fluent-select:focus {
  border-color: var(--fluent-accent-default);
}
</style>
