import type { SessionTabItem } from './workspace';

export interface TerminalTab extends SessionTabItem {
  key: string;
  deviceId: string;
  deviceName: string;
  serialHint: string;
  status: 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';
}

export interface PersistedTerminalTab extends SessionTabItem {
  key: string;
  deviceId: string;
  deviceName?: string;
  serialHint?: string;
}
