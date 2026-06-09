import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from '../../composables/useI18n';
import { readLocalString, writeLocalString } from '../../core/storage/browserStorage';
import { storageKeys } from '../../core/storage/keys';
import { hasPermission } from '../../services/auth';
import { useAppSettings } from '../../services/appSettings';
import { useDialog } from '../../services/dialog';
import { useNotification } from '../../services/notification';
import { requestWorkspaceOpen } from '../../services/workspaceNavigation';
import { apiFetch, readApiErrorMessage, resolveApiErrorMessage } from '../../utils/api';
import type { DeviceGroupSummary, DeviceSummary } from '../../types/devices';
import { isAbortError } from '../../lib/async/abort';
import { createLatestRequestController } from '../../lib/async/latestRequest';

interface AddDevicePayload {
  Serial: string;
  Name?: string;
  PairingPort?: number;
  PairingCode?: string;
}

interface DevicePreviewState {
  objectUrl: string;
  loading: boolean;
  lastRequestedAt: number;
  lastLoadedAt: number;
  failedAt: number;
}

type HomeDeviceViewMode = 'list' | 'preview';
type EncoderApplyTarget = 'video' | 'audio';

const DEVICE_VIEW_MODE_KEY = storageKeys.app.homeDeviceViewMode;
const PREVIEW_WIDTH = 240;
const PREVIEW_MAX_CONCURRENT = 2;
const PREVIEW_PRIORITY_LIMIT = 6;
const PREVIEW_RETRY_DELAY_MS = 5000;

export function useHomeDevices() {
  const router = useRouter();
  const notificationService = useNotification();
  const dialogService = useDialog();
  const { t } = useI18n();
  const { previewRefreshInterval } = useAppSettings();

  const devices = ref<DeviceSummary[]>([]);
  const deviceViewMode = ref<HomeDeviceViewMode>(loadDeviceViewMode());
  const previewStates = ref<Record<number, DevicePreviewState>>({});
  const selectedDeviceIds = ref<number[]>([]);
  const loading = ref(true);
  const showAddDialog = ref(false);
  const showMoreActionsMenu = ref(false);
  const showGroupPickerMenu = ref(false);
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
  const showEncoderTargetDialog = ref(false);
  const fetchingEncoders = ref(false);
  const applyingEncoder = ref(false);
  const deviceEncoders = ref<string[]>([]);
  const encoderSearchKeyword = ref('');
  const encodersDeviceId = ref<number | null>(null);
  const encodersDeviceName = ref('');
  const selectedEncoder = ref('');
  const activeMenuDeviceId = ref<number | null>(null);
  const selectedGroupId = ref<number>(0);
  const groupKeyword = ref('');
  const devicesRequest = createLatestRequestController();
  const groupOptionsRequest = createLatestRequestController();
  const encodersRequest = createLatestRequestController();

  const availableGroups = ref<DeviceGroupSummary[]>([]);
  const previewActiveRequests = new Map<number, AbortController>();
  let previewSchedulerHandle: number | null = null;

  const filteredAvailableGroups = computed(() => {
    const keyword = groupKeyword.value.trim().toLowerCase();
    if (!keyword) {
      return availableGroups.value;
    }

    return availableGroups.value.filter((group) => {
      const haystack = `${group.Name} ${group.Source || ''}`.toLowerCase();
      return haystack.includes(keyword);
    });
  });

  const hasGroupKeyword = computed(() => groupKeyword.value.trim().length > 0);
  const filteredDeviceEncoders = computed(() => {
    const keyword = encoderSearchKeyword.value.trim().toLowerCase();
    if (!keyword) {
      return deviceEncoders.value;
    }

    return deviceEncoders.value.filter((encoder) => encoder.toLowerCase().includes(keyword));
  });

  const selectedGroup = computed(() => {
    if (selectedGroupId.value === 0) {
      return null;
    }
    return availableGroups.value.find((group) => group.Id === selectedGroupId.value) || null;
  });

  const visibleDevices = computed(() => {
    if (selectedGroupId.value === 0) {
      return devices.value;
    }

    return devices.value.filter((device) => {
      const deviceGroups = Array.isArray(device.Groups) ? device.Groups : [];
      return deviceGroups.some((group) => group?.Id === selectedGroupId.value);
    });
  });

  const selectedDeviceCount = computed(() => selectedDeviceIds.value.length);
  const isPreviewMode = computed(() => deviceViewMode.value === 'preview');

  const canManageDevices = computed(() => hasPermission('devices.manage'));
  const canControlDevices = computed(() => hasPermission('devices.control'));
  const canAccessFiles = computed(() => hasPermission('files.access'));
  const canAccessTerminal = computed(() => hasPermission('terminal.access'));

  const formatDeviceGroups = (device: DeviceSummary) => {
    const groups = Array.isArray(device.Groups) ? device.Groups : [];
    if (groups.length === 0) {
      return t('HomeView.AllDevices', '全部设备');
    }
    return groups
      .map((group) => String(group?.Name || '').trim())
      .filter(Boolean)
      .join(' / ');
  };

  const ensurePreviewState = (deviceId: number) => {
    if (!previewStates.value[deviceId]) {
      previewStates.value[deviceId] = {
        objectUrl: '',
        loading: false,
        lastRequestedAt: 0,
        lastLoadedAt: 0,
        failedAt: 0,
      };
    }

    return previewStates.value[deviceId];
  };

  const revokePreviewObjectUrl = (deviceId: number) => {
    const state = previewStates.value[deviceId];
    if (!state || !state.objectUrl) {
      return;
    }

    URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = '';
  };

  const removePreviewState = (deviceId: number) => {
    previewActiveRequests.get(deviceId)?.abort();
    previewActiveRequests.delete(deviceId);
    revokePreviewObjectUrl(deviceId);
    delete previewStates.value[deviceId];
  };

  const cleanupPreviewStates = (validDeviceIds: number[]) => {
    const validIds = new Set(validDeviceIds);
    Object.keys(previewStates.value).forEach((deviceId) => {
      const normalizedId = Number(deviceId);
      if (!validIds.has(normalizedId)) {
        removePreviewState(normalizedId);
      }
    });
  };

  const isDevicePreviewOnline = (device: DeviceSummary) => String(device.Status ?? '').toLowerCase() === 'online';

  const getPreviewState = (deviceId: number | string) => {
    return previewStates.value[Number(deviceId)] || null;
  };

  const getDevicePreviewUrl = (deviceId: number | string) => {
    return getPreviewState(deviceId)?.objectUrl || '';
  };

  const isDevicePreviewLoading = (deviceId: number | string) => {
    return getPreviewState(deviceId)?.loading === true;
  };

  const markVisiblePreviewsStale = () => {
    visibleDevices.value.forEach((device) => {
      const state = previewStates.value[Number(device.Id)];
      if (!state) {
        return;
      }

      state.lastLoadedAt = 0;
      state.lastRequestedAt = 0;
    });
  };

  const shouldRefreshPreview = (device: DeviceSummary, now: number, force = false) => {
    if (!isPreviewMode.value || !isDevicePreviewOnline(device)) {
      return false;
    }

    const deviceId = Number(device.Id);
    if (!Number.isFinite(deviceId)) {
      return false;
    }
    if (previewActiveRequests.has(deviceId)) {
      return false;
    }

    const state = ensurePreviewState(deviceId);
    if (state.loading) {
      return false;
    }

    if (force) {
      return true;
    }

    if (state.failedAt > 0 && now-state.failedAt < PREVIEW_RETRY_DELAY_MS) {
      return false;
    }

    const refreshIntervalMs = previewRefreshInterval.value * 1000;
    const lastSuccessfulLoad = state.lastLoadedAt;
    if (lastSuccessfulLoad === 0) {
      return state.lastRequestedAt === 0 || now-state.lastRequestedAt >= PREVIEW_RETRY_DELAY_MS;
    }

    return now-lastSuccessfulLoad >= refreshIntervalMs;
  };

  const loadPreviewForDevice = async (device: DeviceSummary) => {
    const deviceId = Number(device.Id);
    if (!Number.isFinite(deviceId)) {
      return;
    }

    const controller = new AbortController();
    const state = ensurePreviewState(deviceId);
    state.loading = true;
    state.lastRequestedAt = Date.now();
    previewActiveRequests.set(deviceId, controller);

    try {
      const response = await apiFetch(`/api/devices/${deviceId}/preview?width=${PREVIEW_WIDTH}`, {
        signal: controller.signal,
        timeoutMs: 15000,
      });
      if (!response.ok) {
        throw new Error(`preview request failed with status ${response.status}`);
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      revokePreviewObjectUrl(deviceId);

      state.objectUrl = objectUrl;
      state.lastLoadedAt = Date.now();
      state.failedAt = 0;
    } catch (error) {
      if (!isAbortError(error)) {
        state.failedAt = Date.now();
        console.error('Failed to fetch device preview', error);
      }
    } finally {
      state.loading = false;
      previewActiveRequests.delete(deviceId);
    }
  };

  const queuePreviewRefresh = (force = false) => {
    if (!isPreviewMode.value) {
      return;
    }

    const availableSlots = PREVIEW_MAX_CONCURRENT - previewActiveRequests.size;
    if (availableSlots <= 0) {
      return;
    }

    const prioritizedDevices = visibleDevices.value.slice(0, PREVIEW_PRIORITY_LIMIT);
    const remainingDevices = visibleDevices.value.slice(PREVIEW_PRIORITY_LIMIT);
    const queue = [...prioritizedDevices, ...remainingDevices];
    const now = Date.now();
    let started = 0;
    for (const device of queue) {
      if (started >= availableSlots) {
        break;
      }
      if (!shouldRefreshPreview(device, now, force)) {
        continue;
      }

      started += 1;
      void loadPreviewForDevice(device);
    }
  };

  const startPreviewScheduler = () => {
    if (previewSchedulerHandle !== null) {
      return;
    }

    previewSchedulerHandle = window.setInterval(() => {
      queuePreviewRefresh(false);
    }, 1000);
  };

  const stopPreviewScheduler = () => {
    if (previewSchedulerHandle !== null) {
      window.clearInterval(previewSchedulerHandle);
      previewSchedulerHandle = null;
    }
  };

  const cancelPreviewRequests = () => {
    previewActiveRequests.forEach((controller) => controller.abort());
    previewActiveRequests.clear();
    Object.values(previewStates.value).forEach((state) => {
      state.loading = false;
    });
  };

  const setDeviceViewMode = (mode: HomeDeviceViewMode) => {
    deviceViewMode.value = mode;
    writeLocalString(DEVICE_VIEW_MODE_KEY, mode);
  };

  const toggleDeviceViewMode = async () => {
    const nextMode: HomeDeviceViewMode = isPreviewMode.value ? 'list' : 'preview';
    showMoreActionsMenu.value = false;
    activeMenuDeviceId.value = null;
    if (nextMode === 'preview') {
      selectedDeviceIds.value = [];
    }
    setDeviceViewMode(nextMode);

    if (nextMode === 'preview') {
      await fetchDevices();
      queuePreviewRefresh(true);
      startPreviewScheduler();
      return;
    }

    stopPreviewScheduler();
    cancelPreviewRequests();
  };

  const toggleGroupPickerMenu = async () => {
    const willOpen = !showGroupPickerMenu.value;
    if (willOpen) {
      await Promise.all([fetchDevices(), fetchAvailableGroups()]);
    }

    showGroupPickerMenu.value = willOpen;
    groupKeyword.value = '';
    showMoreActionsMenu.value = false;
    activeMenuDeviceId.value = null;
  };

  const selectGroup = (groupId: number) => {
    selectedGroupId.value = groupId;
    selectedDeviceIds.value = [];
    showGroupPickerMenu.value = false;
    groupKeyword.value = '';
  };

  const isDeviceSelected = (deviceId: number | string) => {
    const normalizedId = Number(deviceId);
    return selectedDeviceIds.value.includes(normalizedId);
  };

  const toggleDeviceSelection = (deviceId: number | string) => {
    const normalizedId = Number(deviceId);
    if (!Number.isFinite(normalizedId)) {
      return;
    }

    if (selectedDeviceIds.value.includes(normalizedId)) {
      selectedDeviceIds.value = selectedDeviceIds.value.filter((id) => id !== normalizedId);
      return;
    }

    selectedDeviceIds.value = [...selectedDeviceIds.value, normalizedId];
  };

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
    if (!target.closest('.group-select')) {
      showGroupPickerMenu.value = false;
    }
  };

  const fetchDevices = async () => {
    const { requestId, signal } = devicesRequest.begin();
    loading.value = true;

    try {
      const response = await apiFetch('/api/devices', {
        signal,
        timeoutMs: 15000,
      });
      if (!devicesRequest.isLatest(requestId)) {
        return;
      }

      if (response.ok) {
        devices.value = await response.json();
        const validDeviceIds = new Set(devices.value.map((device) => Number(device.Id)));
        selectedDeviceIds.value = selectedDeviceIds.value.filter((id) => validDeviceIds.has(id));
        cleanupPreviewStates([...validDeviceIds]);
      }
    } catch (error) {
      if (!isAbortError(error)) {
        console.error('Failed to fetch devices', error);
      }
    } finally {
      if (devicesRequest.isLatest(requestId)) {
        loading.value = false;
      }
      devicesRequest.finalize(requestId);
    }
  };

  const fetchAvailableGroups = async () => {
    const { requestId, signal } = groupOptionsRequest.begin();

    try {
      const response = await apiFetch('/api/device-groups/options', {
        signal,
        timeoutMs: 15000,
      });
      if (!groupOptionsRequest.isLatest(requestId)) {
        return;
      }

      if (response.ok) {
        const payload = await response.json().catch(() => ({ items: [] as DeviceGroupSummary[] })) as { items?: DeviceGroupSummary[] };
        const items = Array.isArray(payload?.items) ? payload.items : [];
        availableGroups.value = items
          .filter((group): group is DeviceGroupSummary => !!group && typeof group.Id === 'number')
          .map((group) => ({
            Id: group.Id,
            Name: String(group.Name || '').trim() || t('HomeView.UnknownGroup', '未命名分组'),
            Source: group.Source || null,
          }))
          .sort((left: DeviceGroupSummary, right: DeviceGroupSummary) => left.Name.localeCompare(right.Name));

        if (selectedGroupId.value !== 0 && !availableGroups.value.some((group) => group.Id === selectedGroupId.value)) {
          selectedGroupId.value = 0;
        }
      }
    } catch (error) {
      if (!isAbortError(error)) {
        console.error('Failed to fetch device groups', error);
      }
    } finally {
      groupOptionsRequest.finalize(requestId);
    }
  };

  const handleRefreshDevices = async () => {
    showMoreActionsMenu.value = false;
    markVisiblePreviewsStale();
    await fetchDevices();
    if (isPreviewMode.value) {
      queuePreviewRefresh(true);
    }
  };

  const deleteSelectedDevices = async () => {
    showMoreActionsMenu.value = false;

    if (selectedDeviceIds.value.length === 0) {
      return;
    }

    const confirmed = await dialogService.confirm(
      t('Devices.DeleteConfirmTitle', '移除设备'),
      t('HomeView.DeleteSelectedDevicesConfirm', '确定要移除选中的设备吗？'),
      t('Common.Delete', '删除'),
      t('Common.Cancel', '取消')
    );
    if (!confirmed) {
      return;
    }

    const deviceIds = [...selectedDeviceIds.value];
    let failureCount = 0;

    await Promise.all(deviceIds.map(async (deviceId) => {
      try {
        const response = await apiFetch(`/api/devices/${deviceId}`, { method: 'DELETE' });
        if (!response.ok) {
          failureCount += 1;
        }
      } catch (error) {
        failureCount += 1;
      }
    }));

    selectedDeviceIds.value = [];
    await fetchDevices();

    if (failureCount > 0) {
      notificationService.show({
        type: 'warning',
        title: t('Common.OperationFailed', '操作失败'),
        message: t('HomeView.DeleteSelectedDevicesPartialFailure', '部分设备删除失败，请稍后重试。')
      });
    }
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
      addError.value = t('Devices.IPRequired', '请输入 IP 地址');
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

    const confirmed = await dialogService.confirm(
      t('Devices.DeleteConfirmTitle', '移除设备'),
      t('Devices.DeleteConfirmMessage', '确定要移除此设备吗？'),
      t('Common.Delete', '删除'),
      t('Common.Cancel', '取消')
    );
    if (!confirmed) {
      return;
    }

    try {
      const response = await apiFetch(`/api/devices/${id}`, { method: 'DELETE' });
      if (response.ok) {
        await fetchDevices();
      }
    } catch (error) {
      console.error('Failed to delete device', error);
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
      renameError.value = t('Devices.NameRequired', '请输入设备名称');
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
      deviceName: buildWorkspaceDeviceName(device, t('Screencast.DefaultTabTitle', '设备投屏'))
    });
    router.push({ name: 'screencast' });
  };

  const openNewDisplayScreencast = (device: DeviceSummary) => {
    activeMenuDeviceId.value = null;
    if (!ensureDeviceInteractive(device)) return;

    requestWorkspaceOpen('screencast', {
      deviceId: String(device.Id),
      deviceName: buildWorkspaceDeviceName(device, t('Screencast.DefaultTabTitle', '设备投屏')),
      newDisplay: true
    });
    router.push({ name: 'screencast' });
  };

  const openTerminal = (device: DeviceSummary) => {
    activeMenuDeviceId.value = null;
    if (!ensureDeviceInteractive(device)) return;

    requestWorkspaceOpen('terminal', {
      deviceId: String(device.Id),
      deviceName: buildWorkspaceDeviceName(device, t('TerminalPage.Title', '终端'))
    });
    router.push({ name: 'terminal' });
  };

  const openFileManager = (device: DeviceSummary) => {
    activeMenuDeviceId.value = null;
    if (!ensureDeviceInteractive(device)) return;

    requestWorkspaceOpen('files', {
      deviceId: String(device.Id),
      deviceName: buildWorkspaceDeviceName(device, t('FilePage.Title', '文件管理'))
    });
    router.push({ name: 'files' });
  };

  const openAppManager = (device: DeviceSummary) => {
    activeMenuDeviceId.value = null;
    if (!ensureDeviceInteractive(device)) return;

    requestWorkspaceOpen('apps', {
      deviceId: String(device.Id),
      deviceName: buildWorkspaceDeviceName(device, t('AppPage.Title', '应用管理'))
    });
    router.push({ name: 'apps' });
  };

  const showEncoderList = async (device: DeviceSummary) => {
    const { requestId, signal } = encodersRequest.begin();
    activeMenuDeviceId.value = null;
    fetchingEncoders.value = true;
    showEncodersDialog.value = true;
    encodersDeviceId.value = Number(device.Id);
    encodersDeviceName.value = buildWorkspaceDeviceName(device, t('Devices.UnknownDevice', '未知设备'));
    deviceEncoders.value = [];
    encoderSearchKeyword.value = '';
    selectedEncoder.value = '';

    try {
      const response = await apiFetch(`/api/devices/${device.Id}/encoders`, {
        signal,
        timeoutMs: 15000,
      });
      if (!encodersRequest.isLatest(requestId)) {
        return;
      }

      if (response.ok) {
        deviceEncoders.value = await response.json();
      }
    } catch (error) {
      if (!isAbortError(error)) {
        console.error('Failed to fetch encoders', error);
      }
    } finally {
      if (encodersRequest.isLatest(requestId)) {
        fetchingEncoders.value = false;
      }
      encodersRequest.finalize(requestId);
    }
  };

  const closeEncodersDialog = () => {
    showEncodersDialog.value = false;
    showEncoderTargetDialog.value = false;
    selectedEncoder.value = '';
    encoderSearchKeyword.value = '';
  };

  const selectEncoder = (encoder: string) => {
    if (applyingEncoder.value) {
      return;
    }

    selectedEncoder.value = encoder;
    showEncoderTargetDialog.value = true;
  };

  const closeEncoderTargetDialog = () => {
    showEncoderTargetDialog.value = false;
    selectedEncoder.value = '';
  };

  const applySelectedEncoder = async (target: EncoderApplyTarget) => {
    const deviceId = encodersDeviceId.value;
    const encoder = selectedEncoder.value.trim();
    if (!deviceId || !encoder || applyingEncoder.value) {
      return;
    }

    applyingEncoder.value = true;
    try {
      const settingsResponse = await apiFetch(`/api/devices/${deviceId}/settings`, {
        timeoutMs: 15000,
      });
      if (!settingsResponse.ok) {
        throw new Error(await readApiErrorMessage(settingsResponse, t('DeviceSettings.LoadFailed', '加载设置失败')));
      }

      const settings = await settingsResponse.json();
      const nextSettings = {
        ...settings,
        [target === 'video' ? 'VideoEncoder' : 'AudioEncoder']: encoder,
      };

      const saveResponse = await apiFetch(`/api/devices/${deviceId}/settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(nextSettings),
        timeoutMs: 15000,
      });
      if (!saveResponse.ok) {
        throw new Error(await readApiErrorMessage(saveResponse, t('Common.SaveFailed', '保存失败')));
      }

      selectedEncoder.value = '';
      showEncoderTargetDialog.value = false;
      notificationService.show({
        type: 'success',
        title: t('HomeView.EncoderApplied', '编码器已应用'),
        message: target === 'video'
          ? t('HomeView.VideoEncoderApplied', '已应用为视频编码器')
          : t('HomeView.AudioEncoderApplied', '已应用为音频编码器'),
      });
    } catch (error) {
      notificationService.show({
        type: 'error',
        title: t('HomeView.EncoderApplyFailed', '应用编码器失败'),
        message: resolveApiErrorMessage(error, t('Common.SaveFailed', '保存失败')),
      });
    } finally {
      applyingEncoder.value = false;
    }
  };

  const openDeviceSettings = (device: DeviceSummary) => {
    activeMenuDeviceId.value = null;
    router.push({ name: 'device-settings', params: { id: String(device.Id) } });
  };

  watch(isPreviewMode, (enabled) => {
    if (enabled) {
      queuePreviewRefresh(true);
      startPreviewScheduler();
      return;
    }

    stopPreviewScheduler();
    cancelPreviewRequests();
  }, { immediate: true });

  watch(visibleDevices, () => {
    if (isPreviewMode.value) {
      queuePreviewRefresh(true);
    }
  });

  watch(previewRefreshInterval, () => {
    if (isPreviewMode.value) {
      queuePreviewRefresh(false);
    }
  });

  onMounted(() => {
    void fetchDevices();
    void fetchAvailableGroups();
    document.addEventListener('click', closeMenu);
  });

  onUnmounted(() => {
    stopPreviewScheduler();
    cancelPreviewRequests();
    Object.keys(previewStates.value).forEach((deviceId) => {
      removePreviewState(Number(deviceId));
    });
    devicesRequest.dispose();
    groupOptionsRequest.dispose();
    encodersRequest.dispose();
    document.removeEventListener('click', closeMenu);
  });

  return {
    router,
    notificationService,
    t,
    devices,
    deviceViewMode,
    isPreviewMode,
    previewRefreshInterval,
    visibleDevices,
    previewStates,
    selectedDeviceIds,
    selectedDeviceCount,
    loading,
    showAddDialog,
    showMoreActionsMenu,
    showGroupPickerMenu,
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
    showEncoderTargetDialog,
    fetchingEncoders,
    applyingEncoder,
    deviceEncoders,
    filteredDeviceEncoders,
    encoderSearchKeyword,
    encodersDeviceId,
    encodersDeviceName,
    selectedEncoder,
    activeMenuDeviceId,
    selectedGroupId,
    selectedGroup,
    groupKeyword,
    availableGroups,
    filteredAvailableGroups,
    hasGroupKeyword,
    canManageDevices,
    canControlDevices,
    canAccessFiles,
    canAccessTerminal,
    formatDeviceGroups,
    toggleGroupPickerMenu,
    selectGroup,
    isDeviceSelected,
    toggleDeviceSelection,
    getPreviewState,
    getDevicePreviewUrl,
    isDevicePreviewLoading,
    toggleMenu,
    toggleMoreActionsMenu,
    toggleDeviceViewMode,
    closeMenu,
    fetchDevices,
    fetchAvailableGroups,
    handleRefreshDevices,
    deleteSelectedDevices,
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
    closeEncodersDialog,
    selectEncoder,
    closeEncoderTargetDialog,
    applySelectedEncoder,
    openDeviceSettings
  };
}

function loadDeviceViewMode(): HomeDeviceViewMode {
  return readLocalString(DEVICE_VIEW_MODE_KEY) === 'preview' ? 'preview' : 'list';
}
