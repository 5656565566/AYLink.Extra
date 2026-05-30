import type { Ref } from 'vue';
import { apiFetch } from '../../utils/api';
import type { CastTab } from '../../types/screencast';

interface UseCastDeviceContextOptions {
  deviceId: Ref<string>;
  isNewDisplayMode: Ref<boolean>;
  selectedDeviceName: Ref<string>;
  isFlexDisplayEnabled: Ref<boolean>;
  isHidKeyboardEnabled: Ref<boolean>;
  isHidMouseEnabled: Ref<boolean>;
  activeTab: Ref<CastTab | null>;
  upsertTab: (tab: CastTab) => void;
}

export function useCastDeviceContext(options: UseCastDeviceContextOptions) {
  const {
    deviceId,
    isNewDisplayMode,
    selectedDeviceName,
    isFlexDisplayEnabled,
    isHidKeyboardEnabled,
    isHidMouseEnabled,
    activeTab,
    upsertTab
  } = options;

  const fetchDeviceName = async () => {
    if (!deviceId.value) {
      selectedDeviceName.value = '设备投屏';
      return;
    }

    try {
      const response = await apiFetch('/api/devices');
      if (!response.ok) return;

      const devices = await response.json();
      const target = Array.isArray(devices)
        ? devices.find((item: any) => String(item.Id ?? item.id) === String(deviceId.value))
        : null;
      selectedDeviceName.value = target?.Name ?? target?.name ?? target?.Serial ?? target?.serial ?? '设备投屏';
      if (activeTab.value) {
        upsertTab({ ...activeTab.value, deviceName: selectedDeviceName.value });
      }
    } catch (error) {
      console.warn('Failed to load device name:', error);
    }
  };

  const fetchDeviceSettings = async () => {
    if (!deviceId.value) {
      isFlexDisplayEnabled.value = false;
      isHidKeyboardEnabled.value = false;
      isHidMouseEnabled.value = false;
      return;
    }

    try {
      const response = await apiFetch(`/api/devices/${deviceId.value}/settings`);
      if (!response.ok) {
        return;
      }

      const settings = await response.json();
      isFlexDisplayEnabled.value = isNewDisplayMode.value && settings?.FlexDisplay === true;
      isHidKeyboardEnabled.value = settings?.HidKeyboard === true;
      isHidMouseEnabled.value = settings?.HidMouse === true;
    } catch (error) {
      console.warn('Failed to load device settings:', error);
      isFlexDisplayEnabled.value = false;
      isHidKeyboardEnabled.value = false;
      isHidMouseEnabled.value = false;
    }
  };

  const refreshDeviceContext = async () => {
    await fetchDeviceName();
    await fetchDeviceSettings();
  };

  return {
    fetchDeviceName,
    fetchDeviceSettings,
    refreshDeviceContext
  };
}
