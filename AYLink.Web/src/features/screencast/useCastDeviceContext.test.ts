import { ref } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiFetchMock = vi.fn();

vi.mock('../../utils/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

import { useCastDeviceContext } from './useCastDeviceContext';

describe('useCastDeviceContext', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  it('loads device name and updates active tab title', async () => {
    const selectedDeviceName = ref('设备投屏');
    const upsertTab = vi.fn();

    apiFetchMock.mockResolvedValueOnce(new Response(JSON.stringify([
      { Id: 7, Name: 'Pixel 7', Serial: 'serial-7' }
    ]), { status: 200 }));

    const context = useCastDeviceContext({
      deviceId: ref('7'),
      isNewDisplayMode: ref(false),
      selectedDeviceName,
      isFlexDisplayEnabled: ref(false),
      isHidKeyboardEnabled: ref(false),
      isHidMouseEnabled: ref(false),
      activeTab: ref({
        key: '7::screen',
        deviceId: '7',
        appPackageName: '',
        appDisplayName: '',
        deviceName: '设备投屏',
        newDisplay: false
      }),
      upsertTab
    });

    await context.fetchDeviceName();

    expect(selectedDeviceName.value).toBe('Pixel 7');
    expect(upsertTab).toHaveBeenCalledWith(expect.objectContaining({
      deviceName: 'Pixel 7'
    }));
  });

  it('loads device settings and updates feature flags', async () => {
    const isFlexDisplayEnabled = ref(false);
    const isHidKeyboardEnabled = ref(false);
    const isHidMouseEnabled = ref(false);

    apiFetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      FlexDisplay: true,
      HidKeyboard: true,
      HidMouse: false
    }), { status: 200 }));

    const context = useCastDeviceContext({
      deviceId: ref('9'),
      isNewDisplayMode: ref(true),
      selectedDeviceName: ref('设备投屏'),
      isFlexDisplayEnabled,
      isHidKeyboardEnabled,
      isHidMouseEnabled,
      activeTab: ref(null),
      upsertTab: vi.fn()
    });

    await context.fetchDeviceSettings();

    expect(isFlexDisplayEnabled.value).toBe(true);
    expect(isHidKeyboardEnabled.value).toBe(true);
    expect(isHidMouseEnabled.value).toBe(false);
  });

  it('resets flags when no device is selected', async () => {
    const isFlexDisplayEnabled = ref(true);
    const isHidKeyboardEnabled = ref(true);
    const isHidMouseEnabled = ref(true);

    const context = useCastDeviceContext({
      deviceId: ref(''),
      isNewDisplayMode: ref(false),
      selectedDeviceName: ref('旧设备'),
      isFlexDisplayEnabled,
      isHidKeyboardEnabled,
      isHidMouseEnabled,
      activeTab: ref(null),
      upsertTab: vi.fn()
    });

    await context.fetchDeviceSettings();

    expect(isFlexDisplayEnabled.value).toBe(false);
    expect(isHidKeyboardEnabled.value).toBe(false);
    expect(isHidMouseEnabled.value).toBe(false);
  });

  it('refreshes name and settings together', async () => {
    const selectedDeviceName = ref('设备投屏');
    const isFlexDisplayEnabled = ref(false);

    apiFetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify([{ Id: 1, Name: 'Phone' }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ FlexDisplay: true, HidKeyboard: false, HidMouse: true }), { status: 200 }));

    const context = useCastDeviceContext({
      deviceId: ref('1'),
      isNewDisplayMode: ref(true),
      selectedDeviceName,
      isFlexDisplayEnabled,
      isHidKeyboardEnabled: ref(false),
      isHidMouseEnabled: ref(false),
      activeTab: ref(null),
      upsertTab: vi.fn()
    });

    await context.refreshDeviceContext();

    expect(selectedDeviceName.value).toBe('Phone');
    expect(isFlexDisplayEnabled.value).toBe(true);
  });
});
