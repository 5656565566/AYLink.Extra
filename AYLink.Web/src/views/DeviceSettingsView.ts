import { defineComponent } from 'vue';
import { ref, reactive, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from '../composables/useI18n';
import { apiFetch, readApiErrorMessage } from '../utils/api';
import SettingSection from '../components/SettingSection.vue';
import SettingItem from '../components/SettingItem.vue';

export default defineComponent({
  name: 'DeviceSettingsView',
  components: {
    SettingSection,
    SettingItem
  },
  setup() {
    const route = useRoute();

    const router = useRouter();

    const { t } = useI18n();

    const deviceId = computed(() => String(route.params.id || '').trim());

    const deviceName = ref(t('DeviceSettings.Title', '设备设置'));

    const loading = ref(true);

    const saving = ref(false);

    const leaving = ref(false);

    const createDefaultSettings = () => ({    
      Video: true,    
      Audio: true,    
      Control: true,    
      VideoCodec: 'h264',    
      MaxSize: null as number | null,    
      VideoBitRate: null as number | null,    
      MaxFps: null as number | null,    
      AudioCodec: 'opus',    
      AudioBitRate: null as number | null,    
      VideoSource: 'display',    
      AudioSource: 'output',    
      StayAwake: false,    
      ShowTouches: false,    
      PowerOn: true,    
      PowerOffOnClose: false,    
      ScreenOffTimeout: -1,    
      HidKeyboard: false,    
      HidMouse: false,    
      CameraFacing: 'front',    
      CameraId: '',    
      CameraSize: '',    
      CameraFps: '',    
      CameraHighSpeed: false,    
      AudioDup: false,    
      VdDestroyContent: true,    
      VdSystemDecorations: true,    
      NewDisplay: '',    
      FlexDisplay: false,    
      VideoEncoder: '',    
      AudioEncoder: '',    
      CodecOptions: ''    
    });

    const settings = reactive(createDefaultSettings());

    let initialSettingsString = '';

    const normalizeNullableInteger = (value: unknown): number | null => {    
      if (value == null || value === '') {    
        return null;    
      }    
        
      const parsed = Number.parseInt(String(value), 10);    
      return Number.isFinite(parsed) ? parsed : null;    
    };

    const normalizeNullableFloat = (value: unknown): number | null => {    
      if (value == null || value === '') {    
        return null;    
      }    
        
      const parsed = Number.parseFloat(String(value));    
      return Number.isFinite(parsed) ? parsed : null;    
    };

    const normalizeOptionalText = (value: unknown) => String(value ?? '').trim();

    const normalizeScreenOffTimeout = (value: unknown): number => {    
      const normalized = normalizeNullableInteger(value);    
      return normalized == null ? -1 : normalized;    
    };

    const normalizeSettingsPayload = (payload?: Partial<typeof settings> | null) => {    
      const normalized = {    
        ...createDefaultSettings(),    
        ...(payload || {})    
      };    
        
      normalized.MaxSize = normalizeNullableInteger(normalized.MaxSize);    
      normalized.VideoBitRate = normalizeNullableInteger(normalized.VideoBitRate);    
      normalized.MaxFps = normalizeNullableFloat(normalized.MaxFps);    
      normalized.AudioBitRate = normalizeNullableInteger(normalized.AudioBitRate);    
      normalized.ScreenOffTimeout = normalizeScreenOffTimeout(normalized.ScreenOffTimeout);    
      normalized.CameraId = normalizeOptionalText(normalized.CameraId);    
      normalized.CameraSize = normalizeOptionalText(normalized.CameraSize);    
      normalized.CameraFps = normalizeOptionalText(normalized.CameraFps);    
      normalized.NewDisplay = normalizeOptionalText(normalized.NewDisplay);    
      normalized.VideoEncoder = normalizeOptionalText(normalized.VideoEncoder);    
      normalized.AudioEncoder = normalizeOptionalText(normalized.AudioEncoder);    
      normalized.CodecOptions = normalizeOptionalText(normalized.CodecOptions);    
        
      return normalized;    
    };

    const normalizeVideoCodec = (codec: string) => {    
      const value = String(codec || '').trim().toLowerCase();    
      if (value === 'h265' || value === 'hevc') return 'h265';    
      if (value === 'h264' || value === 'avc') return 'h264';    
      if (value === 'av1') return 'av1';    
      return '';    
    };

    const detectVideoEncoderCodec = (encoder: string) => {    
      const value = String(encoder || '').trim().toLowerCase();    
      if (!value) return '';    
      if (value.includes('hevc') || value.includes('h265')) return 'h265';    
      if (value.includes('avc') || value.includes('h264')) return 'h264';    
      if (value.includes('av1')) return 'av1';    
      return '';    
    };

    const sanitizeVideoEncoder = () => {    
      const codec = normalizeVideoCodec(settings.VideoCodec) || 'h264';    
      const encoderCodec = detectVideoEncoderCodec(settings.VideoEncoder);    
      if (encoderCodec && encoderCodec !== codec) {    
        settings.VideoEncoder = '';    
      }    
    };

    const navigateAway = async () => {    
      const fallbackRoute = { name: 'home' as const };    
      const currentFullPath = route.fullPath;    
        
      if (window.history.length > 1) {    
        router.back();    
        await new Promise((resolve) => window.setTimeout(resolve, 0));    
        if (route.fullPath !== currentFullPath) {    
          return;    
        }    
      }    
        
      await router.push(fallbackRoute);    
    };

    const goBack = async () => {    
      if (leaving.value) {    
        return;    
      }    
        
      if (!deviceId.value || loading.value || saving.value) {    
        leaving.value = true;    
        try {    
          await navigateAway();    
        } finally {    
          leaving.value = false;    
        }    
        return;    
      }    
        
      leaving.value = true;    
      try {    
        const currentSettingsString = JSON.stringify(settings);    
        if (currentSettingsString !== initialSettingsString) {    
          await saveSettings();    
        }    
        await navigateAway();    
      } catch {    
        // 保存失败时保留在当前页面 允许用户重试    
      } finally {    
        leaving.value = false;    
      }    
    };

    const toggleSetting = (key: keyof typeof settings) => {    
      if (typeof settings[key] === 'boolean') {    
        (settings as any)[key] = !settings[key];    
      }    
    };

    const applySettings = (payload?: Partial<typeof settings> | null) => {    
      Object.assign(settings, normalizeSettingsPayload(payload));    
      sanitizeVideoEncoder();    
      initialSettingsString = JSON.stringify(settings);    
    };

    const resetToDefaults = async () => {    
      if (!deviceId.value) {    
        applySettings();    
        return;    
      }    
        
      saving.value = true;    
      try {    
        const res = await apiFetch(`/api/devices/${deviceId.value}/settings`, {    
          method: 'DELETE'    
        });    
        
        if (!res.ok) {    
          throw new Error(await readApiErrorMessage(res, t('DeviceSettings.ResetFailed', '重置失败')));
        }    
        
        const payload = await res.json();    
        applySettings(payload);    
      } catch (e) {    
        console.error('Failed to reset settings', e);    
      } finally {    
        saving.value = false;    
      }    
    };

    const loadSettings = async () => {    
      if (!deviceId.value) {    
        deviceName.value = t('DeviceSettings.Title', '设备设置');
        applySettings();    
        loading.value = false;    
        return;    
      }    
        
      const currentDeviceId = deviceId.value;    
      loading.value = true;    
      deviceName.value = t('DeviceSettings.Title', '设备设置');
      applySettings();    
      try {    
        const res = await apiFetch('/api/devices');    
        if (res.ok) {    
          const devices = await res.json();    
          const target = devices.find((d: any) => String(d.Id) === currentDeviceId);    
          if (target) {    
            deviceName.value = target.Name || target.Serial || t('DeviceSettings.Title', '设备设置');
          }    
        }    
        
        const settingsRes = await apiFetch(`/api/devices/${currentDeviceId}/settings`);    
        if (settingsRes.ok) {    
          const payload = await settingsRes.json();    
          if (deviceId.value === currentDeviceId) {    
            applySettings(payload);    
          }    
        }    
      } catch (e) {    
        console.error('Failed to load device info', e);    
      } finally {    
        if (deviceId.value === currentDeviceId) {    
          loading.value = false;    
        }    
      }    
    };

    const saveSettings = async () => {    
      if (!deviceId.value) {    
        return;    
      }    
        
      saving.value = true;    
      try {    
        Object.assign(settings, normalizeSettingsPayload(settings));    
        sanitizeVideoEncoder();    
        const res = await apiFetch(`/api/devices/${deviceId.value}/settings`, {    
          method: 'PUT',    
          headers: {    
            'Content-Type': 'application/json'    
          },    
          body: JSON.stringify(settings)    
        });    
        
        if (!res.ok) {    
          throw new Error(await readApiErrorMessage(res, t('Common.SaveFailed', '保存失败')));
        }    
        
        const payload = await res.json();    
        applySettings(payload); // 更新初始状态快照    
      } catch (e) {    
        console.error('Failed to save settings', e);    
        throw e;    
      } finally {    
        saving.value = false;    
      }    
    };

    watch(deviceId, () => {    
      void loadSettings();    
    }, { immediate: true });

    watch(() => settings.VideoCodec, () => {    
      sanitizeVideoEncoder();    
    });

    return {
      route,
      router,
      t,
      deviceId,
      deviceName,
      loading,
      saving,
      leaving,
      createDefaultSettings,
      settings,
      initialSettingsString,
      normalizeNullableInteger,
      normalizeNullableFloat,
      normalizeOptionalText,
      normalizeScreenOffTimeout,
      normalizeSettingsPayload,
      normalizeVideoCodec,
      detectVideoEncoderCodec,
      sanitizeVideoEncoder,
      navigateAway,
      goBack,
      toggleSetting,
      applySettings,
      resetToDefaults,
      loadSettings,
      saveSettings
    };
  }
});
