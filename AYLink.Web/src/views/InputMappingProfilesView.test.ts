import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import InputMappingProfilesView from './InputMappingProfilesView.vue';

const {
  routeQuery,
  routerBack,
  routerPush,
  storeList
} = vi.hoisted(() => ({
  routeQuery: {} as Record<string, string>,
  routerBack: vi.fn(),
  routerPush: vi.fn(),
  storeList: vi.fn(async () => [])
}));

vi.mock('vue-router', () => ({
  useRoute: () => ({
    query: routeQuery
  }),
  useRouter: () => ({
    back: routerBack,
    push: routerPush
  })
}));

vi.mock('../composables/useI18n', () => ({
  useI18n: () => ({
    t: (_key: string, fallback = '', ...args: Array<string | number>) =>
      args.reduce<string>((text, value, index) => text.replace(`{${index}}`, String(value)), fallback)
  })
}));

vi.mock('../services/notification', () => ({
  useNotification: () => ({
    show: vi.fn()
  })
}));

vi.mock('../features/inputMapping/inputMappingProfileStore', () => ({
  createLocalInputMappingProfileStore: () => ({
    list: storeList,
    get: vi.fn(),
    save: vi.fn(),
    remove: vi.fn(),
    import: vi.fn(),
    export: vi.fn()
  })
}));

vi.mock('../features/inputMapping/inputMappingTabState', () => ({
  getInputMappingTabState: vi.fn(() => ({
    activeProfileId: '',
    enabled: false
  })),
  setInputMappingTabState: vi.fn()
}));

describe('InputMappingProfilesView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(routeQuery).forEach((key) => delete routeQuery[key]);
  });

  const mountView = () => mount(InputMappingProfilesView, {
    global: {
      stubs: {
        ArrowDownload20Regular: true,
        CheckmarkCircle20Regular: true,
        Delete20Regular: true,
        Edit20Regular: true
      }
    }
  });

  it('returns to settings from settings management mode without using browser history', async () => {
    routeQuery.mode = 'manage';
    const wrapper = mountView();

    await wrapper.find('.input-mapping-back-btn').trigger('click');

    expect(routerBack).not.toHaveBeenCalled();
    expect(routerPush).toHaveBeenCalledWith({ name: 'settings' });
  });

  it('returns to screencast with mapping context instead of the previous app-management history entry', async () => {
    routeQuery.appPackage = 'com.example.game';
    routeQuery.inputMappingTabKey = 'device-a::cast';
    const wrapper = mountView();

    await wrapper.find('.input-mapping-back-btn').trigger('click');

    expect(routerBack).not.toHaveBeenCalled();
    expect(routerPush).toHaveBeenCalledWith({
      name: 'screencast',
      query: {
        appPackage: 'com.example.game',
        inputMappingTabKey: 'device-a::cast'
      }
    });
  });
});
