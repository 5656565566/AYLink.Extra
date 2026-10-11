import { ref } from 'vue';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsView from './SettingsView.vue';
import { apiFetch } from '../utils/api';
import { loadLocalWebRtcFileTransferPreferred, loadLocalWebRtcOverrideEnabled, setLocalWebRtcFileTransferPreferred } from '../services/webrtcSettings';

enableAutoUnmount(afterEach);

const currentUser = ref({ Id: 1, Username: 'test' });
const { permissions } = vi.hoisted(() => ({ permissions: new Set<string>() }));
vi.mock('../services/auth', () => ({
  useAuth: () => ({ currentUser }),
  hasPermission: (permission: string) => permissions.has(permission),
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
  permissions.clear();
  vi.mocked(apiFetch).mockClear();
  vi.mocked(apiFetch).mockImplementation(async (url) => {
    if (url === '/api/device-groups') return new Response(JSON.stringify({ items: [{ Id: 1, Name: 'Group', Description: '', DeviceCount: 0, UserCount: 0, RoleCount: 0 }] }));
    if (url === '/api/accounts/users') return new Response(JSON.stringify({ users: [{ Id: 2, Username: 'user' }], roles: [{ Id: 3, Name: 'role' }] }));
    if (url === '/api/devices') return new Response(JSON.stringify([{ Id: 4, Name: 'Device' }]));
    return new Response('{"version":"1.0.0"}');
  });
  currentUser.value = { Id: 1, Username: 'test' };
});

describe('group management permissions', () => {
  it('does not show or load group management for a device-only administrator', async () => {
    permissions.add('devices.manage');
    permissions.add('devices.view');
    const wrapper = mount(SettingsView);
    await flushPromises();
    expect(wrapper.text()).not.toContain('分组管理');
    expect(vi.mocked(apiFetch).mock.calls.map(([url]) => url)).not.toContain('/api/device-groups');
  });

  it.each([
    ['accounts.manage'],
    ['accounts.manage', 'devices.manage'],
    ['accounts.manage', 'devices.view'],
    ['accounts.manage', 'devices.manage', 'devices.view'],
  ].map((granted) => ({ granted })))('loads only permitted data for $granted', async ({ granted }) => {
    granted.forEach((permission) => permissions.add(permission));
    const wrapper = mount(SettingsView);
    await flushPromises();
    const vm = wrapper.vm as unknown as {
      groupManagementError: string;
      groupManagementDevices: unknown[];
      groupManagementUsers: unknown[];
      groupManagementRoles: unknown[];
      refreshGroupManagementList: () => Promise<void>;
    };
    const requests = vi.mocked(apiFetch).mock.calls.map(([url]) => url);
    expect(requests).toContain('/api/device-groups');
    expect(requests).toContain('/api/accounts/users');
    const includeDevices = permissions.has('devices.manage') && permissions.has('devices.view');
    expect(requests.includes('/api/devices')).toBe(includeDevices);
    expect(vm.groupManagementDevices).toHaveLength(includeDevices ? 1 : 0);
    expect(vm.groupManagementUsers).toHaveLength(1);
    expect(vm.groupManagementRoles).toHaveLength(1);
    expect(vm.groupManagementError).toBe('');
    vi.mocked(apiFetch).mockClear();
    await vm.refreshGroupManagementList();
    expect(vi.mocked(apiFetch).mock.calls.map(([url]) => url)).toEqual(['/api/device-groups']);
    expect(vm.groupManagementUsers).toHaveLength(1);
    expect(vm.groupManagementRoles).toHaveLength(1);
  });
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
