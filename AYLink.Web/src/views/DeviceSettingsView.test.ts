import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DeviceSettingsView from './DeviceSettingsView.vue';

const {
  apiFetchMock,
  routeParams
} = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
  routeParams: { id: '1' } as Record<string, string>
}));

vi.mock('vue-router', () => ({
  useRoute: () => ({
    fullPath: '/device-settings/1',
    params: routeParams
  }),
  useRouter: () => ({
    back: vi.fn(),
    push: vi.fn()
  })
}));

vi.mock('../composables/useI18n', () => ({
  useI18n: () => ({
    t: (_key: string, fallback = '') => fallback
  })
}));

vi.mock('../utils/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
  readApiErrorMessage: vi.fn(async (_response: Response, fallback: string) => fallback)
}));

const jsonResponse = (payload: unknown) =>
  new Response(JSON.stringify(payload), {
    headers: {
      'Content-Type': 'application/json'
    }
  });

describe('DeviceSettingsView', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    routeParams.id = '1';
  });

  it('preserves an explicitly selected video encoder when saving settings', async () => {
    let savedBody: Record<string, unknown> = {};
    apiFetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
      if (url === '/api/devices') {
        return jsonResponse([{ Id: 1, Name: 'Pixel' }]);
      }
      if (url === '/api/devices/1/settings' && options?.method === 'PUT') {
        savedBody = JSON.parse(String(options.body));
        return jsonResponse(savedBody);
      }
      if (url === '/api/devices/1/settings') {
        return jsonResponse({
          VideoCodec: 'h265',
          VideoEncoder: 'OMX.qcom.video.encoder.avc'
        });
      }
      return new Response(null, { status: 404 });
    });

    const wrapper = mount(DeviceSettingsView);
    await flushPromises();

    const vm = wrapper.vm as unknown as {
      settings: Record<string, unknown>;
      saveSettings: () => Promise<void>;
    };
    expect(vm.settings.VideoEncoder).toBe('OMX.qcom.video.encoder.avc');

    await vm.saveSettings();

    expect(savedBody?.VideoEncoder).toBe('OMX.qcom.video.encoder.avc');
  });
});
