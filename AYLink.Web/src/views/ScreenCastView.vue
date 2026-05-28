<template>
  <div class="screen-page" ref="shellElement">
    <WorkspaceTabs
      :tabs="castTabItems"
      :active-key="activeTabKey"
      @select="activateTab"
      @close="closeTab">
      <template #icon>
        <svg class="workspace-tab__icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4.5 3.5L12.5 8L4.5 12.5V3.5Z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </template>
    </WorkspaceTabs>

    <div class="stream-stage" ref="videoContainer">

    <div v-if="!hasCastTabs" class="empty-state">
      <svg class="empty-state__icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M7 5.5L18 12L7 18.5V5.5Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <div class="empty-state__title">{{ t('Screencast.NoDeviceSelected', '未选中设备') }}</div>
      <div class="empty-state__desc">{{ t('Screencast.SelectDevicePrompt', '请在首页选择一个设备来启动投屏') }}</div>
    </div>
      <img
        v-if="shouldShowLastFrameOverlay && lastFrameOverlayUrl"
        class="last-frame-overlay"
        :class="{ 'fill-mode': effectiveFillMode }"
        :src="lastFrameOverlayUrl"
        alt=""
      />
      <video
        ref="videoElement"
        autoplay
        playsinline
        :class="{ 'fill-mode': effectiveFillMode }"
        @pointerdown="handlePointerDown"
        @pointerup="handlePointerUp"
        @pointermove="handlePointerMove"
        @pointercancel="handlePointerCancel"
        @lostpointercapture="handlePointerCaptureLost"
        @mousedown="handleMouseDown"
        @contextmenu.prevent
      ></video>
      <audio ref="audioElement" autoplay playsinline style="display: none"></audio>
    </div>

    <div
      v-if="hasCastTabs"
      class="floating-menu"
      :class="[
        `dock-${dockedEdge}`,
        {
          expanded: isMenuExpanded,
          'is-docked': isDocked,
          'layout-horizontal': isHorizontalLayout,
          'layout-vertical': !isHorizontalLayout
        }
      ]"
      :style="menuStyle"
      @pointerenter="handleMenuPointerEnter"
      @pointerleave="handleMenuPointerLeave"
    >
      <button type="button" class="menu-toggle" @pointerdown.stop="startMenuDrag" @click.stop="toggleMenu">
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M5 7H19M5 12H19M5 17H19" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
        </svg>
      </button>

      <div class="status-indicator">
        <div class="dot" :class="statusDotClass"></div>
      </div>

      <div v-if="isMenuExpanded" class="menu-items">
        <button type="button" class="menu-item" title="返回" @click="sendAndroidCommand('back')">
          <ChevronLeft20Regular />
        </button>
        <button type="button" class="menu-item" title="主页" @click="sendAndroidCommand('home')">
          <Home20Regular />
        </button>
        <button type="button" class="menu-item" title="菜单" @click="sendAndroidCommand('menu')">
          <List20Regular />
        </button>
        <button type="button" class="menu-item" title="最近任务" @click="sendAndroidCommand('recent')">
          <AppRecent20Regular />
        </button>
        <button type="button" class="menu-item" title="电源" @click="sendAndroidCommand('power')">
          <Power20Regular />
        </button>
        <button type="button" class="menu-item" :title="effectiveFillMode ? '适应显示' : '拉伸填充'" @click="toggleFillMode">
          <ArrowExpand24Regular />
        </button>
        <button type="button" class="menu-item" title="全屏" @click="toggleFullscreen">
          <FullScreenMaximize20Regular />
        </button>
        <button type="button" class="menu-item" title="恢复音频播放" @click="resumeMediaPlayback">
          <Play20Regular />
        </button>
        <button type="button" class="menu-item" title="音量加" @click="sendAndroidCommand('volumeup')">
          <Speaker220Regular />
        </button>
        <button type="button" class="menu-item" title="音量减" @click="sendAndroidCommand('volumedown')">
          <Speaker020Regular />
        </button>
        <button type="button" class="menu-item" title="静音" @click="sendAndroidCommand('mute')">
          <SpeakerMute20Regular />
        </button>
        <button type="button" class="menu-item" title="亮屏" @click="sendAndroidCommand('screenon')">
          <Phone20Regular />
        </button>
        <button type="button" class="menu-item menu-item--danger" title="熄屏" @click="sendAndroidCommand('screenoff')">
          <Phone20Regular />
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  ChevronLeft20Regular,
  Home20Regular,
  List20Regular,
  AppRecent20Regular,
  Power20Regular,
  FullScreenMaximize20Regular,
  Speaker020Regular,
  SpeakerMute20Regular,
  Speaker220Regular,
  Play20Regular,
  ArrowExpand24Regular,
  Phone20Regular
} from '@vicons/fluent';

import { computed, nextTick, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from '../composables/useI18n';
import { useAppSettings } from '../services/appSettings';
import { getAccessToken, useAuth } from '../services/auth';
import { loadLocalWebRtcOverrideConfig, loadLocalWebRtcOverrideEnabled } from '../services/webrtcSettings';
import { apiFetch } from '../utils/api';
import WorkspaceTabs from '../components/WorkspaceTabs.vue';
import { consumeWorkspaceOpen, type WorkspaceOpenRequest } from '../services/workspaceNavigation';

type DockedEdge = 'left' | 'right' | 'none';
interface CastTab {
  key: string;
  deviceId: string;
  appPackageName: string;
  appDisplayName: string;
  deviceName: string;
  newDisplay: boolean;
}

interface WebRtcNetworkSettingsPayload {
  IceTransportPolicy?: string;
  IceServers?: Array<{
    Urls?: string[];
    Username?: string | null;
    Credential?: string | null;
  }>;
}

interface PendingPointerControlPayload {
  payload: Uint8Array;
  onSent?: () => void;
}

const CAST_TABS_STORAGE_KEY = 'aylink_cast_tabs';
const CAST_ACTIVE_TAB_STORAGE_KEY = 'aylink_cast_active_tab';
const POINTER_MOVE_BUFFER_LIMIT = 64 * 1024;
const CONTROL_CHANNEL_BUFFER_LIMIT = 256 * 1024;
const MOUSE_COMPAT_SUPPRESSION_MS = 900;
const POINTER_MOVE_SAMPLE_INTERVAL_MS = 1000 / 120;
const SIGNALING_DETACH_DELAY_MS = 3000;
const VIDEO_RECOVERY_TIMEOUT_MS = 8000;
const VIDEO_FREEZE_THRESHOLD_MS = 2500;
const VIDEO_FREEZE_WATCHDOG_INTERVAL_MS = 1000;
const VIDEO_FREEZE_REFRESH_DEBOUNCE_MS = 4000;
const VIDEO_FREEZE_ESCALATION_MS = 7000;
const DEFAULT_AUTO_NEW_DISPLAY_DPI = 160;
const MIN_NEW_DISPLAY_DPI = 72;
const MAX_NEW_DISPLAY_DPI = 960;
const MIN_NEW_DISPLAY_DIMENSION = 240;
const MAX_NEW_DISPLAY_LONG_EDGE = 1920;
const MENU_MARGIN = 20;
const MENU_BUTTON_SIZE = 48;
const MENU_ITEM_COUNT = 13;
const MENU_ITEM_SIZE = 38;
const MENU_ITEM_GAP = 6;
const MENU_EXPANDED_LENGTH = MENU_BUTTON_SIZE + 6 + (MENU_ITEM_COUNT * MENU_ITEM_SIZE) + ((MENU_ITEM_COUNT - 1) * MENU_ITEM_GAP) + 12;
const SCRCPY_PRIMARY_BUTTON = 1;
const SCRCPY_MSG_INJECT_KEYCODE = 0;
const SCRCPY_MSG_INJECT_TOUCH_EVENT = 2;
const SCRCPY_MSG_SET_SCREEN_POWER_MODE = 10;
const SCRCPY_MSG_UHID_CREATE = 12;
const SCRCPY_MSG_UHID_INPUT = 13;
const SCRCPY_MSG_UHID_DESTROY = 14;
const SCRCPY_MSG_RESIZE_DISPLAY = 21;
const LOCAL_META_CONTROL_PREFIX = 0xff;
const LOCAL_META_MSG_VIDEO_REFRESH = 0x01;
const SCRCPY_ACTION_DOWN = 0;
const SCRCPY_ACTION_UP = 1;
const SCRCPY_ACTION_MOVE = 2;
const SCRCPY_HID_MOUSE_ID = 1;
const SCRCPY_HID_KEYBOARD_ID = 2;
const ANDROID_KEYCODE_BACK = 4;
const ANDROID_KEYCODE_HOME = 3;
const ANDROID_KEYCODE_MENU = 82;
const ANDROID_KEYCODE_RECENT = 187;
const ANDROID_KEYCODE_POWER = 26;
const ANDROID_KEYCODE_VOLUME_UP = 24;
const ANDROID_KEYCODE_VOLUME_DOWN = 25;
const ANDROID_KEYCODE_MUTE = 164;
const RELATIVE_MOUSE_REPORT_DESC = new Uint8Array([
  0x05, 0x01, 0x09, 0x02, 0xA1, 0x01, 0x09, 0x01, 0xA1, 0x00,
  0x05, 0x09, 0x19, 0x01, 0x29, 0x05, 0x15, 0x00, 0x25, 0x01,
  0x95, 0x05, 0x75, 0x01, 0x81, 0x02, 0x95, 0x01, 0x75, 0x03,
  0x81, 0x01, 0x05, 0x01, 0x09, 0x30, 0x09, 0x31, 0x09, 0x38,
  0x15, 0x81, 0x25, 0x7F, 0x75, 0x08, 0x95, 0x03, 0x81, 0x06,
  0x05, 0x0C, 0x0A, 0x38, 0x02, 0x15, 0x81, 0x25, 0x7F, 0x75,
  0x08, 0x95, 0x01, 0x81, 0x06, 0xC0, 0xC0
]);
const KEYBOARD_REPORT_DESC = new Uint8Array([
  0x05, 0x01, 0x09, 0x06, 0xA1, 0x01, 0x05, 0x07, 0x19, 0xE0,
  0x29, 0xE7, 0x15, 0x00, 0x25, 0x01, 0x75, 0x01, 0x95, 0x08,
  0x81, 0x02, 0x95, 0x01, 0x75, 0x08, 0x81, 0x01, 0x95, 0x05,
  0x75, 0x01, 0x05, 0x08, 0x19, 0x01, 0x29, 0x05, 0x91, 0x02,
  0x95, 0x01, 0x75, 0x03, 0x91, 0x01, 0x95, 0x06, 0x75, 0x08,
  0x15, 0x00, 0x25, 0x65, 0x05, 0x07, 0x19, 0x00, 0x29, 0x65,
  0x81, 0x00, 0xC0
]);

const { t } = useI18n();
const { backgroundMute, newDisplayDpiMode, newDisplayDpiValue } = useAppSettings();
const auth = useAuth();
const route = useRoute();
const router = useRouter();
const localWebRtcScope = computed(() => String(auth.currentUser.value?.Id ?? 'anonymous'));
const shellElement = ref<HTMLDivElement | null>(null);
const castTabs = ref<CastTab[]>([]);
const activeTabKey = ref('');
const deviceId = ref('');
const appPackageName = ref('');
const appDisplayName = ref('');
const selectedDeviceName = ref('设备投屏');
const isNewDisplayMode = ref(false);
const isFlexDisplayEnabled = ref(false);
const isHidKeyboardEnabled = ref(false);
const isHidMouseEnabled = ref(false);
const isMouseLocked = ref(false);
const videoElement = ref<HTMLVideoElement | null>(null);
const audioElement = ref<HTMLAudioElement | null>(null);
const videoContainer = ref<HTMLDivElement | null>(null);
const isConnected = ref(false);
const isConnecting = ref(false);
const status = ref('未连接');
const lastFrameOverlayUrl = ref('');
const shouldShowLastFrameOverlay = ref(false);
const shouldFillVideoFrame = ref(false);
const effectiveFillMode = computed(() => shouldFillVideoFrame.value);
const isMenuExpanded = ref(true);
const isDocked = ref(true);
const dockedEdge = ref<DockedEdge>('right');
const isMenuHorizontalLocked = ref(false);
const menuX = ref(0);
const menuY = ref(0);
const menuRelativeX = ref(1);
const menuRelativeY = ref(0.5);
let remoteVideoStream = new MediaStream();
let remoteAudioStream = new MediaStream();
const remoteTracks = new Map<'audio' | 'video', MediaStreamTrack>();
const activePointers = new Set<number>();
const pointerGenerations = new Map<number, number>();
const pointerSnapshots = new Map<number, { xRatio: number; yRatio: number; pointerType: string }>();
const pendingPointerReleases = new Map<number, 'up' | 'cancel'>();
const queuedPointerReleases = new Set<number>();
const pendingPointerMoves = new Map<number, PendingPointerMove>();
const pendingPointerControlPayloads: PendingPointerControlPayload[] = [];

let peerConnection: RTCPeerConnection | null = null;
let ws: WebSocket | null = null;
let dataChannel: RTCDataChannel | null = null;
let metaControlChannel: RTCDataChannel | null = null;
let pointerMoveChannel: RTCDataChannel | null = null;
let activeMousePointerId: number | null = null;
let lastVideoFrameSize = { width: 0, height: 0 };
let pendingReconnectTimer: number | null = null;
let pendingStartConnectionTimer: number | null = null;
let scrcpySessionHeartbeatTimer: number | null = null;
let pendingResumePlaybackTimer: number | null = null;
let pendingDisplayResizeTimer: number | null = null;
let flexDisplayHeartbeatTimer: number | null = null;
let pendingPersistTabsTimer: number | null = null;
let pendingVideoRecoveryTimer: number | null = null;
let pendingSignalingDetachTimer: number | null = null;
let pendingIceRestartFallbackTimer: number | null = null;
let pendingCandidates: RTCIceCandidateInit[] = [];
let activeConnectionId = 0;
let hasHandledInitialActivation = false;
let hasUsedInitialConnectionWarmup = false;
let videoFrameCallbackHandle: number | null = null;
let videoFreezeWatchdogTimer: number | null = null;
let lastDisplayResizeRequest: { width: number; height: number } | null = null;
let videoContainerResizeObserver: ResizeObserver | null = null;
let lastPersistedTabsSnapshot = '';
let lastPersistedActiveTabKey = '';
let dragStartOffset = { x: 0, y: 0 };
let dragStartPoint = { x: 0, y: 0 };
let isDraggingMenu = false;
let didDragMenu = false;
let nextScrcpyPointerId = 0n;
const scrcpyPointerIds = new Map<number, bigint>();
let currentHidMouseButtons = 0;
const pressedHidKeys = new Set<number>();
let lastTouchPointerAt = 0;
let pointerMoveFlushHandle: number | null = null;
let pointerMoveSampleTimer: number | null = null;
let pointerReleaseFlushHandle: number | null = null;
let pointerControlFlushHandle: number | null = null;
let lastPointerMoveFlushAt = 0;
let reconnectAttempt = 0;
let suppressAutoReconnect = false;
let isIceRestartInFlight = false;
let isStartConnectionInFlight = false;
let activeConnectionTargetKey = '';
let detachedSignalingConnectionId = 0;
let expectedSignalingCloseConnectionId = 0;
let currentScrcpySessionId = '';
let lastVideoFrameAt = 0;
let lastVideoFreezeRecoveryAt = 0;
let lastVideoFreezeRecoveryConnectionId = 0;

interface PendingPointerMove {
  pointerId: number;
  xRatio: number;
  yRatio: number;
  frameWidth: number;
  frameHeight: number;
  pressure: number;
}

const activeTab = computed(() => castTabs.value.find((tab) => tab.key === activeTabKey.value) ?? null);
const hasCastTabs = computed(() => castTabs.value.length > 0);
const castTabItems = computed(() => castTabs.value.map((tab) => ({
  key: tab.key,
  title: getTabTitle(tab)
})));
const isScreencastRouteActive = computed(() => route.name === 'screencast');
const canUseFlexDisplay = computed(() => isNewDisplayMode.value && isFlexDisplayEnabled.value);
const resolvedNewDisplayDpi = computed(() => {
  if (!isNewDisplayMode.value) {
    return null;
  }

  if (newDisplayDpiMode.value === 'disabled') {
    return null;
  }

  if (newDisplayDpiMode.value === 'custom') {
    return normalizeNewDisplayDpiValue(newDisplayDpiValue.value);
  }

  return detectAutomaticNewDisplayDpi();
});

type TrackKind = 'audio' | 'video';

interface PersistedCastConnection {
  tabKey: string;
  deviceId: string;
  appPackageName: string;
  appDisplayName: string;
  newDisplay: boolean;
  sessionId: string;
  persistedAt: number;
  peerConnection: RTCPeerConnection;
  ws: WebSocket | null;
  dataChannel: RTCDataChannel | null;
  metaControlChannel: RTCDataChannel | null;
  pointerMoveChannel: RTCDataChannel | null;
  remoteTracks: Map<TrackKind, MediaStreamTrack>;
  remoteVideoStream: MediaStream;
  remoteAudioStream: MediaStream;
  pendingCandidates: RTCIceCandidateInit[];
}

declare global {
  interface Window {
    __aylinkPersistedCastConnections?: Record<string, PersistedCastConnection>;
    __aylinkPersistedCastFrameImages?: Record<string, string>;
    __aylinkPersistentAudioElement?: HTMLAudioElement;
  }
}

const statusDotClass = computed(() => ({
  connecting: isConnecting.value,
  connected: isConnected.value
}));

const menuStyle = computed(() => ({
  left: `${menuX.value}px`,
  top: `${menuY.value}px`
}));

const getPersistentAudioElement = () => {
  if (!window.__aylinkPersistentAudioElement) {
    const element = new Audio();
    element.autoplay = true;
    element.muted = false;
    element.setAttribute('playsinline', '');
    window.__aylinkPersistentAudioElement = element;
  }

  return window.__aylinkPersistentAudioElement;
};

const getDefaultRtcConfiguration = (): RTCConfiguration => ({
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
});

const getRtcConfigurationFromSettings = (settings?: WebRtcNetworkSettingsPayload | null): RTCConfiguration => {
  const normalizedIceServers: RTCIceServer[] = (settings?.IceServers ?? [])
    ?.map((server) => {
      const urls = (server.Urls ?? []).map((url) => url.trim()).filter(Boolean);
      if (urls.length === 0) {
        return null;
      }

      return {
        urls: urls.length === 1 ? urls[0] : urls,
        username: server.Username ?? undefined,
        credential: server.Credential ?? undefined
      };
    })
    .filter((server): server is NonNullable<typeof server> => server != null);

  return {
    iceServers: normalizedIceServers.length > 0 ? normalizedIceServers : getDefaultRtcConfiguration().iceServers,
    iceTransportPolicy: settings?.IceTransportPolicy === 'relay' ? 'relay' : 'all'
  };
};

const loadRtcConfiguration = async (): Promise<RTCConfiguration> => {
  const localOverrideEnabled = loadLocalWebRtcOverrideEnabled(localWebRtcScope.value);
  const localOverrideConfig = loadLocalWebRtcOverrideConfig(localWebRtcScope.value);
  if (localOverrideEnabled && localOverrideConfig) {
    return getRtcConfigurationFromSettings(localOverrideConfig);
  }

  try {
    const response = await apiFetch('/api/control/webrtc-network');
    if (!response.ok) {
      return getDefaultRtcConfiguration();
    }

    return getRtcConfigurationFromSettings(await response.json());
  } catch (error) {
    console.warn('Failed to load WebRTC network settings:', error);
    return getDefaultRtcConfiguration();
  }
};

const shouldMuteForBackground = () => backgroundMute.value &&
  (document.visibilityState !== 'visible' || !document.hasFocus());

const applyBackgroundMuteState = (muted: boolean) => {
  if (audioElement.value && audioElement.value.muted !== muted) {
    audioElement.value.muted = muted;
  }

  const persistentAudioElement = getPersistentAudioElement();
  if (persistentAudioElement.muted !== muted) {
    persistentAudioElement.muted = muted;
  }
};

const syncBackgroundMuteState = () => {
  applyBackgroundMuteState(shouldMuteForBackground());
};

const getStoredLastFrameUrl = (tabKey = activeTabKey.value) => {
  if (!tabKey) {
    return '';
  }

  return window.__aylinkPersistedCastFrameImages?.[tabKey] ?? '';
};

const storeLastFrameUrl = (url: string, tabKey = activeTabKey.value) => {
  if (!tabKey || !url) {
    return;
  }

  window.__aylinkPersistedCastFrameImages ??= {};
  window.__aylinkPersistedCastFrameImages[tabKey] = url;
};

const showLastFrameOverlayForTab = (tabKey = activeTabKey.value) => {
  const url = getStoredLastFrameUrl(tabKey);
  lastFrameOverlayUrl.value = url;
  shouldShowLastFrameOverlay.value = !!url;
};

const hideLastFrameOverlay = () => {
  shouldShowLastFrameOverlay.value = false;
};

const captureCurrentVideoFrame = (tabKey = activeTabKey.value) => {
  if (!tabKey || !videoElement.value) {
    return;
  }

  const source = videoElement.value;
  const width = source.videoWidth;
  const height = source.videoHeight;
  if (width <= 0 || height <= 0 || source.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    console.debug('[WebRTC] Skip frame capture:', { tabKey, width, height, readyState: source.readyState });
    return;
  }

  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }

    context.drawImage(source, 0, 0, width, height);
    storeLastFrameUrl(canvas.toDataURL('image/jpeg', 0.85), tabKey);
    console.debug('[WebRTC] Captured last frame:', { tabKey, width, height });
  } catch (error) {
    console.warn('Failed to capture video frame:', error);
  }
};

const stopVideoFrameCaptureLoop = () => {
  if (videoFrameCallbackHandle == null || !videoElement.value || typeof videoElement.value.cancelVideoFrameCallback !== 'function') {
    videoFrameCallbackHandle = null;
    return;
  }

  try {
    videoElement.value.cancelVideoFrameCallback(videoFrameCallbackHandle);
  } catch (error) {
    console.warn('Failed to cancel video frame callback:', error);
  }
  videoFrameCallbackHandle = null;
};

const resetVideoFreezeState = () => {
  lastVideoFrameAt = 0;
  lastVideoFreezeRecoveryAt = 0;
  lastVideoFreezeRecoveryConnectionId = 0;
};

const stopVideoFreezeWatchdog = () => {
  if (videoFreezeWatchdogTimer != null) {
    window.clearInterval(videoFreezeWatchdogTimer);
    videoFreezeWatchdogTimer = null;
  }
};

const getRefreshRequestChannel = () => {
  if (metaControlChannel?.readyState === 'open') {
    return metaControlChannel;
  }
  if (dataChannel?.readyState === 'open') {
    return dataChannel;
  }
  return null;
};

const requestVideoRefreshFromFrontend = (reason: string) => {
  const channel = getRefreshRequestChannel();
  if (!channel) {
    return false;
  }

  try {
    channel.send(buildVideoRefreshMetaMessage() as unknown as ArrayBufferView<ArrayBuffer>);
    console.warn('[WebRTC] Requested runtime video refresh from frontend.', {
      reason,
      deviceId: deviceId.value,
      tabKey: activeTabKey.value
    });
    return true;
  } catch (error) {
    console.warn('Failed to request runtime video refresh:', error);
    return false;
  }
};

const buildVideoRefreshMetaMessage = () => {
  return new Uint8Array([LOCAL_META_CONTROL_PREFIX, LOCAL_META_MSG_VIDEO_REFRESH]);
};

const shouldMonitorFrozenVideo = (connectionId: number) => {
  if (suppressAutoReconnect || connectionId !== activeConnectionId) {
    return false;
  }
  if (document.visibilityState !== 'visible' || route.name !== 'screencast') {
    return false;
  }
  if (!peerConnection || peerConnection.connectionState !== 'connected') {
    return false;
  }
  const videoTrack = remoteTracks.get('video');
  if (!videoTrack || videoTrack.readyState !== 'live') {
    return false;
  }
  return !!videoElement.value?.srcObject;
};

const handleFrozenVideo = (connectionId: number, reason: string) => {
  if (!shouldMonitorFrozenVideo(connectionId)) {
    return;
  }

  const now = performance.now();
  if (lastVideoFrameAt <= 0 || now - lastVideoFrameAt < VIDEO_FREEZE_THRESHOLD_MS) {
    return;
  }

  const sameRecoveryWindow = lastVideoFreezeRecoveryConnectionId === connectionId;
  const sinceLastRecovery = sameRecoveryWindow ? now - lastVideoFreezeRecoveryAt : Number.POSITIVE_INFINITY;

  if (!sameRecoveryWindow || sinceLastRecovery >= VIDEO_FREEZE_REFRESH_DEBOUNCE_MS) {
    const requested = requestVideoRefreshFromFrontend(reason);
    if (requested) {
      lastVideoFreezeRecoveryAt = now;
      lastVideoFreezeRecoveryConnectionId = connectionId;
      status.value = '画面冻结，正在请求关键帧恢复...';
      return;
    }
  }

  if (sameRecoveryWindow && sinceLastRecovery >= VIDEO_FREEZE_ESCALATION_MS) {
    console.warn('[WebRTC] Frozen video persisted after refresh request, escalating recovery.', {
      reason,
      deviceId: deviceId.value,
      tabKey: activeTabKey.value,
      peerConnectionState: peerConnection?.connectionState ?? null
    });
    lastVideoFreezeRecoveryAt = now;
    void (async () => {
      const restarted = await tryIceRestart(`video_frozen_${reason}`);
      if (!restarted) {
        stopConnection();
        scheduleReconnect(`video_frozen_${reason}`);
      }
    })();
  }
};

const startVideoFrameMonitor = (connectionId: number) => {
  stopVideoFrameCaptureLoop();
  stopVideoFreezeWatchdog();
  resetVideoFreezeState();

  const source = videoElement.value;
  if (!source) {
    return;
  }

  const updateFrameActivity = () => {
    lastVideoFrameAt = performance.now();
    if (lastVideoFreezeRecoveryConnectionId === connectionId) {
      lastVideoFreezeRecoveryAt = 0;
      lastVideoFreezeRecoveryConnectionId = 0;
    }
  };

  const scheduleNextFrame = () => {
    if (!videoElement.value || videoElement.value !== source || connectionId !== activeConnectionId) {
      return;
    }
    if (typeof source.requestVideoFrameCallback !== 'function') {
      return;
    }
    videoFrameCallbackHandle = source.requestVideoFrameCallback(() => {
      updateFrameActivity();
      syncVideoFrameSize();
      scheduleNextFrame();
    });
  };

  updateFrameActivity();
  scheduleNextFrame();
  videoFreezeWatchdogTimer = window.setInterval(() => {
    handleFrozenVideo(connectionId, 'frame_watchdog');
  }, VIDEO_FREEZE_WATCHDOG_INTERVAL_MS);
};

const stopScrcpySessionHeartbeat = () => {
  if (scrcpySessionHeartbeatTimer != null) {
    window.clearInterval(scrcpySessionHeartbeatTimer);
    scrcpySessionHeartbeatTimer = null;
  }
};

const startScrcpySessionHeartbeat = (targetDeviceId: string, sessionId: string) => {
  stopScrcpySessionHeartbeat();
  if (!targetDeviceId || !sessionId) {
    return;
  }

  const tick = () => {
    void postScrcpySessionAction('heartbeat', targetDeviceId, sessionId);
  };

  tick();
  scrcpySessionHeartbeatTimer = window.setInterval(tick, 15000);
};

const stopPointerMoveFlushLoop = () => {
  if (pointerMoveFlushHandle != null) {
    window.cancelAnimationFrame(pointerMoveFlushHandle);
    pointerMoveFlushHandle = null;
  }
  if (pointerMoveSampleTimer != null) {
    window.clearTimeout(pointerMoveSampleTimer);
    pointerMoveSampleTimer = null;
  }
};

const getHighFrequencyControlChannel = () =>
  pointerMoveChannel?.readyState === 'open'
    ? pointerMoveChannel
    : dataChannel;

const stopPointerControlFlushLoop = () => {
  if (pointerControlFlushHandle != null) {
    window.cancelAnimationFrame(pointerControlFlushHandle);
    pointerControlFlushHandle = null;
  }
};

const stopPointerReleaseFlushLoop = () => {
  if (pointerReleaseFlushHandle != null) {
    window.cancelAnimationFrame(pointerReleaseFlushHandle);
    pointerReleaseFlushHandle = null;
  }
};

const flushPendingPointerControlPayloads = () => {
  if (!dataChannel || dataChannel.readyState !== 'open') {
    return;
  }

  while (pendingPointerControlPayloads.length > 0) {
    if (dataChannel.bufferedAmount > CONTROL_CHANNEL_BUFFER_LIMIT) {
      schedulePointerControlFlush();
      return;
    }

    const pendingPayload = pendingPointerControlPayloads[0];
    try {
      dataChannel.send(pendingPayload.payload as unknown as ArrayBufferView<ArrayBuffer>);
      pendingPointerControlPayloads.shift();
      pendingPayload.onSent?.();
    } catch (error) {
      console.warn('Pointer control send failed:', error);
      schedulePointerControlFlush();
      return;
    }
  }

  stopPointerControlFlushLoop();
};

const schedulePointerControlFlush = () => {
  if (pointerControlFlushHandle != null || pendingPointerControlPayloads.length === 0) {
    return;
  }

  pointerControlFlushHandle = window.requestAnimationFrame(() => {
    pointerControlFlushHandle = null;
    flushPendingPointerControlPayloads();
  });
};

const enqueuePointerControlPayloads = (...payloads: PendingPointerControlPayload[]) => {
  if (payloads.length === 0) {
    return true;
  }

  pendingPointerControlPayloads.push(...payloads);
  flushPendingPointerControlPayloads();
  if (pendingPointerControlPayloads.length > 0) {
    schedulePointerControlFlush();
  }
  return true;
};

const enqueuePointerPayloadBuffers = (payloads: Uint8Array[], onLastSent?: () => void) => {
  if (payloads.length === 0) {
    return false;
  }

  return enqueuePointerControlPayloads(
    ...payloads.map((payload, index) => ({
      payload,
      onSent: onLastSent && index === payloads.length - 1 ? onLastSent : undefined
    }))
  );
};

const flushPersistTabs = () => {
  pendingPersistTabsTimer = null;

  const tabsSnapshot = JSON.stringify(castTabs.value);
  const activeTabSnapshot = activeTabKey.value;
  if (tabsSnapshot === lastPersistedTabsSnapshot && activeTabSnapshot === lastPersistedActiveTabKey) {
    return;
  }

  sessionStorage.setItem(CAST_TABS_STORAGE_KEY, tabsSnapshot);
  sessionStorage.setItem(CAST_ACTIVE_TAB_STORAGE_KEY, activeTabSnapshot);
  lastPersistedTabsSnapshot = tabsSnapshot;
  lastPersistedActiveTabKey = activeTabSnapshot;
};

const schedulePersistTabs = () => {
  if (pendingPersistTabsTimer != null) {
    return;
  }

  pendingPersistTabsTimer = window.setTimeout(flushPersistTabs, 0);
};

const postScrcpySessionAction = async (action: 'heartbeat' | 'release', targetDeviceId: string, sessionId: string) => {
  if (!targetDeviceId || !sessionId) {
    return;
  }

  try {
    console.debug('[WebRTC] Session action ->', action, { deviceId: targetDeviceId, sessionId });
    await apiFetch(`/api/scrcpy-sessions/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: targetDeviceId, sessionId })
    });
  } catch (error) {
    console.warn(`Failed to ${action} scrcpy session:`, error);
  }
};

const normalizeNewDisplayDpiValue = (value: number | null | undefined) => {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_AUTO_NEW_DISPLAY_DPI;
  }

  return Math.max(MIN_NEW_DISPLAY_DPI, Math.min(MAX_NEW_DISPLAY_DPI, Math.round(numeric)));
};

const detectAutomaticNewDisplayDpi = () => {
  const dpr = window.devicePixelRatio;
  if (!Number.isFinite(dpr) || dpr <= 0) {
    return DEFAULT_AUTO_NEW_DISPLAY_DPI;
  }

  return normalizeNewDisplayDpiValue(dpr * 160);
};

const roundDisplayDimension = (value: number) => {
  const rounded = Math.max(MIN_NEW_DISPLAY_DIMENSION, Math.round(value));
  return rounded % 2 === 0 ? rounded : rounded + 1;
};

const getDisplayStageRect = () => {
  return videoContainer.value?.getBoundingClientRect()
    ?? shellElement.value?.getBoundingClientRect()
    ?? null;
};

const getDisplayAspectSize = () => {
  if (lastVideoFrameSize.width > 0 && lastVideoFrameSize.height > 0) {
    return {
      width: lastVideoFrameSize.width,
      height: lastVideoFrameSize.height
    };
  }

  const rect = getDisplayStageRect();
  if (rect && rect.width > 0 && rect.height > 0) {
    return {
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    };
  }

  return {
    width: Math.max(1, window.innerWidth),
    height: Math.max(1, window.innerHeight)
  };
};

const buildAdaptiveDisplaySize = () => {
  const aspect = getDisplayAspectSize();
  const rect = getDisplayStageRect();
  const dpr = Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0
    ? Math.min(window.devicePixelRatio, 2)
    : 1;
  const targetLongEdge = rect
    ? Math.min(MAX_NEW_DISPLAY_LONG_EDGE, Math.round(Math.max(rect.width, rect.height) * dpr))
    : MAX_NEW_DISPLAY_LONG_EDGE;
  const baseLongEdge = Math.max(aspect.width, aspect.height, 1);
  const scale = targetLongEdge / baseLongEdge;

  return {
    width: roundDisplayDimension(aspect.width * scale),
    height: roundDisplayDimension(aspect.height * scale)
  };
};

const hasLiveConnection = () => {
  return !!peerConnection && peerConnection.connectionState !== 'closed';
};

const persistCurrentConnection = (tabKey = activeTabKey.value) => {
  if (!peerConnection || !tabKey) {
    return;
  }

  window.__aylinkPersistedCastConnections ??= {};
  window.__aylinkPersistedCastConnections[tabKey] = {
    tabKey,
    deviceId: deviceId.value,
    appPackageName: appPackageName.value,
    appDisplayName: appDisplayName.value,
    newDisplay: isNewDisplayMode.value,
    sessionId: currentScrcpySessionId,
    persistedAt: Date.now(),
    peerConnection,
    ws,
    dataChannel,
    metaControlChannel,
    pointerMoveChannel,
    remoteTracks: new Map(remoteTracks),
    remoteVideoStream,
    remoteAudioStream,
    pendingCandidates: [...pendingCandidates]
  };
  disposeOtherPersistedConnections(tabKey);
};

const clearPersistedConnection = (tabKey = activeTabKey.value) => {
  if (!tabKey || !window.__aylinkPersistedCastConnections) {
    return;
  }

  delete window.__aylinkPersistedCastConnections[tabKey];
  if (Object.keys(window.__aylinkPersistedCastConnections).length === 0) {
    window.__aylinkPersistedCastConnections = undefined;
  }
};

const getPersistedConnection = (tabKey = activeTabKey.value) => {
  if (!tabKey) {
    return null;
  }

  return window.__aylinkPersistedCastConnections?.[tabKey] ?? null;
};

const disposePersistedConnection = (tabKey: string) => {
  const persisted = window.__aylinkPersistedCastConnections?.[tabKey];
  if (!persisted) {
    return;
  }

  try {
    persisted.dataChannel?.close();
  } catch {
  }

  try {
    persisted.metaControlChannel?.close();
  } catch {
  }

  try {
    persisted.pointerMoveChannel?.close();
  } catch {
  }

  try {
    persisted.peerConnection.ontrack = null;
    persisted.peerConnection.onicecandidate = null;
    persisted.peerConnection.onconnectionstatechange = null;
    persisted.peerConnection.ondatachannel = null;
    persisted.peerConnection.close();
  } catch {
  }

  try {
    persisted.ws?.onopen && (persisted.ws.onopen = null);
    persisted.ws?.onmessage && (persisted.ws.onmessage = null);
    persisted.ws?.onerror && (persisted.ws.onerror = null);
    persisted.ws?.onclose && (persisted.ws.onclose = null);
    persisted.ws?.close();
  } catch {
  }

  clearPersistedConnection(tabKey);
};

const disposeOtherPersistedConnections = (keepTabKey: string) => {
  const persistedConnections = window.__aylinkPersistedCastConnections;
  if (!persistedConnections) {
    return;
  }

  for (const tabKey of Object.keys(persistedConnections)) {
    if (tabKey === keepTabKey) {
      continue;
    }

    disposePersistedConnection(tabKey);
  }
};

const disposeAllPersistedConnections = () => {
  const persistedConnections = window.__aylinkPersistedCastConnections;
  if (!persistedConnections) {
    return;
  }

  for (const tabKey of Object.keys(persistedConnections)) {
    disposePersistedConnection(tabKey);
  }
};

const restorePersistedConnection = (tabKey = activeTabKey.value) => {
  const persisted = getPersistedConnection(tabKey);
  if (!persisted) {
    return false;
  }

  if ((persisted.ws && persisted.ws.readyState >= WebSocket.CLOSING) || persisted.peerConnection.connectionState === 'closed') {
    disposePersistedConnection(tabKey);
    return false;
  }

  activeConnectionId++;
  isStartConnectionInFlight = false;
  activeConnectionTargetKey = tabKey;
  resetSignalingDetachState();
  currentScrcpySessionId = persisted.sessionId ?? '';
  peerConnection = persisted.peerConnection;
  ws = persisted.ws;
  dataChannel = persisted.dataChannel;
  metaControlChannel = persisted.metaControlChannel;
  pointerMoveChannel = persisted.pointerMoveChannel;
  pendingCandidates = [...persisted.pendingCandidates];
  remoteTracks.clear();
  for (const [kind, track] of persisted.remoteTracks.entries()) {
    remoteTracks.set(kind, track);
  }
  remoteVideoStream = persisted.remoteVideoStream;
  remoteAudioStream = persisted.remoteAudioStream;

  const connectionId = activeConnectionId;
  wirePeerConnectionEventHandlers(connectionId, peerConnection);
  if (ws) {
    wireWebSocketEventHandlers(connectionId, ws);
  }
  if (dataChannel) {
    setupControlChannel(dataChannel);
  }
  if (metaControlChannel) {
    setupMetaControlChannel(metaControlChannel);
  }
  if (pointerMoveChannel) {
    setupPointerMoveChannel(pointerMoveChannel);
  }

  if (videoElement.value) {
    videoElement.value.srcObject = remoteVideoStream;
  }
  if (audioElement.value) {
    audioElement.value.srcObject = remoteAudioStream;
  }
  const backgroundAudioElement = getPersistentAudioElement();
  if (backgroundAudioElement.srcObject !== remoteAudioStream) {
    backgroundAudioElement.srcObject = remoteAudioStream;
  }

  isConnected.value = peerConnection.connectionState === 'connected';
  isConnecting.value = peerConnection.connectionState === 'connecting';
  status.value = isConnected.value
    ? '已连接'
    : isConnecting.value
      ? '正在恢复连接...'
      : `WebRTC 状态: ${peerConnection.connectionState}`;
  hideLastFrameOverlay();
  scheduleResumeMediaPlayback(0);
  startVideoFrameMonitor(connectionId);
  persistCurrentConnection(tabKey);
  return true;
};

const getStageBounds = () => {
  const rect = videoContainer.value?.getBoundingClientRect();
  const shellRect = shellElement.value?.getBoundingClientRect();
  const videoRect = videoElement.value?.getBoundingClientRect();
  const hasUsableVideoRect = !!videoRect && videoRect.width > 0 && videoRect.height > 0 && (videoElement.value?.videoWidth ?? 0) > 0;

  if (hasUsableVideoRect) {
    return {
      width: videoRect!.width,
      height: videoRect!.height,
      offsetLeft: videoRect!.left - (shellRect?.left ?? 0),
      offsetTop: videoRect!.top - (shellRect?.top ?? 0)
    };
  }

  return {
    width: rect?.width ?? window.innerWidth,
    height: rect?.height ?? (window.innerHeight - 46),
    offsetLeft: (rect?.left ?? 0) - (shellRect?.left ?? 0),
    offsetTop: (rect?.top ?? 46) - (shellRect?.top ?? 0)
  };
};

const doesVerticalLayoutOverflowAt = (y: number) => {
  const bounds = getStageBounds();
  const stageBottom = bounds.offsetTop + bounds.height - MENU_MARGIN;
  return y + MENU_EXPANDED_LENGTH > stageBottom;
};

const shouldUseHorizontalLayoutAt = (y: number) => {
  if (!isMenuExpanded.value) {
    return false;
  }

  return isMenuHorizontalLocked.value || doesVerticalLayoutOverflowAt(y);
};

const getMenuBoundsAt = (y: number) => {
  const horizontal = shouldUseHorizontalLayoutAt(y);
  return {
    horizontal,
    width: horizontal ? (isMenuExpanded.value ? MENU_EXPANDED_LENGTH : MENU_BUTTON_SIZE) : MENU_BUTTON_SIZE,
    height: horizontal ? MENU_BUTTON_SIZE : (isMenuExpanded.value ? MENU_EXPANDED_LENGTH : MENU_BUTTON_SIZE)
  };
};

const isHorizontalLayout = computed(() => getMenuBoundsAt(menuY.value).horizontal);

const getMenuBounds = () => getMenuBoundsAt(menuY.value);

const clampMenuPosition = (x: number, y: number) => {
  const bounds = getStageBounds();
  const minX = bounds.offsetLeft + MENU_MARGIN;
  const minY = bounds.offsetTop + MENU_MARGIN;

  let menuBounds = getMenuBoundsAt(y);
  let maxX = Math.max(minX, bounds.offsetLeft + bounds.width - menuBounds.width - MENU_MARGIN);
  let maxY = Math.max(minY, bounds.offsetTop + bounds.height - menuBounds.height - MENU_MARGIN);

  const clampedY = Math.min(Math.max(minY, y), maxY);
  menuBounds = getMenuBoundsAt(clampedY);
  maxX = Math.max(minX, bounds.offsetLeft + bounds.width - menuBounds.width - MENU_MARGIN);
  maxY = Math.max(minY, bounds.offsetTop + bounds.height - menuBounds.height - MENU_MARGIN);

  return {
    x: Math.min(Math.max(minX, x), maxX),
    y: Math.min(Math.max(minY, y), maxY)
  };
};

const updateMenuRelativePosition = () => {
  const bounds = getStageBounds();
  const clamped = clampMenuPosition(menuX.value, menuY.value);
  const menuBounds = getMenuBoundsAt(clamped.y);
  const minX = bounds.offsetLeft + MENU_MARGIN;
  const minY = bounds.offsetTop + MENU_MARGIN;
  const maxX = Math.max(minX, bounds.offsetLeft + bounds.width - menuBounds.width - MENU_MARGIN);
  const maxY = Math.max(minY, bounds.offsetTop + bounds.height - menuBounds.height - MENU_MARGIN);

  menuRelativeX.value = maxX <= minX ? 0 : (clamped.x - minX) / (maxX - minX);
  menuRelativeY.value = maxY <= minY ? 0 : (clamped.y - minY) / (maxY - minY);
};

const setMenuPosition = (x: number, y: number, syncRelative = true) => {
  if (isMenuExpanded.value) {
    isMenuHorizontalLocked.value = doesVerticalLayoutOverflowAt(y);
  } else {
    isMenuHorizontalLocked.value = false;
  }

  const clamped = clampMenuPosition(x, y);
  menuX.value = clamped.x;
  menuY.value = clamped.y;
  if (syncRelative) {
    updateMenuRelativePosition();
  }
};

const restoreMenuPositionFromRelative = () => {
  const bounds = getStageBounds();
  const minX = bounds.offsetLeft + MENU_MARGIN;
  const minY = bounds.offsetTop + MENU_MARGIN;
  const initialY = minY + Math.max(bounds.height - (MENU_BUTTON_SIZE + MENU_MARGIN * 2), 0) * menuRelativeY.value;
  const menuBounds = getMenuBoundsAt(initialY);
  const maxX = Math.max(minX, bounds.offsetLeft + bounds.width - menuBounds.width - MENU_MARGIN);
  const maxY = Math.max(minY, bounds.offsetTop + bounds.height - menuBounds.height - MENU_MARGIN);

  setMenuPosition(
    minX + (maxX - minX) * menuRelativeX.value,
    minY + (maxY - minY) * menuRelativeY.value,
    false
  );
};

const applyDockPosition = (edge: DockedEdge) => {
  const bounds = getStageBounds();
  const menuBounds = getMenuBounds();
  const centeredY = Math.max(
    bounds.offsetTop + MENU_MARGIN,
    Math.min(
      menuY.value,
      bounds.offsetTop + bounds.height - menuBounds.height - MENU_MARGIN
    )
  );

  if (edge === 'left') {
    setMenuPosition(bounds.offsetLeft + MENU_MARGIN, centeredY);
  } else if (edge === 'right') {
    setMenuPosition(
      Math.max(bounds.offsetLeft + MENU_MARGIN, bounds.offsetLeft + bounds.width - menuBounds.width - MENU_MARGIN),
      centeredY
    );
  }
};

const initializeMenuPosition = () => {
  if (isDocked.value && dockedEdge.value !== 'none') {
    applyDockPosition(dockedEdge.value);
  } else {
    restoreMenuPositionFromRelative();
  }
};

const resolveDockEdge = () => {
  const bounds = getStageBounds();
  const menuBounds = getMenuBounds();
  const distances = [
    { edge: 'left' as DockedEdge, value: Math.abs(menuX.value - (bounds.offsetLeft + MENU_MARGIN)) },
    { edge: 'right' as DockedEdge, value: Math.abs(bounds.offsetLeft + bounds.width - (menuX.value + menuBounds.width)) }
  ].sort((a, b) => a.value - b.value);

  const nearest = distances[0];
  if (nearest.value <= 64) {
    dockedEdge.value = nearest.edge;
    isDocked.value = true;
    applyDockPosition(nearest.edge);
  } else {
    dockedEdge.value = 'none';
    isDocked.value = false;
    setMenuPosition(menuX.value, menuY.value);
  }
};

const buildTabKey = (tab: Pick<CastTab, 'deviceId' | 'appPackageName' | 'newDisplay'>) => {
  const mode = tab.newDisplay ? 'new-display' : 'screen';
  return tab.appPackageName ? `${tab.deviceId}::${mode}::${tab.appPackageName}` : `${tab.deviceId}::${mode}`;
};

const getTabTitle = (tab: CastTab) => {
  const baseTitle = tab.deviceName || '设备投屏';
  return tab.appDisplayName ? `${baseTitle} · ${tab.appDisplayName}` : baseTitle;
};

const persistTabs = () => {
  schedulePersistTabs();
};

const syncRefsFromActiveTab = () => {
  const tab = activeTab.value;
  deviceId.value = tab?.deviceId ?? '';
  appPackageName.value = tab?.appPackageName ?? '';
  appDisplayName.value = tab?.appDisplayName ?? '';
  selectedDeviceName.value = tab?.deviceName || '设备投屏';
  isNewDisplayMode.value = tab?.newDisplay === true;
};

const syncRouteToActiveTab = async () => {
  if (Object.keys(route.query).length > 0) {
    await router.replace({ name: 'screencast', query: {} });
  }
};

const upsertTab = (tab: CastTab) => {
  const existingIndex = castTabs.value.findIndex((item) => item.key === tab.key);
  if (existingIndex >= 0) {
    castTabs.value[existingIndex] = { ...castTabs.value[existingIndex], ...tab };
  } else {
    castTabs.value.push(tab);
  }
  persistTabs();
};

const createTabFromQuery = () => {
  if (!isScreencastRouteActive.value) {
    return null;
  }

  const nextDeviceId = String(route.query.deviceId ?? '').trim();
  if (!nextDeviceId) return null;

  const nextAppPackageName = String(route.query.appPackage ?? '').trim();
  const nextAppDisplayName = String(route.query.appName ?? '').trim();
  const nextDeviceName = activeTab.value?.deviceId === nextDeviceId ? selectedDeviceName.value : '设备投屏';
  const nextNewDisplay = String(route.query.newDisplay ?? '').trim() === '1';

  const nextTab: CastTab = {
    key: buildTabKey({ deviceId: nextDeviceId, appPackageName: nextAppPackageName, newDisplay: nextNewDisplay }),
    deviceId: nextDeviceId,
    appPackageName: nextAppPackageName,
    appDisplayName: nextAppDisplayName,
    deviceName: nextDeviceName,
    newDisplay: nextNewDisplay
  };

  return nextTab;
};

const createTabFromRequest = (request: WorkspaceOpenRequest) => {
  const nextAppPackageName = request.appPackageName ?? '';
  const nextNewDisplay = request.newDisplay === true;
  const nextTab: CastTab = {
    key: buildTabKey({ deviceId: request.deviceId, appPackageName: nextAppPackageName, newDisplay: nextNewDisplay }),
    deviceId: request.deviceId,
    appPackageName: nextAppPackageName,
    appDisplayName: request.appDisplayName ?? '',
    deviceName: request.deviceName ?? '设备投屏',
    newDisplay: nextNewDisplay
  };

  return nextTab;
};

const openIncomingTab = async (tab: CastTab) => {
  upsertTab(tab);
  activeTabKey.value = tab.key;
  syncRefsFromActiveTab();
  persistTabs();
  await syncRouteToActiveTab();
  await fetchDeviceName();
  await fetchDeviceSettings();
  scheduleStartConnection();
};

const consumeIncomingTab = async () => {
  const pendingTab = consumeWorkspaceOpen('screencast');
  if (pendingTab) {
    await openIncomingTab(createTabFromRequest(pendingTab));
    return true;
  }

  const routeTab = createTabFromQuery();
  if (routeTab) {
    await openIncomingTab(routeTab);
    return true;
  }

  await syncRouteToActiveTab();
  return false;
};

const fetchDeviceName = async () => {
  if (!deviceId.value) {
    selectedDeviceName.value = '设备投屏';
    return;
  }

  try {
    const response = await apiFetch('/api/devices');
    if (!response.ok) return;
    const devices = await response.json();
    const target = Array.isArray(devices)
      ? devices.find((item: any) => String(item.Id ?? item.id) === String(deviceId.value))
      : null;
    selectedDeviceName.value = target?.Name ?? target?.name ?? target?.Serial ?? target?.serial ?? '设备投屏';
    if (activeTab.value) {
      upsertTab({ ...activeTab.value, deviceName: selectedDeviceName.value });
    }
  } catch (error) {
    console.warn('Failed to load device name:', error);
  }
};

const fetchDeviceSettings = async () => {
  if (!deviceId.value) {
    isFlexDisplayEnabled.value = false;
    isHidKeyboardEnabled.value = false;
    isHidMouseEnabled.value = false;
    return;
  }

  try {
    const response = await apiFetch(`/api/devices/${deviceId.value}/settings`);
    if (!response.ok) {
      return;
    }

    const settings = await response.json();
    isFlexDisplayEnabled.value = isNewDisplayMode.value && settings?.FlexDisplay === true;
    isHidKeyboardEnabled.value = settings?.HidKeyboard === true;
    isHidMouseEnabled.value = settings?.HidMouse === true;
  } catch (error) {
    console.warn('Failed to load device settings:', error);
    isFlexDisplayEnabled.value = false;
    isHidKeyboardEnabled.value = false;
    isHidMouseEnabled.value = false;
  }
};

const createSyntheticPointerEvent = (pointerId: number, xRatio = 0.5, yRatio = 0.5): PointerEvent | null => {
  if (!videoElement.value) return null;
  const rect = videoElement.value.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const snapshot = pointerSnapshots.get(pointerId);

  return new PointerEvent('pointercancel', {
    pointerId,
    pointerType: snapshot?.pointerType ?? 'touch',
    isPrimary: true,
    clientX: rect.left + rect.width * (snapshot?.xRatio ?? xRatio),
    clientY: rect.top + rect.height * (snapshot?.yRatio ?? yRatio),
    buttons: 0,
    pressure: 0
  });
};

const setupControlChannel = (channel: RTCDataChannel) => {
  dataChannel = channel;
  dataChannel.bufferedAmountLowThreshold = Math.floor(CONTROL_CHANNEL_BUFFER_LIMIT / 2);
  persistCurrentConnection();
  dataChannel.onopen = () => {
    status.value = '控制通道已连接';
    flushPendingPointerControlPayloads();
    flushPendingPointerReleases();
    initializeHidDevices();
    lastDisplayResizeRequest = null;
    scheduleDisplayResize(0);
    persistCurrentConnection();
  };
  dataChannel.onbufferedamountlow = () => {
    flushPendingPointerControlPayloads();
    flushPendingPointerReleases();
  };
  dataChannel.onclose = () => {
    if (dataChannel === channel) {
      dataChannel = null;
      persistCurrentConnection();
    }
  };
  dataChannel.onmessage = (event) => console.log('Data channel message:', event.data);
};

const setupMetaControlChannel = (channel: RTCDataChannel) => {
  metaControlChannel = channel;
  persistCurrentConnection();
  metaControlChannel.onopen = () => {
    persistCurrentConnection();
  };
  metaControlChannel.onclose = () => {
    if (metaControlChannel === channel) {
      metaControlChannel = null;
      persistCurrentConnection();
    }
  };
};

const setupPointerMoveChannel = (channel: RTCDataChannel) => {
  pointerMoveChannel = channel;
  pointerMoveChannel.bufferedAmountLowThreshold = Math.floor(POINTER_MOVE_BUFFER_LIMIT / 2);
  persistCurrentConnection();
  pointerMoveChannel.onopen = () => {
    flushPendingPointerMoves();
    flushPendingPointerReleases();
    persistCurrentConnection();
  };
  pointerMoveChannel.onbufferedamountlow = () => {
    flushPendingPointerMoves();
    flushPendingPointerReleases();
  };
  pointerMoveChannel.onclose = () => {
    if (pointerMoveChannel === channel) {
      pointerMoveChannel = null;
      persistCurrentConnection();
    }
  };
};

const clearPendingReconnect = () => {
  if (pendingReconnectTimer != null) {
    window.clearTimeout(pendingReconnectTimer);
    pendingReconnectTimer = null;
  }
};

const clearPendingIceRestartFallback = () => {
  if (pendingIceRestartFallbackTimer != null) {
    window.clearTimeout(pendingIceRestartFallbackTimer);
    pendingIceRestartFallbackTimer = null;
  }
};

const clearPendingVideoRecovery = () => {
  if (pendingVideoRecoveryTimer != null) {
    window.clearTimeout(pendingVideoRecoveryTimer);
    pendingVideoRecoveryTimer = null;
  }
};

const clearPendingSignalingDetach = () => {
  if (pendingSignalingDetachTimer != null) {
    window.clearTimeout(pendingSignalingDetachTimer);
    pendingSignalingDetachTimer = null;
  }
};

const resetSignalingDetachState = () => {
  clearPendingSignalingDetach();
  detachedSignalingConnectionId = 0;
  expectedSignalingCloseConnectionId = 0;
};

const clearStartConnectionState = () => {
  isStartConnectionInFlight = false;
  activeConnectionTargetKey = '';
};

const scheduleReconnect = (reason: string) => {
  if (suppressAutoReconnect || !activeTab.value || !deviceId.value) {
    return;
  }
  if (pendingReconnectTimer != null || pendingStartConnectionTimer != null) {
    return;
  }

  const delays = [1000, 2000, 5000, 10000];
  const delayMs = delays[Math.min(reconnectAttempt, delays.length - 1)];
  reconnectAttempt += 1;
  isConnecting.value = true;
  status.value = `连接中断，正在重连 (${reconnectAttempt})...`;
  console.warn('[WebRTC] Scheduling reconnect:', {
    reason,
    attempt: reconnectAttempt,
    delayMs,
    deviceId: deviceId.value,
    tabKey: activeTabKey.value
  });
  pendingReconnectTimer = window.setTimeout(() => {
    pendingReconnectTimer = null;
    if (suppressAutoReconnect || !activeTab.value || !deviceId.value) {
      return;
    }
    void startConnection();
  }, delayMs);
};

const enableAutoReconnect = () => {
  suppressAutoReconnect = false;
};

const disableAutoReconnect = () => {
  suppressAutoReconnect = true;
  clearPendingReconnect();
  clearPendingIceRestartFallback();
  clearPendingVideoRecovery();
  resetSignalingDetachState();
  isIceRestartInFlight = false;
  clearStartConnectionState();
};

const scheduleVideoRecovery = (connectionId: number, reason: string, delayMs = VIDEO_RECOVERY_TIMEOUT_MS) => {
  clearPendingVideoRecovery();
  if (suppressAutoReconnect) {
    return;
  }

  pendingVideoRecoveryTimer = window.setTimeout(() => {
    pendingVideoRecoveryTimer = null;
    if (suppressAutoReconnect || connectionId !== activeConnectionId) {
      return;
    }

    const currentPeerConnection = peerConnection;
    const videoTrack = remoteTracks.get('video');
    const hasLiveVideo = !!videoTrack && videoTrack.readyState === 'live';
    if (currentPeerConnection?.connectionState === 'connected' && hasLiveVideo) {
      return;
    }

    console.warn('[WebRTC] Video recovery watchdog triggered reconnect.', {
      reason,
      connectionId,
      peerConnectionState: currentPeerConnection?.connectionState ?? null,
      videoTrackState: videoTrack?.readyState ?? null,
      hasAudioTrack: remoteTracks.has('audio'),
      deviceId: deviceId.value,
      tabKey: activeTabKey.value
    });
    stopConnection();
    scheduleReconnect(`video_recovery_${reason}`);
  }, delayMs);
};

const scheduleReconnectFallbackAfterIceRestart = (reason: string, delayMs = 8000) => {
  clearPendingIceRestartFallback();
  pendingIceRestartFallbackTimer = window.setTimeout(() => {
    pendingIceRestartFallbackTimer = null;
    if (suppressAutoReconnect || !activeTab.value || !deviceId.value) {
      return;
    }
    if (isConnected.value) {
      isIceRestartInFlight = false;
      return;
    }
    isIceRestartInFlight = false;
    stopConnection();
    scheduleReconnect(`ice_restart_timeout_${reason}`);
  }, delayMs);
};

const scheduleSignalingDetach = (connectionId: number) => {
  if (pendingSignalingDetachTimer != null || detachedSignalingConnectionId === connectionId) {
    return;
  }
  if (!ws || ws.readyState !== WebSocket.OPEN || !peerConnection || peerConnection.connectionState !== 'connected' || !remoteTracks.has('video')) {
    return;
  }

  const targetSocket = ws;
  pendingSignalingDetachTimer = window.setTimeout(() => {
    pendingSignalingDetachTimer = null;
    if (connectionId !== activeConnectionId || ws !== targetSocket || targetSocket.readyState !== WebSocket.OPEN) {
      return;
    }
    if (!peerConnection || peerConnection.connectionState !== 'connected' || !remoteTracks.has('video')) {
      return;
    }

    console.info('[WebRTC] Closing signaling websocket after stable connection established.', {
      connectionId,
      deviceId: deviceId.value,
      tabKey: activeTabKey.value
    });
    detachedSignalingConnectionId = connectionId;
    expectedSignalingCloseConnectionId = connectionId;
    targetSocket.close(1000, 'signaling-detached');
  }, SIGNALING_DETACH_DELAY_MS);
};

const tryIceRestart = async (reason: string) => {
  if (suppressAutoReconnect || !peerConnection || !ws || ws.readyState !== WebSocket.OPEN) {
    return false;
  }
  if (peerConnection.signalingState !== 'stable') {
    return false;
  }
  if (isIceRestartInFlight) {
    return true;
  }

  isIceRestartInFlight = true;
  isConnecting.value = true;
  isConnected.value = false;
  status.value = '网络波动，正在尝试恢复连接...';
  console.warn('[WebRTC] Attempting ICE restart:', {
    reason,
    deviceId: deviceId.value,
    tabKey: activeTabKey.value
  });

  try {
    const offer = await peerConnection.createOffer({ iceRestart: true });
    await peerConnection.setLocalDescription(offer);
    if (!peerConnection.localDescription || !ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error('signaling socket not ready for ICE restart');
    }
    ws.send(JSON.stringify(peerConnection.localDescription));
    scheduleReconnectFallbackAfterIceRestart(reason);
    return true;
  } catch (error) {
    console.error('ICE restart failed:', error);
    isIceRestartInFlight = false;
    clearPendingIceRestartFallback();
    return false;
  }
};

const clearPendingStartConnection = () => {
  if (pendingStartConnectionTimer != null) {
    window.clearTimeout(pendingStartConnectionTimer);
    pendingStartConnectionTimer = null;
  }
};

const clearPendingDisplayResize = () => {
  if (pendingDisplayResizeTimer != null) {
    window.clearTimeout(pendingDisplayResizeTimer);
    pendingDisplayResizeTimer = null;
  }
};

const stopFlexDisplayHeartbeat = () => {
  if (flexDisplayHeartbeatTimer != null) {
    window.clearInterval(flexDisplayHeartbeatTimer);
    flexDisplayHeartbeatTimer = null;
  }
};

const startFlexDisplayHeartbeat = () => {
  stopFlexDisplayHeartbeat();
  if (!canUseFlexDisplay.value) {
    return;
  }

  flexDisplayHeartbeatTimer = window.setInterval(() => {
    sendDisplayResizeIfNeeded();
  }, 300);
};

const getDisplayResizeSize = () => {
  if (!isNewDisplayMode.value) {
    return null;
  }

  return buildAdaptiveDisplaySize();
};

const sendDisplayResizeIfNeeded = () => {
  if (!canUseFlexDisplay.value || !isConnected.value) {
    return;
  }

  if (!dataChannel || dataChannel.readyState !== 'open') {
    return;
  }

  const size = getDisplayResizeSize();
  if (!size) {
    return;
  }

  if (lastDisplayResizeRequest
    && lastDisplayResizeRequest.width === size.width
    && lastDisplayResizeRequest.height === size.height) {
    return;
  }

  sendMetaControlMessage(buildResizeDisplayMessage(size.width, size.height));
  lastDisplayResizeRequest = size;
};

const scheduleDisplayResize = (delayMs = 120) => {
  clearPendingDisplayResize();
  if (!canUseFlexDisplay.value) {
    return;
  }

  if (delayMs <= 0) {
    sendDisplayResizeIfNeeded();
    return;
  }

  pendingDisplayResizeTimer = window.setTimeout(() => {
    pendingDisplayResizeTimer = null;
    sendDisplayResizeIfNeeded();
  }, delayMs);
};

const scheduleStartConnection = (delayMs = 0) => {
  clearPendingStartConnection();
  if (!deviceId.value) {
    return;
  }

  if (activeConnectionTargetKey === activeTabKey.value && (isStartConnectionInFlight || hasLiveConnection() || isConnecting.value)) {
    return;
  }

  enableAutoReconnect();

  if (delayMs <= 0) {
    isStartConnectionInFlight = true;
    activeConnectionTargetKey = activeTabKey.value;
    void startConnection(true);
    return;
  }

  status.value = '正在准备 WebRTC 会话...';
  isConnecting.value = true;
  pendingStartConnectionTimer = window.setTimeout(() => {
    pendingStartConnectionTimer = null;
    isStartConnectionInFlight = true;
    activeConnectionTargetKey = activeTabKey.value;
    void startConnection(true);
  }, delayMs);
};

const syncVideoFrameSize = () => {
  if (!videoElement.value) return;

  const width = videoElement.value.videoWidth;
  const height = videoElement.value.videoHeight;
  if (width <= 0 || height <= 0) return;

  if (lastVideoFrameSize.width === width && lastVideoFrameSize.height === height) return;

  lastVideoFrameSize = { width, height };
  if (isConnected.value) {
    status.value = `画面尺寸已更新: ${width}x${height}`;
  }
};

const normalizeIceCandidate = (candidate: unknown): RTCIceCandidateInit | null => {
  function ensureCandidatePrefix(input: string): string {
    const text = input.trim();
    return text.startsWith('candidate:') ? text : `candidate:${text}`;
  }

  function deepParseCandidateText(input: string, maxDepth = 5): string {
    let current = input;
    let depth = 0;
    while (depth < maxDepth) {
      try {
        const parsed = JSON.parse(current);
        if (parsed && typeof parsed === 'object' && typeof parsed.candidate === 'string') {
          current = parsed.candidate;
          depth++;
          continue;
        }
      } catch {
        break;
      }
      break;
    }
    return current;
  }

  if (!candidate) return null;

  if (typeof candidate === 'string') {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') {
        let candidateText = parsed.candidate;
        if (typeof candidateText === 'string') {
          candidateText = deepParseCandidateText(candidateText);
        }
        const normalized: RTCIceCandidateInit = { candidate: ensureCandidatePrefix(String(candidateText)) };
        if (typeof parsed.sdpMid === 'string') normalized.sdpMid = parsed.sdpMid;
        if (typeof parsed.sdpMLineIndex === 'number') normalized.sdpMLineIndex = parsed.sdpMLineIndex;
        if (typeof parsed.usernameFragment === 'string') normalized.usernameFragment = parsed.usernameFragment;
        if (normalized.sdpMid === undefined && normalized.sdpMLineIndex === undefined) {
          normalized.sdpMLineIndex = 0;
        }
        return normalized;
      }
    } catch {
      return { candidate: ensureCandidatePrefix(candidate), sdpMLineIndex: 0 };
    }
  }

  if (typeof candidate !== 'object') {
    console.warn('Invalid ICE candidate payload:', candidate);
    return null;
  }

  const value = candidate as Record<string, unknown>;
  let candidateText = value.candidate ?? value.Candidate;
  if (typeof candidateText === 'string') {
    candidateText = deepParseCandidateText(candidateText);
  }
  if (typeof candidateText !== 'string' || candidateText.length === 0) {
    return null;
  }

  const normalized: RTCIceCandidateInit = { candidate: ensureCandidatePrefix(candidateText) };
  const sdpMid = value.sdpMid ?? value.SdpMid;
  const sdpMLineIndex = value.sdpMLineIndex ?? value.SdpMLineIndex;
  const usernameFragment = value.usernameFragment ?? value.UsernameFragment;

  if (typeof sdpMid === 'string' && sdpMid.length > 0) normalized.sdpMid = sdpMid;
  if (typeof sdpMLineIndex === 'number') {
    normalized.sdpMLineIndex = sdpMLineIndex;
  } else if (typeof sdpMLineIndex === 'string' && sdpMLineIndex.length > 0) {
    const parsedIndex = Number(sdpMLineIndex);
    if (Number.isInteger(parsedIndex)) normalized.sdpMLineIndex = parsedIndex;
  }
  if (normalized.sdpMid === undefined && normalized.sdpMLineIndex === undefined) {
    normalized.sdpMLineIndex = 0;
  }
  if (typeof usernameFragment === 'string') normalized.usernameFragment = usernameFragment;

  return normalized;
};

const isDroppableControlPayload = (payload: Uint8Array) => {
  if (payload.length === 0) {
    return false;
  }

  switch (payload[0]) {
    case SCRCPY_MSG_INJECT_TOUCH_EVENT:
      return payload.length > 1 && payload[1] === SCRCPY_ACTION_MOVE;
    case SCRCPY_MSG_UHID_INPUT: {
      if (payload.length < 10) {
        return false;
      }

      const deviceId = (payload[1] << 8) | payload[2];
      if (deviceId !== SCRCPY_HID_MOUSE_ID) {
        return false;
      }

      return payload[6] !== 0 || payload[7] !== 0 || payload[8] !== 0 || payload[9] !== 0;
    }
    case SCRCPY_MSG_RESIZE_DISPLAY:
      return true;
    default:
      return false;
  }
};

const sendBinaryControlMessage = (payload: Uint8Array, channel = dataChannel) => {
  if (!channel || channel.readyState !== 'open') return;
  if (channel.bufferedAmount > CONTROL_CHANNEL_BUFFER_LIMIT && isDroppableControlPayload(payload)) {
    return;
  }
  try {
    channel.send(payload as unknown as ArrayBufferView<ArrayBuffer>);
  } catch (error) {
    console.warn('Binary control send failed:', error);
  }
};

const getMetaControlChannel = () => {
  if (metaControlChannel?.readyState === 'open') {
    return metaControlChannel;
  }
  return dataChannel;
};

const sendMetaControlMessage = (payload: Uint8Array) => {
  sendBinaryControlMessage(payload, getMetaControlChannel());
};

const writeUInt16BE = (view: DataView, offset: number, value: number) => {
  view.setUint16(offset, Math.max(0, Math.min(0xffff, value)), false);
};

const writeUInt32BE = (view: DataView, offset: number, value: number) => {
  view.setUint32(offset, value >>> 0, false);
};

const writeUInt64BE = (view: DataView, offset: number, value: bigint) => {
  view.setBigUint64(offset, value, false);
};

const getOrCreateScrcpyPointerId = (pointerId: number) => {
  const existing = scrcpyPointerIds.get(pointerId);
  if (existing != null) {
    return existing;
  }

  const nextId = nextScrcpyPointerId;
  nextScrcpyPointerId += 1n;
  scrcpyPointerIds.set(pointerId, nextId);
  return nextId;
};

const getScrcpyPointerId = (pointerId: number) => scrcpyPointerIds.get(pointerId) ?? null;

const releaseScrcpyPointerId = (pointerId: number) => {
  scrcpyPointerIds.delete(pointerId);
};

const buildInjectKeycodeMessage = (action: number, keycode: number, repeat = 0, metaState = 0) => {
  const buffer = new ArrayBuffer(14);
  const view = new DataView(buffer);
  view.setUint8(0, SCRCPY_MSG_INJECT_KEYCODE);
  view.setUint8(1, action);
  writeUInt32BE(view, 2, keycode);
  writeUInt32BE(view, 6, repeat);
  writeUInt32BE(view, 10, metaState);
  return new Uint8Array(buffer);
};

const buildScreenPowerMessage = (isOn: boolean) => {
  const payload = new Uint8Array(2);
  payload[0] = SCRCPY_MSG_SET_SCREEN_POWER_MODE;
  payload[1] = isOn ? 1 : 0;
  return payload;
};

const buildUhidCreateMessage = (id: number, reportDesc: Uint8Array) => {
  const buffer = new ArrayBuffer(1 + 2 + 2 + reportDesc.length);
  const view = new DataView(buffer);
  view.setUint8(0, SCRCPY_MSG_UHID_CREATE);
  writeUInt16BE(view, 1, id);
  writeUInt16BE(view, 3, reportDesc.length);
  new Uint8Array(buffer, 5).set(reportDesc);
  return new Uint8Array(buffer);
};

const buildUhidInputMessage = (id: number, data: Uint8Array) => {
  const buffer = new ArrayBuffer(1 + 2 + 2 + data.length);
  const view = new DataView(buffer);
  view.setUint8(0, SCRCPY_MSG_UHID_INPUT);
  writeUInt16BE(view, 1, id);
  writeUInt16BE(view, 3, data.length);
  new Uint8Array(buffer, 5).set(data);
  return new Uint8Array(buffer);
};

const buildUhidDestroyMessage = (id: number) => {
  const buffer = new ArrayBuffer(3);
  const view = new DataView(buffer);
  view.setUint8(0, SCRCPY_MSG_UHID_DESTROY);
  writeUInt16BE(view, 1, id);
  return new Uint8Array(buffer);
};

const buildResizeDisplayMessage = (width: number, height: number) => {
  const buffer = new ArrayBuffer(5);
  const view = new DataView(buffer);
  view.setUint8(0, SCRCPY_MSG_RESIZE_DISPLAY);
  writeUInt16BE(view, 1, width);
  writeUInt16BE(view, 3, height);
  return new Uint8Array(buffer);
};

const buildHidMouseReport = (buttons: number, dx: number, dy: number, vWheel: number, hWheel: number) => {
  return new Uint8Array([
    buttons & 0xff,
    dx & 0xff,
    dy & 0xff,
    vWheel & 0xff,
    hWheel & 0xff
  ]);
};

const buildHidKeyboardReport = () => {
  const report = new Uint8Array(8);
  let modifiers = 0;
  let keyIndex = 2;

  for (const key of pressedHidKeys) {
    if (key >= 0xe0 && key <= 0xe7) {
      modifiers |= 1 << (key - 0xe0);
      continue;
    }

    if (keyIndex < 8) {
      report[keyIndex] = key;
      keyIndex += 1;
    }
  }

  report[0] = modifiers;
  return report;
};

const buildTouchMessage = (
  action: number,
  pointerId: bigint,
  x: number,
  y: number,
  screenWidth: number,
  screenHeight: number,
  pressure: number,
  actionButton: number,
  buttons: number
) => {
  const buffer = new ArrayBuffer(32);
  const view = new DataView(buffer);
  view.setUint8(0, SCRCPY_MSG_INJECT_TOUCH_EVENT);
  view.setUint8(1, action);
  writeUInt64BE(view, 2, pointerId);
  writeUInt32BE(view, 10, x);
  writeUInt32BE(view, 14, y);
  writeUInt16BE(view, 18, screenWidth);
  writeUInt16BE(view, 20, screenHeight);
  writeUInt16BE(view, 22, Math.round(Math.max(0, Math.min(1, pressure)) * 0xffff));
  writeUInt32BE(view, 24, actionButton);
  writeUInt32BE(view, 28, buttons);
  return new Uint8Array(buffer);
};

const mapAndroidCommandToKeycode = (action: string) => {
  switch (action.toLowerCase()) {
    case 'back':
      return ANDROID_KEYCODE_BACK;
    case 'home':
      return ANDROID_KEYCODE_HOME;
    case 'menu':
      return ANDROID_KEYCODE_MENU;
    case 'recent':
      return ANDROID_KEYCODE_RECENT;
    case 'power':
      return ANDROID_KEYCODE_POWER;
    case 'volumeup':
      return ANDROID_KEYCODE_VOLUME_UP;
    case 'volumedown':
      return ANDROID_KEYCODE_VOLUME_DOWN;
    case 'mute':
      return ANDROID_KEYCODE_MUTE;
    default:
      return 0;
  }
};

const mapBrowserCodeToAndroidKeyCode = (code: string) => {
  switch (code) {
    case 'Enter':
    case 'NumpadEnter':
      return 66;
    case 'Escape':
      return 111;
    case 'Backspace':
      return 67;
    case 'Tab':
      return 61;
    case 'Space':
      return 62;
    case 'ArrowUp':
      return 19;
    case 'ArrowDown':
      return 20;
    case 'ArrowLeft':
      return 21;
    case 'ArrowRight':
      return 22;
    case 'ShiftLeft':
    case 'ShiftRight':
      return 59;
    case 'ControlLeft':
    case 'ControlRight':
      return 113;
    case 'AltLeft':
    case 'AltRight':
      return 57;
    default:
      break;
  }

  if (code.startsWith('Key') && code.length === 4) {
    return 29 + (code.charCodeAt(3) - 65);
  }

  if (code.startsWith('Digit') && code.length === 6) {
    const digit = code.charCodeAt(5) - 48;
    if (digit >= 0 && digit <= 9) {
      return digit === 0 ? 7 : 8 + digit - 1;
    }
  }

  return 0;
};

const mapBrowserCodeToHidKey = (code: string) => {
  switch (code) {
    case 'KeyA': return 0x04;
    case 'KeyB': return 0x05;
    case 'KeyC': return 0x06;
    case 'KeyD': return 0x07;
    case 'KeyE': return 0x08;
    case 'KeyF': return 0x09;
    case 'KeyG': return 0x0a;
    case 'KeyH': return 0x0b;
    case 'KeyI': return 0x0c;
    case 'KeyJ': return 0x0d;
    case 'KeyK': return 0x0e;
    case 'KeyL': return 0x0f;
    case 'KeyM': return 0x10;
    case 'KeyN': return 0x11;
    case 'KeyO': return 0x12;
    case 'KeyP': return 0x13;
    case 'KeyQ': return 0x14;
    case 'KeyR': return 0x15;
    case 'KeyS': return 0x16;
    case 'KeyT': return 0x17;
    case 'KeyU': return 0x18;
    case 'KeyV': return 0x19;
    case 'KeyW': return 0x1a;
    case 'KeyX': return 0x1b;
    case 'KeyY': return 0x1c;
    case 'KeyZ': return 0x1d;
    case 'Digit1': return 0x1e;
    case 'Digit2': return 0x1f;
    case 'Digit3': return 0x20;
    case 'Digit4': return 0x21;
    case 'Digit5': return 0x22;
    case 'Digit6': return 0x23;
    case 'Digit7': return 0x24;
    case 'Digit8': return 0x25;
    case 'Digit9': return 0x26;
    case 'Digit0': return 0x27;
    case 'Enter':
    case 'NumpadEnter': return 0x28;
    case 'Escape': return 0x29;
    case 'Backspace': return 0x2a;
    case 'Tab': return 0x2b;
    case 'Space': return 0x2c;
    case 'Minus': return 0x2d;
    case 'Equal': return 0x2e;
    case 'BracketLeft': return 0x2f;
    case 'BracketRight': return 0x30;
    case 'Backslash': return 0x31;
    case 'Semicolon': return 0x33;
    case 'Quote': return 0x34;
    case 'Backquote': return 0x35;
    case 'Comma': return 0x36;
    case 'Period': return 0x37;
    case 'Slash': return 0x38;
    case 'CapsLock': return 0x39;
    case 'F1': return 0x3a;
    case 'F2': return 0x3b;
    case 'F3': return 0x3c;
    case 'F4': return 0x3d;
    case 'F5': return 0x3e;
    case 'F6': return 0x3f;
    case 'F7': return 0x40;
    case 'F8': return 0x41;
    case 'F9': return 0x42;
    case 'F10': return 0x43;
    case 'F11': return 0x44;
    case 'F12': return 0x45;
    case 'ArrowRight': return 0x4f;
    case 'ArrowLeft': return 0x50;
    case 'ArrowDown': return 0x51;
    case 'ArrowUp': return 0x52;
    case 'ControlLeft': return 0xe0;
    case 'ShiftLeft': return 0xe1;
    case 'AltLeft': return 0xe2;
    case 'MetaLeft': return 0xe3;
    case 'ControlRight': return 0xe4;
    case 'ShiftRight': return 0xe5;
    case 'AltRight': return 0xe6;
    case 'MetaRight': return 0xe7;
    default:
      return 0;
  }
};

const mapMouseButtonToHidMask = (button: number) => {
  switch (button) {
    case 0: return 0x01;
    case 1: return 0x04;
    case 2: return 0x02;
    case 3: return 0x08;
    case 4: return 0x10;
    default: return 0;
  }
};

const clampSignedByte = (value: number) => Math.max(-127, Math.min(127, value)) | 0;

const initializeHidDevices = () => {
  if (isHidMouseEnabled.value) {
    sendMetaControlMessage(buildUhidCreateMessage(SCRCPY_HID_MOUSE_ID, RELATIVE_MOUSE_REPORT_DESC));
    currentHidMouseButtons = 0;
  }

  if (isHidKeyboardEnabled.value) {
    sendMetaControlMessage(buildUhidCreateMessage(SCRCPY_HID_KEYBOARD_ID, KEYBOARD_REPORT_DESC));
    pressedHidKeys.clear();
  }
};

const resetHidInputs = () => {
  if (isHidMouseEnabled.value) {
    currentHidMouseButtons = 0;
    sendBinaryControlMessage(buildUhidInputMessage(SCRCPY_HID_MOUSE_ID, buildHidMouseReport(0, 0, 0, 0, 0)));
  }

  if (isHidKeyboardEnabled.value) {
    pressedHidKeys.clear();
    sendBinaryControlMessage(buildUhidInputMessage(SCRCPY_HID_KEYBOARD_ID, buildHidKeyboardReport()));
  }
};

const releaseHidDevices = () => {
  resetHidInputs();

  if (isHidMouseEnabled.value) {
    sendMetaControlMessage(buildUhidDestroyMessage(SCRCPY_HID_MOUSE_ID));
  }

  if (isHidKeyboardEnabled.value) {
    sendMetaControlMessage(buildUhidDestroyMessage(SCRCPY_HID_KEYBOARD_ID));
  }

  currentHidMouseButtons = 0;
  pressedHidKeys.clear();
};

const sendAndroidCommand = (action: string) => {
  const normalized = action.toLowerCase();
  if (normalized === 'screenon' || normalized === 'screenoff') {
    sendBinaryControlMessage(buildScreenPowerMessage(normalized === 'screenon'));
    return;
  }

  const keycode = mapAndroidCommandToKeycode(normalized);
  if (!keycode) {
    return;
  }

  sendBinaryControlMessage(buildInjectKeycodeMessage(SCRCPY_ACTION_DOWN, keycode));
  sendBinaryControlMessage(buildInjectKeycodeMessage(SCRCPY_ACTION_UP, keycode));
};

const sendKeyboardEvent = (phase: 'down' | 'up', event: KeyboardEvent) => {
  if (isHidKeyboardEnabled.value) {
    const hidKey = mapBrowserCodeToHidKey(event.code);
    if (!hidKey) {
      return;
    }

    if (phase === 'down') {
      pressedHidKeys.add(hidKey);
    } else {
      pressedHidKeys.delete(hidKey);
    }

    sendBinaryControlMessage(buildUhidInputMessage(SCRCPY_HID_KEYBOARD_ID, buildHidKeyboardReport()));
    return;
  }

  const keyCode = mapBrowserCodeToAndroidKeyCode(event.code);
  if (!keyCode) {
    return;
  }

  sendBinaryControlMessage(
    buildInjectKeycodeMessage(
      phase === 'down' ? SCRCPY_ACTION_DOWN : SCRCPY_ACTION_UP,
      keyCode,
      phase === 'down' && event.repeat ? 1 : 0
    )
  );
};

const sendHidMouseEvent = (payload: { phase: 'down' | 'up' | 'move' | 'wheel'; button?: number; dx?: number; dy?: number; wheelX?: number; wheelY?: number }) => {
  if (!isHidMouseEnabled.value) {
    return;
  }

  const highFrequencyChannel =
    pointerMoveChannel?.readyState === 'open'
      ? pointerMoveChannel
      : dataChannel;

  switch (payload.phase) {
    case 'down':
    case 'up': {
      const mask = mapMouseButtonToHidMask(payload.button ?? 0);
      if (!mask) {
        return;
      }

      if (payload.phase === 'down') {
        currentHidMouseButtons |= mask;
      } else {
        currentHidMouseButtons &= ~mask;
      }

      sendBinaryControlMessage(
        buildUhidInputMessage(SCRCPY_HID_MOUSE_ID, buildHidMouseReport(currentHidMouseButtons, 0, 0, 0, 0))
      );
      return;
    }
    case 'move':
      if (highFrequencyChannel?.bufferedAmount && highFrequencyChannel.bufferedAmount > POINTER_MOVE_BUFFER_LIMIT) {
        return;
      }
      sendBinaryControlMessage(
        buildUhidInputMessage(
          SCRCPY_HID_MOUSE_ID,
          buildHidMouseReport(
            currentHidMouseButtons,
            clampSignedByte(payload.dx ?? 0),
            clampSignedByte(payload.dy ?? 0),
            0,
            0
          )
        ),
        highFrequencyChannel
      );
      return;
    case 'wheel':
      if (highFrequencyChannel?.bufferedAmount && highFrequencyChannel.bufferedAmount > POINTER_MOVE_BUFFER_LIMIT) {
        return;
      }
      sendBinaryControlMessage(
        buildUhidInputMessage(
          SCRCPY_HID_MOUSE_ID,
          buildHidMouseReport(
            currentHidMouseButtons,
            0,
            0,
            clampSignedByte(-(payload.wheelY ?? 0)),
            clampSignedByte(payload.wheelX ?? 0)
          )
        ),
        highFrequencyChannel
      );
      return;
  }
};

const syncPointerLockState = () => {
  isMouseLocked.value = document.pointerLockElement === videoElement.value;
};

const requestMouseLock = async () => {
  if (!videoElement.value || !isHidMouseEnabled.value) {
    return;
  }

  try {
    await videoElement.value.requestPointerLock();
  } catch (error) {
    console.warn('Pointer lock request failed:', error);
  } finally {
    syncPointerLockState();
  }
};

const releaseMouseLock = async () => {
  if (document.pointerLockElement) {
    await document.exitPointerLock();
  }
  syncPointerLockState();
};

const toggleMouseLock = async () => {
  if (!isHidMouseEnabled.value) {
    return;
  }

  if (isMouseLocked.value) {
    await releaseMouseLock();
    return;
  }

  await requestMouseLock();
};

const clearPendingResumePlayback = () => {
  if (pendingResumePlaybackTimer != null) {
    window.clearTimeout(pendingResumePlaybackTimer);
    pendingResumePlaybackTimer = null;
  }
};

const resumeMediaPlayback = async () => {
  const playTargets = [videoElement.value, audioElement.value, getPersistentAudioElement()].filter(
    (element): element is HTMLMediaElement => element != null
  );
  if (playTargets.length === 0) return;

  try {
    syncBackgroundMuteState();

    for (const element of playTargets) {
      if (!element.srcObject || !element.paused) {
        continue;
      }

      await element.play();
    }

    status.value = '已连接'
  } catch (error: any) {
    if (error.name === 'AbortError') {
      console.log('Play request aborted due to new load, ignoring.');
    } else {
      console.warn('Media play failed:', error);
      status.value = '已连接，点击播放按钮恢复音频';
    }
  }
};

const scheduleResumeMediaPlayback = (delayMs = 40) => {
  clearPendingResumePlayback();
  pendingResumePlaybackTimer = window.setTimeout(() => {
    pendingResumePlaybackTimer = null;
    void resumeMediaPlayback();
  }, delayMs);
};

const replaceSingleTrack = (stream: MediaStream, track: MediaStreamTrack) => {
  for (const existingTrack of stream.getTracks()) {
    stream.removeTrack(existingTrack);
  }

  stream.addTrack(track);
};

const applyLowLatencyTrackHints = (event: RTCTrackEvent) => {
  const receiver = event.receiver as RTCRtpReceiver & {
    playoutDelayHint?: number;
    jitterBufferTarget?: number | null;
  };

  if (event.track.kind === 'video') {
    event.track.contentHint = 'motion';
  }

  if ('playoutDelayHint' in receiver) {
    receiver.playoutDelayHint = 0;
  }

  if ('jitterBufferTarget' in receiver) {
    receiver.jitterBufferTarget = 0;
  }
};

const bindVideoTrack = (event: RTCTrackEvent) => {
  if (!videoElement.value) return;

  replaceSingleTrack(remoteVideoStream, event.track);
  if (videoElement.value.srcObject !== remoteVideoStream) {
    videoElement.value.srcObject = remoteVideoStream;
  }
  startVideoFrameMonitor(activeConnectionId);
  clearPendingVideoRecovery();
  scheduleSignalingDetach(activeConnectionId);
};

const bindAudioTrack = (event: RTCTrackEvent) => {
  const backgroundAudioElement = getPersistentAudioElement();
  replaceSingleTrack(remoteAudioStream, event.track);
  if (audioElement.value) {
    if (audioElement.value.srcObject !== remoteAudioStream) {
      audioElement.value.srcObject = remoteAudioStream;
    }
  }
  if (backgroundAudioElement.srcObject !== remoteAudioStream) {
    backgroundAudioElement.srcObject = remoteAudioStream;
  }

  syncBackgroundMuteState();
};

const requestFullscreen = async () => {
  const target = shellElement.value ?? videoContainer.value ?? videoElement.value;
  if (!target || document.fullscreenElement === target) return;
  try {
    await target.requestFullscreen();
  } catch (error) {
    console.warn('Fullscreen request failed:', error);
  }
};

const toggleFullscreen = async () => {
  if (document.fullscreenElement) {
    await document.exitFullscreen();
  } else {
    await requestFullscreen();
  }
};

const toggleFillMode = () => {
  if (isFlexDisplayEnabled.value) {
    return;
  }

  shouldFillVideoFrame.value = !shouldFillVideoFrame.value;
};

const attachRemoteTrack = async (event: RTCTrackEvent) => {
  console.log('[WebRTC] Track arrived:', event.track.kind, 'streams:', event.streams?.length || 0);

  if (event.track.kind !== 'audio' && event.track.kind !== 'video') {
    return;
  }

  applyLowLatencyTrackHints(event);

  const trackKind = event.track.kind;
  remoteTracks.set(trackKind, event.track);
  event.track.onended = () => {
    if (remoteTracks.get(trackKind) === event.track) {
      remoteTracks.delete(trackKind);
      if (trackKind === 'video') {
        remoteVideoStream = new MediaStream();
        if (videoElement.value) {
          videoElement.value.srcObject = null;
        }
      } else {
        remoteAudioStream = new MediaStream();
        if (audioElement.value) {
          audioElement.value.srcObject = null;
        }
        getPersistentAudioElement().srcObject = null;
      }
      persistCurrentConnection();

      if (trackKind === 'video' && !suppressAutoReconnect) {
        console.warn('[WebRTC] Remote video track ended.', {
          deviceId: deviceId.value,
          tabKey: activeTabKey.value,
          wsReadyState: ws?.readyState ?? null,
          peerConnectionState: peerConnection?.connectionState ?? null
        });
        stopConnection();
        scheduleReconnect('remote_video_track_ended');
      }
    }
  };

  if (trackKind === 'video') {
    bindVideoTrack(event);
  } else {
    bindAudioTrack(event);
  }
  persistCurrentConnection();

  scheduleResumeMediaPlayback();

  syncVideoFrameSize();
};

const cleanupMediaStream = () => {
  stopVideoFrameCaptureLoop();
  stopVideoFreezeWatchdog();
  resetVideoFreezeState();
  clearPendingReconnect();
  clearPendingResumePlayback();
  lastVideoFrameSize = { width: 0, height: 0 };
  shouldShowLastFrameOverlay.value = false;
  if (videoElement.value) {
    videoElement.value.pause();
    videoElement.value.srcObject = null;
  }
  if (audioElement.value) {
    audioElement.value.pause();
    audioElement.value.srcObject = null;
  }
  const backgroundAudioElement = getPersistentAudioElement();
  backgroundAudioElement.pause();
  backgroundAudioElement.srcObject = null;
  remoteTracks.clear();
  remoteVideoStream = new MediaStream();
  remoteAudioStream = new MediaStream();
};

const wirePeerConnectionEventHandlers = (connectionId: number, targetPeerConnection: RTCPeerConnection) => {
  if (!targetPeerConnection) return;

  targetPeerConnection.ontrack = (event) => {
    if (connectionId !== activeConnectionId || peerConnection !== targetPeerConnection) {
      return;
    }
    console.log('[WebRTC] ontrack fired:', event.track.kind);
    void attachRemoteTrack(event);
  };

  targetPeerConnection.onicecandidate = (event) => {
    if (connectionId !== activeConnectionId || peerConnection !== targetPeerConnection) {
      return;
    }
    if (event.candidate && ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event.candidate));
    }
  };

  targetPeerConnection.onconnectionstatechange = () => {
    if (connectionId !== activeConnectionId || peerConnection !== targetPeerConnection) {
      return;
    }
    status.value = `WebRTC 状态: ${peerConnection.connectionState}`;
    isConnected.value = peerConnection.connectionState === 'connected';
    console.debug('[WebRTC] Peer connection state changed:', peerConnection.connectionState, {
      deviceId: deviceId.value,
      tabKey: activeTabKey.value
    });

  if (peerConnection.connectionState === 'connected') {
    isConnecting.value = false;
    clearPendingReconnect();
    clearPendingIceRestartFallback();
    isIceRestartInFlight = false;
    reconnectAttempt = 0;
    startScrcpySessionHeartbeat(deviceId.value, currentScrcpySessionId);
    startVideoFrameMonitor(connectionId);
    scheduleDisplayResize(150);
    scheduleSignalingDetach(connectionId);
    if (!remoteTracks.has('video')) {
        scheduleVideoRecovery(connectionId, 'peer_connected_without_video');
      }
    }

    if (peerConnection.connectionState === 'failed' || peerConnection.connectionState === 'disconnected' || peerConnection.connectionState === 'closed') {
      isConnecting.value = false;
      if (peerConnection.connectionState === 'closed') {
        stopConnection();
        scheduleReconnect('peer_connection_closed');
        return;
      }

      void (async () => {
        const restarted = await tryIceRestart(`peer_connection_${peerConnection.connectionState}`);
        if (!restarted) {
          stopConnection();
          scheduleReconnect(`peer_connection_${peerConnection.connectionState}`);
        }
      })();
      return;
    }

    persistCurrentConnection();
  };

  targetPeerConnection.oniceconnectionstatechange = () => {
    if (connectionId !== activeConnectionId || peerConnection !== targetPeerConnection) {
      return;
    }

    const currentIceState = targetPeerConnection.iceConnectionState;
    console.debug('[WebRTC] ICE connection state changed:', currentIceState, {
      deviceId: deviceId.value,
      tabKey: activeTabKey.value
    });

    if (currentIceState === 'connected' || currentIceState === 'completed') {
      scheduleSignalingDetach(connectionId);
      if (!remoteTracks.has('video')) {
        scheduleVideoRecovery(connectionId, `ice_${currentIceState}_without_video`);
      }
      return;
    }

    if (currentIceState === 'closed') {
      stopConnection();
      scheduleReconnect('ice_connection_closed');
    }
  };

  targetPeerConnection.ondatachannel = (event) => {
    if (connectionId !== activeConnectionId || peerConnection !== targetPeerConnection) {
      return;
    }
    if (event.channel.label === 'pointer-move') {
      setupPointerMoveChannel(event.channel);
    } else {
      setupControlChannel(event.channel);
    }
  };
};

const wireWebSocketEventHandlers = (connectionId: number, targetSocket: WebSocket) => {
  if (!targetSocket) return;
  const persistedTabKey = activeTabKey.value;

  targetSocket.onmessage = async (event) => {
    if (connectionId !== activeConnectionId || ws !== targetSocket) {
      return;
    }
    const message = JSON.parse(event.data);
    if (message?.candidate && peerConnection) {
      const candidate = normalizeIceCandidate(message);
      if (candidate) {
        if (peerConnection.remoteDescription) {
          try {
            await peerConnection.addIceCandidate(candidate);
          } catch (error) {
            console.warn('Ignored ICE candidate:', candidate, error);
          }
        } else {
          pendingCandidates.push(candidate);
        }
      }
    } else if (message?.sdp && peerConnection && message.type === 'answer') {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(message));
      clearPendingIceRestartFallback();
      isIceRestartInFlight = false;
      scheduleVideoRecovery(connectionId, 'remote_answer_applied');
      for (const candidate of pendingCandidates) {
        try {
          await peerConnection.addIceCandidate(candidate);
        } catch (error) {
          console.warn('Ignored queued ICE candidate:', candidate, error);
        }
      }
      pendingCandidates = [];
      persistCurrentConnection();
    }
  };

  targetSocket.onerror = () => {
    if (connectionId !== activeConnectionId || ws !== targetSocket) {
      return;
    }
    status.value = 'WebSocket 连接出错';
    isConnecting.value = false;
  };

  targetSocket.onclose = () => {
    if (connectionId !== activeConnectionId || ws !== targetSocket) {
      return;
    }
    const wasIntentionalDetach = expectedSignalingCloseConnectionId === connectionId;
    expectedSignalingCloseConnectionId = 0;
    ws = null;
    clearPersistedConnection(persistedTabKey);
    const currentState = peerConnection?.connectionState;
    if (currentState === 'connected' || currentState === 'connecting') {
      detachedSignalingConnectionId = connectionId;
      status.value = wasIntentionalDetach ? '媒体已直连，信令已断开' : '信令连接已断开，媒体链路继续运行';
      console.warn('[WebRTC] Signaling websocket closed while peer connection is still active.', {
        deviceId: deviceId.value,
        tabKey: activeTabKey.value,
        peerConnectionState: currentState,
        intentionalDetach: wasIntentionalDetach
      });
      return;
    }

    detachedSignalingConnectionId = 0;
    status.value = '信令连接已断开';
    stopConnection();
    scheduleReconnect('websocket_closed');
  };
};

const startConnection = async (bypassStartGuard = false) => {
  if (!deviceId.value) {
    return;
  }

  const targetTabKey = activeTabKey.value;
  if (!targetTabKey) {
    return;
  }
  if (!bypassStartGuard && activeConnectionTargetKey === targetTabKey && (isStartConnectionInFlight || hasLiveConnection())) {
    return;
  }

  const token = getAccessToken();
  if (!token) {
    router.push('/login');
    return;
  }

  const previousDeviceId = deviceId.value;
  const previousSessionId = currentScrcpySessionId;
  stopScrcpySessionHeartbeat();
  if (previousSessionId) {
    void postScrcpySessionAction('release', previousDeviceId, previousSessionId);
  }
  disposeAllPersistedConnections();
  stopConnection();
  enableAutoReconnect();
  resetSignalingDetachState();
  isStartConnectionInFlight = true;
  activeConnectionTargetKey = targetTabKey;
  isConnecting.value = true;
  status.value = '正在连接设备...';
  pendingCandidates = [];
  const connectionId = ++activeConnectionId;

  try {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    let wsUrl = import.meta.env.DEV ? 'ws://127.0.0.1:5501/webrtc' : `${protocol}//${host}/webrtc`;
    const initialNewDisplaySize = isNewDisplayMode.value ? buildAdaptiveDisplaySize() : null;
    const ticketResponse = await apiFetch('/api/webrtc-ticket', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: deviceId.value,
          appPackage: appPackageName.value || undefined,
          appName: appDisplayName.value || undefined,
          newDisplay: isNewDisplayMode.value,
          newDisplayWidth: initialNewDisplaySize?.width,
          newDisplayHeight: initialNewDisplaySize?.height,
          newDisplayDpi: resolvedNewDisplayDpi.value ?? undefined,
        })
      });

    if (!ticketResponse.ok) {
      status.value = '创建连接凭据失败';
      isConnecting.value = false;
      clearStartConnectionState();
      scheduleReconnect(`ticket_${ticketResponse.status}`);
      return;
    }
    const ticketPayload = await ticketResponse.json();
    currentScrcpySessionId = String(ticketPayload.sessionId ?? '');
    wsUrl += `?ticket=${encodeURIComponent(ticketPayload.ticket)}`;

    ws = new WebSocket(wsUrl);
    const socket = ws;

    ws.onopen = async () => {
      if (connectionId !== activeConnectionId || ws !== socket) {
        return;
      }
      clearStartConnectionState();
      status.value = '正在创建 WebRTC 会话...';
      startScrcpySessionHeartbeat(deviceId.value, currentScrcpySessionId);

      try {
        const rtcConfiguration = await loadRtcConfiguration();
        peerConnection = new RTCPeerConnection(rtcConfiguration);
        const currentPeerConnection = peerConnection;

        peerConnection.addTransceiver('video', { direction: 'recvonly' });
        peerConnection.addTransceiver('audio', { direction: 'recvonly' });
        setupControlChannel(peerConnection.createDataChannel('control'));
        setupMetaControlChannel(peerConnection.createDataChannel('control-meta'));
        setupPointerMoveChannel(peerConnection.createDataChannel('pointer-move', { ordered: false, maxRetransmits: 0 }));
        wirePeerConnectionEventHandlers(connectionId, currentPeerConnection);

        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        ws?.send(JSON.stringify(peerConnection.localDescription));
      } catch (error) {
        console.error('Failed to create WebRTC offer:', error);
        status.value = '创建 Offer 失败';
        isConnecting.value = false;
        clearStartConnectionState();
        stopConnection();
        scheduleReconnect('offer_create_failed');
      }
    };

    wireWebSocketEventHandlers(connectionId, socket);

    persistCurrentConnection();
  } catch (error) {
    console.error('Failed to start WebRTC connection:', error);
    status.value = '连接初始化失败，准备重试...';
    isConnecting.value = false;
    clearStartConnectionState();
    stopConnection();
    scheduleReconnect('connection_bootstrap_failed');
  }
};

const detachActiveConnectionFromView = () => {
  activeConnectionId++;
  stopFlexDisplayHeartbeat();
  clearPendingDisplayResize();
  activePointers.clear();
  pointerGenerations.clear();
  scrcpyPointerIds.clear();
  currentScrcpySessionId = '';
  pendingPointerReleases.clear();
  queuedPointerReleases.clear();
  pendingPointerMoves.clear();
  pendingPointerControlPayloads.length = 0;
  isStartConnectionInFlight = false;
  activeConnectionTargetKey = '';
  stopVideoFrameCaptureLoop();
  resetSignalingDetachState();
  stopPointerControlFlushLoop();
  stopPointerReleaseFlushLoop();
  clearPendingIceRestartFallback();
  clearPendingVideoRecovery();
  isIceRestartInFlight = false;
  peerConnection = null;
  ws = null;
  dataChannel = null;
  metaControlChannel = null;
  pointerMoveChannel = null;
  pendingCandidates = [];
  remoteTracks.clear();
  remoteVideoStream = new MediaStream();
  remoteAudioStream = new MediaStream();
  clearPendingReconnect();
  clearPendingStartConnection();
  clearPendingDisplayResize();
  lastDisplayResizeRequest = null;
  isConnected.value = false;
  isConnecting.value = false;
  status.value = '未连接';
  showLastFrameOverlayForTab();

  if (videoElement.value) {
    videoElement.value.pause();
    videoElement.value.srcObject = null;
  }

  if (audioElement.value) {
    audioElement.value.pause();
    audioElement.value.srcObject = null;
  }
};

const stopConnection = (preserveForBackground = false, preserveTabKey = activeTabKey.value) => {
  stopScrcpySessionHeartbeat();
  stopFlexDisplayHeartbeat();
  stopVideoFreezeWatchdog();
  clearPendingDisplayResize();
  activePointers.clear();
  pointerGenerations.clear();
  scrcpyPointerIds.clear();
  currentScrcpySessionId = '';
  nextScrcpyPointerId = 0n;
  pendingPointerReleases.clear();
  queuedPointerReleases.clear();
  pendingPointerMoves.clear();
  pendingPointerControlPayloads.length = 0;
  isStartConnectionInFlight = false;
  activeConnectionTargetKey = '';
  resetSignalingDetachState();
  stopPointerControlFlushLoop();
  stopPointerReleaseFlushLoop();
  clearPendingIceRestartFallback();
  clearPendingVideoRecovery();
  isIceRestartInFlight = false;

  if (preserveForBackground && hasLiveConnection()) {
    captureCurrentVideoFrame(preserveTabKey);
    persistCurrentConnection(preserveTabKey);
    detachActiveConnectionFromView();
    return;
  }

  activeConnectionId++;
  releaseHidDevices();

  if (dataChannel) {
    dataChannel.close();
    dataChannel = null;
  }
  if (pointerMoveChannel) {
    pointerMoveChannel.close();
    pointerMoveChannel = null;
  }

  if (metaControlChannel) {
    metaControlChannel.close();
    metaControlChannel = null;
  }
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  if (ws) {
    const socket = ws;
    ws = null;
    socket.onclose = null;
    socket.close();
  }

  cleanupMediaStream();
  clearPersistedConnection();
  pendingCandidates = [];
  clearPendingReconnect();
  clearPendingStartConnection();
  lastDisplayResizeRequest = null;
  isConnected.value = false;
  isConnecting.value = false;
  status.value = '未连接';
};

const activateTab = async (tabKey: string) => {
  if (tabKey === activeTabKey.value && peerConnection) {
    return;
  }

  const tab = castTabs.value.find((item) => item.key === tabKey);
  if (!tab) {
    return;
  }

  const previousTabKey = activeTabKey.value;
  if (previousTabKey && previousTabKey !== tab.key) {
    captureCurrentVideoFrame(previousTabKey);
    disableAutoReconnect();
    stopConnection();
  }

  activeTabKey.value = tab.key;
  enableAutoReconnect();
  syncRefsFromActiveTab();
  showLastFrameOverlayForTab(tab.key);
  persistTabs();
  await syncRouteToActiveTab();
  await fetchDeviceName();
  await fetchDeviceSettings();
  if (deviceId.value) {
    scheduleStartConnection();
  }
};

const closeTab = async (tabKey: string) => {
  const closingActive = tabKey === activeTabKey.value;
  const closingIndex = castTabs.value.findIndex((item) => item.key === tabKey);
  if (closingIndex < 0) {
    return;
  }

  const closingTab = castTabs.value[closingIndex];
  const closingPersistedConnection = getPersistedConnection(tabKey);
  const closingSessionId = closingActive
    ? currentScrcpySessionId
    : (closingPersistedConnection?.sessionId ?? '');
  castTabs.value.splice(closingIndex, 1);

  if (!closingActive) {
    disposePersistedConnection(tabKey);
    void postScrcpySessionAction('release', closingTab?.deviceId ?? '', closingSessionId);
    persistTabs();
    return;
  }

  disableAutoReconnect();
  const activeSessionId = currentScrcpySessionId;
  stopConnection();
  clearPersistedConnection(tabKey);
  void postScrcpySessionAction('release', deviceId.value, activeSessionId);

  const nextTab = castTabs.value[closingIndex] ?? castTabs.value[closingIndex - 1] ?? null;
  activeTabKey.value = nextTab?.key ?? '';
  enableAutoReconnect();
  syncRefsFromActiveTab();
  persistTabs();
  await syncRouteToActiveTab();
  if (nextTab) {
    await fetchDeviceName();
    await fetchDeviceSettings();
    scheduleStartConnection();
  }
};

const loadPersistedTabs = () => {
  try {
    const rawTabs = sessionStorage.getItem(CAST_TABS_STORAGE_KEY);
    const rawActiveTab = sessionStorage.getItem(CAST_ACTIVE_TAB_STORAGE_KEY) ?? '';
    const parsedTabs = rawTabs ? JSON.parse(rawTabs) : [];
    if (Array.isArray(parsedTabs)) {
      castTabs.value = parsedTabs
        .filter((item): item is CastTab => !!item && typeof item.key === 'string' && typeof item.deviceId === 'string')
        .map((item) => ({
          key: item.key,
          deviceId: item.deviceId,
          appPackageName: item.appPackageName ?? '',
          appDisplayName: item.appDisplayName ?? '',
          deviceName: item.deviceName ?? '设备投屏',
          newDisplay: item.newDisplay === true
        }));
    }
    activeTabKey.value = castTabs.value.some((item) => item.key === rawActiveTab)
      ? rawActiveTab
      : castTabs.value[0]?.key ?? '';
    syncRefsFromActiveTab();
    lastPersistedTabsSnapshot = JSON.stringify(castTabs.value);
    lastPersistedActiveTabKey = activeTabKey.value;
  } catch (error) {
    console.warn('Failed to restore cast tabs:', error);
    castTabs.value = [];
    activeTabKey.value = '';
    syncRefsFromActiveTab();
    lastPersistedTabsSnapshot = JSON.stringify(castTabs.value);
    lastPersistedActiveTabKey = activeTabKey.value;
  }
};

const getVideoViewport = () => {
  if (!videoElement.value) return null;
  const rect = videoElement.value.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;

  const videoWidth = videoElement.value.videoWidth || rect.width;
  const videoHeight = videoElement.value.videoHeight || rect.height;
  if (videoWidth <= 0 || videoHeight <= 0) return null;

  if (effectiveFillMode.value) {
    return {
      offsetX: rect.left,
      offsetY: rect.top,
      displayWidth: rect.width,
      displayHeight: rect.height,
      frameWidth: Math.round(videoWidth),
      frameHeight: Math.round(videoHeight)
    };
  }

  const scale = Math.min(rect.width / videoWidth, rect.height / videoHeight);
  const displayWidth = videoWidth * scale;
  const displayHeight = videoHeight * scale;
  const offsetX = rect.left + (rect.width - displayWidth) / 2;
  const offsetY = rect.top + (rect.height - displayHeight) / 2;

  return {
    offsetX,
    offsetY,
    displayWidth,
    displayHeight,
    frameWidth: Math.round(videoWidth),
    frameHeight: Math.round(videoHeight)
  };
};

const getPointerRatios = (event: PointerEvent) => {
  const viewport = getVideoViewport();
  if (!viewport) return null;

  const xRatio = (event.clientX - viewport.offsetX) / viewport.displayWidth;
  const yRatio = (event.clientY - viewport.offsetY) / viewport.displayHeight;
  return {
    xRatio: Math.min(1, Math.max(0, xRatio)),
    yRatio: Math.min(1, Math.max(0, yRatio)),
    frameWidth: viewport.frameWidth,
    frameHeight: viewport.frameHeight
  };
};

const clearLocalPointerState = (pointerId: number) => {
  activePointers.delete(pointerId);
  pendingPointerReleases.delete(pointerId);
  queuedPointerReleases.delete(pointerId);
  pendingPointerMoves.delete(pointerId);
  pointerGenerations.delete(pointerId);
  pointerSnapshots.delete(pointerId);
  releaseScrcpyPointerId(pointerId);
  try {
    videoElement.value?.releasePointerCapture?.(pointerId);
  } catch {
    // Ignore release failures when the browser has already dropped capture.
  }
};

const getPointerGeneration = (pointerId: number) => pointerGenerations.get(pointerId) ?? 0;

const bumpPointerGeneration = (pointerId: number) => {
  const nextGeneration = getPointerGeneration(pointerId) + 1;
  pointerGenerations.set(pointerId, nextGeneration);
  return nextGeneration;
};

const finalizePointerRelease = (pointerId: number, releaseGeneration: number) => {
  pendingPointerReleases.delete(pointerId);
  queuedPointerReleases.delete(pointerId);
  pendingPointerMoves.delete(pointerId);

  if (getPointerGeneration(pointerId) !== releaseGeneration || activePointers.has(pointerId)) {
    return;
  }

  clearLocalPointerState(pointerId);
};

const flushPendingPointerReleases = () => {
  flushPendingPointerControlPayloads();
  for (const [pointerId, phase] of [...pendingPointerReleases.entries()]) {
    if (queuedPointerReleases.has(pointerId)) {
      continue;
    }
    releasePointer(pointerId, phase);
  }

  if (pendingPointerReleases.size > 0) {
    schedulePointerReleaseFlush();
    return;
  }

  stopPointerReleaseFlushLoop();
};

const schedulePointerReleaseFlush = () => {
  if (pointerReleaseFlushHandle != null || pendingPointerReleases.size === 0) {
    return;
  }

  pointerReleaseFlushHandle = window.requestAnimationFrame(() => {
    pointerReleaseFlushHandle = null;
    flushPendingPointerReleases();
  });
};

const schedulePointerMoveFlush = () => {
  if ((pointerMoveFlushHandle != null || pointerMoveSampleTimer != null) || pendingPointerMoves.size === 0) {
    return;
  }

  const now = performance.now();
  const elapsed = now - lastPointerMoveFlushAt;
  const delayMs = Math.max(0, POINTER_MOVE_SAMPLE_INTERVAL_MS - elapsed);

  const requestFlushFrame = () => {
    pointerMoveSampleTimer = null;
    pointerMoveFlushHandle = window.requestAnimationFrame(() => {
      pointerMoveFlushHandle = null;
      flushPendingPointerMoves();
    });
  };

  if (delayMs <= 0) {
    requestFlushFrame();
    return;
  }

  pointerMoveSampleTimer = window.setTimeout(requestFlushFrame, delayMs);
};

const flushPendingPointerMoves = () => {
  flushPendingPointerControlPayloads();
  const channel = getHighFrequencyControlChannel();
  if (!channel || channel.readyState !== 'open') {
    return;
  }

  if (channel.bufferedAmount > POINTER_MOVE_BUFFER_LIMIT) {
    schedulePointerMoveFlush();
    return;
  }

  const moves = [...pendingPointerMoves.values()];
  pendingPointerMoves.clear();
  let sentAnyMove = false;

  for (const move of moves) {
    const pointerId = getScrcpyPointerId(move.pointerId);
    if (pointerId == null) {
      continue;
    }

    const payload = buildTouchMessage(
      SCRCPY_ACTION_MOVE,
      pointerId,
      Math.trunc(move.xRatio * move.frameWidth),
      Math.trunc(move.yRatio * move.frameHeight),
      move.frameWidth,
      move.frameHeight,
      move.pressure,
      0,
      SCRCPY_PRIMARY_BUTTON
    );

    try {
      channel.send(payload);
      sentAnyMove = true;
    } catch (error) {
      console.warn('Pointer move send failed:', error);
      pendingPointerMoves.set(move.pointerId, move);
      schedulePointerMoveFlush();
      return;
    }
  }

  if (pendingPointerMoves.size > 0) {
    schedulePointerMoveFlush();
    return;
  }

  if (sentAnyMove) {
    lastPointerMoveFlushAt = performance.now();
  }
};

const markTouchPointerActivity = () => {
  lastTouchPointerAt = performance.now();
};

const shouldIgnoreCompatMouse = () => performance.now() - lastTouchPointerAt < MOUSE_COMPAT_SUPPRESSION_MS;

const buildQueuedPointerMovePayload = (move: PendingPointerMove) => {
  const pointerId = getScrcpyPointerId(move.pointerId);
  if (pointerId == null) {
    return null;
  }

  return buildTouchMessage(
    SCRCPY_ACTION_MOVE,
    pointerId,
    Math.trunc(move.xRatio * move.frameWidth),
    Math.trunc(move.yRatio * move.frameHeight),
    move.frameWidth,
    move.frameHeight,
    move.pressure,
    0,
    SCRCPY_PRIMARY_BUTTON
  );
};

const buildPointerLifecyclePayloads = (
  phase: 'down' | 'up' | 'cancel',
  event: PointerEvent,
  ratios: ReturnType<typeof getPointerRatios>
) => {
  if (!ratios) {
    return null;
  }

  const action = phase === 'down' ? SCRCPY_ACTION_DOWN : SCRCPY_ACTION_UP;
  const pointerId = action === SCRCPY_ACTION_DOWN
    ? getOrCreateScrcpyPointerId(event.pointerId)
    : getScrcpyPointerId(event.pointerId);
  if (pointerId == null) {
    return null;
  }

  const payloads: Uint8Array[] = [];
  const pendingMove = pendingPointerMoves.get(event.pointerId);
  if (phase !== 'down' && pendingMove) {
    const movePayload = buildQueuedPointerMovePayload(pendingMove);
    if (movePayload) {
      payloads.push(movePayload);
    }
  }

  const x = Math.trunc(ratios.xRatio * ratios.frameWidth);
  const y = Math.trunc(ratios.yRatio * ratios.frameHeight);
  const isUp = action === SCRCPY_ACTION_UP;
  payloads.push(
    buildTouchMessage(
      action,
      pointerId,
      x,
      y,
      ratios.frameWidth,
      ratios.frameHeight,
      isUp ? 0 : (event.pressure || 1),
      SCRCPY_PRIMARY_BUTTON,
      isUp ? 0 : SCRCPY_PRIMARY_BUTTON
    )
  );

  return payloads;
};

const sendPointerMessage = (phase: 'down' | 'up' | 'move' | 'cancel', event: PointerEvent) => {
  const isMove = phase === 'move';
  const channel = isMove ? getHighFrequencyControlChannel() : dataChannel;
  if (!channel || channel.readyState !== 'open') return false;

  const ratios = getPointerRatios(event);
  if (!ratios) return false;

  pointerSnapshots.set(event.pointerId, {
    xRatio: ratios.xRatio,
    yRatio: ratios.yRatio,
    pointerType: event.pointerType || 'touch'
  });

  if (isMove) {
    pendingPointerMoves.set(event.pointerId, {
      pointerId: event.pointerId,
      xRatio: ratios.xRatio,
      yRatio: ratios.yRatio,
      frameWidth: ratios.frameWidth,
      frameHeight: ratios.frameHeight,
      pressure: event.pressure || 1,
    });
    schedulePointerMoveFlush();
    return true;
  }

  const payloads = buildPointerLifecyclePayloads(phase, event, ratios);
  if (!payloads || payloads.length === 0) {
    return false;
  }

  return enqueuePointerPayloadBuffers(payloads);
};

const releasePointer = (pointerId: number, phase: 'up' | 'cancel', event?: PointerEvent) => {
  if (!activePointers.has(pointerId) && !pendingPointerReleases.has(pointerId)) return false;

  if (queuedPointerReleases.has(pointerId)) {
    return true;
  }

  const releaseGeneration = getPointerGeneration(pointerId);
  const finalizeRelease = () => {
    finalizePointerRelease(pointerId, releaseGeneration);
  };

  const attemptRelease = (pointerEvent?: PointerEvent | null) => {
    if (!pointerEvent) {
      return false;
    }

    const ratios = getPointerRatios(pointerEvent);
    if (!ratios) {
      return false;
    }

    const payloads = buildPointerLifecyclePayloads(phase, pointerEvent, ratios);
    if (!payloads || payloads.length === 0) {
      return false;
    }

    pendingPointerReleases.set(pointerId, phase);
    queuedPointerReleases.add(pointerId);
    const queued = enqueuePointerPayloadBuffers(payloads, finalizeRelease);
    if (!queued) {
      queuedPointerReleases.delete(pointerId);
    }
    return queued;
  };

  const pointerEvent = event ?? createSyntheticPointerEvent(pointerId);
  if (attemptRelease(pointerEvent)) {
    return true;
  }

  const fallbackPointerEvent = createSyntheticPointerEvent(pointerId);
  if (attemptRelease(fallbackPointerEvent)) {
    return true;
  }

  if (!fallbackPointerEvent) {
    queuedPointerReleases.delete(pointerId);
    pendingPointerReleases.set(pointerId, phase);
    schedulePointerReleaseFlush();
    return false;
  }

  queuedPointerReleases.delete(pointerId);
  pendingPointerReleases.set(pointerId, phase);
  schedulePointerReleaseFlush();
  return false;
};

const releaseAllPointers = (phase: 'up' | 'cancel' = 'cancel') => {
  pendingPointerMoves.clear();
  stopPointerMoveFlushLoop();

  for (const pointerId of [...activePointers]) {
    releasePointer(pointerId, phase);
  }

  activeMousePointerId = null;
  pointerGenerations.clear();
  scrcpyPointerIds.clear();
};

const releaseLingeringTouchPointers = (nextPointerId: number) => {
  const stalePointerIds = new Set<number>([
    ...activePointers,
    ...pendingPointerReleases.keys(),
    ...queuedPointerReleases,
  ]);

  for (const pointerId of stalePointerIds) {
    if (pointerId === nextPointerId) {
      continue;
    }

    releasePointer(pointerId, 'cancel');
  }
};

const getLatestPointerSample = (event: PointerEvent) => {
  if (typeof event.getCoalescedEvents !== 'function') {
    return event;
  }

  const samples = event.getCoalescedEvents();
  return samples.length > 0 ? samples[samples.length - 1] : event;
};

const handlePointerDown = (event: PointerEvent) => {
  if (event.pointerType === 'mouse') return;
  markTouchPointerActivity();
  if (activePointers.has(event.pointerId) || pendingPointerReleases.has(event.pointerId) || queuedPointerReleases.has(event.pointerId)) {
    releasePointer(event.pointerId, 'cancel');
  }
  releaseLingeringTouchPointers(event.pointerId);
  flushPendingPointerReleases();
  bumpPointerGeneration(event.pointerId);
  videoElement.value?.setPointerCapture?.(event.pointerId);
  if (sendPointerMessage('down', event)) {
    activePointers.add(event.pointerId);
    pendingPointerReleases.delete(event.pointerId);
    return;
  }

  try {
    videoElement.value?.releasePointerCapture?.(event.pointerId);
  } catch {
    // Ignore release failures if capture was never established.
  }
};

const handlePointerMove = (event: PointerEvent) => {
  if (event.pointerType === 'mouse') return;
  markTouchPointerActivity();
  if (!activePointers.has(event.pointerId)) return;
  sendPointerMessage('move', getLatestPointerSample(event));
};

const handlePointerUp = (event: PointerEvent) => {
  if (event.pointerType === 'mouse') return;
  markTouchPointerActivity();
  releasePointer(event.pointerId, 'up', event);
};

const handlePointerCancel = (event: PointerEvent) => {
  if (event.pointerType === 'mouse') return;
  markTouchPointerActivity();
  releasePointer(event.pointerId, 'cancel', event);
};

const handlePointerCaptureLost = (event: PointerEvent) => {
  if (event.pointerType === 'mouse') return;
  markTouchPointerActivity();
  releasePointer(event.pointerId, 'cancel', event);
};

const handleWindowPointerUp = (event: PointerEvent) => {
  if (isDraggingMenu) {
    finishMenuDrag();
    return;
  }

  releasePointer(event.pointerId, 'up', event);
};

const handleWindowPointerCancel = (event: PointerEvent) => {
  if (isDraggingMenu) {
    finishMenuDrag();
  }

  releasePointer(event.pointerId, 'cancel', event);
};

const handleWindowPointerMove = (event: PointerEvent) => {
  if (!isDraggingMenu) return;

  const position = clampMenuPosition(event.clientX - dragStartOffset.x, event.clientY - dragStartOffset.y);
  menuX.value = position.x;
  menuY.value = position.y;
  updateMenuRelativePosition();
  isDocked.value = false;
  dockedEdge.value = 'none';

  const distanceX = Math.abs(event.clientX - dragStartPoint.x);
  const distanceY = Math.abs(event.clientY - dragStartPoint.y);
  if (distanceX > 3 || distanceY > 3) {
    didDragMenu = true;
  }
};

const buildMousePointerEvent = (event: MouseEvent, type: string): PointerEvent | null => {
  if (!videoElement.value) return null;

  return new PointerEvent(type, {
    pointerId: activeMousePointerId ?? 1,
    pointerType: 'mouse',
    isPrimary: true,
    button: event.button,
    buttons: event.buttons,
    clientX: event.clientX,
    clientY: event.clientY,
    pressure: event.buttons === 0 ? 0 : 0.5
  });
};

const handleMouseDown = (event: MouseEvent) => {
  if (isHidMouseEnabled.value && isMouseLocked.value) {
    event.preventDefault();
    sendHidMouseEvent({
      phase: 'down',
      button: event.button
    });
    return;
  }

  if (shouldIgnoreCompatMouse()) return;
  if (event.button !== 0) return;
  event.preventDefault();

  activeMousePointerId = 1;
  const pointerEvent = buildMousePointerEvent(event, 'pointerdown');
  if (!pointerEvent) return;

  if (activePointers.has(activeMousePointerId) || pendingPointerReleases.has(activeMousePointerId) || queuedPointerReleases.has(activeMousePointerId)) {
    releasePointer(activeMousePointerId, 'cancel', pointerEvent);
  }
  bumpPointerGeneration(activeMousePointerId);
  if (sendPointerMessage('down', pointerEvent)) {
    activePointers.add(activeMousePointerId);
    pendingPointerReleases.delete(activeMousePointerId);
  } else {
    activeMousePointerId = null;
  }
};

const handleWindowMouseMove = (event: MouseEvent) => {
  if (isHidMouseEnabled.value && isMouseLocked.value) {
    sendHidMouseEvent({
      phase: 'move',
      dx: Math.round(event.movementX),
      dy: Math.round(event.movementY)
    });
    return;
  }

  if (shouldIgnoreCompatMouse()) return;
  if (activeMousePointerId == null || !activePointers.has(activeMousePointerId)) return;
  const pointerEvent = buildMousePointerEvent(event, 'pointermove');
  if (!pointerEvent) return;
  sendPointerMessage('move', pointerEvent);
};

const handleWindowMouseUp = (event: MouseEvent) => {
  if (isHidMouseEnabled.value && isMouseLocked.value) {
    sendHidMouseEvent({
      phase: 'up',
      button: event.button
    });
    return;
  }

  if (shouldIgnoreCompatMouse()) return;
  if (activeMousePointerId == null) return;

  const pointerId = activeMousePointerId;
  const pointerEvent = buildMousePointerEvent(event, 'pointerup');
  activeMousePointerId = null;
  releasePointer(pointerId, 'up', pointerEvent ?? undefined);
};

const handleWindowBlur = () => {
  finishMenuDrag();
  releaseAllPointers('cancel');
  resetHidInputs();
  void releaseMouseLock();
  syncBackgroundMuteState();
};

const handleWindowFocus = () => {
  syncBackgroundMuteState();
};

const handleVisibilityChange = () => {
  syncBackgroundMuteState();
};

const handlePageHide = () => {
  syncBackgroundMuteState();
};

const handlePageShow = () => {
  syncBackgroundMuteState();
};

const shouldIgnoreKeyboardEvent = (event: KeyboardEvent) => {
  const target = event.target as HTMLElement | null;
  if (!target) {
    return false;
  }

  const tagName = target.tagName;
  return target.isContentEditable
    || tagName === 'INPUT'
    || tagName === 'TEXTAREA'
    || tagName === 'SELECT';
};

const handleWindowKeyDown = (event: KeyboardEvent) => {
  if (!isConnected.value || shouldIgnoreKeyboardEvent(event)) {
    return;
  }

  if (isHidMouseEnabled.value && !event.repeat && (event.code === 'AltLeft' || event.code === 'AltRight')) {
    event.preventDefault();
    void toggleMouseLock();
    return;
  }

  sendKeyboardEvent('down', event);
  event.preventDefault();
};

const handleWindowKeyUp = (event: KeyboardEvent) => {
  if (!isConnected.value || shouldIgnoreKeyboardEvent(event)) {
    return;
  }

  if (isHidMouseEnabled.value && (event.code === 'AltLeft' || event.code === 'AltRight')) {
    event.preventDefault();
    return;
  }

  sendKeyboardEvent('up', event);
  event.preventDefault();
};

const handleMouseWheel = (event: WheelEvent) => {
  if (!isConnected.value || !isHidMouseEnabled.value || !isMouseLocked.value) {
    return;
  }

  sendHidMouseEvent({
    phase: 'wheel',
    wheelX: Math.round(event.deltaX),
    wheelY: Math.round(event.deltaY)
  });
  event.preventDefault();
};

const handlePointerLockChange = () => {
  syncPointerLockState();
};

const handleVideoMetadataLoaded = () => {
  syncVideoFrameSize();
  scheduleDisplayResize();
};

const handleVideoResize = () => {
  syncVideoFrameSize();
  scheduleDisplayResize();
};

const handleWindowResize = () => {
  initializeMenuPosition();
  scheduleDisplayResize();
};

const handleVideoTimeUpdate = () => {
  if (!videoElement.value) {
    return;
  }

  if (videoElement.value.currentTime > 0.01) {
    hideLastFrameOverlay();
  }
};

const attachPageEventListeners = () => {
  window.addEventListener('pointermove', handleWindowPointerMove);
  window.addEventListener('pointerup', handleWindowPointerUp);
  window.addEventListener('pointercancel', handleWindowPointerCancel);
  window.addEventListener('mousemove', handleWindowMouseMove);
  window.addEventListener('mouseup', handleWindowMouseUp);
  window.addEventListener('blur', handleWindowBlur);
  window.addEventListener('focus', handleWindowFocus);
  window.addEventListener('keydown', handleWindowKeyDown);
  window.addEventListener('keyup', handleWindowKeyUp);
  window.addEventListener('wheel', handleMouseWheel, { passive: false });
  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('pagehide', handlePageHide);
  window.addEventListener('pageshow', handlePageShow);
  document.addEventListener('pointerlockchange', handlePointerLockChange);
  window.addEventListener('resize', handleWindowResize);
  videoElement.value?.addEventListener('loadedmetadata', handleVideoMetadataLoaded);
  videoElement.value?.addEventListener('resize', handleVideoResize);
  videoElement.value?.addEventListener('timeupdate', handleVideoTimeUpdate);
};

const detachPageEventListeners = () => {
  window.removeEventListener('pointermove', handleWindowPointerMove);
  window.removeEventListener('pointerup', handleWindowPointerUp);
  window.removeEventListener('pointercancel', handleWindowPointerCancel);
  window.removeEventListener('mousemove', handleWindowMouseMove);
  window.removeEventListener('mouseup', handleWindowMouseUp);
  window.removeEventListener('blur', handleWindowBlur);
  window.removeEventListener('focus', handleWindowFocus);
  window.removeEventListener('keydown', handleWindowKeyDown);
  window.removeEventListener('keyup', handleWindowKeyUp);
  window.removeEventListener('wheel', handleMouseWheel);
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  window.removeEventListener('pagehide', handlePageHide);
  window.removeEventListener('pageshow', handlePageShow);
  document.removeEventListener('pointerlockchange', handlePointerLockChange);
  window.removeEventListener('resize', handleWindowResize);
  videoElement.value?.removeEventListener('loadedmetadata', handleVideoMetadataLoaded);
  videoElement.value?.removeEventListener('resize', handleVideoResize);
  videoElement.value?.removeEventListener('timeupdate', handleVideoTimeUpdate);
};

const setupVideoContainerResizeObserver = () => {
  if (!videoContainer.value || typeof ResizeObserver === 'undefined') {
    return;
  }

  videoContainerResizeObserver?.disconnect();
  videoContainerResizeObserver = new ResizeObserver(() => {
    scheduleDisplayResize();
  });
  videoContainerResizeObserver.observe(videoContainer.value);
};

const teardownVideoContainerResizeObserver = () => {
  videoContainerResizeObserver?.disconnect();
  videoContainerResizeObserver = null;
};

const handleMenuPointerEnter = () => {
  if (isDocked.value && !isMenuExpanded.value) {
    setMenuPosition(menuX.value, menuY.value);
  }
};

const handleMenuPointerLeave = () => {
  if (!isDraggingMenu && isDocked.value && !isMenuExpanded.value) {
    applyDockPosition(dockedEdge.value);
  }
};

const syncDockedMenuPosition = async () => {
  await nextTick();
  if (!isDocked.value || dockedEdge.value === 'none') {
    return;
  }

  applyDockPosition(dockedEdge.value);
};

const finishMenuDrag = () => {
  if (!isDraggingMenu) return;
  isDraggingMenu = false;
  setMenuPosition(menuX.value, menuY.value);
  resolveDockEdge();
};

const startMenuDrag = (event: PointerEvent) => {
  const target = event.currentTarget as HTMLElement | null;
  if (!target) return;
  event.preventDefault();
  isDraggingMenu = true;
  didDragMenu = false;
  
  if (isDocked.value) {
    const bounds = getStageBounds();
    if (dockedEdge.value === 'left') {
      menuX.value = bounds.offsetLeft + MENU_MARGIN;
    } else if (dockedEdge.value === 'right') {
      menuX.value = bounds.offsetLeft + bounds.width - getMenuBounds().width - MENU_MARGIN;
    }
  }

  isDocked.value = false;
  dockedEdge.value = 'none';

  dragStartOffset = {
    x: event.clientX - menuX.value,
    y: event.clientY - menuY.value
  };
  dragStartPoint = {
    x: event.clientX,
    y: event.clientY
  };
  target.setPointerCapture?.(event.pointerId);
};

const toggleMenu = () => {
  if (didDragMenu) {
    didDragMenu = false;
    return;
  }

  isMenuExpanded.value = !isMenuExpanded.value;
  if (!isMenuExpanded.value) {
    isMenuHorizontalLocked.value = false;
  }
  setMenuPosition(menuX.value, menuY.value);
  void syncDockedMenuPosition();
};

watch(
  () => route.query,
  async () => {
    await consumeIncomingTab();
  }
);

watch(
  () => canUseFlexDisplay.value,
  (enabled) => {
    lastDisplayResizeRequest = null;
    if (enabled) {
      scheduleDisplayResize(0);
      startFlexDisplayHeartbeat();
      return;
    }

    clearPendingDisplayResize();
    stopFlexDisplayHeartbeat();
  },
  { immediate: true }
);

watch(backgroundMute, () => {
  syncBackgroundMuteState();
});

watch(
  () => [isMenuExpanded.value, isHorizontalLayout.value, dockedEdge.value, isDocked.value],
  () => {
    if (!isDocked.value || dockedEdge.value === 'none') {
      return;
    }
    void syncDockedMenuPosition();
  }
);

onMounted(async () => {
  enableAutoReconnect();
  loadPersistedTabs();
  initializeMenuPosition();
  attachPageEventListeners();
  syncBackgroundMuteState();
  setupVideoContainerResizeObserver();

  if (!isScreencastRouteActive.value) {
    return;
  }

  const consumed = await consumeIncomingTab();
  if (consumed) {
    hasUsedInitialConnectionWarmup = true;
    return;
  }

  if (activeTabKey.value) {
    syncRefsFromActiveTab();
    await syncRouteToActiveTab();
  }

  if (activeTab.value) {
    await fetchDeviceName();
    await fetchDeviceSettings();
    if (restorePersistedConnection()) {
      hasUsedInitialConnectionWarmup = true;
      return;
    }
    scheduleStartConnection(hasUsedInitialConnectionWarmup ? 0 : 350);
    hasUsedInitialConnectionWarmup = true;
  }
});

onActivated(async () => {
  if (!hasHandledInitialActivation) {
    hasHandledInitialActivation = true;
    return;
  }

  enableAutoReconnect();
  attachPageEventListeners();
  syncBackgroundMuteState();
  initializeMenuPosition();
  stopScrcpySessionHeartbeat();
  setupVideoContainerResizeObserver();

  const consumed = await consumeIncomingTab();
  if (consumed) {
    return;
  }

  if (activeTab.value) {
    await fetchDeviceName();
    await fetchDeviceSettings();
    if (restorePersistedConnection()) {
      return;
    }
    scheduleStartConnection();
  }
});

onDeactivated(() => {
  disableAutoReconnect();
  if (pendingPersistTabsTimer != null) {
    window.clearTimeout(pendingPersistTabsTimer);
    flushPersistTabs();
  }
  detachPageEventListeners();
  stopPointerMoveFlushLoop();
  stopPointerControlFlushLoop();
  stopPointerReleaseFlushLoop();
  teardownVideoContainerResizeObserver();
  stopFlexDisplayHeartbeat();
  void releaseMouseLock();
  releaseAllPointers('cancel');
  captureCurrentVideoFrame();
  stopScrcpySessionHeartbeat();
  stopConnection(true);
  showLastFrameOverlayForTab();
});

onUnmounted(() => {
  disableAutoReconnect();
  if (pendingPersistTabsTimer != null) {
    window.clearTimeout(pendingPersistTabsTimer);
    flushPersistTabs();
  }
  detachPageEventListeners();
  stopPointerMoveFlushLoop();
  stopPointerControlFlushLoop();
  stopPointerReleaseFlushLoop();
  teardownVideoContainerResizeObserver();
  stopFlexDisplayHeartbeat();
  void releaseMouseLock();
  releaseAllPointers('cancel');
  stopScrcpySessionHeartbeat();
  void postScrcpySessionAction('release', deviceId.value, currentScrcpySessionId);
  stopConnection();
});
</script>

<style scoped>
.screen-page {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  position: relative;
  background: var(--fluent-bg-layer);
  overflow: hidden;
}

.screen-page:fullscreen {
  background: #000;
}

.screen-page:fullscreen :deep(.workspace-tabs) {
  display: none;
}

.screen-page:fullscreen .stream-stage {
  flex: 1 1 auto;
  height: 100%;
}

.cast-tabs {
  display: flex;
  align-items: stretch;
  gap: 0;
  height: 46px;
  padding: 8px 10px 0;
  background: var(--fluent-bg-base);
  border-bottom: 1px solid var(--fluent-stroke-default);
  overflow-x: auto;
  flex-shrink: 0;
}

.cast-tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  min-width: 0;
  min-height: 0;
  width: clamp(120px, 15vw, 200px);
  max-width: 200px;
  height: 38px;
  padding: 0 10px 0 12px;
  border: 1px solid transparent;
  border-bottom: none;
  border-radius: 8px 8px 0 0;
  color: var(--fluent-text-secondary);
  background: rgba(255, 255, 255, 0.02);
  cursor: pointer;
  transition: background 0.2s, color 0.2s, border-color 0.2s;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 0;
  flex: 0 0 auto;
}

.cast-tab:hover {
  background: rgba(255, 255, 255, 0.06);
  color: var(--fluent-text-primary);
}

.cast-tab--active {
  color: var(--fluent-text-primary);
  background: var(--fluent-bg-layer);
  border-color: var(--fluent-stroke-default);
  border-bottom-color: var(--fluent-bg-layer);
  z-index: 1;
}

.cast-tab--active:hover {
  background: var(--fluent-bg-layer);
}

.cast-tab__label {
  flex: 1 1 auto;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: left;
}

.cast-tab__close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  font-size: 10px;
  line-height: 1;
  opacity: 0.58;
  transition: all 0.2s;
  color: var(--fluent-text-tertiary);
  flex: 0 0 auto;
}

.cast-tab:hover .cast-tab__close,
.cast-tab--active .cast-tab__close {
  opacity: 0.9;
}

.cast-tab__close:hover {
  background: rgba(255, 255, 255, 0.1);
  opacity: 1 !important;
  color: var(--fluent-text-primary);
}

.cast-tab--empty {
  width: clamp(120px, 15vw, 200px);
  background: rgba(255, 255, 255, 0.015);
  border-color: rgba(255, 255, 255, 0.04);
  pointer-events: none;
}

.stream-shell {
  --bg-elevated: rgba(43, 43, 46, 0.74);
  --stroke: rgba(255, 255, 255, 0.08);
  --text-soft: rgba(255, 255, 255, 0.68);
  position: relative;
  width: 100%;
  flex: 1;
  min-height: 0;
  background: var(--fluent-bg-layer);
}

.stream-stage {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  flex: 1;
  min-height: 0;
  padding: 0;
  background: var(--fluent-bg-layer);
  touch-action: none;
  position: relative;
  overflow: hidden;
}

.last-frame-overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  pointer-events: none;
  user-select: none;
  z-index: 2;
}

video {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 100%;
  height: 100%;
  max-height: 100%;
  object-fit: contain;
  background: transparent;
  border-radius: 0;
  touch-action: none;
  user-select: none;
  display: block;
}

video.fill-mode {
  width: 100%;
  max-width: 100%;
  object-fit: fill;
}

.last-frame-overlay.fill-mode {
  object-fit: fill;
}

.floating-menu {
  position: absolute;
  z-index: 20;
  display: flex;
  align-items: center;
  padding: 5px;
  border: 0;
  border-radius: 24px;
  background: rgba(30, 30, 30, 0.72);
  backdrop-filter: blur(12px);
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.28);
  user-select: none;
  touch-action: none;
  transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s;
}

.floating-menu.layout-vertical {
  flex-direction: column;
}

.floating-menu.layout-horizontal {
  flex-direction: row;
}

.floating-menu.layout-horizontal.dock-right {
  flex-direction: row-reverse;
}

.floating-menu.is-docked.dock-left:not(:hover):not(.expanded) {
  transform: translateX(-44px);
  opacity: 0.34;
}

.floating-menu.is-docked.dock-right:not(:hover):not(.expanded) {
  transform: translateX(44px);
  opacity: 0.34;
}

.floating-menu.is-docked.dock-top:not(:hover):not(.expanded) {
  transform: translateY(-44px);
  opacity: 0.34;
}

.floating-menu.is-docked.dock-bottom:not(:hover):not(.expanded) {
  transform: translateY(44px);
  opacity: 0.34;
}

.menu-toggle,
.menu-item {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border: 0;
  border-radius: 50%;
  color: rgba(255, 255, 255, 0.94);
  background: transparent;
  box-shadow: none;
  cursor: pointer;
  padding: 0;
}

.menu-toggle svg,
.menu-item svg {
  width: 18px;
  height: 18px;
}

.menu-items {
  display: flex;
  gap: 6px;
}

.floating-menu.layout-vertical .menu-items {
  flex-direction: column;
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  margin-left: 0;
  padding-left: 0;
  border-left: none;
}

.floating-menu.layout-horizontal .menu-items {
  flex-direction: row;
  margin-left: 6px;
  padding-left: 6px;
  border-left: 1px solid rgba(255, 255, 255, 0.08);
  margin-top: 0;
  padding-top: 0;
  border-top: none;
}

.floating-menu.layout-horizontal.dock-right .menu-items {
  margin-left: 0;
  padding-left: 0;
  border-left: none;
  margin-right: 6px;
  padding-right: 6px;
  border-right: 1px solid rgba(255, 255, 255, 0.08);
}

.menu-item {
  background: transparent;
}

.menu-toggle:hover,
.menu-item:hover {
  background: rgba(255, 255, 255, 0.1);
}

.menu-item--danger {
  color: #ffcece;
}

.status-indicator {
  position: absolute;
  top: 1px;
  right: 1px;
  width: 12px;
  height: 12px;
}

.dot {
  width: 8px;
  height: 8px;
  margin: 2px;
  border-radius: 50%;
  background: #ff6b6b;
}

.dot.connecting {
  background: #f6c45d;
  animation: pulse 1.4s infinite;
}

.dot.connected {
  background: #6ae28a;
}

@keyframes pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(246, 196, 93, 0.56);
  }
  100% {
    box-shadow: 0 0 0 8px rgba(246, 196, 93, 0);
  }
}

.empty-state {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 10;
  background: var(--fluent-bg-layer);
}

.empty-state__icon {
  width: 64px;
  height: 64px;
  margin-bottom: 16px;
  color: var(--fluent-text-tertiary);
}

.empty-state__title {
  font-size: 18px;
  font-weight: 600;
  color: var(--fluent-text-primary);
  margin-bottom: 8px;
}

.empty-state__desc {
  font-size: 13px;
  color: var(--fluent-text-secondary);
}

</style>
