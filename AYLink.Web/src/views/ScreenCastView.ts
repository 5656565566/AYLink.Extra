import { defineComponent } from 'vue';
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
  ArrowExpand24Regular,
  Phone20Regular
} from '@vicons/fluent';
import { computed, nextTick, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from '../composables/useI18n';
import { useAppSettings } from '../services/appSettings';
import { getAccessToken, useAuth } from '../services/auth';
import { loadLocalWebRtcOverrideConfig, loadLocalWebRtcOverrideEnabled } from '../services/webrtcSettings';
import { apiFetch, readApiErrorMessage } from '../utils/api';
import WorkspaceTabs from '../components/WorkspaceTabs.vue';
import {
  clearPendingReconnect as clearPendingReconnectTimer,
  clearPendingStartConnection as clearPendingStartConnectionTimer,
  clearStartConnectionState as resetStartConnectionState,
  createCastConnectionSchedulerState,
  disableAutoReconnect as disableAutoReconnectFlow,
  enableAutoReconnect as enableAutoReconnectFlow,
  scheduleReconnect as scheduleReconnectFlow,
  scheduleStartConnection as scheduleStartConnectionFlow
} from '../features/screencast/connectionScheduler';
import { useCastDeviceContext } from '../features/screencast/useCastDeviceContext';
import { useCastTabs } from '../features/screencast/useCastTabs';
import { useCastSessionPersistence } from '../features/screencast/useCastSessionPersistence';
import type { CastTab } from '../types/screencast';
import { normalizeDeviceId, normalizePackageName } from '../lib/input/normalize';
import {
  buildHidKeyboardReport,
  buildHidMouseReport,
  buildUhidCreateMessage,
  buildUhidDestroyMessage,
  buildUhidInputMessage,
  clampSignedByte,
  KEYBOARD_REPORT_DESC,
  mapBrowserCodeToHidKey,
  mapMouseButtonToHidMask,
  RELATIVE_MOUSE_REPORT_DESC,
  SCRCPY_HID_KEYBOARD_ID,
  SCRCPY_HID_MOUSE_ID,
  SCRCPY_MSG_UHID_CREATE,
  SCRCPY_MSG_UHID_DESTROY,
  SCRCPY_MSG_UHID_INPUT
} from '../lib/input/hidProtocol';
import { createHidSession } from '../lib/input/hidSession';
import { createLatestRequestController } from '../lib/async/latestRequest';
import { isAbortError } from '../lib/async/abort';

declare global {
  interface Window {
    __aylinkPersistedCastFrameImages?: Record<string, string>;
    __aylinkPersistentAudioElement?: HTMLAudioElement;
  }
}

export default defineComponent({
  name: 'ScreenCastView',
  components: {
    WorkspaceTabs,
    ChevronLeft20Regular,
    Home20Regular,
    List20Regular,
    AppRecent20Regular,
    Power20Regular,
    FullScreenMaximize20Regular,
    Speaker020Regular,
    SpeakerMute20Regular,
    Speaker220Regular,
    ArrowExpand24Regular,
    Phone20Regular
  },
  setup() {
    type DockedEdge = 'left' | 'right' | 'none';

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

    interface SignalErrorMessagePayload {
      type: 'error';
      code?: string;
      messageKey: string;
      message?: string;
      detail?: string;
      retryable?: boolean;
    }

    interface PersistedFloatingMenuPlacement {
      isDocked?: boolean;
      dockedEdge?: DockedEdge;
      relativeRight?: number;
      relativeTop?: number;
    }

    const CAST_MENU_PLACEMENT_STORAGE_KEY = 'aylink_cast_menu_placement';

    const POINTER_MOVE_BUFFER_LIMIT = 64 * 1024;

    const CONTROL_CHANNEL_BUFFER_LIMIT = 256 * 1024;

    const MOUSE_COMPAT_SUPPRESSION_MS = 900;

    const POINTER_MOVE_SAMPLE_INTERVAL_MS = 1000 / 120;

    const SIGNALING_DETACH_DELAY_MS = 3000;

    const VIDEO_RECOVERY_TIMEOUT_MS = 8000;

    const VIDEO_FREEZE_THRESHOLD_MS = 2500;

    const VIDEO_FREEZE_WATCHDOG_INTERVAL_MS = 1000;

    const VIDEO_FREEZE_ESCALATION_MS = 7000;

    const VIDEO_FREEZE_CONFIRMATION_COUNT = 2;

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

    const MENU_COLLAPSED_VISIBLE_WIDTH = 18;

    const MENU_EXPAND_DIRECTION_SWITCH_RATIO = 0.75;

    const CLIPBOARD_WINDOW_MARGIN = 16;

    const CLIPBOARD_WINDOW_DEFAULT_WIDTH = 380;

    const CLIPBOARD_WINDOW_DEFAULT_HEIGHT = 220;

    const SCRCPY_PRIMARY_BUTTON = 1;

    const SCRCPY_MSG_INJECT_KEYCODE = 0;

    const SCRCPY_MSG_INJECT_TOUCH_EVENT = 2;

    const SCRCPY_MSG_SET_SCREEN_POWER_MODE = 10;

    const SCRCPY_MSG_RESIZE_DISPLAY = 21;

    const SCRCPY_ACTION_DOWN = 0;

    const SCRCPY_ACTION_UP = 1;

    const SCRCPY_ACTION_MOVE = 2;

    const ANDROID_KEYCODE_BACK = 4;

    const ANDROID_KEYCODE_HOME = 3;

    const ANDROID_KEYCODE_MENU = 82;

    const ANDROID_KEYCODE_RECENT = 187;

    const ANDROID_KEYCODE_POWER = 26;

    const ANDROID_KEYCODE_VOLUME_UP = 24;

    const ANDROID_KEYCODE_VOLUME_DOWN = 25;

    const ANDROID_KEYCODE_MUTE = 164;

    const { t } = useI18n();

    const { backgroundMute, newDisplayDpiMode, newDisplayDpiValue } = useAppSettings();

    const auth = useAuth();

    const localWebRtcScope = computed(() => String(auth.currentUser.value?.Id ?? 'anonymous'));

    const shellElement = ref<HTMLDivElement | null>(null);

    const deviceId = ref('');

    const appPackageName = ref('');

    const appDisplayName = ref('');

    const selectedDeviceName = ref(t('Screencast.DefaultTabTitle', '设备投屏'));

    const isNewDisplayMode = ref(false);

    const isFlexDisplayEnabled = ref(false);

    const isHidKeyboardEnabled = ref(false);

    const isHidMouseEnabled = ref(false);

    const isMouseLocked = ref(false);

    const videoElement = ref<HTMLVideoElement | null>(null);

    const audioElement = ref<HTMLAudioElement | null>(null);

    const videoContainer = ref<HTMLDivElement | null>(null);

    let isPageEventListenersAttached = false;

    let attachedVideoElement: HTMLVideoElement | null = null;
    const rtcConfigRequest = createLatestRequestController();
    const clipboardRequest = createLatestRequestController();

    const clipboardFloatElement = ref<HTMLDivElement | null>(null);

    const isConnected = ref(false);

    const isConnecting = ref(false);

    const status = ref(t('Screencast.StatusDisconnected', '未连接'));

    const lastFrameOverlayUrl = ref('');

    const shouldShowLastFrameOverlay = ref(false);

    const shouldFillVideoFrame = ref(false);

    const getTargetDisplayAspectSize = () => {
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

    const getVideoFrameAspectSize = () => {
      if (lastVideoFrameSize.width > 0 && lastVideoFrameSize.height > 0) {
        return {
          width: lastVideoFrameSize.width,
          height: lastVideoFrameSize.height
        };
      }

      return null;
    };

    const isOrientationConsistentForFill = computed(() => {
      const target = getTargetDisplayAspectSize();
      const frame = getVideoFrameAspectSize();
      if (!frame) {
        return false;
      }

      const isTargetLandscape = target.width >= target.height;
      const isFrameLandscape = frame.width >= frame.height;
      return isTargetLandscape === isFrameLandscape;
    });

    const effectiveFillMode = computed(() => {
      if (shouldFillVideoFrame.value) {
        return true;
      }

      if (!canUseFlexDisplay.value) {
        return false;
      }

      return isOrientationConsistentForFill.value;
    });

    const isMenuExpanded = ref(true);

    const isDocked = ref(true);

    const isClipboardWindowVisible = ref(false);

    const clipboardText = ref('');

    const clipboardStatusText = ref('');

    const isClipboardLoading = ref(false);

    const isClipboardSaving = ref(false);

    const clipboardWindowX = ref(0);

    const clipboardWindowY = ref(0);

    const dockedEdge = ref<DockedEdge>('right');

    const isMenuHorizontalLocked = ref(false);

    const menuX = ref(0);

    const menuY = ref(0);

    const menuRelativeX = ref(0);

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

    const connectionSchedulerState = createCastConnectionSchedulerState();

    let pendingResumePlaybackTimer: number | null = null;

    let pendingDisplayResizeTimer: number | null = null;

    let flexDisplayHeartbeatTimer: number | null = null;

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

    let dragStartOffset = { x: 0, y: 0 };

    let dragStartPoint = { x: 0, y: 0 };

    let isDraggingMenu = false;

    let didDragMenu = false;

    let wasMenuExpandedAtDragStart = false;

    let currentMenuExpandDirection: 'left' | 'right' = 'right';

    let isDraggingClipboard = false;

    let clipboardDragStartOffset = { x: 0, y: 0 };

    let nextScrcpyPointerId = 0n;

    const scrcpyPointerIds = new Map<number, bigint>();

    let lastTouchPointerAt = 0;

    let pointerMoveFlushHandle: number | null = null;

    let pointerMoveSampleTimer: number | null = null;

    let pointerReleaseFlushHandle: number | null = null;

    let pointerControlFlushHandle: number | null = null;

    let lastPointerMoveFlushAt = 0;

    let isIceRestartInFlight = false;

    let detachedSignalingConnectionId = 0;

    let expectedSignalingCloseConnectionId = 0;

    let currentScrcpySessionId = '';

    let lastVideoFrameAt = 0;

    let lastVideoFreezeRecoveryAt = 0;

    let lastVideoFreezeRecoveryConnectionId = 0;

    let consecutiveFrozenVideoDetections = 0;

    interface PendingPointerMove {
      pointerId: number;
      xRatio: number;
      yRatio: number;
      frameWidth: number;
      frameHeight: number;
      pressure: number;
    }

    const getTabTitle = (tab: CastTab) => {
      const baseTitle = tab.deviceName || t('Screencast.DefaultTabTitle', '设备投屏');
      return tab.appDisplayName ? `${baseTitle} · ${tab.appDisplayName}` : baseTitle;
    };

    const isSignalErrorMessagePayload = (payload: unknown): payload is SignalErrorMessagePayload => {
      return payload !== null &&
        typeof payload === 'object' &&
        (payload as { type?: unknown }).type === 'error' &&
        typeof (payload as { messageKey?: unknown }).messageKey === 'string' &&
        (payload as { messageKey: string }).messageKey.length > 0;
    };

    const {
      CAST_TABS_STORAGE_KEY,
      CAST_ACTIVE_TAB_STORAGE_KEY,
      route,
      router,
      castTabs,
      activeTabKey,
      activeTab,
      hasCastTabs,
      castTabItems,
      isScreencastRouteActive,
      buildTabKey,
      flushPersistTabs,
      schedulePersistTabs,
      cleanupPersistTabs,
      persistTabs,
      syncRouteToActiveTab,
      upsertTab,
      createTabFromQuery,
      createTabFromRequest,
      openIncomingTab,
      consumeIncomingTab,
      loadPersistedTabs
    } = useCastTabs(getTabTitle);

    const {
      postScrcpySessionAction,
      stopScrcpySessionHeartbeat,
      startScrcpySessionHeartbeat,
      persistCurrentConnection: persistCastConnectionSnapshot,
      clearPersistedConnection: clearPersistedCastConnection,
      getPersistedConnection: getPersistedCastConnection,
      disposePersistedConnection: disposePersistedCastConnection,
      disposeOtherPersistedConnections,
      disposeAllPersistedConnections
    } = useCastSessionPersistence();

    const clearPersistedConnection = (tabKey = activeTabKey.value) => {
      clearPersistedCastConnection(tabKey);
    };

    const getPersistedConnection = (tabKey = activeTabKey.value) => {
      return getPersistedCastConnection(tabKey);
    };

    const disposePersistedConnection = (tabKey: string) => {
      disposePersistedCastConnection(tabKey);
    };

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

    const statusDotClass = computed(() => ({
      connecting: isConnecting.value,
      connected: isConnected.value
    }));

    const menuStyle = computed(() => {
      const frame = getMenuFrameAt(menuX.value, menuY.value, isMenuExpanded.value);
      return {
        left: `${frame.x}px`,
        top: `${frame.y}px`
      };
    });

    const getClipboardWindowSize = () => {
      const rect = clipboardFloatElement.value?.getBoundingClientRect();
      return {
        width: rect?.width && rect.width > 0 ? rect.width : CLIPBOARD_WINDOW_DEFAULT_WIDTH,
        height: rect?.height && rect.height > 0 ? rect.height : CLIPBOARD_WINDOW_DEFAULT_HEIGHT
      };
    };

    const clampClipboardWindowPosition = (x: number, y: number) => {
      const bounds = getStageBounds();
      const size = getClipboardWindowSize();
      const minX = bounds.offsetLeft + CLIPBOARD_WINDOW_MARGIN;
      const minY = bounds.offsetTop + CLIPBOARD_WINDOW_MARGIN;
      const maxX = Math.max(minX, bounds.offsetLeft + bounds.width - size.width - CLIPBOARD_WINDOW_MARGIN);
      const maxY = Math.max(minY, bounds.offsetTop + bounds.height - size.height - CLIPBOARD_WINDOW_MARGIN);
      return {
        x: Math.min(Math.max(minX, x), maxX),
        y: Math.min(Math.max(minY, y), maxY)
      };
    };

    const initializeClipboardWindowPosition = () => {
      const bounds = getStageBounds();
      const size = getClipboardWindowSize();
      const clamped = clampClipboardWindowPosition(
        bounds.offsetLeft + bounds.width - size.width - CLIPBOARD_WINDOW_MARGIN,
        bounds.offsetTop + bounds.height - size.height - CLIPBOARD_WINDOW_MARGIN
      );
      clipboardWindowX.value = clamped.x;
      clipboardWindowY.value = clamped.y;
    };

    const clipboardWindowStyle = computed(() => {
      let x = clipboardWindowX.value;
      let y = clipboardWindowY.value;
      if (x === 0 && y === 0) {
        const bounds = getStageBounds();
        const size = getClipboardWindowSize();
        x = bounds.offsetLeft + bounds.width - size.width - CLIPBOARD_WINDOW_MARGIN;
        y = bounds.offsetTop + bounds.height - size.height - CLIPBOARD_WINDOW_MARGIN;
      }
      return {
        left: `${x}px`,
        top: `${y}px`,
        right: 'auto',
        bottom: 'auto'
      };
    });

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
      const { requestId, signal } = rtcConfigRequest.begin();
      const localOverrideEnabled = loadLocalWebRtcOverrideEnabled(localWebRtcScope.value);
      const localOverrideConfig = loadLocalWebRtcOverrideConfig(localWebRtcScope.value);
      if (localOverrideEnabled && localOverrideConfig) {
        rtcConfigRequest.finalize(requestId);
        return getRtcConfigurationFromSettings(localOverrideConfig);
      }
    
      try {
        const response = await apiFetch('/api/control/webrtc-network', {
          signal,
          timeoutMs: 15000,
        });
        if (!rtcConfigRequest.isLatest(requestId)) {
          return getDefaultRtcConfiguration();
        }
        if (!response.ok) {
          return getDefaultRtcConfiguration();
        }
    
        return getRtcConfigurationFromSettings(await response.json());
      } catch (error) {
        if (!isAbortError(error)) {
          console.warn('Failed to load WebRTC network settings:', error);
        }
        return getDefaultRtcConfiguration();
      } finally {
        rtcConfigRequest.finalize(requestId);
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
      consecutiveFrozenVideoDetections = 0;
    };

    const stopVideoFreezeWatchdog = () => {
      if (videoFreezeWatchdogTimer != null) {
        window.clearInterval(videoFreezeWatchdogTimer);
        videoFreezeWatchdogTimer = null;
      }
    };

    const shouldMonitorFrozenVideo = (connectionId: number) => {
      if (connectionSchedulerState.suppressAutoReconnect || connectionId !== activeConnectionId) {
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
        consecutiveFrozenVideoDetections = 0;
        return;
      }
    
      const now = performance.now();
      if (lastVideoFrameAt <= 0 || now - lastVideoFrameAt < VIDEO_FREEZE_THRESHOLD_MS) {
        consecutiveFrozenVideoDetections = 0;
        return;
      }

      consecutiveFrozenVideoDetections += 1;
      if (consecutiveFrozenVideoDetections < VIDEO_FREEZE_CONFIRMATION_COUNT) {
        console.warn('[WebRTC] Frozen video detected, waiting for consecutive confirmation before refresh.', {
          reason,
          deviceId: deviceId.value,
          tabKey: activeTabKey.value,
          consecutiveFrozenVideoDetections,
          confirmationThreshold: VIDEO_FREEZE_CONFIRMATION_COUNT
        });
        return;
      }
    
      const sameRecoveryWindow = lastVideoFreezeRecoveryConnectionId === connectionId;
      const sinceLastRecovery = sameRecoveryWindow ? now - lastVideoFreezeRecoveryAt : Number.POSITIVE_INFINITY;

      if (!sameRecoveryWindow) {
        lastVideoFreezeRecoveryAt = now;
        lastVideoFreezeRecoveryConnectionId = connectionId;
        status.value = t('Screencast.StatusVideoFrozen', '画面冻结，正在等待恢复...');
        console.warn('[WebRTC] Frozen video confirmed, deferring scrcpy reset and waiting before transport recovery.', {
          reason,
          deviceId: deviceId.value,
          tabKey: activeTabKey.value,
          peerConnectionState: peerConnection?.connectionState ?? null
        });
        return;
      }

      if (sinceLastRecovery >= VIDEO_FREEZE_ESCALATION_MS) {
        console.warn('[WebRTC] Frozen video persisted without recovery, escalating transport recovery.', {
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
        consecutiveFrozenVideoDetections = 0;
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
      return getTargetDisplayAspectSize();
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

      persistCastConnectionSnapshot(tabKey, {
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
      });
    };

    const restorePersistedConnection = (tabKey = activeTabKey.value) => {
      const persisted = getPersistedConnection(tabKey);
      if (!persisted) {
        return false;
      }
    
      if ((persisted.ws && persisted.ws.readyState >= WebSocket.CLOSING) || persisted.peerConnection.connectionState === 'closed') {
        console.warn('[WebRTC] Discarding stale persisted connection snapshot.', {
          tabKey,
          deviceId: persisted.deviceId,
          hasSocket: !!persisted.ws,
          peerConnectionState: persisted.peerConnection.connectionState
        });
        disposePersistedConnection(tabKey);
        return false;
      }
    
      activeConnectionId++;
      connectionSchedulerState.isStartConnectionInFlight = false;
      connectionSchedulerState.activeConnectionTargetKey = tabKey;
      resetSignalingDetachState();
      currentScrcpySessionId = persisted.sessionId ?? '';
      const restoredPeerConnection = persisted.peerConnection;
      peerConnection = restoredPeerConnection;
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
      wirePeerConnectionEventHandlers(connectionId, restoredPeerConnection);
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
    
      isConnected.value = restoredPeerConnection.connectionState === 'connected';
      isConnecting.value = restoredPeerConnection.connectionState === 'connecting';
      status.value = isConnected.value
        ? t('Screencast.StatusConnected', '已连接')
        : isConnecting.value
          ? t('Screencast.StatusReconnecting', '正在恢复连接...')
          : t('Screencast.StatusWebRtcState', 'WebRTC 状态: {0}', restoredPeerConnection.connectionState);
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

    const getMenuExpandDirectionAt = (x: number, y: number, expanded = isMenuExpanded.value) => {
      const bounds = getStageBounds();
      const centerX = x + (MENU_BUTTON_SIZE / 2);
      const centerRatio = bounds.width <= 0 ? 0.5 : (centerX - bounds.offsetLeft) / bounds.width;
      if (!expanded) {
        return centerRatio <= 0.5 ? 'right' : 'left';
      }
    
      const menuBounds = getMenuBoundsAt(y);
      if (!menuBounds.horizontal) {
        return centerRatio <= 0.5 ? 'right' : 'left';
      }
    
      const extraWidth = Math.max(0, menuBounds.width - MENU_BUTTON_SIZE);
      const availableLeft = centerX - (MENU_BUTTON_SIZE / 2) - bounds.offsetLeft - MENU_MARGIN;
      const availableRight = bounds.offsetLeft + bounds.width - (centerX + (MENU_BUTTON_SIZE / 2)) - MENU_MARGIN;
      const leftEnough = availableLeft >= extraWidth;
      const rightEnough = availableRight >= extraWidth;
    
      if (leftEnough && !rightEnough) {
        return 'left';
      }
    
      if (rightEnough && !leftEnough) {
        return 'right';
      }
    
      if (leftEnough && rightEnough) {
        if (centerRatio <= (1 - MENU_EXPAND_DIRECTION_SWITCH_RATIO)) {
          return 'right';
        }

        if (centerRatio >= MENU_EXPAND_DIRECTION_SWITCH_RATIO) {
          return 'left';
        }

        return currentMenuExpandDirection;
      }
    
      return availableRight >= availableLeft ? 'right' : 'left';
    };

    const getMenuFrameAt = (x: number, y: number, expanded: boolean) => {
      if (!expanded) {
        return {
          x,
          y,
          width: MENU_BUTTON_SIZE,
          height: MENU_BUTTON_SIZE,
          horizontal: false,
          direction: getMenuExpandDirectionAt(x, y, false)
        };
      }
    
      const bounds = getMenuBoundsAt(y);
      const direction = getMenuExpandDirectionAt(x, y, true);
      return {
        x: bounds.horizontal && direction === 'left' ? x - (bounds.width - MENU_BUTTON_SIZE) : x,
        y,
        width: bounds.width,
        height: bounds.height,
        horizontal: bounds.horizontal,
        direction
      };
    };

    const clampCollapsedMenuPosition = (x: number, y: number) => {
      const bounds = getStageBounds();
      const hiddenWidth = MENU_BUTTON_SIZE - MENU_COLLAPSED_VISIBLE_WIDTH;
      const minX = bounds.offsetLeft - hiddenWidth;
      const maxX = bounds.offsetLeft + bounds.width - MENU_COLLAPSED_VISIBLE_WIDTH;
      const minY = bounds.offsetTop + MENU_MARGIN;
      const maxY = Math.max(minY, bounds.offsetTop + bounds.height - MENU_BUTTON_SIZE - MENU_MARGIN);
      return {
        x: Math.min(Math.max(minX, x), maxX),
        y: Math.min(Math.max(minY, y), maxY)
      };
    };

    const clampExpandedMenuPosition = (x: number, y: number) => {
      const bounds = getStageBounds();
      const frame = getMenuFrameAt(x, y, true);
      const minFrameX = bounds.offsetLeft + MENU_MARGIN;
      const maxFrameX = Math.max(minFrameX, bounds.offsetLeft + bounds.width - frame.width - MENU_MARGIN);
      const minFrameY = bounds.offsetTop + MENU_MARGIN;
      const maxFrameY = Math.max(minFrameY, bounds.offsetTop + bounds.height - frame.height - MENU_MARGIN);
      const clampedFrameX = Math.min(Math.max(minFrameX, frame.x), maxFrameX);
      const clampedFrameY = Math.min(Math.max(minFrameY, frame.y), maxFrameY);
      return {
        x: frame.horizontal && frame.direction === 'left'
          ? clampedFrameX + (frame.width - MENU_BUTTON_SIZE)
          : clampedFrameX,
        y: clampedFrameY
      };
    };

    const clampMenuPosition = (x: number, y: number) => {
      return isMenuExpanded.value
        ? clampExpandedMenuPosition(x, y)
        : clampCollapsedMenuPosition(x, y);
    };

    const syncMenuSideState = () => {
      currentMenuExpandDirection = getMenuExpandDirectionAt(menuX.value, menuY.value, isMenuExpanded.value);
      dockedEdge.value = currentMenuExpandDirection === 'left' ? 'right' : 'left';
    };

    const shouldCollapseExpandedMenuWhileDragging = (_event: PointerEvent, _rawX: number, rawY: number, _clampedX: number, clampedY: number) => {
      if (!wasMenuExpandedAtDragStart) {
        return false;
      }

      const wasClampedVertically = Math.abs(rawY - clampedY) > 0.5;
      return wasClampedVertically
        && doesVerticalLayoutOverflowAt(rawY)
        && rawY > clampedY;
    };

    const updateMenuRelativePosition = () => {
      const bounds = getStageBounds();
      const clamped = clampCollapsedMenuPosition(menuX.value, menuY.value);
      const minX = bounds.offsetLeft - (MENU_BUTTON_SIZE - MENU_COLLAPSED_VISIBLE_WIDTH);
      const minY = bounds.offsetTop + MENU_MARGIN;
      const maxX = Math.max(minX, bounds.offsetLeft + bounds.width - MENU_COLLAPSED_VISIBLE_WIDTH);
      const maxY = Math.max(minY, bounds.offsetTop + bounds.height - MENU_BUTTON_SIZE - MENU_MARGIN);
    
      menuRelativeX.value = maxX <= minX ? 0 : (maxX - clamped.x) / (maxX - minX);
      menuRelativeY.value = maxY <= minY ? 0 : (clamped.y - minY) / (maxY - minY);
    };

    const persistMenuPlacement = () => {
      try {
        const placement: PersistedFloatingMenuPlacement = {
          isDocked: isDocked.value,
          dockedEdge: dockedEdge.value,
          relativeRight: menuRelativeX.value,
          relativeTop: menuRelativeY.value
        };
        localStorage.setItem(CAST_MENU_PLACEMENT_STORAGE_KEY, JSON.stringify(placement));
      } catch {
        // ignore local persistence failures
      }
    };

    const setMenuPosition = (x: number, y: number, syncRelative = true) => {
      const clamped = clampMenuPosition(x, y);
      menuX.value = clamped.x;
      menuY.value = clamped.y;
      syncMenuSideState();
      if (isMenuExpanded.value) {
        isMenuHorizontalLocked.value = doesVerticalLayoutOverflowAt(clamped.y);
      } else {
        isMenuHorizontalLocked.value = false;
      }
      if (syncRelative) {
        updateMenuRelativePosition();
      }
      persistMenuPlacement();
    };

    const restoreMenuPositionFromRelative = () => {
      const bounds = getStageBounds();
      const minX = bounds.offsetLeft - (MENU_BUTTON_SIZE - MENU_COLLAPSED_VISIBLE_WIDTH);
      const minY = bounds.offsetTop + MENU_MARGIN;
      const maxX = Math.max(minX, bounds.offsetLeft + bounds.width - MENU_COLLAPSED_VISIBLE_WIDTH);
      const maxY = Math.max(minY, bounds.offsetTop + bounds.height - MENU_BUTTON_SIZE - MENU_MARGIN);
    
      setMenuPosition(
        maxX - (maxX - minX) * menuRelativeX.value,
        minY + (maxY - minY) * menuRelativeY.value,
        false
      );
    };

    const loadPersistedMenuPlacement = () => {
      try {
        const raw = localStorage.getItem(CAST_MENU_PLACEMENT_STORAGE_KEY);
        if (!raw) {
          return;
        }

        const parsed = JSON.parse(raw) as PersistedFloatingMenuPlacement | null;
        if (!parsed || typeof parsed !== 'object') {
          return;
        }

        if (typeof parsed.relativeRight === 'number' && Number.isFinite(parsed.relativeRight)) {
          menuRelativeX.value = Math.min(Math.max(parsed.relativeRight, 0), 1);
        }

        if (typeof parsed.relativeTop === 'number' && Number.isFinite(parsed.relativeTop)) {
          menuRelativeY.value = Math.min(Math.max(parsed.relativeTop, 0), 1);
        }

        if (parsed.dockedEdge === 'left' || parsed.dockedEdge === 'right' || parsed.dockedEdge === 'none') {
          dockedEdge.value = parsed.dockedEdge;
        }

        if (typeof parsed.isDocked === 'boolean') {
          isDocked.value = parsed.isDocked;
        }
      } catch {
        // ignore local persistence failures
      }
    };

    const applyDockPosition = (edge: DockedEdge) => {
      const bounds = getStageBounds();
      const menuBounds = getMenuBoundsAt(menuY.value);
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
          Math.max(bounds.offsetLeft + MENU_MARGIN, bounds.offsetLeft + bounds.width - MENU_BUTTON_SIZE - MENU_MARGIN),
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
      const leftDockX = bounds.offsetLeft + MENU_MARGIN;
      const rightDockX = Math.max(leftDockX, bounds.offsetLeft + bounds.width - MENU_BUTTON_SIZE - MENU_MARGIN);
      const distances = [
        { edge: 'left' as DockedEdge, value: Math.abs(menuX.value - leftDockX) },
        { edge: 'right' as DockedEdge, value: Math.abs(menuX.value - rightDockX) }
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
      persistMenuPlacement();
    };

    const syncRefsFromActiveTab = () => {
      const tab = activeTab.value;
      deviceId.value = tab?.deviceId ?? '';
      appPackageName.value = tab?.appPackageName ?? '';
      appDisplayName.value = tab?.appDisplayName ?? '';
      selectedDeviceName.value = tab?.deviceName || t('Screencast.DefaultTabTitle', '设备投屏');
      isNewDisplayMode.value = tab?.newDisplay === true;
    };

    const {
      fetchDeviceName,
      fetchDeviceSettings,
      refreshDeviceContext,
      cancelDeviceContextRequests
    } = useCastDeviceContext({
      deviceId,
      isNewDisplayMode,
      selectedDeviceName,
      getDefaultDeviceName: () => t('Screencast.DefaultTabTitle', '设备投屏'),
      isFlexDisplayEnabled,
      isHidKeyboardEnabled,
      isHidMouseEnabled,
      activeTab,
      upsertTab
    });

    const handleTabOpened = async () => {
      await refreshDeviceContext();
      scheduleStartConnection();
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
        status.value = t('Screencast.StatusControlConnected', '控制通道已连接');
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
      clearPendingReconnectTimer(connectionSchedulerState);
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
      resetStartConnectionState(connectionSchedulerState);
    };

    const scheduleReconnect = (reason: string) => {
      scheduleReconnectFlow(reason, {
        state: connectionSchedulerState,
        getActiveTabPresent: () => !!activeTab.value,
        getDeviceId: () => deviceId.value,
        getActiveTabKey: () => activeTabKey.value,
        isConnecting,
        status,
        getReconnectStatusMessage: (attempt) => t('Screencast.StatusReconnectAttempt', '连接中断，正在重连 ({0})...', attempt),
        startConnection: () => {
          void startConnection();
        }
      });
    };

    const enableAutoReconnect = () => {
      enableAutoReconnectFlow(connectionSchedulerState);
    };

    const disableAutoReconnect = () => {
      disableAutoReconnectFlow({
        state: connectionSchedulerState,
        clearPendingReconnect,
        clearPendingIceRestartFallback,
        clearPendingVideoRecovery,
        resetSignalingDetachState,
        onIceRestartReset: () => {
          isIceRestartInFlight = false;
        }
      });
    };

    const scheduleVideoRecovery = (connectionId: number, reason: string, delayMs = VIDEO_RECOVERY_TIMEOUT_MS) => {
      clearPendingVideoRecovery();
      if (connectionSchedulerState.suppressAutoReconnect) {
        return;
      }
    
      pendingVideoRecoveryTimer = window.setTimeout(() => {
        pendingVideoRecoveryTimer = null;
        if (connectionSchedulerState.suppressAutoReconnect || connectionId !== activeConnectionId) {
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
        if (connectionSchedulerState.suppressAutoReconnect || !activeTab.value || !deviceId.value) {
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
      if (connectionSchedulerState.suppressAutoReconnect || !peerConnection || !ws || ws.readyState !== WebSocket.OPEN) {
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
      status.value = t('Screencast.StatusNetworkRecovering', '网络波动，正在尝试恢复连接...');
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
      clearPendingStartConnectionTimer(connectionSchedulerState);
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
      scheduleStartConnectionFlow(delayMs, {
        state: connectionSchedulerState,
        getDeviceId: () => deviceId.value,
        getActiveTabKey: () => activeTabKey.value,
        hasLiveConnection,
        isConnecting,
        status,
        getPreparingStatusMessage: () => t('Screencast.StatusPreparingSession', '正在准备 WebRTC 会话...'),
        enableAutoReconnect,
        startConnection: () => {
          void startConnection(true);
        }
      });
    };

    const syncVideoFrameSize = () => {
      if (!videoElement.value) return;
    
      const width = videoElement.value.videoWidth;
      const height = videoElement.value.videoHeight;
      if (width <= 0 || height <= 0) return;
    
      if (lastVideoFrameSize.width === width && lastVideoFrameSize.height === height) return;
    
      lastVideoFrameSize = { width, height };
      if (isConnected.value) {
        status.value = t('Screencast.StatusResolutionUpdated', '画面尺寸已更新: {0}x{1}', width, height);
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

    const hidSession = createHidSession({
      getIsKeyboardEnabled: () => isHidKeyboardEnabled.value,
      getIsMouseEnabled: () => isHidMouseEnabled.value,
      sendBinaryControlMessage,
      sendMetaControlMessage,
      getPointerMoveChannel: () => pointerMoveChannel,
      getDefaultControlChannel: () => dataChannel,
      pointerMoveBufferLimit: POINTER_MOVE_BUFFER_LIMIT
    });

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

    const buildResizeDisplayMessage = (width: number, height: number) => {
      const buffer = new ArrayBuffer(5);
      const view = new DataView(buffer);
      view.setUint8(0, SCRCPY_MSG_RESIZE_DISPLAY);
      writeUInt16BE(view, 1, width);
      writeUInt16BE(view, 3, height);
      return new Uint8Array(buffer);
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

    const initializeHidDevices = () => {
      hidSession.initializeDevices();
    };

    const resetHidInputs = () => {
      hidSession.resetInputs();
    };

    const releaseHidDevices = () => {
      hidSession.releaseDevices();
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
      if (hidSession.sendKeyboardEvent(phase, event)) {
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
      hidSession.sendMouseEvent(payload);
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

    const isAltToggleKey = (event: KeyboardEvent) => event.code === 'AltLeft' || event.code === 'AltRight';

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
    
        status.value = t('Screencast.StatusConnected', '已连接')
      } catch (error: any) {
        if (error.name === 'AbortError') {
          console.log('Play request aborted due to new load, ignoring.');
        } else {
          console.warn('Media play failed:', error);
          status.value = t('Screencast.StatusConnectedResumeAudio', '已连接，点击播放按钮恢复音频');
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

    const applyRemoteClipboardText = (text: string) => {
      clipboardText.value = text;
    };

    const readClipboard = async () => {
      const { requestId, signal } = clipboardRequest.begin();
      const targetDeviceId = normalizeDeviceId(deviceId.value);
      if (!targetDeviceId) {
        clipboardStatusText.value = t('Screencast.NoDeviceSelected', '未选中设备');
        clipboardRequest.finalize(requestId);
        return;
      }
    
      isClipboardLoading.value = true;
      clipboardStatusText.value = t('Screencast.ClipboardReading', '正在读取...');
    
      try {
        const response = await apiFetch(`/api/devices/${targetDeviceId}/clipboard`, {
          signal,
          timeoutMs: 15000,
        });
        if (!clipboardRequest.isLatest(requestId)) {
          return;
        }
        if (!response.ok) {
          clipboardStatusText.value = await readApiErrorMessage(response, t('Screencast.ClipboardReadFailed', '读取失败'));
          return;
        }
    
        const payload = await response.json() as { text?: string };
        applyRemoteClipboardText(String(payload.text ?? ''));
        clipboardStatusText.value = t('Screencast.ClipboardReadSuccess', '读取成功');
      } catch (error) {
        if (!isAbortError(error)) {
          console.error('Failed to load remote clipboard:', {
            deviceId: targetDeviceId,
            error
          });
          clipboardStatusText.value = t('Screencast.ClipboardReadFailed', '读取失败');
        }
      } finally {
        if (clipboardRequest.isLatest(requestId)) {
          isClipboardLoading.value = false;
        }
        clipboardRequest.finalize(requestId);
      }
    };

    const syncClipboard = async () => {
      const { requestId, signal } = clipboardRequest.begin();
      const targetDeviceId = normalizeDeviceId(deviceId.value);
      if (!targetDeviceId) {
        clipboardStatusText.value = t('Screencast.NoDeviceSelected', '未选中设备');
        clipboardRequest.finalize(requestId);
        return;
      }
    
      isClipboardSaving.value = true;
      clipboardStatusText.value = t('Screencast.ClipboardSyncing', '正在同步...');
    
      try {
        const response = await apiFetch(`/api/devices/${targetDeviceId}/clipboard`, {
          method: 'PUT',
          signal,
          timeoutMs: 15000,
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            text: clipboardText.value
          })
        });
        if (!clipboardRequest.isLatest(requestId)) {
          return;
        }
        if (!response.ok) {
          clipboardStatusText.value = await readApiErrorMessage(response, t('Screencast.ClipboardSyncFailed', '同步失败'));
          return;
        }
        clipboardStatusText.value = t('Screencast.ClipboardSyncSuccess', '已同步');
      } catch (error) {
        if (!isAbortError(error)) {
          console.error('Failed to save remote clipboard:', {
            deviceId: targetDeviceId,
            error
          });
          clipboardStatusText.value = t('Screencast.ClipboardSyncFailed', '同步失败');
        }
      } finally {
        if (clipboardRequest.isLatest(requestId)) {
          isClipboardSaving.value = false;
        }
        clipboardRequest.finalize(requestId);
      }
    };

    const pasteClipboard = async () => {
      const { requestId, signal } = clipboardRequest.begin();
      const targetDeviceId = normalizeDeviceId(deviceId.value);
      if (!targetDeviceId) {
        clipboardStatusText.value = t('Screencast.NoDeviceSelected', '未选中设备');
        clipboardRequest.finalize(requestId);
        return;
      }
    
      isClipboardSaving.value = true;
      clipboardStatusText.value = t('Screencast.ClipboardPasting', '正在粘贴...');
    
      try {
        const response = await apiFetch(`/api/devices/${targetDeviceId}/clipboard`, {
          method: 'POST',
          signal,
          timeoutMs: 15000,
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            text: clipboardText.value
          })
        });
        if (!clipboardRequest.isLatest(requestId)) {
          return;
        }
        if (!response.ok) {
          clipboardStatusText.value = await readApiErrorMessage(response, t('Screencast.ClipboardPasteFailed', '粘贴失败'));
          return;
        }
        clipboardStatusText.value = t('Screencast.ClipboardPasteSuccess', '已发送粘贴');
      } catch (error) {
        if (!isAbortError(error)) {
          console.error('Failed to paste remote clipboard:', {
            deviceId: targetDeviceId,
            error
          });
          clipboardStatusText.value = t('Screencast.ClipboardPasteFailed', '粘贴失败');
        }
      } finally {
        if (clipboardRequest.isLatest(requestId)) {
          isClipboardSaving.value = false;
        }
        clipboardRequest.finalize(requestId);
      }
    };

    const openClipboardWindow = () => {
      if (clipboardWindowX.value === 0 && clipboardWindowY.value === 0) {
        initializeClipboardWindowPosition();
      } else {
        const clamped = clampClipboardWindowPosition(clipboardWindowX.value, clipboardWindowY.value);
        clipboardWindowX.value = clamped.x;
        clipboardWindowY.value = clamped.y;
      }
      isClipboardWindowVisible.value = true;
    };

    const closeClipboardWindow = () => {
      isClipboardWindowVisible.value = false;
    };

    const toggleClipboardWindow = () => {
      if (isClipboardWindowVisible.value) {
        closeClipboardWindow();
        return;
      }
    
      openClipboardWindow();
    };

    const startClipboardDrag = (event: PointerEvent) => {
      const target = event.currentTarget as HTMLElement | null;
      if (!target) {
        return;
      }
    
      event.preventDefault();
      isDraggingClipboard = true;
      clipboardDragStartOffset = {
        x: event.clientX - clipboardWindowX.value,
        y: event.clientY - clipboardWindowY.value
      };
      target.setPointerCapture?.(event.pointerId);
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
    
          if (trackKind === 'video' && !connectionSchedulerState.suppressAutoReconnect) {
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
        status.value = t('Screencast.StatusWebRtcState', 'WebRTC 状态: {0}', peerConnection.connectionState);
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
        connectionSchedulerState.reconnectAttempt = 0;
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
        if ((message as { type?: unknown })?.type === 'error') {
          if (!isSignalErrorMessagePayload(message)) {
            status.value = t('Screencast.StatusSignalingClosed', '信令连接已断开');
            isConnecting.value = false;
            console.warn('[WebRTC] Received invalid signaling error payload:', message);
            return;
          }

          status.value = t(
            message.messageKey,
            typeof message.message === 'string' && message.message ? message.message : t('Screencast.StatusSignalingClosed', '信令连接已断开')
          );
          isConnecting.value = false;
          if (message.detail) {
            console.warn('[WebRTC] Signaling error detail:', {
              code: message.code || '',
              messageKey: message.messageKey,
              retryable: message.retryable === true,
              detail: message.detail
            });
          }
          return;
        }
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
        status.value = t('Screencast.StatusWebSocketError', 'WebSocket 连接出错');
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
          status.value = wasIntentionalDetach
            ? t('Screencast.StatusMediaDirect', '媒体已直连，信令已断开')
            : t('Screencast.StatusSignalingDetached', '信令连接已断开，媒体链路继续运行');
          console.warn('[WebRTC] Signaling websocket closed while peer connection is still active.', {
            deviceId: deviceId.value,
            tabKey: activeTabKey.value,
            peerConnectionState: currentState,
            intentionalDetach: wasIntentionalDetach
          });
          return;
        }
    
        detachedSignalingConnectionId = 0;
        status.value = t('Screencast.StatusSignalingClosed', '信令连接已断开');
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
      if (!bypassStartGuard
        && connectionSchedulerState.activeConnectionTargetKey === targetTabKey
        && (connectionSchedulerState.isStartConnectionInFlight || hasLiveConnection())) {
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
      connectionSchedulerState.isStartConnectionInFlight = true;
      connectionSchedulerState.activeConnectionTargetKey = targetTabKey;
      isConnecting.value = true;
      status.value = t('Screencast.StatusConnectingDevice', '正在连接设备...');
      pendingCandidates = [];
      const connectionId = ++activeConnectionId;
    
      try {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        let wsUrl = import.meta.env.DEV ? 'ws://127.0.0.1:5501/webrtc' : `${protocol}//${host}/webrtc`;
        const initialNewDisplaySize = isNewDisplayMode.value ? buildAdaptiveDisplaySize() : null;
        const normalizedDeviceId = normalizeDeviceId(deviceId.value);
        const normalizedAppPackage = normalizePackageName(appPackageName.value);
        if (!normalizedDeviceId) {
          throw new Error('invalid device id for screencast connection');
        }
        const ticketResponse = await apiFetch('/api/webrtc-ticket', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              deviceId: normalizedDeviceId,
              appPackage: normalizedAppPackage || undefined,
              appName: appDisplayName.value || undefined,
              newDisplay: isNewDisplayMode.value,
              newDisplayWidth: initialNewDisplaySize?.width,
              newDisplayHeight: initialNewDisplaySize?.height,
              newDisplayDpi: resolvedNewDisplayDpi.value ?? undefined,
            })
          });
    
        if (!ticketResponse.ok) {
          status.value = t('Screencast.StatusCreateCredentialFailed', '创建连接凭据失败');
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
          status.value = t('Screencast.StatusCreatingSession', '正在创建 WebRTC 会话...');
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
            status.value = t('Screencast.StatusCreateOfferFailed', '创建 Offer 失败');
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
        status.value = t('Screencast.StatusInitRetry', '连接初始化失败，准备重试...');
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
      connectionSchedulerState.isStartConnectionInFlight = false;
      connectionSchedulerState.activeConnectionTargetKey = '';
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
      status.value = t('Screencast.StatusDisconnected', '未连接');
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
      connectionSchedulerState.isStartConnectionInFlight = false;
      connectionSchedulerState.activeConnectionTargetKey = '';
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
      status.value = t('Screencast.StatusDisconnected', '未连接');
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
      await refreshDeviceContext();
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
        await refreshDeviceContext();
        scheduleStartConnection();
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
      if (isDraggingClipboard) {
        isDraggingClipboard = false;
        const clamped = clampClipboardWindowPosition(clipboardWindowX.value, clipboardWindowY.value);
        clipboardWindowX.value = clamped.x;
        clipboardWindowY.value = clamped.y;
        return;
      }
    
      if (isDraggingMenu) {
        finishMenuDrag();
        return;
      }
    
      releasePointer(event.pointerId, 'up', event);
    };

    const handleWindowPointerCancel = (event: PointerEvent) => {
      if (isDraggingClipboard) {
        isDraggingClipboard = false;
      }
    
      if (isDraggingMenu) {
        finishMenuDrag();
      }
    
      releasePointer(event.pointerId, 'cancel', event);
    };

    const handleWindowPointerMove = (event: PointerEvent) => {
      if (isDraggingClipboard) {
        const position = clampClipboardWindowPosition(
          event.clientX - clipboardDragStartOffset.x,
          event.clientY - clipboardDragStartOffset.y
        );
        clipboardWindowX.value = position.x;
        clipboardWindowY.value = position.y;
        return;
      }
    
      if (!isDraggingMenu) return;
    
      const rawX = event.clientX - dragStartOffset.x;
      const rawY = event.clientY - dragStartOffset.y;
    
      if (isMenuExpanded.value) {
        const expandedPosition = clampExpandedMenuPosition(rawX, rawY);
        if (shouldCollapseExpandedMenuWhileDragging(event, rawX, rawY, expandedPosition.x, expandedPosition.y)) {
          isMenuExpanded.value = false;
          isMenuHorizontalLocked.value = false;
          setMenuPosition(rawX, rawY);
        } else {
          setMenuPosition(expandedPosition.x, expandedPosition.y);
        }
      } else {
        setMenuPosition(rawX, rawY);
      }
    
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
      isDraggingClipboard = false;
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
    
      if (isHidMouseEnabled.value && !event.repeat && isAltToggleKey(event)) {
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
    
      if (isHidMouseEnabled.value && isAltToggleKey(event)) {
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
      if (menuX.value === 0 && menuY.value === 0) {
        initializeMenuPosition();
      } else if (isDocked.value && dockedEdge.value !== 'none') {
        applyDockPosition(dockedEdge.value);
      } else {
        restoreMenuPositionFromRelative();
      }
    
      if (isClipboardWindowVisible.value || clipboardWindowX.value !== 0 || clipboardWindowY.value !== 0) {
        const clamped = clampClipboardWindowPosition(clipboardWindowX.value, clipboardWindowY.value);
        clipboardWindowX.value = clamped.x;
        clipboardWindowY.value = clamped.y;
      }
    
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
      if (isPageEventListenersAttached) {
        if (attachedVideoElement !== videoElement.value) {
          attachedVideoElement?.removeEventListener('loadedmetadata', handleVideoMetadataLoaded);
          attachedVideoElement?.removeEventListener('resize', handleVideoResize);
          attachedVideoElement?.removeEventListener('timeupdate', handleVideoTimeUpdate);
          attachedVideoElement = videoElement.value;
          attachedVideoElement?.addEventListener('loadedmetadata', handleVideoMetadataLoaded);
          attachedVideoElement?.addEventListener('resize', handleVideoResize);
          attachedVideoElement?.addEventListener('timeupdate', handleVideoTimeUpdate);
        }
        return;
      }

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
      attachedVideoElement = videoElement.value;
      attachedVideoElement?.addEventListener('loadedmetadata', handleVideoMetadataLoaded);
      attachedVideoElement?.addEventListener('resize', handleVideoResize);
      attachedVideoElement?.addEventListener('timeupdate', handleVideoTimeUpdate);
      isPageEventListenersAttached = true;
    };

    const detachPageEventListeners = () => {
      if (!isPageEventListenersAttached && !attachedVideoElement) {
        return;
      }

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
      attachedVideoElement?.removeEventListener('loadedmetadata', handleVideoMetadataLoaded);
      attachedVideoElement?.removeEventListener('resize', handleVideoResize);
      attachedVideoElement?.removeEventListener('timeupdate', handleVideoTimeUpdate);
      attachedVideoElement = null;
      isPageEventListenersAttached = false;
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
      if (!isDocked.value || dockedEdge.value === 'none' || (menuX.value === 0 && menuY.value === 0)) {
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
      wasMenuExpandedAtDragStart = isMenuExpanded.value;

      if (isDocked.value) {
        const bounds = getStageBounds();
        const menuBounds = getMenuBoundsAt(menuY.value);
        if (dockedEdge.value === 'left') {
          menuX.value = bounds.offsetLeft + MENU_MARGIN;
        } else if (dockedEdge.value === 'right') {
          menuX.value = bounds.offsetLeft + bounds.width - menuBounds.width - MENU_MARGIN;
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
      () => deviceId.value,
      () => {
        clipboardStatusText.value = '';
    
        if (!isClipboardWindowVisible.value) {
          clipboardText.value = '';
          return;
        }
    
        openClipboardWindow();
      }
    );

    watch(
      () => route.query,
      async () => {
        await consumeIncomingTab(selectedDeviceName.value, t('Screencast.DefaultTabTitle', '设备投屏'), syncRefsFromActiveTab, handleTabOpened);
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

    const cleanupCastViewResources = (preserveForBackground: boolean) => {
      rtcConfigRequest.dispose();
      clipboardRequest.dispose();
      cancelDeviceContextRequests();
      disableAutoReconnect();
      cleanupPersistTabs();
      detachPageEventListeners();
      stopPointerMoveFlushLoop();
      stopPointerControlFlushLoop();
      stopPointerReleaseFlushLoop();
      teardownVideoContainerResizeObserver();
      stopFlexDisplayHeartbeat();
      void releaseMouseLock();
      releaseAllPointers('cancel');
      stopScrcpySessionHeartbeat();

      if (!preserveForBackground) {
        void postScrcpySessionAction('release', deviceId.value, currentScrcpySessionId);
      }

      stopConnection(preserveForBackground);
      if (preserveForBackground) {
        showLastFrameOverlayForTab();
      }
    };

    onMounted(async () => {
      enableAutoReconnect();
      loadPersistedTabs(syncRefsFromActiveTab, t('Screencast.DefaultTabTitle', '设备投屏'));
      loadPersistedMenuPlacement();
      initializeMenuPosition();
      attachPageEventListeners();
      syncBackgroundMuteState();
      setupVideoContainerResizeObserver();
    
      if (!isScreencastRouteActive.value) {
        return;
      }
    
      const consumed = await consumeIncomingTab(selectedDeviceName.value, t('Screencast.DefaultTabTitle', '设备投屏'), syncRefsFromActiveTab, handleTabOpened);
      if (consumed) {
        hasUsedInitialConnectionWarmup = true;
        return;
      }
    
      if (activeTabKey.value) {
        syncRefsFromActiveTab();
        await syncRouteToActiveTab();
      }
    
      if (activeTab.value) {
        await refreshDeviceContext();
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
      loadPersistedMenuPlacement();
      initializeMenuPosition();
      stopScrcpySessionHeartbeat();
      setupVideoContainerResizeObserver();
    
      const consumed = await consumeIncomingTab(selectedDeviceName.value, t('Screencast.DefaultTabTitle', '设备投屏'), syncRefsFromActiveTab, handleTabOpened);
      if (consumed) {
        return;
      }
    
      if (activeTab.value) {
        await refreshDeviceContext();
        if (restorePersistedConnection()) {
          return;
        }
        scheduleStartConnection();
      }
    });

    onDeactivated(() => {
      cleanupCastViewResources(true);
    });

    onUnmounted(() => {
      cleanupCastViewResources(false);
    });

    return {
      CAST_TABS_STORAGE_KEY,
      CAST_ACTIVE_TAB_STORAGE_KEY,
      POINTER_MOVE_BUFFER_LIMIT,
      CONTROL_CHANNEL_BUFFER_LIMIT,
      MOUSE_COMPAT_SUPPRESSION_MS,
      POINTER_MOVE_SAMPLE_INTERVAL_MS,
      SIGNALING_DETACH_DELAY_MS,
      VIDEO_RECOVERY_TIMEOUT_MS,
      VIDEO_FREEZE_THRESHOLD_MS,
      VIDEO_FREEZE_WATCHDOG_INTERVAL_MS,
      VIDEO_FREEZE_ESCALATION_MS,
      DEFAULT_AUTO_NEW_DISPLAY_DPI,
      MIN_NEW_DISPLAY_DPI,
      MAX_NEW_DISPLAY_DPI,
      MIN_NEW_DISPLAY_DIMENSION,
      MAX_NEW_DISPLAY_LONG_EDGE,
      MENU_MARGIN,
      MENU_BUTTON_SIZE,
      MENU_ITEM_COUNT,
      MENU_ITEM_SIZE,
      MENU_ITEM_GAP,
      MENU_EXPANDED_LENGTH,
      MENU_COLLAPSED_VISIBLE_WIDTH,
      CLIPBOARD_WINDOW_MARGIN,
      CLIPBOARD_WINDOW_DEFAULT_WIDTH,
      CLIPBOARD_WINDOW_DEFAULT_HEIGHT,
      SCRCPY_PRIMARY_BUTTON,
      SCRCPY_MSG_INJECT_KEYCODE,
      SCRCPY_MSG_INJECT_TOUCH_EVENT,
      SCRCPY_MSG_SET_SCREEN_POWER_MODE,
      SCRCPY_MSG_UHID_CREATE,
      SCRCPY_MSG_UHID_INPUT,
      SCRCPY_MSG_UHID_DESTROY,
      SCRCPY_MSG_RESIZE_DISPLAY,
      SCRCPY_ACTION_DOWN,
      SCRCPY_ACTION_UP,
      SCRCPY_ACTION_MOVE,
      SCRCPY_HID_MOUSE_ID,
      SCRCPY_HID_KEYBOARD_ID,
      ANDROID_KEYCODE_BACK,
      ANDROID_KEYCODE_HOME,
      ANDROID_KEYCODE_MENU,
      ANDROID_KEYCODE_RECENT,
      ANDROID_KEYCODE_POWER,
      ANDROID_KEYCODE_VOLUME_UP,
      ANDROID_KEYCODE_VOLUME_DOWN,
      ANDROID_KEYCODE_MUTE,
      RELATIVE_MOUSE_REPORT_DESC,
      KEYBOARD_REPORT_DESC,
      t,
      backgroundMute,
      newDisplayDpiMode,
      newDisplayDpiValue,
      auth,
      route,
      router,
      localWebRtcScope,
      shellElement,
      castTabs,
      activeTabKey,
      deviceId,
      appPackageName,
      appDisplayName,
      selectedDeviceName,
      isNewDisplayMode,
      isFlexDisplayEnabled,
      isHidKeyboardEnabled,
      isHidMouseEnabled,
      isMouseLocked,
      videoElement,
      audioElement,
      videoContainer,
      clipboardFloatElement,
      isConnected,
      isConnecting,
      status,
      lastFrameOverlayUrl,
      shouldShowLastFrameOverlay,
      shouldFillVideoFrame,
      effectiveFillMode,
      isMenuExpanded,
      isDocked,
      isClipboardWindowVisible,
      clipboardText,
      clipboardStatusText,
      isClipboardLoading,
      isClipboardSaving,
      clipboardWindowX,
      clipboardWindowY,
      dockedEdge,
      isMenuHorizontalLocked,
      menuX,
      menuY,
      menuRelativeX,
      menuRelativeY,
      remoteVideoStream,
      remoteAudioStream,
      remoteTracks,
      activePointers,
      pointerGenerations,
      pointerSnapshots,
      pendingPointerReleases,
      queuedPointerReleases,
      pendingPointerMoves,
      pendingPointerControlPayloads,
      peerConnection,
      ws,
      dataChannel,
      metaControlChannel,
      pointerMoveChannel,
      activeMousePointerId,
      lastVideoFrameSize,
      connectionSchedulerState,
      pendingResumePlaybackTimer,
      pendingDisplayResizeTimer,
      flexDisplayHeartbeatTimer,
      pendingVideoRecoveryTimer,
      pendingSignalingDetachTimer,
      pendingIceRestartFallbackTimer,
      pendingCandidates,
      activeConnectionId,
      hasHandledInitialActivation,
      hasUsedInitialConnectionWarmup,
      videoFrameCallbackHandle,
      videoFreezeWatchdogTimer,
      lastDisplayResizeRequest,
      videoContainerResizeObserver,
      dragStartOffset,
      dragStartPoint,
      isDraggingMenu,
      didDragMenu,
      wasMenuExpandedAtDragStart,
      currentMenuExpandDirection,
      isDraggingClipboard,
      clipboardDragStartOffset,
      nextScrcpyPointerId,
      scrcpyPointerIds,
      currentHidMouseButtons: hidSession.getCurrentMouseButtons(),
      pressedHidKeys: hidSession.getPressedKeys(),
      lastTouchPointerAt,
      pointerMoveFlushHandle,
      pointerMoveSampleTimer,
      pointerReleaseFlushHandle,
      pointerControlFlushHandle,
      lastPointerMoveFlushAt,
      isIceRestartInFlight,
      detachedSignalingConnectionId,
      expectedSignalingCloseConnectionId,
      currentScrcpySessionId,
      lastVideoFrameAt,
      lastVideoFreezeRecoveryAt,
      lastVideoFreezeRecoveryConnectionId,
      activeTab,
      hasCastTabs,
      castTabItems,
      isScreencastRouteActive,
      canUseFlexDisplay,
      resolvedNewDisplayDpi,
      statusDotClass,
      menuStyle,
      getClipboardWindowSize,
      clampClipboardWindowPosition,
      initializeClipboardWindowPosition,
      clipboardWindowStyle,
      getPersistentAudioElement,
      getDefaultRtcConfiguration,
      getRtcConfigurationFromSettings,
      loadRtcConfiguration,
      shouldMuteForBackground,
      applyBackgroundMuteState,
      syncBackgroundMuteState,
      getStoredLastFrameUrl,
      storeLastFrameUrl,
      showLastFrameOverlayForTab,
      hideLastFrameOverlay,
      captureCurrentVideoFrame,
      stopVideoFrameCaptureLoop,
      resetVideoFreezeState,
      stopVideoFreezeWatchdog,
      shouldMonitorFrozenVideo,
      handleFrozenVideo,
      startVideoFrameMonitor,
      stopScrcpySessionHeartbeat,
      startScrcpySessionHeartbeat,
      stopPointerMoveFlushLoop,
      getHighFrequencyControlChannel,
      stopPointerControlFlushLoop,
      stopPointerReleaseFlushLoop,
      flushPendingPointerControlPayloads,
      schedulePointerControlFlush,
      enqueuePointerControlPayloads,
      enqueuePointerPayloadBuffers,
      flushPersistTabs,
      schedulePersistTabs,
      postScrcpySessionAction,
      normalizeNewDisplayDpiValue,
      detectAutomaticNewDisplayDpi,
      roundDisplayDimension,
      getDisplayStageRect,
      getDisplayAspectSize,
      buildAdaptiveDisplaySize,
      hasLiveConnection,
      persistCurrentConnection,
      clearPersistedConnection,
      getPersistedConnection,
      disposePersistedConnection,
      disposeOtherPersistedConnections,
      disposeAllPersistedConnections,
      restorePersistedConnection,
      getStageBounds,
      doesVerticalLayoutOverflowAt,
      shouldUseHorizontalLayoutAt,
      getMenuBoundsAt,
      isHorizontalLayout,
      getMenuExpandDirectionAt,
      getMenuFrameAt,
      clampCollapsedMenuPosition,
      clampExpandedMenuPosition,
      clampMenuPosition,
      syncMenuSideState,
      shouldCollapseExpandedMenuWhileDragging,
      updateMenuRelativePosition,
      setMenuPosition,
      restoreMenuPositionFromRelative,
      initializeMenuPosition,
      buildTabKey,
      getTabTitle,
      persistTabs,
      syncRefsFromActiveTab,
      syncRouteToActiveTab,
      upsertTab,
      createTabFromQuery,
      createTabFromRequest,
      openIncomingTab,
      consumeIncomingTab,
      fetchDeviceName,
      fetchDeviceSettings,
      createSyntheticPointerEvent,
      setupControlChannel,
      setupMetaControlChannel,
      setupPointerMoveChannel,
      clearPendingReconnect,
      clearPendingIceRestartFallback,
      clearPendingVideoRecovery,
      clearPendingSignalingDetach,
      resetSignalingDetachState,
      clearStartConnectionState,
      scheduleReconnect,
      enableAutoReconnect,
      disableAutoReconnect,
      scheduleVideoRecovery,
      scheduleReconnectFallbackAfterIceRestart,
      scheduleSignalingDetach,
      tryIceRestart,
      clearPendingStartConnection,
      clearPendingDisplayResize,
      stopFlexDisplayHeartbeat,
      startFlexDisplayHeartbeat,
      getDisplayResizeSize,
      sendDisplayResizeIfNeeded,
      scheduleDisplayResize,
      scheduleStartConnection,
      syncVideoFrameSize,
      normalizeIceCandidate,
      isDroppableControlPayload,
      sendBinaryControlMessage,
      getMetaControlChannel,
      sendMetaControlMessage,
      writeUInt16BE,
      writeUInt32BE,
      writeUInt64BE,
      getOrCreateScrcpyPointerId,
      getScrcpyPointerId,
      releaseScrcpyPointerId,
      buildInjectKeycodeMessage,
      buildScreenPowerMessage,
      buildUhidCreateMessage,
      buildUhidInputMessage,
      buildUhidDestroyMessage,
      buildResizeDisplayMessage,
      buildHidMouseReport,
      buildHidKeyboardReport,
      buildTouchMessage,
      mapAndroidCommandToKeycode,
      mapBrowserCodeToAndroidKeyCode,
      mapBrowserCodeToHidKey,
      mapMouseButtonToHidMask,
      clampSignedByte,
      initializeHidDevices,
      resetHidInputs,
      releaseHidDevices,
      sendAndroidCommand,
      sendKeyboardEvent,
      sendHidMouseEvent,
      syncPointerLockState,
      requestMouseLock,
      releaseMouseLock,
      toggleMouseLock,
      clearPendingResumePlayback,
      resumeMediaPlayback,
      scheduleResumeMediaPlayback,
      applyRemoteClipboardText,
      readClipboard,
      syncClipboard,
      pasteClipboard,
      openClipboardWindow,
      closeClipboardWindow,
      toggleClipboardWindow,
      startClipboardDrag,
      replaceSingleTrack,
      applyLowLatencyTrackHints,
      bindVideoTrack,
      bindAudioTrack,
      requestFullscreen,
      toggleFullscreen,
      toggleFillMode,
      attachRemoteTrack,
      cleanupMediaStream,
      wirePeerConnectionEventHandlers,
      wireWebSocketEventHandlers,
      startConnection,
      detachActiveConnectionFromView,
      stopConnection,
      activateTab,
      closeTab,
      loadPersistedTabs,
      getVideoViewport,
      getPointerRatios,
      clearLocalPointerState,
      getPointerGeneration,
      bumpPointerGeneration,
      finalizePointerRelease,
      flushPendingPointerReleases,
      schedulePointerReleaseFlush,
      schedulePointerMoveFlush,
      flushPendingPointerMoves,
      markTouchPointerActivity,
      shouldIgnoreCompatMouse,
      buildQueuedPointerMovePayload,
      buildPointerLifecyclePayloads,
      sendPointerMessage,
      releasePointer,
      releaseAllPointers,
      releaseLingeringTouchPointers,
      getLatestPointerSample,
      handlePointerDown,
      handlePointerMove,
      handlePointerUp,
      handlePointerCancel,
      handlePointerCaptureLost,
      handleWindowPointerUp,
      handleWindowPointerCancel,
      handleWindowPointerMove,
      buildMousePointerEvent,
      handleMouseDown,
      handleWindowMouseMove,
      handleWindowMouseUp,
      handleWindowBlur,
      handleWindowFocus,
      handleVisibilityChange,
      handlePageHide,
      handlePageShow,
      shouldIgnoreKeyboardEvent,
      handleWindowKeyDown,
      handleWindowKeyUp,
      handleMouseWheel,
      handlePointerLockChange,
      handleVideoMetadataLoaded,
      handleVideoResize,
      handleWindowResize,
      handleVideoTimeUpdate,
      attachPageEventListeners,
      detachPageEventListeners,
      setupVideoContainerResizeObserver,
      teardownVideoContainerResizeObserver,
      handleMenuPointerEnter,
      handleMenuPointerLeave,
      syncDockedMenuPosition,
      finishMenuDrag,
      startMenuDrag,
      toggleMenu
    };
  }
});
