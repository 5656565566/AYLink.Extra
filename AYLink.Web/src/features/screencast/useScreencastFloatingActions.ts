import { computed, nextTick, ref, type Ref } from 'vue';
import type { InputMappingProfileDialogMode } from '../inputMapping/useInputMappingEditorState';

export type FloatingMenuPage =
  | 'main'
  | 'navigation'
  | 'display'
  | 'volume'
  | 'power'
  | 'inputMapping';

export interface FloatingMenuActionItem {
  id: string;
  title: string;
  iconComponent: unknown;
  danger?: boolean;
  disabled?: boolean;
  action: () => void;
}

export interface FloatingMenuGroupItem {
  id: Exclude<FloatingMenuPage, 'main'>;
  title: string;
  iconComponent: unknown;
}

export interface ScreencastFloatingActionIcons {
  arrowBack: unknown;
  back: unknown;
  home: unknown;
  menu: unknown;
  recent: unknown;
  fullscreen: unknown;
  fillDisplay: unknown;
  volumeUp: unknown;
  volumeDown: unknown;
  mute: unknown;
  power: unknown;
  phone: unknown;
  inputMapping: unknown;
  clipboard: unknown;
  save: unknown;
  edit: unknown;
  dismiss: unknown;
  eye: unknown;
  eyeOff: unknown;
  pause: unknown;
  play: unknown;
  closeMapping: unknown;
}

export function useScreencastFloatingActions(options: {
  t: (key: string, fallback?: string, ...args: (string | number)[]) => string;
  icons: ScreencastFloatingActionIcons;
  isMenuExpanded: Ref<boolean>;
  effectiveFillMode: Ref<boolean>;
  isInputMappingEditMode: Ref<boolean>;
  hasActiveInputMappingProfile: Ref<boolean>;
  isNewInputMappingProfileDraft: Ref<boolean>;
  isInputMappingHintsVisible: Ref<boolean>;
  isInputMappingEnabled: Ref<boolean>;
  isInputMappingPaused: Ref<boolean>;
  ensureMenuInsideStage: () => void;
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
}) {
  const activeFloatingMenuPage = ref<FloatingMenuPage>('main');

  const openFloatingMenuPage = (page: Exclude<FloatingMenuPage, 'main'>) => {
    activeFloatingMenuPage.value = page;
    options.isMenuExpanded.value = false;
    void nextTick(() => {
      options.isMenuExpanded.value = true;
      options.ensureMenuInsideStage();
    });
  };

  const returnToFloatingMenuMain = () => {
    activeFloatingMenuPage.value = 'main';
    options.isMenuExpanded.value = false;
    void nextTick(() => {
      options.isMenuExpanded.value = true;
      options.ensureMenuInsideStage();
    });
  };

  const floatingMenuGroups: FloatingMenuGroupItem[] = [
    { id: 'navigation', title: '导航', iconComponent: options.icons.home },
    { id: 'display', title: '显示', iconComponent: options.icons.fullscreen },
    { id: 'volume', title: '音量', iconComponent: options.icons.volumeUp },
    { id: 'power', title: '电源 / 屏幕', iconComponent: options.icons.power },
    { id: 'inputMapping', title: '按键映射', iconComponent: options.icons.inputMapping }
  ];

  const createBackToMainMenuItem = (): FloatingMenuActionItem => ({
    id: 'back-to-main',
    title: '返回主分组',
    iconComponent: options.icons.arrowBack,
    action: returnToFloatingMenuMain
  });

  const getFloatingMenuGroupItems = (page: FloatingMenuPage): FloatingMenuActionItem[] => {
    switch (page) {
      case 'navigation':
        return [
          createBackToMainMenuItem(),
          { id: 'back', title: options.t('Screencast.Back', '返回'), iconComponent: options.icons.back, action: () => options.sendAndroidCommand('back') },
          { id: 'home', title: options.t('Screencast.Home', '主页'), iconComponent: options.icons.home, action: () => options.sendAndroidCommand('home') },
          { id: 'menu', title: options.t('Screencast.Menu', '菜单'), iconComponent: options.icons.menu, action: () => options.sendAndroidCommand('menu') },
          { id: 'recent', title: options.t('Screencast.RecentApps', '最近任务'), iconComponent: options.icons.recent, action: () => options.sendAndroidCommand('recent') }
        ];
      case 'display':
        return [
          createBackToMainMenuItem(),
          {
            id: 'fill-mode',
            title: options.effectiveFillMode.value
              ? options.t('Screencast.FitDisplay', '适应显示')
              : options.t('Screencast.FillDisplay', '拉伸填充'),
            iconComponent: options.icons.fillDisplay,
            action: options.toggleFillMode
          },
          { id: 'fullscreen', title: options.t('Screencast.Fullscreen', '全屏'), iconComponent: options.icons.fullscreen, action: () => void options.toggleFullscreen() }
        ];
      case 'volume':
        return [
          createBackToMainMenuItem(),
          { id: 'volume-up', title: options.t('Screencast.VolumeUp', '音量加'), iconComponent: options.icons.volumeUp, action: () => options.sendAndroidCommand('volumeup') },
          { id: 'volume-down', title: options.t('Screencast.VolumeDown', '音量减'), iconComponent: options.icons.volumeDown, action: () => options.sendAndroidCommand('volumedown') },
          { id: 'mute', title: options.t('Screencast.Mute', '静音'), iconComponent: options.icons.mute, action: () => options.sendAndroidCommand('mute') }
        ];
      case 'power':
        return [
          createBackToMainMenuItem(),
          { id: 'power', title: options.t('Screencast.Power', '电源'), iconComponent: options.icons.power, action: () => options.sendAndroidCommand('power') },
          { id: 'screen-on', title: options.t('Screencast.ScreenOn', '亮屏'), iconComponent: options.icons.phone, action: () => options.sendAndroidCommand('screenon') },
          { id: 'screen-off', title: options.t('Screencast.ScreenOff', '熄屏'), iconComponent: options.icons.phone, danger: true, action: () => options.sendAndroidCommand('screenoff') }
        ];
      case 'inputMapping':
        return options.isInputMappingEditMode.value
          ? [
            createBackToMainMenuItem(),
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
            createBackToMainMenuItem(),
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
          ];
      case 'main':
      default:
        return [];
    }
  };

  const activeFloatingMenuItems = computed<FloatingMenuActionItem[]>(() => {
    if (activeFloatingMenuPage.value === 'main') {
      const mainGroupItems: FloatingMenuActionItem[] = floatingMenuGroups.map((group) => ({
        id: group.id,
        title: group.title,
        iconComponent: group.iconComponent,
        action: () => openFloatingMenuPage(group.id)
      }));
      return mainGroupItems.concat({
        id: 'remote-clipboard',
        title: options.t('Screencast.RemoteClipboard', '远端剪贴板'),
        iconComponent: options.icons.clipboard,
        action: options.toggleClipboardWindow
      });
    }

    return getFloatingMenuGroupItems(activeFloatingMenuPage.value);
  });

  const activeFloatingMenuItemCount = computed(() => activeFloatingMenuItems.value.length);

  return {
    activeFloatingMenuPage,
    activeFloatingMenuItems,
    activeFloatingMenuItemCount,
    openFloatingMenuPage,
    returnToFloatingMenuMain
  };
}
