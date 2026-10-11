import { ref } from 'vue';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsView from './SettingsView.vue';
import { loadLocalWebRtcFileTransferPreferred, loadLocalWebRtcOverrideEnabled, setLocalWebRtcFileTransferPreferred } from '../services/webrtcSettings';

enableAutoUnmount(afterEach);

const currentUser = ref({ Id: 1, Username: 'test' });
vi.mock('../services/auth', () => ({
  useAuth: () => ({ currentUser }),
  hasPermission: () => false,
  logout: vi.fn(),
  logoutAll: vi.fn(),
}));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../composables/useI18n', () => ({
  useI18n: () => ({ t: (_key: string, fallback = '') => fallback, currentLocale: 'zh-CN', languages: [], setLocale: vi.fn() }),
}));
vi.mock('../utils/api', () => ({
  apiFetch: vi.fn(async () => new Response('{"version":"1.0.0"}')),
  readApiErrorMessage: vi.fn(),
  resolveApiErrorMessage: vi.fn(),
}));

beforeEach(() => {
  localStorage.clear();
  currentUser.value = { Id: 1, Username: 'test' };
});

describe('local WebRTC file transfer preference', () => {
  const selector = 'input[aria-label="文件上传下载优先使用 WebRTC"]';

  it('is enabled by default independently of the ICE override and saves changes immediately', async () => {
    const wrapper = mount(SettingsView);
    await flushPromises();
    expect(wrapper.get<HTMLInputElement>(selector).element.checked).toBe(true);
    expect(loadLocalWebRtcOverrideEnabled('1')).toBe(false);
    await wrapper.get(selector).setValue(false);
    expect(loadLocalWebRtcFileTransferPreferred('1')).toBe(false);
    expect(loadLocalWebRtcFileTransferPreferred('2')).toBe(true);
    wrapper.unmount();
    const reopened = mount(SettingsView);
    await flushPromises();
    expect(reopened.get<HTMLInputElement>(selector).element.checked).toBe(false);
  });

  it('restores the current account preference without changing another account', async () => {
    setLocalWebRtcFileTransferPreferred(false, '1');
    setLocalWebRtcFileTransferPreferred(false, '2');
    const wrapper = mount(SettingsView);
    await flushPromises();
    const vm = wrapper.vm as unknown as { resetLocalWebRtcSettings: () => void };
    vm.resetLocalWebRtcSettings();
    expect(loadLocalWebRtcFileTransferPreferred('1')).toBe(true);
    expect(loadLocalWebRtcFileTransferPreferred('2')).toBe(false);
  });
});
