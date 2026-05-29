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

<script lang="ts" src="./DeviceSettingsView.ts"></script>

<style scoped src="./DeviceSettingsView.css"></style>
