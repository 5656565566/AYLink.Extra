import { computed, nextTick, ref, type Ref } from 'vue';

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
  debug: unknown;
}

export interface ScreencastFloatingActionOptions {
  isMenuExpanded: Ref<boolean>;
  backToMainIcon: unknown;
  ensureMenuInsideStage: () => void;
  modules: ScreencastFloatingActionModule[];
}

export interface ScreencastFloatingActionModuleContext {
  createBackToMainMenuItem: () => FloatingMenuActionItem;
}

export interface ScreencastFloatingActionModule {
  group?: FloatingMenuGroupItem;
  buildItems?: (context: ScreencastFloatingActionModuleContext) => FloatingMenuActionItem[];
  buildDirectItems?: () => FloatingMenuActionItem[];
}

export function useScreencastFloatingActions(options: ScreencastFloatingActionOptions) {
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

  const createBackToMainMenuItem = (): FloatingMenuActionItem => ({
    id: 'back-to-main',
    title: '返回主分组',
    iconComponent: options.backToMainIcon,
    action: returnToFloatingMenuMain
  });

  const actionContext: ScreencastFloatingActionModuleContext = {
    createBackToMainMenuItem
  };

  const getFloatingMenuGroupItems = (page: FloatingMenuPage): FloatingMenuActionItem[] => {
    const activeModule = options.modules.find((module) => module.group?.id === page);
    return activeModule?.buildItems?.(actionContext) ?? [];
  };

  const activeFloatingMenuItems = computed<FloatingMenuActionItem[]>(() => {
    if (activeFloatingMenuPage.value === 'main') {
      const mainGroupItems: FloatingMenuActionItem[] = options.modules.flatMap((module) => module.group ? [module.group] : []).map((group) => ({
        id: group.id,
        title: group.title,
        iconComponent: group.iconComponent,
        action: () => openFloatingMenuPage(group.id)
      }));
      const directItems = options.modules.flatMap((module) => module.buildDirectItems?.() ?? []);
      return mainGroupItems.concat(directItems);
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
