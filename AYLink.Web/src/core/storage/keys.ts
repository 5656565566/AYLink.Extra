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
    adaptivePointerSampling: 'aylink.settings.adaptivePointerSampling',
    backgroundEnabled: 'aylink.settings.backgroundEnabled',
    backgroundMute: 'aylink.settings.backgroundMute',
    homeDeviceViewMode: 'aylink.settings.homeDeviceViewMode',
    language: 'aylink.ui.language',
    newDisplayDpiMode: 'aylink.settings.newDisplayDpiMode',
    newDisplayDpiValue: 'aylink.settings.newDisplayDpiValue',
    pointerSamplingRateHz: 'aylink.settings.pointerSamplingRateHz',
    previewRefreshInterval: 'aylink.settings.previewRefreshInterval',
    themeMode: 'aylink.theme.mode',
    weakNetworkMode: 'aylink.settings.weakNetworkMode',
    accentColor: 'aylink.theme.accentColor',
  },
  webrtc: {
    overrideEnabled: 'aylink.webrtc.override.enabled',
    overrideConfig: 'aylink.webrtc.override.config',
  },
  inputMapping: {
    activeProfileId: 'aylink.inputMapping.activeProfileId',
    enabled: 'aylink.inputMapping.enabled',
    enabledToggleKey: 'aylink.inputMapping.enabledToggleKey',
    mouseCaptureKey: 'aylink.inputMapping.mouseCaptureKey',
    mouseSensitivity: 'aylink.inputMapping.mouseSensitivity',
    profiles: 'aylink.inputMapping.profiles.v1',
    tabStates: 'aylink.inputMapping.tabStates.v1',
    toggleHintsKey: 'aylink.inputMapping.toggleHintsKey',
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
