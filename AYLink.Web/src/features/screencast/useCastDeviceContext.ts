import type { Ref } from 'vue';
import { apiFetch } from '../../utils/api';
import type { CastTab } from '../../types/screencast';
import { isAbortError } from '../../lib/async/abort';
import { createLatestRequestController } from '../../lib/async/latestRequest';
import { normalizeDeviceId } from '../../lib/input/normalize';

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
  const deviceNameRequest = createLatestRequestController();
  const deviceSettingsRequest = createLatestRequestController();

  const fetchDeviceName = async () => {
    const normalizedDeviceId = normalizeDeviceId(deviceId.value);
    if (!normalizedDeviceId) {
      selectedDeviceName.value = '设备投屏';
      return;
    }

    const { requestId, signal } = deviceNameRequest.begin();

    try {
      const response = await apiFetch('/api/devices', {
        signal,
        timeoutMs: 15000,
      });
      if (!deviceNameRequest.isLatest(requestId)) {
        return;
      }
      if (!response.ok) return;

      const devices = await response.json();
      const target = Array.isArray(devices)
        ? devices.find((item: any) => String(item.Id ?? item.id) === normalizedDeviceId)
        : null;
      selectedDeviceName.value = target?.Name ?? target?.name ?? target?.Serial ?? target?.serial ?? '设备投屏';
      if (activeTab.value) {
        upsertTab({ ...activeTab.value, deviceName: selectedDeviceName.value });
      }
    } catch (error) {
      if (!isAbortError(error)) {
        console.warn('Failed to load device name:', error);
      }
    } finally {
      deviceNameRequest.finalize(requestId);
    }
  };

  const fetchDeviceSettings = async () => {
    const normalizedDeviceId = normalizeDeviceId(deviceId.value);
    if (!normalizedDeviceId) {
      isFlexDisplayEnabled.value = false;
      isHidKeyboardEnabled.value = false;
      isHidMouseEnabled.value = false;
      return;
    }

    const { requestId, signal } = deviceSettingsRequest.begin();

    try {
      const response = await apiFetch(`/api/devices/${normalizedDeviceId}/settings`, {
        signal,
        timeoutMs: 15000,
      });
      if (!deviceSettingsRequest.isLatest(requestId)) {
        return;
      }
      if (!response.ok) {
        return;
      }

      const settings = await response.json();
      isFlexDisplayEnabled.value = isNewDisplayMode.value && settings?.FlexDisplay === true;
      isHidKeyboardEnabled.value = settings?.HidKeyboard === true;
      isHidMouseEnabled.value = settings?.HidMouse === true;
    } catch (error) {
      if (!isAbortError(error)) {
        console.warn('Failed to load device settings:', error);
        isFlexDisplayEnabled.value = false;
        isHidKeyboardEnabled.value = false;
        isHidMouseEnabled.value = false;
      }
    } finally {
      deviceSettingsRequest.finalize(requestId);
    }
  };

  const refreshDeviceContext = async () => {
    await fetchDeviceName();
    await fetchDeviceSettings();
  };

  return {
    fetchDeviceName,
    fetchDeviceSettings,
    refreshDeviceContext,
    cancelDeviceContextRequests: () => {
      deviceNameRequest.dispose();
      deviceSettingsRequest.dispose();
    }
  };
}
