import type { SessionTabItem } from './workspace';

export interface AppInfo {
  Name: string;
  PackageName: string;
}

export interface AppDetails {
  packageName: string;
  versionName: string;
  versionCode: string;
  firstInstallTime: string;
  lastUpdateTime: string;
  installerPackageName: string;
  primaryApkPath: string;
  apkPaths: string[];
}

export interface AppManagerTab extends SessionTabItem {
  key: string;
  deviceId: string;
  deviceName: string;
}
