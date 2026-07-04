import type { Ref } from 'vue';
import type { InputMappingProfileDialogMode } from '../inputMapping/useInputMappingEditorState';
import type { ScreencastFloatingActionIcons, ScreencastFloatingActionModule } from './useScreencastFloatingActions';

type Translate = (key: string, fallback?: string, ...args: (string | number)[]) => string;

export const createNavigationFloatingActionModule = (options: {
  t: Translate;
  iconComponent: unknown;
  icons: Pick<ScreencastFloatingActionIcons, 'back' | 'home' | 'menu' | 'recent'>;
  sendAndroidCommand: (command: string) => void;
}): ScreencastFloatingActionModule => ({
  group: { id: 'navigation', title: '导航', iconComponent: options.iconComponent },
  buildItems: (context) => [
    context.createBackToMainMenuItem(),
    { id: 'back', title: options.t('Screencast.Back', '返回'), iconComponent: options.icons.back, action: () => options.sendAndroidCommand('back') },
    { id: 'home', title: options.t('Screencast.Home', '主页'), iconComponent: options.icons.home, action: () => options.sendAndroidCommand('home') },
    { id: 'menu', title: options.t('Screencast.Menu', '菜单'), iconComponent: options.icons.menu, action: () => options.sendAndroidCommand('menu') },
    { id: 'recent', title: options.t('Screencast.RecentApps', '最近任务'), iconComponent: options.icons.recent, action: () => options.sendAndroidCommand('recent') }
  ]
});

export const createDisplayFloatingActionModule = (options: {
  t: Translate;
  iconComponent: unknown;
  icons: Pick<ScreencastFloatingActionIcons, 'fillDisplay' | 'fullscreen'>;
  effectiveFillMode: Ref<boolean>;
  toggleFillMode: () => void;
  toggleFullscreen: () => void | Promise<void>;
}): ScreencastFloatingActionModule => ({
  group: { id: 'display', title: '显示', iconComponent: options.iconComponent },
  buildItems: (context) => [
    context.createBackToMainMenuItem(),
    {
      id: 'fill-mode',
      title: options.effectiveFillMode.value
        ? options.t('Screencast.FitDisplay', '适应显示')
        : options.t('Screencast.FillDisplay', '拉伸填充'),
      iconComponent: options.icons.fillDisplay,
      action: options.toggleFillMode
    },
    { id: 'fullscreen', title: options.t('Screencast.Fullscreen', '全屏'), iconComponent: options.icons.fullscreen, action: () => void options.toggleFullscreen() }
  ]
});

export const createVolumeFloatingActionModule = (options: {
  t: Translate;
  iconComponent: unknown;
  icons: Pick<ScreencastFloatingActionIcons, 'volumeUp' | 'volumeDown' | 'mute'>;
  sendAndroidCommand: (command: string) => void;
}): ScreencastFloatingActionModule => ({
  group: { id: 'volume', title: '音量', iconComponent: options.iconComponent },
  buildItems: (context) => [
    context.createBackToMainMenuItem(),
    { id: 'volume-up', title: options.t('Screencast.VolumeUp', '音量加'), iconComponent: options.icons.volumeUp, action: () => options.sendAndroidCommand('volumeup') },
    { id: 'volume-down', title: options.t('Screencast.VolumeDown', '音量减'), iconComponent: options.icons.volumeDown, action: () => options.sendAndroidCommand('volumedown') },
    { id: 'mute', title: options.t('Screencast.Mute', '静音'), iconComponent: options.icons.mute, action: () => options.sendAndroidCommand('mute') }
  ]
});

export const createPowerFloatingActionModule = (options: {
  t: Translate;
  iconComponent: unknown;
  icons: Pick<ScreencastFloatingActionIcons, 'power' | 'phone'>;
  sendAndroidCommand: (command: string) => void;
}): ScreencastFloatingActionModule => ({
  group: { id: 'power', title: '电源 / 屏幕', iconComponent: options.iconComponent },
  buildItems: (context) => [
    context.createBackToMainMenuItem(),
    { id: 'power', title: options.t('Screencast.Power', '电源'), iconComponent: options.icons.power, action: () => options.sendAndroidCommand('power') },
    { id: 'screen-on', title: options.t('Screencast.ScreenOn', '亮屏'), iconComponent: options.icons.phone, action: () => options.sendAndroidCommand('screenon') },
    { id: 'screen-off', title: options.t('Screencast.ScreenOff', '熄屏'), iconComponent: options.icons.phone, danger: true, action: () => options.sendAndroidCommand('screenoff') }
  ]
});

export const createInputMappingFloatingActionModule = (options: {
  t: Translate;
  iconComponent: unknown;
  icons: Pick<ScreencastFloatingActionIcons, 'save' | 'edit' | 'dismiss' | 'inputMapping' | 'eye' | 'eyeOff' | 'play' | 'pause' | 'closeMapping'>;
  isInputMappingEditMode: Ref<boolean>;
  hasActiveInputMappingProfile: Ref<boolean>;
  isNewInputMappingProfileDraft: Ref<boolean>;
  isInputMappingHintsVisible: Ref<boolean>;
  isInputMappingEnabled: Ref<boolean>;
  isInputMappingPaused: Ref<boolean>;
  saveInputMappingProfileFromEditMenu: () => void | Promise<void>;
  openInputMappingProfileDialog: (mode: InputMappingProfileDialogMode) => void;
  exitInputMappingEditMode: () => void | Promise<void>;
  backToInputMappingProfiles: () => void | Promise<void>;
  enterInputMappingEditMode: () => void;
  toggleInputMappingHintsWithNotification: () => void;
  toggleInputMappingPausedWithNotification: () => void;
  closeInputMappingWithNotification: () => void;
}): ScreencastFloatingActionModule => ({
  group: { id: 'inputMapping', title: '按键映射', iconComponent: options.iconComponent },
  buildItems: (context) => options.isInputMappingEditMode.value
    ? [
      context.createBackToMainMenuItem(),
      {
        id: 'save-input-mapping',
        title: options.t('InputMapping.SaveProfile', '保存方案'),
        iconComponent: options.icons.save,
        disabled: !options.hasActiveInputMappingProfile.value,
        action: () => void options.saveInputMappingProfileFromEditMenu()
      },
      {
        id: 'edit-input-mapping-info',
        title: options.t('InputMapping.EditProfileInfo', '编辑信息'),
        iconComponent: options.icons.edit,
        disabled: !options.hasActiveInputMappingProfile.value,
        action: () => options.openInputMappingProfileDialog(options.isNewInputMappingProfileDraft.value ? 'new' : 'info')
      },
      {
        id: 'exit-input-mapping-edit',
        title: options.t('InputMapping.ExitEdit', '退出编辑'),
        iconComponent: options.icons.dismiss,
        action: () => void options.exitInputMappingEditMode()
      },
      {
        id: 'input-mapping-profiles',
        title: options.t('InputMapping.BackToProfiles', '返回管理'),
        iconComponent: options.icons.inputMapping,
        action: () => void options.backToInputMappingProfiles()
      }
    ]
    : [
      context.createBackToMainMenuItem(),
      {
        id: 'input-mapping-profiles',
        title: options.t('InputMapping.ManageProfiles', '管理方案'),
        iconComponent: options.icons.inputMapping,
        action: () => void options.backToInputMappingProfiles()
      },
      {
        id: 'edit-input-mapping',
        title: options.t('InputMapping.EditBindings', '编辑按键'),
        iconComponent: options.icons.edit,
        disabled: !options.hasActiveInputMappingProfile.value,
        action: options.enterInputMappingEditMode
      },
      {
        id: 'toggle-input-mapping-hints',
        title: options.isInputMappingHintsVisible.value
          ? options.t('InputMapping.HideHints', '隐藏提示')
          : options.t('InputMapping.ShowHints', '显示提示'),
        iconComponent: options.isInputMappingHintsVisible.value ? options.icons.eyeOff : options.icons.eye,
        disabled: !options.hasActiveInputMappingProfile.value,
        action: options.toggleInputMappingHintsWithNotification
      },
      {
        id: 'toggle-input-mapping-paused',
        title: options.isInputMappingPaused.value
          ? options.t('InputMapping.Resume', '恢复映射')
          : options.t('InputMapping.Pause', '暂停映射'),
        iconComponent: options.isInputMappingPaused.value ? options.icons.play : options.icons.pause,
        disabled: !options.isInputMappingEnabled.value || !options.hasActiveInputMappingProfile.value,
        action: options.toggleInputMappingPausedWithNotification
      },
      {
        id: 'close-input-mapping',
        title: options.t('InputMapping.CloseMapping', '关闭映射'),
        iconComponent: options.icons.closeMapping,
        danger: true,
        disabled: !options.isInputMappingEnabled.value || !options.hasActiveInputMappingProfile.value,
        action: options.closeInputMappingWithNotification
      }
    ]
});

export const createClipboardFloatingActionModule = (options: {
  t: Translate;
  iconComponent: unknown;
  toggleClipboardWindow: () => void;
}): ScreencastFloatingActionModule => ({
  buildDirectItems: () => [{
    id: 'remote-clipboard',
    title: options.t('Screencast.RemoteClipboard', '远端剪贴板'),
    iconComponent: options.iconComponent,
    action: options.toggleClipboardWindow
  }]
});

export const createDebugStatsFloatingActionModule = (options: {
  t: Translate;
  iconComponent: unknown;
  debugModeEnabled: Ref<boolean>;
  isVideoStatsOverlayVisible: Ref<boolean>;
  toggleVideoStatsOverlay: () => void;
}): ScreencastFloatingActionModule => ({
  buildDirectItems: () => options.debugModeEnabled.value
    ? [{
      id: 'toggle-video-stats',
      title: options.isVideoStatsOverlayVisible.value
        ? options.t('Screencast.HideVideoStats', '隐藏视频统计')
        : options.t('Screencast.ShowVideoStats', '视频统计信息'),
      iconComponent: options.iconComponent,
      action: options.toggleVideoStatsOverlay
    }]
    : []
});

export const createFullWorkbenchFloatingActionModules = (options: {
  t: Translate;
  icons: ScreencastFloatingActionIcons;
  effectiveFillMode: Ref<boolean>;
  isInputMappingEditMode: Ref<boolean>;
  hasActiveInputMappingProfile: Ref<boolean>;
  isNewInputMappingProfileDraft: Ref<boolean>;
  isInputMappingHintsVisible: Ref<boolean>;
  isInputMappingEnabled: Ref<boolean>;
  isInputMappingPaused: Ref<boolean>;
  debugModeEnabled: Ref<boolean>;
  isVideoStatsOverlayVisible: Ref<boolean>;
  sendAndroidCommand: (command: string) => void;
  toggleFillMode: () => void;
  toggleFullscreen: () => void | Promise<void>;
  toggleClipboardWindow: () => void;
  saveInputMappingProfileFromEditMenu: () => void | Promise<void>;
  openInputMappingProfileDialog: (mode: InputMappingProfileDialogMode) => void;
  exitInputMappingEditMode: () => void | Promise<void>;
  backToInputMappingProfiles: () => void | Promise<void>;
  enterInputMappingEditMode: () => void;
  toggleInputMappingHintsWithNotification: () => void;
  toggleInputMappingPausedWithNotification: () => void;
  closeInputMappingWithNotification: () => void;
  toggleVideoStatsOverlay: () => void;
}): ScreencastFloatingActionModule[] => [
  createNavigationFloatingActionModule({
    t: options.t,
    iconComponent: options.icons.home,
    icons: options.icons,
    sendAndroidCommand: options.sendAndroidCommand
  }),
  createDisplayFloatingActionModule({
    t: options.t,
    iconComponent: options.icons.fullscreen,
    icons: options.icons,
    effectiveFillMode: options.effectiveFillMode,
    toggleFillMode: options.toggleFillMode,
    toggleFullscreen: options.toggleFullscreen
  }),
  createVolumeFloatingActionModule({
    t: options.t,
    iconComponent: options.icons.volumeUp,
    icons: options.icons,
    sendAndroidCommand: options.sendAndroidCommand
  }),
  createPowerFloatingActionModule({
    t: options.t,
    iconComponent: options.icons.power,
    icons: options.icons,
    sendAndroidCommand: options.sendAndroidCommand
  }),
  createInputMappingFloatingActionModule({
    t: options.t,
    iconComponent: options.icons.inputMapping,
    icons: options.icons,
    isInputMappingEditMode: options.isInputMappingEditMode,
    hasActiveInputMappingProfile: options.hasActiveInputMappingProfile,
    isNewInputMappingProfileDraft: options.isNewInputMappingProfileDraft,
    isInputMappingHintsVisible: options.isInputMappingHintsVisible,
    isInputMappingEnabled: options.isInputMappingEnabled,
    isInputMappingPaused: options.isInputMappingPaused,
    saveInputMappingProfileFromEditMenu: options.saveInputMappingProfileFromEditMenu,
    openInputMappingProfileDialog: options.openInputMappingProfileDialog,
    exitInputMappingEditMode: options.exitInputMappingEditMode,
    backToInputMappingProfiles: options.backToInputMappingProfiles,
    enterInputMappingEditMode: options.enterInputMappingEditMode,
    toggleInputMappingHintsWithNotification: options.toggleInputMappingHintsWithNotification,
    toggleInputMappingPausedWithNotification: options.toggleInputMappingPausedWithNotification,
    closeInputMappingWithNotification: options.closeInputMappingWithNotification
  }),
  createClipboardFloatingActionModule({
    t: options.t,
    iconComponent: options.icons.clipboard,
    toggleClipboardWindow: options.toggleClipboardWindow
  }),
  createDebugStatsFloatingActionModule({
    t: options.t,
    iconComponent: options.icons.debug,
    debugModeEnabled: options.debugModeEnabled,
    isVideoStatsOverlayVisible: options.isVideoStatsOverlayVisible,
    toggleVideoStatsOverlay: options.toggleVideoStatsOverlay
  })
];
