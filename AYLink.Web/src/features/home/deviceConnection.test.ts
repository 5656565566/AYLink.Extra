import { describe, expect, it } from 'vitest';
import { getStoredDeviceTransport, isADBDeviceOnline, isStoredDevice } from './deviceConnection';

describe('device connection helpers', () => {
  it('distinguishes stored USB, Wi-Fi and emulator devices', () => {
    expect(getStoredDeviceTransport({ Serial: 'R58N123', IpAddress: null })).toBe('usb');
    expect(getStoredDeviceTransport({ Serial: '192.168.1.20:5555', IpAddress: '192.168.1.20' })).toBe('wifi');
    expect(getStoredDeviceTransport({ Serial: 'emulator-5554', IpAddress: null })).toBe('emulator');
  });

  it('only treats usable ADB states as online', () => {
    expect(isADBDeviceOnline({ serial: 'R58N123', state: 'device', transport: 'usb' })).toBe(true);
    expect(isADBDeviceOnline({ serial: 'R58N123', state: 'unauthorized', transport: 'usb' })).toBe(false);
    expect(isADBDeviceOnline({ serial: 'R58N123', state: 'offline', transport: 'usb' })).toBe(false);
  });

  it('matches stored serials without case sensitivity or surrounding whitespace', () => {
    expect(isStoredDevice({ Serial: ' R58N123 ' }, 'r58n123')).toBe(true);
  });
});
