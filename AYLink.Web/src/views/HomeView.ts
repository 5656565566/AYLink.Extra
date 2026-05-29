import { defineComponent } from 'vue';
import { computed, ref, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { hasPermission } from '../services/auth';
import { useI18n } from '../composables/useI18n';
import { apiFetch, readApiErrorMessage, resolveApiErrorMessage } from '../utils/api';
import { requestWorkspaceOpen } from '../services/workspaceNavigation';
import { useNotification } from '../services/notification';

export default defineComponent({
  name: 'HomeView',
  setup() {
    const router = useRouter();

    const notificationService = useNotification();

    const { t } = useI18n();

    const devices = ref<any[]>([]);

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

    const closeMenu = (e: MouseEvent) => {    
      const target = e.target as HTMLElement;    
      if (!target.closest('.dropdown-container')) {    
        activeMenuDeviceId.value = null;    
        showMoreActionsMenu.value = false;    
      }    
    };

    const fetchDevices = async () => {    
      loading.value = true;    
      try {    
        const res = await apiFetch('/api/devices');    
        if (res.ok) {    
          devices.value = await res.json();    
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
        message: isMultiSelectMode.value ? t('HomePage.MultiSelectEnabled', '已开启多选模式') : t('HomePage.MultiSelectDisabled', '已退出多选模式')    
      });    
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
          
      const payload: any = { Serial: serial };    
      if (newDeviceName.value.trim()) {    
        payload.Name = newDeviceName.value.trim();    
      }    
      const pairingPortVal = parseInt(newDevicePairingPort.value.trim(), 10);    
      if (!isNaN(pairingPortVal) && newDevicePairingCode.value.trim()) {    
        payload.PairingPort = pairingPortVal;    
        payload.PairingCode = newDevicePairingCode.value.trim();    
      }    
          
      try {    
        const res = await apiFetch('/api/devices', {    
          method: 'POST',    
          headers: { 'Content-Type': 'application/json' },    
          body: JSON.stringify(payload)    
        });    
            
        if (!res.ok) {
    
          addError.value = await readApiErrorMessage(res, t('Devices.AddFailed', '添加失败'));
    
        } else {
    
          await res.json().catch(() => null);
    
          showAddDialog.value = false;    
          newDeviceName.value = '';    
          newDeviceIp.value = '';    
          newDevicePort.value = '';    
          newDevicePairingPort.value = '';    
          newDevicePairingCode.value = '';    
          await fetchDevices();    
        }    
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
          const res = await apiFetch(`/api/devices/${id}`, { method: 'DELETE' });    
          if (res.ok) {    
            await fetchDevices();    
          }    
        } catch (error) {    
          console.error('Failed to delete device', error);    
        }    
      }    
    };

    const openRenameDialog = (device: any) => {    
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
        const res = await apiFetch(`/api/devices/${renameDeviceId.value}/rename`, {    
          method: 'PUT',    
          headers: { 'Content-Type': 'application/json' },    
          body: JSON.stringify({ Name: nextName })    
        });    
        
        const data = await res.json().catch(() => null);    
        if (!res.ok) {    
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

    const ensureDeviceInteractive = (device: any) => {    
      if (String(device?.Status ?? '').toLowerCase() === 'online') {    
        return true;    
      }    
        
      notificationService.show({    
        type: 'warning',    
        title: t('Devices.OfflineTitle', '设备已断开'),    
        message: t('Devices.OfflineMessage', '该设备当前离线，系统正在尝试自动重连，请稍后再试。')    
      });    
      return false;    
    };

    const openScreencast = (device: any) => {    
      activeMenuDeviceId.value = null;    
      if (!ensureDeviceInteractive(device)) return;    
      requestWorkspaceOpen('screencast', {    
        deviceId: String(device.Id),    
        deviceName: device.Name || device.Serial || '设备投屏'    
      });    
      router.push({ name: 'screencast' });    
    };

    const openNewDisplayScreencast = (device: any) => {    
      activeMenuDeviceId.value = null;    
      if (!ensureDeviceInteractive(device)) return;    
      requestWorkspaceOpen('screencast', {    
        deviceId: String(device.Id),    
        deviceName: device.Name || device.Serial || '设备投屏',    
        newDisplay: true    
      });    
      router.push({ name: 'screencast' });    
    };

    const openTerminal = (device: any) => {    
      activeMenuDeviceId.value = null;    
      if (!ensureDeviceInteractive(device)) return;    
      requestWorkspaceOpen('terminal', {    
        deviceId: String(device.Id),    
        deviceName: device.Name || device.Serial || '设备终端'    
      });    
      router.push({ name: 'terminal' });    
    };

    const openFileManager = (device: any) => {    
      activeMenuDeviceId.value = null;    
      if (!ensureDeviceInteractive(device)) return;    
      requestWorkspaceOpen('files', {    
        deviceId: String(device.Id),    
        deviceName: device.Name || device.Serial || '文件管理'    
      });    
      router.push({ name: 'files' });    
    };

    const openAppManager = (device: any) => {    
      activeMenuDeviceId.value = null;    
      if (!ensureDeviceInteractive(device)) return;    
      requestWorkspaceOpen('apps', {    
        deviceId: String(device.Id),    
        deviceName: device.Name || device.Serial || '应用管理'    
      });    
      router.push({ name: 'apps' });    
    };

    const showEncoderList = async (device: any) => {    
      activeMenuDeviceId.value = null;    
      fetchingEncoders.value = true;    
      showEncodersDialog.value = true;    
      encodersDeviceName.value = device.Name || device.Serial || '未知设备';    
      deviceEncoders.value = [];    
          
      try {    
        const res = await apiFetch(`/api/devices/${device.Id}/encoders`);    
        if (res.ok) {    
          deviceEncoders.value = await res.json();    
        }    
      } catch (error) {    
        console.error('Failed to fetch encoders', error);    
      } finally {    
        fetchingEncoders.value = false;    
      }    
    };

    const openDeviceSettings = (device: any) => {    
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
});

