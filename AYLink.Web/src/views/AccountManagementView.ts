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

    const dialogService = useDialog();

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

    function onUserRoleChange(user: UserItem, roleId: number, event: Event) {
    
      toggleUserRole(user, roleId, (event.target as HTMLInputElement).checked);
    
    }

    function onRolePermissionChange(role: RoleItem, permissionCode: string, event: Event) {
    
      toggleRolePermission(role, permissionCode, (event.target as HTMLInputElement).checked);
    
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
          throw new Error(resolveApiErrorMessage(payload, t('AccountPage.CreateUserFailed', '创建用户失败。')));    
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
          throw new Error(resolveApiErrorMessage(payload, t('AccountPage.CreateRoleFailed', '创建角色失败。')));    
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
      userRoleMap,
      newUser,
      newRole,
      goBack,
      userRoleIds,
      isCurrentUser,
      toggleUserRole,
      toggleRolePermission,
      onUserRoleChange,
      onRolePermissionChange,
      loadData,
      createUser,
      saveUser,
      setActive,
      resetPassword,
      createRole,
      saveRole
    };
  }
});
