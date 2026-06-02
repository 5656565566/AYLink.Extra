// 统一管理本地持久化 Key 避免字符串散落在各功能模块

export const storageKeys = {
  auth: {
    accessToken: 'aylink.auth.accessToken',
    accessTokenExpiresAt: 'aylink.auth.accessTokenExpiresAt',
    refreshToken: 'aylink.auth.refreshToken',
    refreshTokenExpiresAt: 'aylink.auth.refreshTokenExpiresAt',
    user: 'aylink.auth.user',
    permissions: 'aylink.auth.permissions',
  },
  app: {
    backgroundEnabled: 'aylink.settings.backgroundEnabled',
    backgroundMute: 'aylink.settings.backgroundMute',
    language: 'aylink.ui.language',
    newDisplayDpiMode: 'aylink.settings.newDisplayDpiMode',
    newDisplayDpiValue: 'aylink.settings.newDisplayDpiValue',
    themeMode: 'aylink.theme.mode',
    accentColor: 'aylink.theme.accentColor',
  },
  webrtc: {
    overrideEnabled: 'aylink.webrtc.override.enabled',
    overrideConfig: 'aylink.webrtc.override.config',
  },
  workspace: {
    pendingOpenPrefix: 'aylink_pending',
  },
} as const;

export function buildScopedStorageKey(baseKey: string, scope = 'anonymous') {
  return `${baseKey}.${scope}`;
}

export function buildWorkspacePendingOpenKey(target: string) {
  return `${storageKeys.workspace.pendingOpenPrefix}_${target}_open`;
}
