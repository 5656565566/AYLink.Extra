export type WorkspaceTarget = 'files' | 'apps' | 'screencast' | 'terminal';

export interface WorkspaceOpenRequest {
  deviceId: string;
  deviceName?: string;
  appPackageName?: string;
  appDisplayName?: string;
  newDisplay?: boolean;
}

export interface SessionTabItem {
  key: string;
}
