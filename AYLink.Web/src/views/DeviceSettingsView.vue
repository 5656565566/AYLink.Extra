<template>
  <div class="page-container">
    <div class="header">
      <div class="title-bar">
        <button class="transparent icon-btn back-btn" @click="goBack" :disabled="saving">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M10.5 3.5L6 8L10.5 12.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span class="back-text">{{ saving ? t('Settings.Saving', '保存中...') : t('Common.Back', '返回') }}</span>
        </button>
        <h2 class="title">{{ deviceName }}</h2>
      </div>
    </div>
    
    <div class="content-area">
      <div v-if="loading" class="empty-state">
        <div class="spinner"></div>
        <p>加载设置中...</p>
      </div>
      <div v-else class="settings-content">
        <SettingSection title="主要设置">
          <SettingItem
            title="启用视频"
            description="请求服务端发送视频流 关闭时不显示画面"
          >
            <div class="toggle-switch" :class="{ active: settings.Video }" @click="toggleSetting('Video')">
              <div class="toggle-knob"></div>
            </div>
            <span class="toggle-label">{{ settings.Video ? 'On' : 'Off' }}</span>
          </SettingItem>

          <SettingItem
            title="启用音频"
            description="请求服务端发送音频流 需要Android 11+ 关闭时不捕获音频"
          >
            <div class="toggle-switch" :class="{ active: settings.Audio }" @click="toggleSetting('Audio')">
              <div class="toggle-knob"></div>
            </div>
            <span class="toggle-label">{{ settings.Audio ? 'On' : 'Off' }}</span>
          </SettingItem>

          <SettingItem
            title="启用设备控制"
            description="请求服务端监听并处理控制事件（如点击、按键）关闭则为纯观看模式"
          >
            <div class="toggle-switch" :class="{ active: settings.Control }" @click="toggleSetting('Control')">
              <div class="toggle-knob"></div>
            </div>
            <span class="toggle-label">{{ settings.Control ? 'On' : 'Off' }}</span>
          </SettingItem>
        </SettingSection>

        <SettingSection title="流媒体质量">
          <SettingItem
            title="最大分辨率"
            description="最大分辨率，不影响屏幕比例，缩放最长的边"
          >
            <input type="number" class="fluent-input" v-model.number="settings.MaxSize" placeholder="例如: 1080" />
          </SettingItem>

          <SettingItem
            title="视频比特率"
            description="请求服务端使用的视频比特率 (单位: bps) 例如: 8000000 (8Mbps)"
          >
            <input type="number" class="fluent-input" v-model.number="settings.VideoBitRate" placeholder="例如: 8000000" />
          </SettingItem>

          <SettingItem
            title="最大帧率"
            description="请求服务端编码的最大帧率"
          >
            <input type="number" class="fluent-input" v-model.number="settings.MaxFps" placeholder="例如: 60" />
          </SettingItem>

          <SettingItem
            title="音频比特率"
            description="请求服务端使用的音频比特率 (单位: bps) 例如: 128000 (128kbps)"
          >
            <input type="number" class="fluent-input" v-model.number="settings.AudioBitRate" placeholder="例如: 128000" />
          </SettingItem>
        </SettingSection>

        <SettingSection title="输入源">
          <SettingItem
            title="视频源"
            description="请求视频源，'display'表示屏幕内容，'camera'表示摄像头"
          >
            <select class="fluent-select" v-model="settings.VideoSource">
              <option value="display">display</option>
              <option value="camera">camera</option>
            </select>
          </SettingItem>
          <SettingItem
            title="音频源"
            description="请求音频源，'output'表示设备内部播放的声音，'mic'表示麦克风"
          >
            <select class="fluent-select" v-model="settings.AudioSource">
              <option value="output">output</option>
              <option value="mic">mic</option>
            </select>
          </SettingItem>
        </SettingSection>
        
        <SettingSection title="电源与交互">
          <SettingItem
            title="保持设备唤醒"
            description="请求服务端持有一个Wakelock，防止设备在连接期间自动休眠"
          >
            <div class="toggle-switch" :class="{ active: settings.StayAwake }" @click="toggleSetting('StayAwake')">
              <div class="toggle-knob"></div>
            </div>
            <span class="toggle-label">{{ settings.StayAwake ? 'On' : 'Off' }}</span>
          </SettingItem>
          <SettingItem
            title="显示触摸操作"
            description="请求服务端开启“显示触摸操作”的开发者选项功能"
          >
            <div class="toggle-switch" :class="{ active: settings.ShowTouches }" @click="toggleSetting('ShowTouches')">
              <div class="toggle-knob"></div>
            </div>
            <span class="toggle-label">{{ settings.ShowTouches ? 'On' : 'Off' }}</span>
          </SettingItem>
          <SettingItem
            title="连接时点亮屏幕"
            description="启动时，请求服务端唤醒并点亮屏幕"
          >
            <div class="toggle-switch" :class="{ active: settings.PowerOn }" @click="toggleSetting('PowerOn')">
              <div class="toggle-knob"></div>
            </div>
            <span class="toggle-label">{{ settings.PowerOn ? 'On' : 'Off' }}</span>
          </SettingItem>
          <SettingItem
            title="断开时关闭屏幕"
            description="客户端断开连接时，请求服务端执行关闭屏幕操作"
          >
            <div class="toggle-switch" :class="{ active: settings.PowerOffOnClose }" @click="toggleSetting('PowerOffOnClose')">
              <div class="toggle-knob"></div>
            </div>
            <span class="toggle-label">{{ settings.PowerOffOnClose ? 'On' : 'Off' }}</span>
          </SettingItem>
          <SettingItem
            title="无操作自动息屏"
            description="设置一个延迟（毫秒），如果客户端在这段时间内没有交互，则关闭设备屏幕，-1表示禁用"
          >
            <input type="number" class="fluent-input" v-model.number="settings.ScreenOffTimeout" placeholder="例如: -1" />
          </SettingItem>
          <SettingItem
            title="键盘 HID 输入"
            description="使用虚拟 HID 键盘设备进行输入（需要 Android 12+）"
          >
            <div class="toggle-switch" :class="{ active: settings.HidKeyboard }" @click="toggleSetting('HidKeyboard')">
              <div class="toggle-knob"></div>
            </div>
            <span class="toggle-label">{{ settings.HidKeyboard ? 'On' : 'Off' }}</span>
          </SettingItem>
          <SettingItem
            title="鼠标 HID 输入"
            description="使用虚拟 HID 鼠标设备进行输入（需要 Android 12+）"
          >
            <div class="toggle-switch" :class="{ active: settings.HidMouse }" @click="toggleSetting('HidMouse')">
              <div class="toggle-knob"></div>
            </div>
            <span class="toggle-label">{{ settings.HidMouse ? 'On' : 'Off' }}</span>
          </SettingItem>
        </SettingSection>

        <SettingSection title="摄像头专属设置" description="当视频源为摄像头时生效">
          <SettingItem
            title="摄像头朝向"
            description="选择摄像头朝向"
          >
            <select class="fluent-select" v-model="settings.CameraFacing">
              <option value="front">front</option>
              <option value="back">back</option>
              <option value="external">external</option>
            </select>
          </SettingItem>
          <SettingItem
            title="摄像头ID"
            description="要使用的摄像头ID"
          >
            <input type="text" class="fluent-input" v-model="settings.CameraId" />
          </SettingItem>
          <SettingItem
            title="摄像头分辨率"
            description="期望的摄像头分辨率"
          >
            <input type="text" class="fluent-input" v-model="settings.CameraSize" />
          </SettingItem>
          <SettingItem
            title="摄像头帧率"
            description="期望的摄像头帧率"
          >
            <input type="text" class="fluent-input" v-model="settings.CameraFps" />
          </SettingItem>
          <SettingItem
            title="摄像头高速模式"
            description="是否启用摄像头高速模式"
          >
            <div class="toggle-switch" :class="{ active: settings.CameraHighSpeed }" @click="toggleSetting('CameraHighSpeed')">
              <div class="toggle-knob"></div>
            </div>
            <span class="toggle-label">{{ settings.CameraHighSpeed ? 'On' : 'Off' }}</span>
          </SettingItem>
        </SettingSection>

        <SettingSection title="高级设置">
          <SettingItem
            title="音频转发到扬声器"
            description="请求服务端在捕获音频的同时，也将其路由到设备扬声器播放"
          >
            <div class="toggle-switch" :class="{ active: settings.AudioDup }" @click="toggleSetting('AudioDup')">
              <div class="toggle-knob"></div>
            </div>
            <span class="toggle-label">{{ settings.AudioDup ? 'On' : 'Off' }}</span>
          </SettingItem>
          <SettingItem
            title="虚拟显示器关闭行为"
            description="销毁内容"
          >
            <div class="toggle-switch" :class="{ active: settings.VdDestroyContent }" @click="toggleSetting('VdDestroyContent')">
              <div class="toggle-knob"></div>
            </div>
            <span class="toggle-label">{{ settings.VdDestroyContent ? 'On' : 'Off' }}</span>
          </SettingItem>
          <SettingItem
            title="虚拟显示器启用系统主题"
            description="系统主题"
          >
            <div class="toggle-switch" :class="{ active: settings.VdSystemDecorations }" @click="toggleSetting('VdSystemDecorations')">
              <div class="toggle-knob"></div>
            </div>
            <span class="toggle-label">{{ settings.VdSystemDecorations ? 'On' : 'Off' }}</span>
          </SettingItem>
          <SettingItem
            title="新的显示器参数"
            description="创建显示器"
          >
            <input type="text" class="fluent-input" v-model="settings.NewDisplay" />
          </SettingItem>
          <SettingItem
            title="自适应显示器大小"
            description="调整窗口大小时，自动同步虚拟显示器尺寸"
          >
            <div class="toggle-switch" :class="{ active: settings.FlexDisplay }" @click="toggleSetting('FlexDisplay')">
              <div class="toggle-knob"></div>
            </div>
            <span class="toggle-label">{{ settings.FlexDisplay ? 'On' : 'Off' }}</span>
          </SettingItem>
          <SettingItem
            title="指定视频编码器"
            description="请求服务端使用的特定视频编码器名称"
          >
            <input type="text" class="fluent-input" v-model="settings.VideoEncoder" />
          </SettingItem>
          <SettingItem
            title="指定音频编码器"
            description="请求服务端使用的特定音频编码器名称"
          >
            <input type="text" class="fluent-input" v-model="settings.AudioEncoder" />
          </SettingItem>
          <SettingItem
            title="编码器高级选项"
            description="为音视频编码器设置高级键值对选项，格式: 'key:type=value,key2:type=value...'"
          >
            <input type="text" class="fluent-input" v-model="settings.CodecOptions" />
          </SettingItem>
        </SettingSection>

        <div class="actions-row">
          <button class="transparent" @click="resetToDefaults">
            恢复默认设置
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from '../composables/useI18n';
import { apiFetch } from '../utils/api';
import SettingSection from '../components/SettingSection.vue';
import SettingItem from '../components/SettingItem.vue';

const route = useRoute();
const router = useRouter();
const { t } = useI18n();

const deviceId = String(route.params.id || '');
const deviceName = ref('设备设置');
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

  if (!deviceId || loading.value || saving.value) {
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
  if (!deviceId) {
    applySettings();
    return;
  }

  saving.value = true;
  try {
    const res = await apiFetch(`/api/devices/${deviceId}/settings`, {
      method: 'DELETE'
    });

    if (!res.ok) {
      throw new Error(`Reset failed: ${res.status}`);
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
  loading.value = true;
  try {
    const res = await apiFetch('/api/devices');
    if (res.ok) {
      const devices = await res.json();
      const target = devices.find((d: any) => String(d.Id) === deviceId);
      if (target) {
        deviceName.value = target.Name || target.Serial || '设备设置';
      }
    }

    const settingsRes = await apiFetch(`/api/devices/${deviceId}/settings`);
    if (settingsRes.ok) {
      const payload = await settingsRes.json();
      applySettings(payload);
    }
  } catch (e) {
    console.error('Failed to load device info', e);
  } finally {
    loading.value = false;
  }
};

const saveSettings = async () => {
  saving.value = true;
  try {
    Object.assign(settings, normalizeSettingsPayload(settings));
    sanitizeVideoEncoder();
    const res = await apiFetch(`/api/devices/${deviceId}/settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(settings)
    });

    if (!res.ok) {
      throw new Error(`Save failed: ${res.status}`);
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

onMounted(() => {
  if (deviceId) {
    loadSettings();
  }
});

watch(() => settings.VideoCodec, () => {
  sanitizeVideoEncoder();
});
</script>

<style scoped>
.page-container {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.header {
  padding: 16px 24px;
  border-bottom: 1px solid var(--fluent-stroke-default);
}

.title-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}

.back-btn {
  position: absolute;
  left: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: 4px;
  transition: opacity 0.2s ease;
}

.back-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.back-text {
  font-size: 14px;
}

.title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--fluent-text-primary);
}

.content-area {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--fluent-text-secondary);
}

.spinner {
  width: 24px;
  height: 24px;
  border: 3px solid var(--fluent-control-fill-secondary);
  border-top-color: var(--fluent-accent-default);
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 12px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.settings-content {
  max-width: 800px;
  margin: 0 auto;
}

.toggle-switch {
  width: 40px;
  height: 20px;
  background-color: var(--fluent-control-fill-secondary);
  border: 1px solid var(--fluent-stroke-default);
  border-radius: 10px;
  position: relative;
  cursor: pointer;
  transition: all 0.2s ease;
}

.toggle-switch.active {
  background-color: var(--fluent-accent-default);
  border-color: var(--fluent-accent-default);
}

.toggle-knob {
  width: 12px;
  height: 12px;
  background-color: var(--fluent-text-secondary);
  border-radius: 50%;
  position: absolute;
  top: 3px;
  left: 4px;
  transition: all 0.2s ease;
}

.toggle-switch.active .toggle-knob {
  left: 22px;
  background-color: #fff;
}

.toggle-label {
  font-size: 14px;
  font-weight: 600;
  min-width: 24px;
}

.fluent-input,
.fluent-select {
  width: 180px;
  padding: 6px 12px;
  font-size: 14px;
  background-color: var(--fluent-control-fill-secondary);
  border: 1px solid var(--fluent-stroke-default);
  color: var(--fluent-text-primary);
  border-radius: 4px;
  transition: all 0.2s ease;
}

.fluent-input:focus,
.fluent-select:focus {
  outline: none;
  border-color: var(--fluent-accent-default);
  background-color: var(--fluent-control-fill-default);
}

.actions-row {
  display: flex;
  align-items: center;
  margin-top: 32px;
}
</style>
