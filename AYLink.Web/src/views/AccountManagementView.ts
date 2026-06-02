import { defineComponent } from 'vue';
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from '../composables/useI18n';
import SettingItem from '../components/SettingItem.vue';
import SettingSection from '../components/SettingSection.vue';
import { useAuth } from '../services/auth';
import { useDialog } from '../services/dialog';
import { useNotification } from '../services/notification';
import { getPermissionDescription, getPermissionLabel } from '../services/permissionCatalog';
import { apiFetch, resolveApiErrorMessage } from '../utils/api';

export default defineComponent({
  name: 'AccountManagementView',
  components: {
    SettingItem,
    SettingSection
  },
  setup() {
    interface DeviceGroupSummary {
      Id: number;
      Name: string;
      Description?: string;
      DeviceCount?: number;
      IsInternal?: boolean;
    }

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
      DirectDeviceGroups?: DeviceGroupSummary[] | null;
      EffectiveDeviceGroups?: DeviceGroupSummary[] | null;
      EffectiveDeviceCount?: number;
      EffectiveDeviceGroupCount?: number;
    }

    interface RoleItem {
      Id: number;
      Name: string;
      Description: string;
      IsInternal: boolean;
      Permissions: string[];
      DeviceGroups?: DeviceGroupSummary[] | null;
    }

    interface PermissionItem {
      Code: string;
      Description: string;
    }

    const router = useRouter();
    const { t } = useI18n();
    const auth = useAuth();
    const dialogService = useDialog();
    const notifications = useNotification();

    const loading = ref(true);
    const saving = ref(false);
    const users = ref<UserItem[]>([]);
    const roles = ref<RoleItem[]>([]);
    const availablePermissions = ref<PermissionItem[]>([]);
    const availableDeviceGroups = ref<DeviceGroupSummary[]>([]);
    const userRoleMap = ref<Record<number, number[]>>({});
    const userDeviceGroupMap = ref<Record<number, number[]>>({});
    const roleDeviceGroupMap = ref<Record<number, number[]>>({});

    const newUser = ref({
      username: '',
      password: '',
      roleIds: [] as number[],
      deviceGroupIds: [] as number[]
    });

    const newRole = ref({
      name: '',
      description: '',
      permissions: [] as string[],
      deviceGroupIds: [] as number[]
    });

    function goBack() {
      router.back();
    }

    function userRoleIds(user: UserItem) {
      return userRoleMap.value[user.Id] || [];
    }

    function userDeviceGroupIds(user: UserItem) {
      return userDeviceGroupMap.value[user.Id] || [];
    }

    function roleDeviceGroupIds(role: RoleItem) {
      return roleDeviceGroupMap.value[role.Id] || [];
    }

    function isCurrentUser(user: UserItem) {
      return auth.currentUser.value?.Id === user.Id;
    }

    function formatDeviceGroupLabel(group: DeviceGroupSummary) {
      return group.IsInternal
        ? t('AccountPage.InternalAllDevicesGroupLabel', '{0} · 系统全量范围', group.Name)
        : group.Name;
    }

    function formatEffectiveScope(user: UserItem) {
      return t(
        'AccountPage.EffectiveScopeSummary',
        '最终生效 {0} 个分组 / {1} 台设备',
        user.EffectiveDeviceGroupCount ?? 0,
        user.EffectiveDeviceCount ?? 0
      );
    }

    function validateNewUser() {
      if (!newUser.value.username.trim()) {
        notifications.show({
          type: 'warning',
          title: t('AccountPage.ValidationFailedTitle', '请检查填写内容'),
          message: t('AccountPage.UsernameRequiredMessage', '请先填写用户名。')
        });
        return false;
      }
      if (!newUser.value.password.trim()) {
        notifications.show({
          type: 'warning',
          title: t('AccountPage.ValidationFailedTitle', '请检查填写内容'),
          message: t('AccountPage.PasswordRequiredMessage', '请先填写初始密码。')
        });
        return false;
      }
      if (newUser.value.roleIds.length === 0) {
        notifications.show({
          type: 'warning',
          title: t('AccountPage.ValidationFailedTitle', '请检查填写内容'),
          message: t('AccountPage.RoleSelectionRequiredMessage', '至少选择一个角色。')
        });
        return false;
      }
      return true;
    }

    function validateNewRole() {
      if (!newRole.value.name.trim()) {
        notifications.show({
          type: 'warning',
          title: t('AccountPage.ValidationFailedTitle', '请检查填写内容'),
          message: t('AccountPage.RoleNameRequiredMessage', '请先填写角色名称。')
        });
        return false;
      }
      if (newRole.value.permissions.length === 0) {
        notifications.show({
          type: 'warning',
          title: t('AccountPage.ValidationFailedTitle', '请检查填写内容'),
          message: t('AccountPage.PermissionSelectionRequiredMessage', '至少选择一个权限。')
        });
        return false;
      }
      return true;
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

    function toggleUserDeviceGroup(user: UserItem, groupId: number, checked: boolean) {
      const next = new Set(userDeviceGroupIds(user));
      if (checked) {
        next.add(groupId);
      } else {
        next.delete(groupId);
      }
      userDeviceGroupMap.value[user.Id] = [...next];
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

    function toggleRoleDeviceGroup(role: RoleItem, groupId: number, checked: boolean) {
      const next = new Set(roleDeviceGroupIds(role));
      if (checked) {
        next.add(groupId);
      } else {
        next.delete(groupId);
      }
      roleDeviceGroupMap.value[role.Id] = [...next];
    }

    function onUserRoleChange(user: UserItem, roleId: number, event: Event) {
      toggleUserRole(user, roleId, (event.target as HTMLInputElement).checked);
    }

    function onUserDeviceGroupChange(user: UserItem, groupId: number, event: Event) {
      toggleUserDeviceGroup(user, groupId, (event.target as HTMLInputElement).checked);
    }

    function onRolePermissionChange(role: RoleItem, permissionCode: string, event: Event) {
      toggleRolePermission(role, permissionCode, (event.target as HTMLInputElement).checked);
    }

    function onRoleDeviceGroupChange(role: RoleItem, groupId: number, event: Event) {
      toggleRoleDeviceGroup(role, groupId, (event.target as HTMLInputElement).checked);
    }

    async function loadData() {
      loading.value = true;

      try {
        const [usersResponse, rolesResponse, groupsResponse] = await Promise.all([
          apiFetch('/api/accounts/users'),
          apiFetch('/api/accounts/roles'),
          apiFetch('/api/device-groups')
        ]);

        if (!usersResponse.ok || !rolesResponse.ok || !groupsResponse.ok) {
          throw new Error(t('AccountPage.LoadFailedMessage', '账户管理数据加载失败，请稍后重试。'));
        }

        const usersPayload = await usersResponse.json() as { users?: UserItem[]; roles?: RoleItem[] };
        const rolesPayload = await rolesResponse.json() as { roles?: RoleItem[]; availablePermissions?: PermissionItem[] };
        const groupsPayload = await groupsResponse.json() as { items?: DeviceGroupSummary[] };

        users.value = usersPayload.users || [];
        roles.value = rolesPayload.roles || usersPayload.roles || [];
        availablePermissions.value = rolesPayload.availablePermissions || [];
        availableDeviceGroups.value = groupsPayload.items || [];

        userRoleMap.value = Object.fromEntries(
          users.value.map((user) => [user.Id, user.Roles.map((role) => role.Id)])
        );
        userDeviceGroupMap.value = Object.fromEntries(
          users.value.map((user) => [user.Id, (user.DirectDeviceGroups || []).map((group) => group.Id)])
        );
        roleDeviceGroupMap.value = Object.fromEntries(
          roles.value.map((role) => [role.Id, (role.DeviceGroups || []).map((group) => group.Id)])
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
      if (!validateNewUser()) {
        return;
      }

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
            roleIds: newUser.value.roleIds,
            deviceGroupIds: newUser.value.deviceGroupIds
          })
        });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(resolveApiErrorMessage(payload, t('AccountPage.CreateUserFailed', '创建用户失败。')));
        }

        notifications.show({
          type: 'success',
          title: t('AccountPage.CreateUserSuccessTitle', '创建成功'),
          message: t('AccountPage.CreateUserSuccessMessage', '已创建账号 {0}。', payload.user?.Username || newUser.value.username)
        });

        newUser.value = { username: '', password: '', roleIds: [], deviceGroupIds: [] };
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
            roleIds: userRoleIds(user),
            deviceGroupIds: userDeviceGroupIds(user)
          })
        });

        const payload = await response.json();

        if (!response.ok) {
          throw new Error(resolveApiErrorMessage(payload, t('AccountPage.SaveUserFailed', '保存用户失败。')));
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
          throw new Error(resolveApiErrorMessage(payload, t('AccountPage.UpdateStateFailed', '更新账号状态失败。')));
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
      const newPassword = await dialogService.prompt(
        t('AccountPage.ResetPasswordTitle', '重置密码'),
        t('AccountPage.ResetPasswordPrompt', '为 {0} 输入新密码。\n留空则自动生成随机密码。', user.Username),
        '',
        t('AccountPage.ResetPasswordPlaceholder', '留空则自动生成随机密码'),
        t('Common.Save', '保存'),
        t('Common.Cancel', '取消')
      );
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
          throw new Error(resolveApiErrorMessage(payload, t('AccountPage.ResetPasswordFailed', '重置密码失败。')));
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

    async function deleteUser(user: UserItem) {
      if (isCurrentUser(user)) {
        notifications.show({
          type: 'warning',
          title: t('AccountPage.DeleteCurrentUserForbiddenTitle', '无法删除当前账号'),
          message: t('AccountPage.DeleteCurrentUserForbiddenMessage', '当前登录账号不能删除自己，请先使用其他管理员账号操作。')
        });
        return;
      }

      const confirmed = await dialogService.confirm(
        t('AccountPage.DeleteUserTitle', '删除用户'),
        t('AccountPage.DeleteUserPrompt', '确定要删除账号 {0} 吗？', user.Username),
        t('Common.Delete', '删除'),
        t('Common.Cancel', '取消')
      );
      if (!confirmed) {
        return;
      }

      saving.value = true;

      try {
        const response = await apiFetch(`/api/accounts/users/${user.Id}`, {
          method: 'DELETE'
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(resolveApiErrorMessage(payload, t('AccountPage.DeleteUserFailed', '删除用户失败。')));
        }

        notifications.show({
          type: 'success',
          title: t('AccountPage.DeleteUserSuccessTitle', '删除成功'),
          message: t('AccountPage.DeleteUserSuccessMessage', '已删除账号 {0}。', user.Username)
        });

        await loadData();
      } catch (error) {
        notifications.show({
          type: 'error',
          title: t('Common.SaveFailed', '保存失败'),
          message: error instanceof Error ? error.message : t('AccountPage.DeleteUserFailed', '删除用户失败。')
        });
      } finally {
        saving.value = false;
      }
    }

    async function createRole() {
      if (!validateNewRole()) {
        return;
      }

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
          throw new Error(resolveApiErrorMessage(payload, t('AccountPage.CreateRoleFailed', '创建角色失败。')));
        }

        notifications.show({
          type: 'success',
          title: t('AccountPage.CreateRoleSuccessTitle', '角色已创建'),
          message: t('AccountPage.CreateRoleSuccessMessage', '已创建角色 {0}。', payload.role?.Name || newRole.value.name)
        });

        newRole.value = { name: '', description: '', permissions: [], deviceGroupIds: [] };
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
            permissions: role.Permissions,
            deviceGroupIds: roleDeviceGroupIds(role)
          })
        });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(resolveApiErrorMessage(payload, t('AccountPage.SaveRoleFailed', '保存角色失败。')));
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

    return {
      router,
      t,
      auth,
      notifications,
      getPermissionDescription,
      getPermissionLabel,
      loading,
      saving,
      users,
      roles,
      availablePermissions,
      availableDeviceGroups,
      userRoleMap,
      userDeviceGroupMap,
      roleDeviceGroupMap,
      newUser,
      newRole,
      goBack,
      userRoleIds,
      userDeviceGroupIds,
      roleDeviceGroupIds,
      isCurrentUser,
      formatDeviceGroupLabel,
      formatEffectiveScope,
      validateNewUser,
      validateNewRole,
      toggleUserRole,
      toggleUserDeviceGroup,
      toggleRolePermission,
      toggleRoleDeviceGroup,
      onUserRoleChange,
      onUserDeviceGroupChange,
      onRolePermissionChange,
      onRoleDeviceGroupChange,
      loadData,
      createUser,
      saveUser,
      setActive,
      resetPassword,
      deleteUser,
      createRole,
      saveRole
    };
  }
});
