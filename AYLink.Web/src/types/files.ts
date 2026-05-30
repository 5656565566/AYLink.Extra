import type { SessionTabItem } from './workspace';

export interface FileManagerTab extends SessionTabItem {
  key: string;
  deviceId: string;
  deviceName: string;
  path: string;
}

export interface FileEntry {
  Name: string;
  IsDirectory: boolean;
  Size: number;
}
