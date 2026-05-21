type TranslateFn = (key: string, fallback?: string, ...args: any[]) => string;

const permissionKeyMap: Record<string, string> = {
  'dashboard.view': 'PermissionCatalog.dashboard.view',
  'devices.view': 'PermissionCatalog.devices.view',
  'devices.manage': 'PermissionCatalog.devices.manage',
  'devices.control': 'PermissionCatalog.devices.control',
  'files.access': 'PermissionCatalog.files.access',
  'terminal.access': 'PermissionCatalog.terminal.access',
  'settings.view': 'PermissionCatalog.settings.view',
  'settings.manage': 'PermissionCatalog.settings.manage',
  'accounts.view': 'PermissionCatalog.accounts.view',
  'accounts.manage': 'PermissionCatalog.accounts.manage',
  'accounts.change-password': 'PermissionCatalog.accounts.changePassword'
};

function getPermissionKeyPrefix(code: string) {
  return permissionKeyMap[code];
}

export function getPermissionLabel(t: TranslateFn, code: string) {
  const keyPrefix = getPermissionKeyPrefix(code);
  return keyPrefix ? t(`${keyPrefix}.Title`, code) : code;
}

export function getPermissionDescription(t: TranslateFn, code: string, fallback: string) {
  const keyPrefix = getPermissionKeyPrefix(code);
  return keyPrefix ? t(`${keyPrefix}.Description`, fallback) : fallback;
}
