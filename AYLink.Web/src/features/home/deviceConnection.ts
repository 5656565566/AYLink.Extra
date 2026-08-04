import type { DeviceSummary } from '../../types/devices';

export type ADBTransport = 'usb' | 'wifi' | 'emulator' | 'unknown';

export interface DiscoveredADBDevice {
  serial: string;
  state: string;
  model?: string;
  transport: ADBTransport;
}

export interface ADBStatusResponse {
  devices?: DiscoveredADBDevice[];
}

export function isADBDeviceOnline(device: DiscoveredADBDevice): boolean {
  const state = device.state.trim().toLowerCase();
  return state === 'device' || state === 'online';
}

export function isStoredDevice(device: Pick<DeviceSummary, 'Serial'>, serial: string): boolean {
  return String(device.Serial || '').trim().toLowerCase() === serial.trim().toLowerCase();
}

export function getStoredDeviceTransport(device: Pick<DeviceSummary, 'Serial' | 'IpAddress'>): ADBTransport {
  if (String(device.IpAddress || '').trim()) {
    return 'wifi';
  }

  const serial = String(device.Serial || '').trim().toLowerCase();
  if (serial.startsWith('emulator-')) {
    return 'emulator';
  }
  return serial ? 'usb' : 'unknown';
}
