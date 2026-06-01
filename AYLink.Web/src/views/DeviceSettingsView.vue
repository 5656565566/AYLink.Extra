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
        <p>{{ t('DeviceSettings.Loading', '加载设置中...') }}</p>
      </div>
      <div v-else class="settings-content">
        <SettingSection :title="t('DeviceSettings.Main', '主要设置')">
          <SettingItem
            :title="t('DeviceSettings.Video', '启用视频')"
            :description="t('DeviceSettings.VideoDescription', '请求服务端发送视频流，关闭时不显示画面')"
          >
            <div class="toggle-switch" :class="{ active: settings.Video }" @click="toggleSetting('Video')">
              <div class="toggle-knob"></div>
            </div>
            <span class="toggle-label">{{ settings.Video ? t('Common.On', 'On') : t('Common.Off', 'Off') }}</span>
          </SettingItem>

          <SettingItem
            :title="t('DeviceSettings.Audio', '启用音频')"
            :description="t('DeviceSettings.AudioDescription', '请求服务端发送音频流，需要 Android 11+，关闭时不捕获音频')"
          >
            <div class="toggle-switch" :class="{ active: settings.Audio }" @click="toggleSetting('Audio')">
              <div class="toggle-knob"></div>
            </div>
            <span class="toggle-label">{{ settings.Audio ? t('Common.On', 'On') : t('Common.Off', 'Off') }}</span>
          </SettingItem>

          <SettingItem
            :title="t('DeviceSettings.Control', '启用设备控制')"
            :description="t('DeviceSettings.ControlDescription', '请求服务端监听并处理控制事件（如点击、按键），关闭则为纯观看模式')"
          >
            <div class="toggle-switch" :class="{ active: settings.Control }" @click="toggleSetting('Control')">
              <div class="toggle-knob"></div>
            </div>
            <span class="toggle-label">{{ settings.Control ? t('Common.On', 'On') : t('Common.Off', 'Off') }}</span>
          </SettingItem>
        </SettingSection>

        <SettingSection :title="t('DeviceSettings.StreamQuality', '流媒体质量')">
          <SettingItem
            :title="t('DeviceSettings.MaxSize', '最大分辨率')"
            :description="t('DeviceSettings.MaxSizeDescription', '最大分辨率，不影响屏幕比例，缩放最长的边')"
          >
            <input type="number" class="fluent-input" v-model.number="settings.MaxSize" :placeholder="t('DeviceSettings.MaxSizePlaceholder', '例如: 1080')" />
          </SettingItem>

          <SettingItem
            :title="t('DeviceSettings.VideoBitRate', '视频比特率')"
            :description="t('DeviceSettings.VideoBitRateDescription', '请求服务端使用的视频比特率（单位: bps），例如: 8000000 (8Mbps)')"
          >
            <input type="number" class="fluent-input" v-model.number="settings.VideoBitRate" :placeholder="t('DeviceSettings.VideoBitRatePlaceholder', '例如: 8000000')" />
          </SettingItem>

          <SettingItem
            :title="t('DeviceSettings.MaxFps', '最大帧率')"
            :description="t('DeviceSettings.MaxFpsDescription', '请求服务端编码的最大帧率')"
          >
            <input type="number" class="fluent-input" v-model.number="settings.MaxFps" :placeholder="t('DeviceSettings.MaxFpsPlaceholder', '例如: 60')" />
          </SettingItem>

          <SettingItem
            :title="t('DeviceSettings.AudioBitRate', '音频比特率')"
            :description="t('DeviceSettings.AudioBitRateDescription', '请求服务端使用的音频比特率（单位: bps），例如: 128000 (128kbps)')"
          >
            <input type="number" class="fluent-input" v-model.number="settings.AudioBitRate" :placeholder="t('DeviceSettings.AudioBitRatePlaceholder', '例如: 128000')" />
          </SettingItem>
        </SettingSection>

        <SettingSection :title="t('DeviceSettings.InputSource', '输入源')">
          <SettingItem
            :title="t('DeviceSettings.VideoSource', '视频源')"
            :description="t('DeviceSettings.VideoSourceDescription', '请求视频源，display 表示屏幕内容，camera 表示摄像头')"
          >
            <select class="fluent-select" v-model="settings.VideoSource">
              <option value="display">{{ t('DeviceSettings.VideoSourceDisplay', 'display') }}</option>
              <option value="camera">{{ t('DeviceSettings.VideoSourceCamera', 'camera') }}</option>
            </select>
          </SettingItem>
          <SettingItem
            :title="t('DeviceSettings.AudioSource', '音频源')"
            :description="t('DeviceSettings.AudioSourceDescription', '请求音频源，output 表示设备内部播放的声音，mic 表示麦克风')"
          >
            <select class="fluent-select" v-model="settings.AudioSource">
              <option value="output">{{ t('DeviceSettings.AudioSourceOutput', 'output') }}</option>
              <option value="mic">{{ t('DeviceSettings.AudioSourceMic', 'mic') }}</option>
            </select>
          </SettingItem>
        </SettingSection>

        <SettingSection :title="t('DeviceSettings.PowerAndInteraction', '电源与交互')">
          <SettingItem
            :title="t('DeviceSettings.StayAwake', '保持设备唤醒')"
            :description="t('DeviceSettings.StayAwakeDescription', '请求服务端持有一个 Wakelock，防止设备在连接期间自动休眠')"
          >
            <div class="toggle-switch" :class="{ active: settings.StayAwake }" @click="toggleSetting('StayAwake')">
              <div class="toggle-knob"></div>
            </div>
            <span class="toggle-label">{{ settings.StayAwake ? t('Common.On', 'On') : t('Common.Off', 'Off') }}</span>
          </SettingItem>
          <SettingItem
            :title="t('DeviceSettings.ShowTouches', '显示触摸操作')"
            :description="t('DeviceSettings.ShowTouchesDescription', '请求服务端开启“显示触摸操作”的开发者选项功能')"
          >
            <div class="toggle-switch" :class="{ active: settings.ShowTouches }" @click="toggleSetting('ShowTouches')">
              <div class="toggle-knob"></div>
            </div>
            <span class="toggle-label">{{ settings.ShowTouches ? t('Common.On', 'On') : t('Common.Off', 'Off') }}</span>
          </SettingItem>
          <SettingItem
            :title="t('DeviceSettings.PowerOn', '连接时点亮屏幕')"
            :description="t('DeviceSettings.PowerOnDescription', '启动时，请求服务端唤醒并点亮屏幕')"
          >
            <div class="toggle-switch" :class="{ active: settings.PowerOn }" @click="toggleSetting('PowerOn')">
              <div class="toggle-knob"></div>
            </div>
            <span class="toggle-label">{{ settings.PowerOn ? t('Common.On', 'On') : t('Common.Off', 'Off') }}</span>
          </SettingItem>
          <SettingItem
            :title="t('DeviceSettings.PowerOffOnClose', '断开时关闭屏幕')"
            :description="t('DeviceSettings.PowerOffOnCloseDescription', '客户端断开连接时，请求服务端执行关闭屏幕操作')"
          >
            <div class="toggle-switch" :class="{ active: settings.PowerOffOnClose }" @click="toggleSetting('PowerOffOnClose')">
              <div class="toggle-knob"></div>
            </div>
            <span class="toggle-label">{{ settings.PowerOffOnClose ? t('Common.On', 'On') : t('Common.Off', 'Off') }}</span>
          </SettingItem>
          <SettingItem
            :title="t('DeviceSettings.ScreenOffTimeout', '无操作自动息屏')"
            :description="t('DeviceSettings.ScreenOffTimeoutDescription', '设置一个延迟（毫秒），如果客户端在这段时间内没有交互，则关闭设备屏幕，-1 表示禁用')"
          >
            <input type="number" class="fluent-input" v-model.number="settings.ScreenOffTimeout" :placeholder="t('DeviceSettings.ScreenOffTimeoutPlaceholder', '例如: -1')" />
          </SettingItem>
          <SettingItem
            :title="t('DeviceSettings.HidKeyboard', '键盘 HID 输入')"
            :description="t('DeviceSettings.HidKeyboardDescription', '使用虚拟 HID 键盘设备进行输入（需要 Android 12+）')"
          >
            <div class="toggle-switch" :class="{ active: settings.HidKeyboard }" @click="toggleSetting('HidKeyboard')">
              <div class="toggle-knob"></div>
            </div>
            <span class="toggle-label">{{ settings.HidKeyboard ? t('Common.On', 'On') : t('Common.Off', 'Off') }}</span>
          </SettingItem>
          <SettingItem
            :title="t('DeviceSettings.HidMouse', '鼠标 HID 输入')"
            :description="t('DeviceSettings.HidMouseDescription', '使用虚拟 HID 鼠标设备进行输入（需要 Android 12+），投屏页面按下 ALT 锁定鼠标')"
          >
            <div class="toggle-switch" :class="{ active: settings.HidMouse }" @click="toggleSetting('HidMouse')">
              <div class="toggle-knob"></div>
            </div>
            <span class="toggle-label">{{ settings.HidMouse ? t('Common.On', 'On') : t('Common.Off', 'Off') }}</span>
          </SettingItem>
        </SettingSection>

        <SettingSection :title="t('DeviceSettings.CameraSection', '摄像头专属设置')" :description="t('DeviceSettings.CameraSectionDescription', '当视频源为摄像头时生效')">
          <SettingItem
            :title="t('DeviceSettings.CameraFacing', '摄像头朝向')"
            :description="t('DeviceSettings.CameraFacingDescription', '选择摄像头朝向')"
          >
            <select class="fluent-select" v-model="settings.CameraFacing">
              <option value="front">{{ t('DeviceSettings.CameraFacingFront', 'front') }}</option>
              <option value="back">{{ t('DeviceSettings.CameraFacingBack', 'back') }}</option>
              <option value="external">{{ t('DeviceSettings.CameraFacingExternal', 'external') }}</option>
            </select>
          </SettingItem>
          <SettingItem
            :title="t('DeviceSettings.CameraId', '摄像头ID')"
            :description="t('DeviceSettings.CameraIdDescription', '要使用的摄像头 ID')"
          >
            <input type="text" class="fluent-input" v-model="settings.CameraId" />
          </SettingItem>
          <SettingItem
            :title="t('DeviceSettings.CameraSize', '摄像头分辨率')"
            :description="t('DeviceSettings.CameraSizeDescription', '期望的摄像头分辨率')"
          >
            <input type="text" class="fluent-input" v-model="settings.CameraSize" />
          </SettingItem>
          <SettingItem
            :title="t('DeviceSettings.CameraFps', '摄像头帧率')"
            :description="t('DeviceSettings.CameraFpsDescription', '期望的摄像头帧率')"
          >
            <input type="text" class="fluent-input" v-model="settings.CameraFps" />
          </SettingItem>
          <SettingItem
            :title="t('DeviceSettings.CameraHighSpeed', '摄像头高速模式')"
            :description="t('DeviceSettings.CameraHighSpeedDescription', '是否启用摄像头高速模式')"
          >
            <div class="toggle-switch" :class="{ active: settings.CameraHighSpeed }" @click="toggleSetting('CameraHighSpeed')">
              <div class="toggle-knob"></div>
            </div>
            <span class="toggle-label">{{ settings.CameraHighSpeed ? t('Common.On', 'On') : t('Common.Off', 'Off') }}</span>
          </SettingItem>
        </SettingSection>

        <SettingSection :title="t('DeviceSettings.Advanced', '高级设置')">
          <SettingItem
            :title="t('DeviceSettings.AudioDup', '音频转发到扬声器')"
            :description="t('DeviceSettings.AudioDupDescription', '请求服务端在捕获音频的同时，也将其路由到设备扬声器播放')"
          >
            <div class="toggle-switch" :class="{ active: settings.AudioDup }" @click="toggleSetting('AudioDup')">
              <div class="toggle-knob"></div>
            </div>
            <span class="toggle-label">{{ settings.AudioDup ? t('Common.On', 'On') : t('Common.Off', 'Off') }}</span>
          </SettingItem>
          <SettingItem
            :title="t('DeviceSettings.VdDestroyContent', '虚拟显示器关闭行为')"
            :description="t('DeviceSettings.VdDestroyContentDescription', '销毁内容')"
          >
            <div class="toggle-switch" :class="{ active: settings.VdDestroyContent }" @click="toggleSetting('VdDestroyContent')">
              <div class="toggle-knob"></div>
            </div>
            <span class="toggle-label">{{ settings.VdDestroyContent ? t('Common.On', 'On') : t('Common.Off', 'Off') }}</span>
          </SettingItem>
          <SettingItem
            :title="t('DeviceSettings.VdSystemDecorations', '虚拟显示器启用系统主题')"
            :description="t('DeviceSettings.VdSystemDecorationsDescription', '系统主题')"
          >
            <div class="toggle-switch" :class="{ active: settings.VdSystemDecorations }" @click="toggleSetting('VdSystemDecorations')">
              <div class="toggle-knob"></div>
            </div>
            <span class="toggle-label">{{ settings.VdSystemDecorations ? t('Common.On', 'On') : t('Common.Off', 'Off') }}</span>
          </SettingItem>
          <SettingItem
            :title="t('DeviceSettings.NewDisplay', '新的显示器参数')"
            :description="t('DeviceSettings.NewDisplayDescription', '创建显示器')"
          >
            <input type="text" class="fluent-input" v-model="settings.NewDisplay" />
          </SettingItem>
          <SettingItem
            :title="t('DeviceSettings.FlexDisplay', '自适应显示器大小')"
            :description="t('DeviceSettings.FlexDisplayDescription', '调整窗口大小时，自动同步虚拟显示器尺寸')"
          >
            <div class="toggle-switch" :class="{ active: settings.FlexDisplay }" @click="toggleSetting('FlexDisplay')">
              <div class="toggle-knob"></div>
            </div>
            <span class="toggle-label">{{ settings.FlexDisplay ? t('Common.On', 'On') : t('Common.Off', 'Off') }}</span>
          </SettingItem>
          <SettingItem
            :title="t('DeviceSettings.VideoEncoder', '指定视频编码器')"
            :description="t('DeviceSettings.VideoEncoderDescription', '请求服务端使用的特定视频编码器名称')"
          >
            <input type="text" class="fluent-input" v-model="settings.VideoEncoder" />
          </SettingItem>
          <SettingItem
            :title="t('DeviceSettings.AudioEncoder', '指定音频编码器')"
            :description="t('DeviceSettings.AudioEncoderDescription', '请求服务端使用的特定音频编码器名称')"
          >
            <input type="text" class="fluent-input" v-model="settings.AudioEncoder" />
          </SettingItem>
          <SettingItem
            :title="t('DeviceSettings.CodecOptions', '编码器高级选项')"
            :description="t('DeviceSettings.CodecOptionsDescription', '为音视频编码器设置高级键值对选项，格式: key:type=value,key2:type=value...')"
          >
            <input type="text" class="fluent-input" v-model="settings.CodecOptions" />
          </SettingItem>
        </SettingSection>

        <div class="actions-row">
          <button class="transparent" @click="resetToDefaults">
            {{ t('Settings.RestoreDefaults', '恢复默认设置') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" src="./DeviceSettingsView.ts"></script>

<style scoped src="./DeviceSettingsView.css"></style>
