import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from '../../composables/useI18n';
import { hasPermission } from '../../services/auth';
import { useNotification } from '../../services/notification';
import { requestWorkspaceOpen } from '../../services/workspaceNavigation';
import { apiFetch, readApiErrorMessage, resolveApiErrorMessage } from '../../utils/api';
import type { DeviceSummary } from '../../types/devices';

interface AddDevicePayload {
  Serial: string;
  Name?: string;
  PairingPort?: number;
  PairingCode?: string;
}

export function useHomeDevices() {
  const router = useRouter();
  const notificationService = useNotification();
  const { t } = useI18n();

  const devices = ref<DeviceSummary[]>([]);
  const loading = ref(true);
  const showAddDialog = ref(false);
  const showMoreActionsMenu = ref(false);
  const isMultiSelectMode = ref(false);
  const adding = ref(false);
  const addError = ref('');
  const renaming = ref(false);
  const renameError = ref('');
  const newDeviceName = ref('');
  const newDeviceIp = ref('');
  const newDevicePort = ref<string>('');
  const newDevicePairingPort = ref<string>('');
  const newDevicePairingCode = ref('');
  const showRenameDialog = ref(false);
  const renameDeviceId = ref<number | null>(null);
  const renameDeviceName = ref('');
  const showEncodersDialog = ref(false);
  const fetchingEncoders = ref(false);
  const deviceEncoders = ref<string[]>([]);
  const encodersDeviceName = ref('');
  const activeMenuDeviceId = ref<number | null>(null);

  const canManageDevices = computed(() => hasPermission('devices.manage'));
  const canControlDevices = computed(() => hasPermission('devices.control'));
  const canAccessFiles = computed(() => hasPermission('files.access'));
  const canAccessTerminal = computed(() => hasPermission('terminal.access'));

  const toggleMenu = (deviceId: number) => {
    if (activeMenuDeviceId.value === deviceId) {
      activeMenuDeviceId.value = null;
    } else {
      activeMenuDeviceId.value = deviceId;
    }
  };

  const toggleMoreActionsMenu = () => {
    showMoreActionsMenu.value = !showMoreActionsMenu.value;
  };

  const closeMenu = (event: MouseEvent) => {
    const target = event.target as HTMLElement;

    if (!target.closest('.dropdown-container')) {
      activeMenuDeviceId.value = null;
      showMoreActionsMenu.value = false;
    }
  };

  const fetchDevices = async () => {
    loading.value = true;

    try {
      const response = await apiFetch('/api/devices');
      if (response.ok) {
        devices.value = await response.json();
      }
    } catch (error) {
      console.error('Failed to fetch devices', error);
    } finally {
      loading.value = false;
    }
  };

  const handleRefreshDevices = async () => {
    showMoreActionsMenu.value = false;
    await fetchDevices();
  };

  const toggleMultiSelectMode = () => {
    showMoreActionsMenu.value = false;
    isMultiSelectMode.value = !isMultiSelectMode.value;

    notificationService.show({
      type: 'info',
      title: t('HomePage.MultiSelectState', '状态切换'),
      message: isMultiSelectMode.value
        ? t('HomePage.MultiSelectEnabled', '已开启多选模式')
        : t('HomePage.MultiSelectDisabled', '已退出多选模式')
    });
  };

  const resetAddDeviceForm = () => {
    showAddDialog.value = false;
    newDeviceName.value = '';
    newDeviceIp.value = '';
    newDevicePort.value = '';
    newDevicePairingPort.value = '';
    newDevicePairingCode.value = '';
    addError.value = '';
  };

  const addDevice = async () => {
    if (!newDeviceIp.value.trim()) {
      addError.value = '请输入 IP 地址';
      return;
    }

    adding.value = true;
    addError.value = '';

    const port = newDevicePort.value.trim() || '5555';
    const serial = `${newDeviceIp.value.trim()}:${port}`;
    const payload: AddDevicePayload = { Serial: serial };

    if (newDeviceName.value.trim()) {
      payload.Name = newDeviceName.value.trim();
    }

    const pairingPort = Number.parseInt(newDevicePairingPort.value.trim(), 10);
    if (!Number.isNaN(pairingPort) && newDevicePairingCode.value.trim()) {
      payload.PairingPort = pairingPort;
      payload.PairingCode = newDevicePairingCode.value.trim();
    }

    try {
      const response = await apiFetch('/api/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        addError.value = await readApiErrorMessage(response, t('Devices.AddFailed', '添加失败'));
        return;
      }

      await response.json().catch(() => null);
      resetAddDeviceForm();
      await fetchDevices();
    } catch (error) {
      addError.value = t('Common.NetworkRequestFailed', '网络请求失败');
    } finally {
      adding.value = false;
    }
  };

  const deleteDevice = async (id: number) => {
    activeMenuDeviceId.value = null;

    if (confirm('确定要移除此设备吗？')) {
      try {
        const response = await apiFetch(`/api/devices/${id}`, { method: 'DELETE' });
        if (response.ok) {
          await fetchDevices();
        }
      } catch (error) {
        console.error('Failed to delete device', error);
      }
    }
  };

  const openRenameDialog = (device: DeviceSummary) => {
    activeMenuDeviceId.value = null;
    renameDeviceId.value = Number(device.Id);
    renameDeviceName.value = String(device.Name || '').trim();
    renameError.value = '';
    showRenameDialog.value = true;
  };

  const closeRenameDialog = () => {
    showRenameDialog.value = false;
    renameDeviceId.value = null;
    renameDeviceName.value = '';
    renameError.value = '';
    renaming.value = false;
  };

  const submitRenameDevice = async () => {
    if (!renameDeviceId.value) {
      return;
    }

    const nextName = renameDeviceName.value.trim();
    if (!nextName) {
      renameError.value = '请输入设备名称';
      return;
    }

    renaming.value = true;
    renameError.value = '';

    try {
      const response = await apiFetch(`/api/devices/${renameDeviceId.value}/rename`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ Name: nextName })
      });

      const data = await response.json().catch(() => null);
      if (!response.ok) {
        renameError.value = resolveApiErrorMessage(data, t('Devices.RenameFailed', '重命名失败'));
        return;
      }

      closeRenameDialog();
      await fetchDevices();
    } catch (error) {
      renameError.value = t('Common.NetworkRequestFailed', '网络请求失败');
    } finally {
      renaming.value = false;
    }
  };

  const ensureDeviceInteractive = (device: DeviceSummary) => {
    if (String(device.Status ?? '').toLowerCase() === 'online') {
      return true;
    }

    notificationService.show({
      type: 'warning',
      title: t('Devices.OfflineTitle', '设备已断开'),
      message: t('Devices.OfflineMessage', '该设备当前离线，系统正在尝试自动重连，请稍后再试。')
    });
    return false;
  };

  const buildWorkspaceDeviceName = (device: DeviceSummary, fallback: string) => {
    return device.Name || device.Serial || fallback;
  };

  const openScreencast = (device: DeviceSummary) => {
    activeMenuDeviceId.value = null;
    if (!ensureDeviceInteractive(device)) return;

    requestWorkspaceOpen('screencast', {
      deviceId: String(device.Id),
      deviceName: buildWorkspaceDeviceName(device, '设备投屏')
    });
    router.push({ name: 'screencast' });
  };

  const openNewDisplayScreencast = (device: DeviceSummary) => {
    activeMenuDeviceId.value = null;
    if (!ensureDeviceInteractive(device)) return;

    requestWorkspaceOpen('screencast', {
      deviceId: String(device.Id),
      deviceName: buildWorkspaceDeviceName(device, '设备投屏'),
      newDisplay: true
    });
    router.push({ name: 'screencast' });
  };

  const openTerminal = (device: DeviceSummary) => {
    activeMenuDeviceId.value = null;
    if (!ensureDeviceInteractive(device)) return;

    requestWorkspaceOpen('terminal', {
      deviceId: String(device.Id),
      deviceName: buildWorkspaceDeviceName(device, '设备终端')
    });
    router.push({ name: 'terminal' });
  };

  const openFileManager = (device: DeviceSummary) => {
    activeMenuDeviceId.value = null;
    if (!ensureDeviceInteractive(device)) return;

    requestWorkspaceOpen('files', {
      deviceId: String(device.Id),
      deviceName: buildWorkspaceDeviceName(device, '文件管理')
    });
    router.push({ name: 'files' });
  };

  const openAppManager = (device: DeviceSummary) => {
    activeMenuDeviceId.value = null;
    if (!ensureDeviceInteractive(device)) return;

    requestWorkspaceOpen('apps', {
      deviceId: String(device.Id),
      deviceName: buildWorkspaceDeviceName(device, '应用管理')
    });
    router.push({ name: 'apps' });
  };

  const showEncoderList = async (device: DeviceSummary) => {
    activeMenuDeviceId.value = null;
    fetchingEncoders.value = true;
    showEncodersDialog.value = true;
    encodersDeviceName.value = buildWorkspaceDeviceName(device, '未知设备');
    deviceEncoders.value = [];

    try {
      const response = await apiFetch(`/api/devices/${device.Id}/encoders`);
      if (response.ok) {
        deviceEncoders.value = await response.json();
      }
    } catch (error) {
      console.error('Failed to fetch encoders', error);
    } finally {
      fetchingEncoders.value = false;
    }
  };

  const openDeviceSettings = (device: DeviceSummary) => {
    activeMenuDeviceId.value = null;
    router.push({ name: 'device-settings', params: { id: String(device.Id) } });
  };

  onMounted(() => {
    fetchDevices();
    document.addEventListener('click', closeMenu);
  });

  onUnmounted(() => {
    document.removeEventListener('click', closeMenu);
  });

  return {
    router,
    notificationService,
    t,
    devices,
    loading,
    showAddDialog,
    showMoreActionsMenu,
    isMultiSelectMode,
    adding,
    addError,
    renaming,
    renameError,
    newDeviceName,
    newDeviceIp,
    newDevicePort,
    newDevicePairingPort,
    newDevicePairingCode,
    showRenameDialog,
    renameDeviceId,
    renameDeviceName,
    showEncodersDialog,
    fetchingEncoders,
    deviceEncoders,
    encodersDeviceName,
    activeMenuDeviceId,
    canManageDevices,
    canControlDevices,
    canAccessFiles,
    canAccessTerminal,
    toggleMenu,
    toggleMoreActionsMenu,
    closeMenu,
    fetchDevices,
    handleRefreshDevices,
    toggleMultiSelectMode,
    addDevice,
    deleteDevice,
    openRenameDialog,
    closeRenameDialog,
    submitRenameDevice,
    ensureDeviceInteractive,
    openScreencast,
    openNewDisplayScreencast,
    openTerminal,
    openFileManager,
    openAppManager,
    showEncoderList,
    openDeviceSettings
  };
}
