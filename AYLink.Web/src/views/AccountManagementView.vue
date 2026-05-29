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
                    @change="onUserRoleChange(user, role.Id, $event)"
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
                    @change="onRolePermissionChange(role, permission.Code, $event)"
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

<script lang="ts" src="./AccountManagementView.ts"></script>

<style scoped src="./AccountManagementView.css"></style>
