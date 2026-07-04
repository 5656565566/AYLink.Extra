import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import {
  createDebugStatsFloatingActionModule,
  createDisplayFloatingActionModule,
  createFullWorkbenchFloatingActionModules
} from './screencastFloatingActionModules';
import { useScreencastFloatingActions, type ScreencastFloatingActionIcons, type ScreencastFloatingActionOptions } from './useScreencastFloatingActions';

const icons: ScreencastFloatingActionIcons = {
  arrowBack: 'arrowBack',
  back: 'back',
  home: 'home',
  menu: 'menu',
  recent: 'recent',
  fullscreen: 'fullscreen',
  fillDisplay: 'fillDisplay',
  volumeUp: 'volumeUp',
  volumeDown: 'volumeDown',
  mute: 'mute',
  power: 'power',
  phone: 'phone',
  inputMapping: 'inputMapping',
  clipboard: 'clipboard',
  save: 'save',
  edit: 'edit',
  dismiss: 'dismiss',
  eye: 'eye',
  eyeOff: 'eyeOff',
  pause: 'pause',
  play: 'play',
  closeMapping: 'closeMapping',
  debug: 'debug'
};

const t = (_key: string, fallback?: string) => fallback ?? '';

const createOptions = (overrides: Partial<ScreencastFloatingActionOptions> = {}): ScreencastFloatingActionOptions => ({
  isMenuExpanded: ref(true),
  backToMainIcon: icons.arrowBack,
  ensureMenuInsideStage: vi.fn(),
  modules: [],
  ...overrides
});

const createFullWorkbenchModules = () => createFullWorkbenchFloatingActionModules({
  t,
  icons,
  effectiveFillMode: ref(false),
  isInputMappingEditMode: ref(false),
  hasActiveInputMappingProfile: ref(true),
  isNewInputMappingProfileDraft: ref(false),
  isInputMappingHintsVisible: ref(false),
  isInputMappingEnabled: ref(true),
  isInputMappingPaused: ref(false),
  debugModeEnabled: ref(false),
  isVideoStatsOverlayVisible: ref(false),
  sendAndroidCommand: vi.fn(),
  toggleFillMode: vi.fn(),
  toggleFullscreen: vi.fn(),
  toggleClipboardWindow: vi.fn(),
  saveInputMappingProfileFromEditMenu: vi.fn(),
  openInputMappingProfileDialog: vi.fn(),
  exitInputMappingEditMode: vi.fn(),
  backToInputMappingProfiles: vi.fn(),
  enterInputMappingEditMode: vi.fn(),
  toggleInputMappingHintsWithNotification: vi.fn(),
  toggleInputMappingPausedWithNotification: vi.fn(),
  closeInputMappingWithNotification: vi.fn(),
  toggleVideoStatsOverlay: vi.fn()
});

describe('useScreencastFloatingActions', () => {
  it('keeps the full workbench menu composed from explicit modules', () => {
    const actions = useScreencastFloatingActions(createOptions({
      modules: createFullWorkbenchModules()
    }));

    expect(actions.activeFloatingMenuItems.value.map((item) => item.id)).toEqual([
      'navigation',
      'display',
      'volume',
      'power',
      'inputMapping',
      'remote-clipboard'
    ]);

    actions.openFloatingMenuPage('navigation');

    expect(actions.activeFloatingMenuItems.value.map((item) => item.id)).toEqual([
      'back-to-main',
      'back',
      'home',
      'menu',
      'recent'
    ]);
  });

  it('only exposes actions and dependencies from mounted modules', () => {
    const actions = useScreencastFloatingActions(createOptions({
      modules: [
        createDisplayFloatingActionModule({
          t,
          iconComponent: icons.fullscreen,
          icons,
          effectiveFillMode: ref(false),
          toggleFillMode: vi.fn(),
          toggleFullscreen: vi.fn()
        }),
        createDebugStatsFloatingActionModule({
          t,
          iconComponent: icons.debug,
          debugModeEnabled: ref(true),
          isVideoStatsOverlayVisible: ref(false),
          toggleVideoStatsOverlay: vi.fn()
        })
      ]
    }));

    expect(actions.activeFloatingMenuItems.value.map((item) => item.id)).toEqual([
      'display',
      'toggle-video-stats'
    ]);

    actions.openFloatingMenuPage('display');

    expect(actions.activeFloatingMenuItems.value.map((item) => item.id)).toEqual([
      'back-to-main',
      'fill-mode',
      'fullscreen'
    ]);
  });
});
