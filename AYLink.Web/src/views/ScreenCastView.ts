import { defineComponent } from 'vue';
import {
  ChevronLeft20Regular,
  ArrowHookUpLeft20Regular,
  Home20Regular,
  List20Regular,
  AppRecent20Regular,
  Power20Regular,
  FullScreenMaximize20Regular,
  Speaker020Regular,
  SpeakerMute20Regular,
  Speaker220Regular,
  ArrowExpand24Regular,
  Phone20Regular,
  Clipboard20Regular,
  CheckmarkCircle20Regular,
  DismissCircle20Regular,
  Edit20Regular,
  Eye20Regular,
  EyeOff20Regular,
  Save20Regular,
  CursorClick24Regular,
  TapDouble24Regular,
  SwipeRight24Regular,
  Apps24Regular,
  Target24Regular,
  EyeTracking24Regular,
  Flash24Regular,
  CursorHover24Regular,
  Sparkle24Regular
} from '@vicons/fluent';
import { computed, nextTick, onActivated, onDeactivated, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useI18n } from '../composables/useI18n';
import { useAppSettings } from '../services/appSettings';
import { getAccessToken, useAuth } from '../services/auth';
import { useNotification } from '../services/notification';
import { loadLocalWebRtcOverrideConfig, loadLocalWebRtcOverrideEnabled } from '../services/webrtcSettings';
import { apiFetch } from '../utils/api';
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
import {
  useVideoStreamHealth,
  type VideoStreamStallDetails
} from '../features/screencast/useVideoStreamHealth';
import { useScreencastMediaTracks } from '../features/screencast/useScreencastMediaTracks';
import {
  useScrcpyControlChannels,
  type PendingPointerControlPayload
} from '../features/screencast/useScrcpyControlChannels';
import { useCastDeviceContext } from '../features/screencast/useCastDeviceContext';
import { useCastTabs } from '../features/screencast/useCastTabs';
import { useCastSessionPersistence } from '../features/screencast/useCastSessionPersistence';
import { wireBackgroundPersistedConnectionHandlers } from '../features/screencast/persistedConnectionTracks';
import {
  ANDROID_KEYCODE_BACK,
  ANDROID_KEYCODE_HOME,
  ANDROID_KEYCODE_MENU,
  ANDROID_KEYCODE_MUTE,
  ANDROID_KEYCODE_POWER,
  ANDROID_KEYCODE_RECENT,
  ANDROID_KEYCODE_VOLUME_DOWN,
  ANDROID_KEYCODE_VOLUME_UP,
  SCRCPY_ACTION_DOWN,
  SCRCPY_ACTION_MOVE,
  SCRCPY_ACTION_UP,
  SCRCPY_MSG_INJECT_KEYCODE,
  SCRCPY_MSG_INJECT_TOUCH_EVENT,
  SCRCPY_MSG_RESIZE_DISPLAY,
  SCRCPY_MSG_SET_SCREEN_POWER_MODE,
  SCRCPY_PRIMARY_BUTTON,
  buildInjectKeycodeMessage,
  buildResizeDisplayMessage,
  buildScreenPowerMessage,
  buildTouchMessage,
  mapAndroidCommandToKeycode,
  mapBrowserCodeToAndroidKeyCode,
  writeUInt16BE,
  writeUInt32BE,
  writeUInt64BE
} from '../features/screencast/scrcpyControlProtocol';
import {
  getPointerRatios as getPointerRatiosFromViewport,
  getVideoViewport as resolveVideoViewport
} from '../features/screencast/videoViewport';
import { useFloatingMenu } from '../features/screencast/useFloatingMenu';
import { useRemoteClipboard } from '../features/screencast/useRemoteClipboard';
import { useTouchPointerInput } from '../features/screencast/useTouchPointerInput';
import { createInputMappingTouchBridge } from '../features/screencast/inputMappingTouchBridge';
import { useInputMappingRuntimeController } from '../features/inputMapping/useInputMappingRuntimeController';
import { setInputMappingTabState } from '../features/inputMapping/inputMappingTabState';
import { buildInputMappingStickers } from '../features/inputMapping/inputMappingStickers';
import {
  createEmptyInputMappingProfile,
  type InputMappingBinding,
  type InputMappingProfile,
  type NormalizedPoint
} from '../features/inputMapping/inputMappingSchema';
import type { InputMappingStickerItem } from '../features/inputMapping/inputMappingStickers';
import type { CastTab, PersistedCastConnection } from '../types/screencast';
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
    ArrowHookUpLeft20Regular,
    Home20Regular,
    List20Regular,
    AppRecent20Regular,
    Power20Regular,
    FullScreenMaximize20Regular,
    Speaker020Regular,
    SpeakerMute20Regular,
    Speaker220Regular,
    ArrowExpand24Regular,
    Phone20Regular,
    Clipboard20Regular,
    CheckmarkCircle20Regular,
    DismissCircle20Regular,
    Edit20Regular,
    Eye20Regular,
    EyeOff20Regular,
    Save20Regular,
    CursorClick24Regular,
    TapDouble24Regular,
    SwipeRight24Regular,
    Apps24Regular,
    Target24Regular,
    EyeTracking24Regular,
    Flash24Regular,
    CursorHover24Regular,
    Sparkle24Regular
  },
  setup() {
    interface WebRtcNetworkSettingsPayload {
      IceTransportPolicy?: string;
      IceServers?: Array<{
        Urls?: string[];
        Username?: string | null;
        Credential?: string | null;
      }>;
    }

    type FloatingMenuPage =
      | 'main'
      | 'navigation'
      | 'display'
      | 'volume'
      | 'power'
      | 'inputMapping';

    interface FloatingMenuActionItem {
      id: string;
      title: string;
      iconComponent: unknown;
      danger?: boolean;
      disabled?: boolean;
      action: () => void;
    }

    interface FloatingMenuGroupItem {
      id: Exclude<FloatingMenuPage, 'main'>;
      title: string;
      iconComponent: unknown;
    }

    interface SignalErrorMessagePayload {
      type: 'error';
      code?: string;
      messageKey: string;
      message?: string;
      detail?: string;
      retryable?: boolean;
    }

    const CAST_MENU_PLACEMENT_STORAGE_KEY = 'aylink_cast_menu_placement';

    const POINTER_MOVE_BUFFER_LIMIT = 64 * 1024;

    const CONTROL_CHANNEL_BUFFER_LIMIT = 256 * 1024;

    const MOUSE_COMPAT_SUPPRESSION_MS = 900;

    const POINTER_MOVE_SAMPLE_INTERVAL_MS = 1000 / 120;

    const POINTER_MOVE_SAMPLE_INTERVAL_60HZ_MS = 1000 / 60;

    const POINTER_MOVE_SAMPLE_INTERVAL_30HZ_MS = 1000 / 30;

    const WEAK_NETWORK_POINTER_MOVE_BUFFER_LIMIT = Math.floor(POINTER_MOVE_BUFFER_LIMIT * 0.5);

    const POINTER_MOVE_BUFFER_PRESSURE_MEDIUM_RATIO = 0.35;

    const POINTER_MOVE_BUFFER_PRESSURE_HIGH_RATIO = 0.75;

    const SIGNALING_STABLE_DETACH_MS = 20000;

    const VIDEO_RECOVERY_TIMEOUT_MS = 8000;

    const VIDEO_STREAM_STALL_THRESHOLD_MS = 3000;

    const VIDEO_STREAM_WATCHDOG_INTERVAL_MS = 1000;

    const VIDEO_STREAM_DIAGNOSTIC_INTERVAL_MS = 5000;

    const VIDEO_STREAM_STALL_CONFIRMATION_COUNT = 2;

    const VIDEO_STREAM_STALL_RECOVERY_OBSERVATION_MS = 3000;

    const VIDEO_STREAM_STALL_RECOVERY_COOLDOWN_MS = 10000;

    const DEFAULT_AUTO_NEW_DISPLAY_DPI = 160;

    const MIN_NEW_DISPLAY_DPI = 72;

    const MAX_NEW_DISPLAY_DPI = 960;

    const MIN_NEW_DISPLAY_DIMENSION = 240;

    const MAX_NEW_DISPLAY_LONG_EDGE = 1920;

    const MENU_MARGIN = 20;

    const MENU_BUTTON_SIZE = 48;

    const MENU_ITEM_SIZE = 38;

    const MENU_ITEM_GAP = 6;

    const getMenuExpandedLength = (itemCount: number) =>
      MENU_BUTTON_SIZE + 6 + (itemCount * MENU_ITEM_SIZE) + (Math.max(0, itemCount - 1) * MENU_ITEM_GAP) + 12;

    const MENU_COLLAPSED_VISIBLE_WIDTH = 18;

    const MENU_EXPAND_DIRECTION_SWITCH_RATIO = 0.75;

    const MENU_DRAG_THRESHOLD_PX = 4;

    const CLIPBOARD_WINDOW_MARGIN = 16;

    const CLIPBOARD_WINDOW_DEFAULT_WIDTH = 380;

    const CLIPBOARD_WINDOW_DEFAULT_HEIGHT = 220;

    const { t } = useI18n();
    const notifications = useNotification();

    const {
      adaptivePointerSampling,
      backgroundMute,
      newDisplayDpiMode,
      newDisplayDpiValue,
      pointerSamplingRateHz,
      weakNetworkMode
    } = useAppSettings();

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

    const lastFrameOverlayElement = ref<HTMLImageElement | null>(null);

    const audioElement = ref<HTMLAudioElement | null>(null);

    const videoContainer = ref<HTMLDivElement | null>(null);

    let isPageEventListenersAttached = false;

    let attachedVideoElement: HTMLVideoElement | null = null;
    const rtcConfigRequest = createLatestRequestController();

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

    const remoteClipboard = useRemoteClipboard({
      margin: CLIPBOARD_WINDOW_MARGIN,
      defaultWidth: CLIPBOARD_WINDOW_DEFAULT_WIDTH,
      defaultHeight: CLIPBOARD_WINDOW_DEFAULT_HEIGHT,
      getDeviceId: () => deviceId.value,
      getStageBounds: () => getStageBounds(),
      t
    });

    const {
      clipboardFloatElement,
      isClipboardWindowVisible,
      clipboardText,
      clipboardStatusText,
      isClipboardLoading,
      isClipboardSaving,
      clipboardWindowX,
      clipboardWindowY,
      clipboardWindowStyle,
      getClipboardWindowSize,
      clampClipboardWindowPosition,
      initializeClipboardWindowPosition,
      clampClipboardWindowToStage,
      applyRemoteClipboardText,
      readClipboard,
      syncClipboard,
      pasteClipboard,
      openClipboardWindow,
      closeClipboardWindow,
      toggleClipboardWindow,
      startClipboardDrag,
      handleWindowPointerMove: handleClipboardWindowPointerMove,
      finishClipboardDrag,
      cancelClipboardDrag
    } = remoteClipboard;

    const activeFloatingMenuPage = ref<FloatingMenuPage>('main');

    const floatingMenuLayout = reactive({
      margin: MENU_MARGIN,
      buttonSize: MENU_BUTTON_SIZE,
      expandedLength: getMenuExpandedLength(6),
      expandDirectionSwitchRatio: MENU_EXPAND_DIRECTION_SWITCH_RATIO
    });

    const floatingMenu = useFloatingMenu({
      storageKey: CAST_MENU_PLACEMENT_STORAGE_KEY,
      layout: floatingMenuLayout,
      dragThresholdPx: MENU_DRAG_THRESHOLD_PX,
      dockSnapDistancePx: 64,
      getStageBounds: () => getStageBounds()
    });

    const {
      isMenuExpanded,
      isDocked,
      isMenuDragActive,
      dockedEdge,
      menuX,
      menuY,
      menuRelativeX,
      menuRelativeY,
      isHorizontalLayout,
      menuStyle,
      clampCollapsedMenuPosition,
      updateMenuRelativePosition,
      setMenuPosition,
      restoreMenuPositionFromRelative,
      loadPersistedMenuPlacement,
      applyDockPosition,
      initializeMenuPosition,
      ensureMenuInsideStage,
      handleMenuPointerEnter,
      handleMenuPointerLeave,
      syncDockedMenuPosition,
      finishMenuDrag,
      startMenuDrag,
      handleWindowPointerMove: handleMenuWindowPointerMove,
      toggleMenu
    } = floatingMenu;

    let remoteVideoStream = new MediaStream();

    let remoteAudioStream = new MediaStream();

    const remoteTracks = new Map<'audio' | 'video', MediaStreamTrack>();

    let peerConnection: RTCPeerConnection | null = null;

    let ws: WebSocket | null = null;

    let dataChannel: RTCDataChannel | null = null;

    let metaControlChannel: RTCDataChannel | null = null;

    let pointerMoveChannel: RTCDataChannel | null = null;

    let activeMousePointerId: number | null = null;

    let lastVideoFrameSize = { width: 0, height: 0 };

    const connectionSchedulerState = createCastConnectionSchedulerState();

    const videoStreamHealth = useVideoStreamHealth({
      stableDetachMs: SIGNALING_STABLE_DETACH_MS,
      stallThresholdMs: VIDEO_STREAM_STALL_THRESHOLD_MS,
      watchdogIntervalMs: VIDEO_STREAM_WATCHDOG_INTERVAL_MS,
      diagnosticIntervalMs: VIDEO_STREAM_DIAGNOSTIC_INTERVAL_MS,
      stallConfirmationCount: VIDEO_STREAM_STALL_CONFIRMATION_COUNT,
      getActiveConnectionId: () => activeConnectionId,
      isAutoReconnectSuppressed: () => connectionSchedulerState.suppressAutoReconnect,
      isScreencastVisible: () => document.visibilityState === 'visible' && route.name === 'screencast',
      getPeerConnection: () => peerConnection,
      getSignalingSocket: () => ws,
      getVideoTrack: () => remoteTracks.get('video'),
      hasVideoTrack: () => remoteTracks.has('video'),
      hasVideoSource: () => !!videoElement.value?.srcObject,
      getVideoElement: () => videoElement.value,
      syncVideoFrameSize: () => syncVideoFrameSize(),
      getDeviceId: () => deviceId.value,
      getTabKey: () => activeTabKey.value,
      onVideoStreamStalledConfirmed: (details) => {
        handleConfirmedVideoStreamStall(details);
      }
    });

    const mediaTracks = useScreencastMediaTracks({
      remoteTracks,
      getVideoStream: () => remoteVideoStream,
      setVideoStream: (stream) => {
        remoteVideoStream = stream;
      },
      getAudioStream: () => remoteAudioStream,
      setAudioStream: (stream) => {
        remoteAudioStream = stream;
      },
      getVideoElement: () => videoElement.value,
      getAudioElement: () => audioElement.value,
      getPersistentAudioElement: () => getPersistentAudioElement(),
      getConnectionId: () => activeConnectionId,
      shouldReconnectOnVideoEnded: () => !connectionSchedulerState.suppressAutoReconnect,
      getDeviceId: () => deviceId.value,
      getTabKey: () => activeTabKey.value,
      getWebSocketReadyState: () => ws?.readyState ?? null,
      getPeerConnectionState: () => peerConnection?.connectionState ?? null,
      onVideoTrackBound: (connectionId) => {
        startVideoFrameMonitor(connectionId);
        clearPendingVideoRecovery();
        scheduleSignalingDetach(connectionId);
      },
      onAudioTrackBound: () => {
        syncBackgroundMuteState();
      },
      onTrackChanged: () => {
        persistCurrentConnection();
      },
      onVideoTrackEnded: (connectionId) => {
        markActiveVideoStreamUnstable(connectionId, 'remote_video_track_ended');
        stopConnection();
        scheduleReconnect('remote_video_track_ended');
      }
    });

    const controlChannels = useScrcpyControlChannels({
      controlBufferLimit: CONTROL_CHANNEL_BUFFER_LIMIT,
      pointerMoveBufferLimit: POINTER_MOVE_BUFFER_LIMIT,
      isDroppableControlPayload: (payload) => isDroppableControlPayload(payload),
      onControlChannelChanged: (channel) => {
        dataChannel = channel;
      },
      onMetaControlChannelChanged: (channel) => {
        metaControlChannel = channel;
      },
      onPointerMoveChannelChanged: (channel) => {
        pointerMoveChannel = channel;
      },
      onControlChannelOpen: () => {
        status.value = t('Screencast.StatusControlConnected', '控制通道已连接');
        flushPendingPointerReleases();
        initializeHidDevices();
        lastDisplayResizeRequest = null;
        scheduleDisplayResize(0);
      },
      onControlBufferedAmountLow: () => {
        flushPendingPointerReleases();
      },
      onPointerMoveChannelOpen: () => {
        flushPendingPointerMoves();
        flushPendingPointerReleases();
      },
      onPointerMoveBufferedAmountLow: () => {
        flushPendingPointerMoves();
        flushPendingPointerReleases();
      },
      onPersistConnection: () => {
        persistCurrentConnection();
      }
    });

    const pendingPointerControlPayloads = controlChannels.pendingPointerControlPayloads;

    const touchPointerInput = useTouchPointerInput({
      getVideoElement: () => videoElement.value,
      getPointerRatios: (event) => getPointerRatios(event),
      getPrimaryControlChannel: () => dataChannel,
      getPointerMoveSendChannel: () => getPointerMoveSendChannel(),
      getCurrentPointerMoveBufferLimit: () => getCurrentPointerMoveBufferLimit(),
      getCurrentPointerMoveSampleIntervalMs: () => getCurrentPointerMoveSampleIntervalMs(),
      flushPendingPointerControlPayloads: () => flushPendingPointerControlPayloads(),
      enqueuePointerPayloadBuffers: (payloads, onLastSent) => enqueuePointerPayloadBuffers(payloads, onLastSent),
      mouseCompatSuppressionMs: MOUSE_COMPAT_SUPPRESSION_MS
    });

    const {
      activePointers,
      pointerGenerations,
      pointerSnapshots,
      pointerControlQueues,
      pendingPointerReleases,
      queuedPointerReleases,
      pendingPointerMoves,
      createSyntheticPointerEvent,
      getOrCreateScrcpyPointerId,
      getScrcpyPointerId,
      releaseScrcpyPointerId,
      clearLocalPointerState,
      getPointerGeneration,
      bumpPointerGeneration,
      finalizePointerRelease,
      markTouchPointerActivity,
      shouldIgnoreCompatMouse,
      buildQueuedPointerMovePayload,
      buildPointerLifecyclePayloads,
      sendPointerMessage,
      releasePointer,
      releaseAllPointers: releaseTouchPointers,
      releaseLingeringTouchPointers,
      getLatestPointerSample,
      handlePointerDown,
      handlePointerMove,
      handlePointerUp,
      handlePointerCancel,
      handlePointerCaptureLost,
      clearAllPointerState,
      resetAllPointerState,
      stopPointerMoveFlushLoop,
      stopPointerReleaseFlushLoop,
      flushPendingPointerReleases,
      schedulePointerReleaseFlush,
      schedulePointerMoveFlush,
      flushPendingPointerMoves
    } = touchPointerInput;

    const releaseAllPointers = (phase: 'up' | 'cancel' = 'cancel') => {
      releaseTouchPointers(phase);
      activeMousePointerId = null;
    };

    const isInputMappingEditMode = ref(false);

    const selectedInputMappingStickerId = ref('');

    const isInputMappingProfileDialogVisible = ref(false);

    const inputMappingProfileDialogMode = ref<'new' | 'info'>('info');

    const inputMappingProfileForm = ref({
      name: '',
      author: '',
      description: '',
      packageName: ''
    });

    const inputMappingContextMenu = ref({
      visible: false,
      x: 0,
      y: 0,
      point: { x: 0.5, y: 0.5 } as NormalizedPoint
    });

    const inputMappingCaptureBindingId = ref('');

    const inputMappingCaptureIgnoreMouseUntil = ref(0);

    const inputMappingStickerDrag = ref<{
      bindingId: string;
      offsetX: number;
      offsetY: number;
    } | null>(null);

    const inputMappingStickerLayoutRevision = ref(0);

    const inputMappingStickers = computed(() => {
      const profile = activeInputMappingProfile.value;
      return profile ? buildInputMappingStickers(profile) : [];
    });

    const isNewInputMappingProfileDraft = computed(() =>
      route.query.inputMappingNew === '1' && isInputMappingEditMode.value && !!activeInputMappingProfile.value
    );

    const getCurrentInputMappingPackageName = () => {
      const routePackageName = typeof route.query.appPackage === 'string' ? route.query.appPackage : '';
      return normalizePackageName(appPackageName.value || activeTab.value?.appPackageName || routePackageName);
    };

    const selectedInputMappingSticker = computed(() => {
      return inputMappingStickers.value.find((sticker) => sticker.bindingId === selectedInputMappingStickerId.value) ?? null;
    });

    const getJoystickStickerBindingIds = (bindingId: string) => {
      if (!bindingId.startsWith('joystick:')) {
        return [];
      }

      const separatorIndex = bindingId.lastIndexOf(':');
      if (separatorIndex < 'joystick:'.length) {
        return [];
      }

      return bindingId
        .slice(separatorIndex + 1)
        .split('+')
        .filter(Boolean);
    };

    const findExistingJoystickSticker = () => {
      return inputMappingStickers.value.find((sticker) => sticker.bindingId.startsWith('joystick:')) ?? null;
    };

    const selectedInputMappingBinding = computed(() => {
      const profile = activeInputMappingProfile.value;
      const sticker = selectedInputMappingSticker.value;
      if (!profile || !sticker || sticker.bindingId.startsWith('joystick:')) {
        return null;
      }

      return profile.bindings.find((binding) => binding.id === sticker.bindingId) ?? null;
    });

    const selectedInputMappingStickerLabelText = computed(() => {
      const binding = selectedInputMappingBinding.value;
      return binding?.sticker?.label ?? binding?.label ?? selectedInputMappingSticker.value?.label ?? '';
    });

    const selectedInputMappingConfigTitle = computed(() => {
      const sticker = selectedInputMappingSticker.value;
      const binding = selectedInputMappingBinding.value;
      const label = selectedInputMappingStickerLabelText.value;
      if (!sticker) {
        return '';
      }

      if (sticker.shape === 'joystick') {
        return '方向按键';
      }

      if (binding?.action.type === 'mouseLook') {
        return '视角移动';
      }

      if (binding?.action.type === 'swipe') {
        return '滑动键位';
      }

      if (binding?.action.type === 'rapidTap') {
        return '连击按键';
      }

      if (binding?.trigger.type === 'mouseButton') {
        return label || '鼠标按键';
      }

      return label || '按键配置';
    });

    const inputMappingStickerPaletteItems = [
      { type: 'click', title: '点击按键', iconComponent: CursorClick24Regular },
      { type: 'rapidTap', title: '连击按键', iconComponent: TapDouble24Regular },
      { type: 'swipe', title: '滑动键位', iconComponent: SwipeRight24Regular },
      { type: 'joystick', title: '方向按键', iconComponent: Apps24Regular },
      { type: 'aim', title: '准星键', iconComponent: Target24Regular },
      { type: 'look', title: '视角移动', iconComponent: EyeTracking24Regular },
      { type: 'fire', title: '攻击键', iconComponent: Flash24Regular },
      { type: 'mouse', title: '右键行走', iconComponent: CursorHover24Regular },
      { type: 'skill', title: '技能施法', iconComponent: Sparkle24Regular }
    ];

    const inputMappingTouchBridge = createInputMappingTouchBridge({
      getVideoViewport: () => getVideoViewport(),
      sendPointerRatiosCommand: (command) => touchPointerInput.sendPointerRatiosCommand(command)
    });

    let pendingResumePlaybackTimer: number | null = null;

    let pendingDisplayResizeTimer: number | null = null;

    let flexDisplayHeartbeatTimer: number | null = null;

    let pendingVideoRecoveryTimer: number | null = null;

    let pendingVideoStreamStallObservationTimer: number | null = null;

    let pendingIceRestartFallbackTimer: number | null = null;

    let pendingCandidates: RTCIceCandidateInit[] = [];

    let activeConnectionId = 0;

    let hasHandledInitialActivation = false;

    let lastVideoStreamStallRecoveryAttemptAt = 0;

    let hasUsedInitialConnectionWarmup = false;

    let lastDisplayResizeRequest: { width: number; height: number } | null = null;

    let videoContainerResizeObserver: ResizeObserver | null = null;

    let hasInitializedFloatingMenuPlacement = false;

    let isIceRestartInFlight = false;

    let currentScrcpySessionId = '';

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

    const getCurrentInputMappingTabKey = () => {
      const routeTabKey = typeof route.query.inputMappingTabKey === 'string'
        ? route.query.inputMappingTabKey
        : '';
      return activeTabKey.value || routeTabKey;
    };

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

    const getSessionReleaseTarget = (tabKey = activeTabKey.value) => {
      const persisted = getPersistedConnection(tabKey);
      return {
        deviceId: deviceId.value || persisted?.deviceId || '',
        sessionId: currentScrcpySessionId || persisted?.sessionId || ''
      };
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
      videoStreamHealth.stopVideoFrameCaptureLoop();
    };

    const resetVideoStreamWatchdogState = () => {
      videoStreamHealth.resetWatchdogState();
    };

    const stopVideoStreamWatchdog = () => {
      videoStreamHealth.stopWatchdog();
    };

    const shouldMonitorVideoStream = (connectionId: number) => videoStreamHealth.shouldMonitorVideoStream(connectionId);

    const handleVideoStreamWatchdog = (connectionId: number, reason: string) => videoStreamHealth.handleWatchdog(connectionId, reason);

    const startVideoFrameMonitor = (connectionId: number) => {
      videoStreamHealth.start(connectionId);
    };

    const getHighFrequencyControlChannel = () =>
      controlChannels.getHighFrequencyControlChannel();

    const getPointerMoveSendChannel = () =>
      controlChannels.getPointerMoveSendChannel();

    const getConfiguredPointerMoveSampleIntervalMs = () => {
      if (pointerSamplingRateHz.value === 30) {
        return POINTER_MOVE_SAMPLE_INTERVAL_30HZ_MS;
      }
      if (pointerSamplingRateHz.value === 60) {
        return POINTER_MOVE_SAMPLE_INTERVAL_60HZ_MS;
      }
      return POINTER_MOVE_SAMPLE_INTERVAL_MS;
    };

    const getPointerMoveBufferedAmount = () => getPointerMoveSendChannel()?.bufferedAmount ?? 0;

    const getCurrentPointerMoveBufferLimit = () =>
      weakNetworkMode.value && !adaptivePointerSampling.value
        ? WEAK_NETWORK_POINTER_MOVE_BUFFER_LIMIT
        : POINTER_MOVE_BUFFER_LIMIT;

    const getAdaptivePointerMoveSampleIntervalMs = () => {
      const bufferedAmount = getPointerMoveBufferedAmount();
      const bufferLimit = getCurrentPointerMoveBufferLimit();
      if (bufferedAmount >= bufferLimit * POINTER_MOVE_BUFFER_PRESSURE_HIGH_RATIO) {
        return POINTER_MOVE_SAMPLE_INTERVAL_30HZ_MS;
      }
      if (bufferedAmount >= bufferLimit * POINTER_MOVE_BUFFER_PRESSURE_MEDIUM_RATIO) {
        return POINTER_MOVE_SAMPLE_INTERVAL_60HZ_MS;
      }
      return POINTER_MOVE_SAMPLE_INTERVAL_MS;
    };

    const getCurrentPointerMoveSampleIntervalMs = () => {
      if (adaptivePointerSampling.value) {
        return getAdaptivePointerMoveSampleIntervalMs();
      }

      const configuredInterval = getConfiguredPointerMoveSampleIntervalMs();
      if (!weakNetworkMode.value) {
        return configuredInterval;
      }

      return Math.max(configuredInterval, getAdaptivePointerMoveSampleIntervalMs());
    };

    const stopPointerControlFlushLoop = () => {
      controlChannels.stopPointerControlFlushLoop();
    };

    const flushPendingPointerControlPayloads = () => {
      controlChannels.flushPendingPointerControlPayloads();
    };

    const schedulePointerControlFlush = () => {
      flushPendingPointerControlPayloads();
    };

    const enqueuePointerControlPayloads = (...payloads: PendingPointerControlPayload[]) => {
      return controlChannels.enqueuePointerControlPayloads(...payloads);
    };

    const enqueuePointerPayloadBuffers = (payloads: Uint8Array[], onLastSent?: () => void) => {
      return controlChannels.enqueuePointerPayloadBuffers(payloads, onLastSent);
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

    const buildSignalWebSocketBaseUrl = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      return import.meta.env.DEV ? 'ws://127.0.0.1:5501/webrtc' : `${protocol}//${host}/webrtc`;
    };

    const requestSignalTicket = async (existingSessionId = '') => {
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
          sessionId: existingSessionId || undefined,
          appPackage: normalizedAppPackage || undefined,
          appName: appDisplayName.value || undefined,
          newDisplay: isNewDisplayMode.value,
          newDisplayWidth: initialNewDisplaySize?.width,
          newDisplayHeight: initialNewDisplaySize?.height,
          newDisplayDpi: resolvedNewDisplayDpi.value ?? undefined,
        })
      });

      return {
        normalizedDeviceId,
        ticketResponse
      };
    };

    const persistCurrentConnection = (
      tabKey = activeTabKey.value,
      options: { disposeOtherConnections?: boolean; wireBackgroundHandlers?: boolean } = {}
    ) => {
      if (!peerConnection || !tabKey) {
        return;
      }

      const snapshot: PersistedCastConnection = {
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
      if (options.wireBackgroundHandlers) {
        wireBackgroundPersistedConnectionHandlers(snapshot, disposePersistedConnection);
      }

      persistCastConnectionSnapshot(tabKey, snapshot, options);
    };

    const restorePersistedConnection = (tabKey = activeTabKey.value) => {
      const persisted = getPersistedConnection(tabKey);
      if (!persisted) {
        return false;
      }

      const persistedPeerConnectionState = persisted.peerConnection.connectionState;
      if ((persisted.ws && persisted.ws.readyState >= WebSocket.CLOSING)
        || persistedPeerConnectionState === 'closed'
        || persistedPeerConnectionState === 'failed') {
        console.warn('[WebRTC] Discarding stale persisted connection snapshot.', {
          tabKey,
          deviceId: persisted.deviceId,
          hasSocket: !!persisted.ws,
          peerConnectionState: persistedPeerConnectionState
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
      startScrcpySessionHeartbeat(persisted.deviceId, currentScrcpySessionId);
      scheduleResumeMediaPlayback(0);
      startVideoFrameMonitor(connectionId);
      persistCurrentConnection(tabKey, { disposeOtherConnections: false });
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

    const setupControlChannel = (channel: RTCDataChannel) => {
      controlChannels.setupControlChannel(channel);
    };

    const setupMetaControlChannel = (channel: RTCDataChannel) => {
      controlChannels.setupMetaControlChannel(channel);
    };

    const setupPointerMoveChannel = (channel: RTCDataChannel) => {
      controlChannels.setupPointerMoveChannel(channel);
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

    const clearPendingVideoStreamStallObservation = () => {
      if (pendingVideoStreamStallObservationTimer != null) {
        window.clearTimeout(pendingVideoStreamStallObservationTimer);
        pendingVideoStreamStallObservationTimer = null;
      }
    };

    const clearPendingSignalingDetach = () => {
      videoStreamHealth.clearPendingSignalingDetach();
    };

    const resetSignalingDetachState = () => {
      videoStreamHealth.resetSignalingDetachState();
    };

    const markActiveVideoStreamUnstable = (connectionId: number, reason: string) => {
      videoStreamHealth.markUnstable(connectionId, reason);
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
        clearPendingVideoRecovery: () => {
          clearPendingVideoRecovery();
          clearPendingVideoStreamStallObservation();
        },
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
      clearPendingVideoStreamStallObservation();
      videoStreamHealth.scheduleSignalingDetach(connectionId);
    };

    const handleConfirmedVideoStreamStall = (details: VideoStreamStallDetails) => {
      if (connectionSchedulerState.suppressAutoReconnect || details.connectionId !== activeConnectionId) {
        return;
      }

      const currentPeerConnection = peerConnection;
      const currentVideoTrack = remoteTracks.get('video');
      if (!currentPeerConnection || currentPeerConnection.connectionState !== 'connected' || !currentVideoTrack || currentVideoTrack.readyState !== 'live') {
        return;
      }

      const now = Date.now();
      if (pendingVideoStreamStallObservationTimer != null || now - lastVideoStreamStallRecoveryAttemptAt < VIDEO_STREAM_STALL_RECOVERY_COOLDOWN_MS) {
        return;
      }

      lastVideoStreamStallRecoveryAttemptAt = now;
      const signalingAttached = !!ws && ws.readyState === WebSocket.OPEN;
      const recoveryReason = details.status === 'browser_decode_stalled_confirmed'
          ? 'browser_decode_stalled'
          : 'browser_playback_starved';
      requestVideoKeyFrameReplay(recoveryReason);
      if (!signalingAttached) {
        console.info('[WebRTC] Confirmed video stream stall while signaling websocket is detached; attempting signaling reattach before escalating recovery.', {
          ...details,
          sessionId: currentScrcpySessionId
        });
        void tryReattachSignaling(recoveryReason);
      } else {
        console.info('[WebRTC] Confirmed video stream stall; entering recovery observation window before escalating recovery.', details);
      }

      pendingVideoStreamStallObservationTimer = window.setTimeout(() => {
        pendingVideoStreamStallObservationTimer = null;
        if (connectionSchedulerState.suppressAutoReconnect || details.connectionId !== activeConnectionId) {
          return;
        }

        const activeVideoTrack = remoteTracks.get('video');
        if (!peerConnection || peerConnection.connectionState !== 'connected' || !activeVideoTrack || activeVideoTrack.readyState !== 'live') {
          return;
        }

        void (async () => {
          const renegotiated = await tryVideoRenegotiation(recoveryReason);
          if (renegotiated) {
            return;
          }

          console.warn('[WebRTC] Video recovery observation window elapsed while browser playback starvation persisted; deferring heavier recovery until a non-destructive signaling reattach path is available.', {
            ...details,
            signalingAttached: !!ws && ws.readyState === WebSocket.OPEN,
            sessionId: currentScrcpySessionId
          });
        })();
      }, VIDEO_STREAM_STALL_RECOVERY_OBSERVATION_MS);
    };

    const tryReattachSignaling = async (reason: string) => {
      if (connectionSchedulerState.suppressAutoReconnect || !peerConnection || peerConnection.connectionState !== 'connected' || !deviceId.value || !currentScrcpySessionId) {
        return false;
      }
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        return ws.readyState === WebSocket.OPEN;
      }

      console.warn('[WebRTC] Attempting signaling reattach for active peer connection.', {
        reason,
        deviceId: deviceId.value,
        tabKey: activeTabKey.value,
        sessionId: currentScrcpySessionId
      });

      try {
        const { ticketResponse } = await requestSignalTicket(currentScrcpySessionId);
        if (!ticketResponse.ok) {
          console.warn('[WebRTC] Signaling reattach ticket request failed.', {
            reason,
            status: ticketResponse.status,
            deviceId: deviceId.value,
            tabKey: activeTabKey.value,
            sessionId: currentScrcpySessionId
          });
          return false;
        }

        const ticketPayload = await ticketResponse.json();
        currentScrcpySessionId = String(ticketPayload.sessionId ?? currentScrcpySessionId);
        const socket = new WebSocket(`${buildSignalWebSocketBaseUrl()}?ticket=${encodeURIComponent(String(ticketPayload.ticket ?? ''))}`);
        ws = socket;

        socket.onopen = () => {
          if (ws !== socket || !peerConnection || peerConnection.connectionState !== 'connected') {
            return;
          }
          status.value = t('Screencast.StatusConnected', '已连接');
          startScrcpySessionHeartbeat(deviceId.value, currentScrcpySessionId);
          persistCurrentConnection();
          console.info('[WebRTC] Signaling websocket reattached to the active peer connection.', {
            deviceId: deviceId.value,
            tabKey: activeTabKey.value,
            sessionId: currentScrcpySessionId
          });
        };

        wireWebSocketEventHandlers(activeConnectionId, socket);
        persistCurrentConnection();
        return true;
      } catch (error) {
        console.error('Failed to reattach signaling websocket:', error);
        return false;
      }
    };

    const tryVideoRenegotiation = async (reason: string) => {
      if (connectionSchedulerState.suppressAutoReconnect || !peerConnection || !ws || ws.readyState !== WebSocket.OPEN) {
        return false;
      }
      if (peerConnection.connectionState !== 'connected' || peerConnection.signalingState !== 'stable') {
        return false;
      }
      if (isIceRestartInFlight) {
        return false;
      }

      console.warn('[WebRTC] Attempting non-destructive video renegotiation after confirmed browser video stall.', {
        reason,
        deviceId: deviceId.value,
        tabKey: activeTabKey.value,
        sessionId: currentScrcpySessionId
      });

      try {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        if (!peerConnection.localDescription || !ws || ws.readyState !== WebSocket.OPEN) {
          throw new Error('signaling socket not ready for video renegotiation');
        }
        ws.send(JSON.stringify(peerConnection.localDescription));
        return true;
      } catch (error) {
        console.error('Video renegotiation failed:', error);
        return false;
      }
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
      controlChannels.sendBinaryControlMessage(payload, channel);
    };

    const getMetaControlChannel = () => {
      return controlChannels.getMetaControlChannel();
    };

    const sendMetaControlMessage = (payload: Uint8Array, options?: { requireDedicatedChannel?: boolean }) => {
      controlChannels.sendMetaControlMessage(payload, options);
    };

    const buildLocalMetaControlMessage = (messageType: number) => {
      const payload = new Uint8Array(2);
      payload[0] = 0xFF;
      payload[1] = Math.max(0, Math.min(0xFF, messageType)) & 0xFF;
      return payload;
    };

    const requestVideoKeyFrameReplay = (reason: string) => {
      const metaChannel = getMetaControlChannel();
      if (!metaChannel || metaChannel.readyState !== 'open') {
        return false;
      }

      sendMetaControlMessage(buildLocalMetaControlMessage(0x02), { requireDedicatedChannel: true });
      console.info('[WebRTC] Requested cached video key frame replay over meta control channel.', {
        reason,
        deviceId: deviceId.value,
        tabKey: activeTabKey.value,
        sessionId: currentScrcpySessionId
      });
      return true;
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
        return true;
      }

      const keyCode = mapBrowserCodeToAndroidKeyCode(event.code);
      if (!keyCode) {
        return false;
      }

      sendBinaryControlMessage(
        buildInjectKeycodeMessage(
          phase === 'down' ? SCRCPY_ACTION_DOWN : SCRCPY_ACTION_UP,
          keyCode,
          phase === 'down' && event.repeat ? 1 : 0
        )
      );
      return true;
    };

    const sendHidMouseEvent = (payload: { phase: 'down' | 'up' | 'move' | 'wheel'; button?: number; dx?: number; dy?: number; wheelX?: number; wheelY?: number }) => {
      return hidSession.sendMouseEvent(payload);
    };

    const sendInputMappingHidKeyCommand = (phase: 'down' | 'up', code: string) => {
      if (hidSession.sendKeyboardCode(phase, code)) {
        return true;
      }

      const keyCode = mapBrowserCodeToAndroidKeyCode(code);
      if (!keyCode) {
        return false;
      }

      sendBinaryControlMessage(
        buildInjectKeycodeMessage(
          phase === 'down' ? SCRCPY_ACTION_DOWN : SCRCPY_ACTION_UP,
          keyCode
        )
      );
      return true;
    };

    const inputMappingController = useInputMappingRuntimeController({
      getRouteQuery: () => route.query,
      getActiveTabKey: getCurrentInputMappingTabKey,
      refreshStickerLayout: () => refreshInputMappingStickerLayout(),
      sendTouchCommand: (command) => inputMappingTouchBridge.sendTouchCommand(command),
      sendHidKeyCommand: (phase, code) => sendInputMappingHidKeyCommand(phase, code),
      sendHidMouseButtonCommand: (phase, button) => sendHidMouseEvent({ phase, button }),
      sendHidMouseWheelCommand: (deltaY) => sendHidMouseEvent({
        phase: 'wheel',
        wheelY: Math.round(deltaY)
      }),
      isPointerLocked: () => document.pointerLockElement === videoElement.value
    });

    const {
      activeInputMappingProfileName,
      activeInputMappingProfile,
      isInputMappingHintsVisible,
      isInputMappingEnabled,
      release: releaseInputMapping,
      saveActiveProfile: saveRuntimeInputMappingProfile,
      handleKeyboard: handleInputMappingKeyboard,
      handleMouseButton: handleInputMappingMouseButton,
      handleMouseMove: handleInputMappingMouseMove,
      handleMouseWheel: handleInputMappingMouseWheel,
      hasMouseLook: hasInputMappingMouseLook,
      isMouseCaptureToggleKey,
      isHintsToggleKey: isInputMappingHintsToggleKey,
      isEnabledToggleKey: isInputMappingEnabledToggleKey,
      toggleHints: toggleInputMappingHints,
      toggleEnabled: toggleInputMappingEnabled,
      loadActiveProfile: loadRuntimeInputMappingProfile,
      clearPointerKeys: clearInputMappingPointerKeys
    } = inputMappingController;

    const applyInputMappingProfileToRuntime = (profile: InputMappingProfile) => {
      inputMappingController.executeCommands(inputMappingController.runtime.setProfile(profile));
      activeInputMappingProfileName.value = profile.name;
      refreshInputMappingStickerLayout();
    };

    const syncPointerLockState = () => {
      isMouseLocked.value = document.pointerLockElement === videoElement.value;
    };

    const canUseMouseLock = () => {
      return isHidMouseEnabled.value || hasInputMappingMouseLook();
    };

    const isInputMappingMouseModeActive = () => {
      return hasInputMappingMouseLook() && document.pointerLockElement === videoElement.value;
    };

    const requestMouseLock = async () => {
      if (!videoElement.value || !canUseMouseLock()) {
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
      if (!canUseMouseLock()) {
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
      refreshInputMappingStickerLayout();
    };

    const attachRemoteTrack = async (event: RTCTrackEvent) => {
      await mediaTracks.attachRemoteTrack(event);
      scheduleResumeMediaPlayback();
      syncVideoFrameSize();
    };

    const cleanupMediaStream = () => {
      stopVideoFrameCaptureLoop();
      stopVideoStreamWatchdog();
      resetVideoStreamWatchdogState();
      clearPendingReconnect();
      clearPendingVideoStreamStallObservation();
      clearPendingResumePlayback();
      lastVideoFrameSize = { width: 0, height: 0 };
      shouldShowLastFrameOverlay.value = false;
      mediaTracks.cleanupMediaElements();
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
          markActiveVideoStreamUnstable(connectionId, `peer_connection_${peerConnection.connectionState}`);
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

        markActiveVideoStreamUnstable(connectionId, `ice_connection_${currentIceState}`);
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
        const wasIntentionalDetach = videoStreamHealth.consumeExpectedSignalingClose(connectionId);
        ws = null;
        const currentState = peerConnection?.connectionState;
        if (currentState === 'connected' || currentState === 'connecting') {
          videoStreamHealth.markSignalingClosedWhileActive(connectionId);
          persistCurrentConnection(persistedTabKey);
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

        clearPersistedConnection(persistedTabKey);
        resetSignalingDetachState();
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

      const previousSession = getSessionReleaseTarget(targetTabKey);
      stopScrcpySessionHeartbeat();
      if (previousSession.sessionId) {
        void postScrcpySessionAction('release', previousSession.deviceId, previousSession.sessionId);
      }
      disposeAllPersistedConnections();
      stopConnection();
      enableAutoReconnect();
      resetSignalingDetachState();
      resetVideoStreamWatchdogState();
      connectionSchedulerState.isStartConnectionInFlight = true;
      connectionSchedulerState.activeConnectionTargetKey = targetTabKey;
      isConnecting.value = true;
      status.value = t('Screencast.StatusConnectingDevice', '正在连接设备...');
      pendingCandidates = [];
      const connectionId = ++activeConnectionId;

      try {
        let wsUrl = buildSignalWebSocketBaseUrl();
        const { ticketResponse } = await requestSignalTicket();

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
      releaseInputMapping('disconnect');
      clearAllPointerState();
      clearInputMappingPointerKeys();
      currentScrcpySessionId = '';
      controlChannels.clearPendingPointerControlPayloads();
      connectionSchedulerState.isStartConnectionInFlight = false;
      connectionSchedulerState.activeConnectionTargetKey = '';
      stopVideoFrameCaptureLoop();
      stopVideoStreamWatchdog();
      resetVideoStreamWatchdogState();
      resetSignalingDetachState();
      stopPointerControlFlushLoop();
      stopPointerReleaseFlushLoop();
      clearPendingIceRestartFallback();
      clearPendingVideoRecovery();
      clearPendingVideoStreamStallObservation();
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

    const stopConnection = (
      preserveForBackground = false,
      preserveTabKey = activeTabKey.value,
      options: { disposeOtherPersistedConnections?: boolean } = {}
    ) => {
      const shouldPreserveLiveConnection = preserveForBackground && hasLiveConnection();
      if (!shouldPreserveLiveConnection) {
        stopScrcpySessionHeartbeat();
      }
      stopFlexDisplayHeartbeat();
      stopVideoStreamWatchdog();
      clearPendingDisplayResize();
      releaseInputMapping('disconnect');
      resetAllPointerState();
      clearInputMappingPointerKeys();
      controlChannels.clearPendingPointerControlPayloads();
      connectionSchedulerState.isStartConnectionInFlight = false;
      connectionSchedulerState.activeConnectionTargetKey = '';
      resetSignalingDetachState();
      stopPointerControlFlushLoop();
      stopPointerReleaseFlushLoop();
      clearPendingIceRestartFallback();
      clearPendingVideoRecovery();
      clearPendingVideoStreamStallObservation();
      isIceRestartInFlight = false;

      if (shouldPreserveLiveConnection) {
        captureCurrentVideoFrame(preserveTabKey);
        persistCurrentConnection(preserveTabKey, {
          disposeOtherConnections: options.disposeOtherPersistedConnections,
          wireBackgroundHandlers: true
        });
        detachActiveConnectionFromView();
        return;
      }

      currentScrcpySessionId = '';
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
        stopConnection(true, previousTabKey, { disposeOtherPersistedConnections: false });
      }

      activeTabKey.value = tab.key;
      enableAutoReconnect();
      syncRefsFromActiveTab();
      showLastFrameOverlayForTab(tab.key);
      persistTabs();
      await syncRouteToActiveTab();
      await loadActiveInputMappingProfile();
      await refreshDeviceContext();
      if (restorePersistedConnection(tab.key)) {
        return;
      }
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
      await loadActiveInputMappingProfile();
      if (nextTab) {
        await refreshDeviceContext();
        scheduleStartConnection();
      }
    };

    const getVideoViewport = () => {
      if (shouldShowLastFrameOverlay.value && lastFrameOverlayElement.value) {
        return resolveVideoViewport(lastFrameOverlayElement.value, effectiveFillMode.value);
      }

      return resolveVideoViewport(videoElement.value, effectiveFillMode.value);
    };

    const refreshInputMappingStickerLayout = () => {
      inputMappingStickerLayoutRevision.value += 1;
    };

    const getInputMappingStickerStyle = (sticker: InputMappingStickerItem) => {
      void inputMappingStickerLayoutRevision.value;

      const viewport = getVideoViewport();
      if (!viewport || viewport.displayWidth <= 0 || viewport.displayHeight <= 0) {
        return {
          display: 'none'
        };
      }
      const stageRect = videoContainer.value?.getBoundingClientRect();
      const originX = stageRect?.left ?? 0;
      const originY = stageRect?.top ?? 0;

      return {
        left: `${viewport.offsetX - originX + viewport.displayWidth * sticker.point.x}px`,
        top: `${viewport.offsetY - originY + viewport.displayHeight * sticker.point.y}px`,
        opacity: `${sticker.opacity}`
      };
    };

    const getInputMappingConfigPanelStyle = () => {
      void inputMappingStickerLayoutRevision.value;

      const sticker = selectedInputMappingSticker.value;
      const viewport = getVideoViewport();
      const stageRect = videoContainer.value?.getBoundingClientRect();
      if (!sticker || !viewport || !stageRect) {
        return {
          display: 'none'
        };
      }

      const left = viewport.offsetX - stageRect.left + viewport.displayWidth * sticker.point.x;
      const top = viewport.offsetY - stageRect.top + viewport.displayHeight * sticker.point.y;
      const panelOffsetX = left > stageRect.width - 320 ? -286 : 48;
      const panelOffsetY = top > stageRect.height - 240 ? -172 : -42;
      return {
        left: `${left + panelOffsetX}px`,
        top: `${top + panelOffsetY}px`
      };
    };

    const getInputMappingPointFromClient = (clientX: number, clientY: number) => {
      const viewport = getVideoViewport();
      if (!viewport || viewport.displayWidth <= 0 || viewport.displayHeight <= 0) {
        return null;
      }

      return {
        x: Math.min(1, Math.max(0, (clientX - viewport.offsetX) / viewport.displayWidth)),
        y: Math.min(1, Math.max(0, (clientY - viewport.offsetY) / viewport.displayHeight))
      };
    };

    const createInputMappingBindingId = (prefix: string) => {
      return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    };

    const getInputMappingTriggerText = (binding: InputMappingBinding) => {
      if (binding.trigger.type === 'keyboard') {
        return binding.trigger.code.replace(/^Key/, '').replace(/^Digit/, '');
      }
      if (binding.trigger.type === 'mouseButton') {
        if (binding.trigger.button === 0) return '左键';
        if (binding.trigger.button === 1) return '中键';
        if (binding.trigger.button === 2) return '右键';
        return `M${binding.trigger.button}`;
      }
      if (binding.trigger.type === 'mouseWheel') {
        return binding.trigger.direction === 'up' ? '滚上' : '滚下';
      }
      return '鼠标';
    };

    const createInputMappingBindingAtPoint = (type: string, point: NormalizedPoint): InputMappingBinding[] => {
      const id = createInputMappingBindingId(type);
      const sticker = {
        keyText: '1',
        label: '',
        shape: 'key' as const,
        opacity: 0.9
      };

      switch (type) {
        case 'rapidTap':
          return [{
            id,
            label: '连击',
            trigger: { type: 'keyboard', code: 'Digit1' },
            action: {
              type: 'rapidTap',
              point,
              mode: 'whileHeld',
              tapsPerSecond: 20,
              tapCount: 20
            },
            sticker: { ...sticker, label: '连击' }
          }];
        case 'swipe':
          return [{
            id,
            label: '滑动',
            trigger: { type: 'keyboard', code: 'Digit1' },
            action: {
              type: 'swipe',
              from: point,
              to: { x: Math.min(1, point.x + 0.08), y: point.y },
              durationMs: 120
            },
            sticker: { ...sticker, label: '滑动' }
          }];
        case 'joystick': {
          const group = createInputMappingBindingId('movement');
          const directions = [
            ['move-forward', 'W', 'KeyW', { x: 0, y: -1 }],
            ['move-left', 'A', 'KeyA', { x: -1, y: 0 }],
            ['move-back', 'S', 'KeyS', { x: 0, y: 1 }],
            ['move-right', 'D', 'KeyD', { x: 1, y: 0 }]
          ] as const;
          return directions.map(([suffix, keyText, code, direction]) => ({
            id: `${group}-${suffix}`,
            label: keyText,
            trigger: { type: 'keyboard', code },
            action: {
              type: 'virtualJoystick',
              center: point,
              radius: 0.08,
              direction,
              group
            },
            sticker: {
              keyText,
              label: '',
              shape: 'key' as const,
              opacity: 0.9
            }
          }));
        }
        case 'look':
          return [{
            id,
            label: '视角',
            trigger: { type: 'mouseMove', activation: 'pointerLock' },
            action: {
              type: 'mouseLook',
              touchStart: point,
              sensitivityX: 1,
              sensitivityY: 1,
              invertY: false,
              maxStep: 0.08
            },
            sticker: {
              keyText: '',
              label: '',
              shape: 'mouse',
              opacity: 0.55
            }
          }];
        case 'fire':
          return [{
            id,
            label: '攻击',
            trigger: { type: 'mouseButton', button: 0 },
            action: { type: 'tap', point },
            sticker: { ...sticker, keyText: '左键', label: '攻击', shape: 'mouse' }
          }];
        case 'mouse':
          return [{
            id,
            label: '右键',
            trigger: { type: 'mouseButton', button: 2 },
            action: { type: 'hold', point },
            sticker: { ...sticker, keyText: '右键', label: '右键', shape: 'mouse' }
          }];
        case 'skill':
          return [{
            id,
            label: '技能',
            trigger: { type: 'keyboard', code: 'KeyE' },
            action: { type: 'tap', point },
            sticker: { ...sticker, keyText: 'E', label: '技能' }
          }];
        case 'aim':
          return [{
            id,
            label: '准星',
            trigger: { type: 'keyboard', code: 'KeyQ' },
            action: { type: 'tap', point },
            sticker: { ...sticker, keyText: 'Q', label: '准星' }
          }];
        case 'click':
        default:
          return [{
            id,
            label: '点击',
            trigger: { type: 'keyboard', code: 'Digit1' },
            action: { type: 'tap', point },
            sticker: { ...sticker, label: '点击' }
          }];
      }
    };

    const saveActiveInputMappingProfile = async () => {
      const profile = activeInputMappingProfile.value;
      if (!profile) {
        return;
      }

      if (isNewInputMappingProfileDraft.value) {
        activeInputMappingProfileName.value = profile.name;
        refreshInputMappingStickerLayout();
        return;
      }

      await saveRuntimeInputMappingProfile();
    };

    const addInputMappingStickerFromPalette = async (type: string) => {
      const profile = activeInputMappingProfile.value;
      if (!profile) {
        return;
      }

      if (type === 'joystick') {
        const existingJoystickSticker = findExistingJoystickSticker();
        if (existingJoystickSticker) {
          selectedInputMappingStickerId.value = existingJoystickSticker.bindingId;
          closeInputMappingContextMenu();
          return;
        }
      }

      const bindings = createInputMappingBindingAtPoint(type, inputMappingContextMenu.value.point);
      profile.bindings.push(...bindings);
      selectedInputMappingStickerId.value = bindings[0]?.action.type === 'virtualJoystick'
        ? (findExistingJoystickSticker()?.bindingId ?? '')
        : (bindings[0]?.id ?? '');
      closeInputMappingContextMenu();
      await saveActiveInputMappingProfile();
    };

    const updateSelectedInputMappingBindingSticker = async (patch: { label?: string; labelEnabled?: boolean; keyText?: string }) => {
      const binding = selectedInputMappingBinding.value;
      if (!binding) {
        return;
      }

      const label = patch.label != null ? patch.label.slice(0, 5) : binding.sticker?.label;
      binding.sticker = {
        ...binding.sticker,
        label,
        labelEnabled: patch.labelEnabled ?? binding.sticker?.labelEnabled,
        keyText: patch.keyText ?? binding.sticker?.keyText ?? getInputMappingTriggerText(binding)
      };
      if (patch.label != null) {
        binding.label = label || binding.label;
      }
      await saveActiveInputMappingProfile();
    };

    const updateSelectedInputMappingLabel = (event: Event) => {
      const value = (event.target as HTMLInputElement | null)?.value ?? '';
      void updateSelectedInputMappingBindingSticker({ label: value });
    };

    const toggleSelectedInputMappingStickerEnabled = () => {
      const binding = selectedInputMappingBinding.value;
      if (!binding) {
        return;
      }

      void updateSelectedInputMappingBindingSticker({ labelEnabled: binding.sticker?.labelEnabled === false });
    };

    const startInputMappingTriggerCapture = () => {
      const binding = selectedInputMappingBinding.value;
      if (!binding) {
        return;
      }

      inputMappingCaptureIgnoreMouseUntil.value = Date.now() + 180;
      inputMappingCaptureBindingId.value = binding.id;
    };

    const captureSelectedInputMappingMouseButton = (event: MouseEvent) => {
      if (!inputMappingCaptureBindingId.value) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      if (Date.now() < inputMappingCaptureIgnoreMouseUntil.value) {
        return;
      }

      void applyInputMappingCapturedMouseButton(event);
    };

    const applyInputMappingCapturedKeyboard = async (event: KeyboardEvent) => {
      const profile = activeInputMappingProfile.value;
      const binding = profile?.bindings.find((item) => item.id === inputMappingCaptureBindingId.value);
      if (!binding) {
        return false;
      }

      binding.trigger = { type: 'keyboard', code: event.code };
      binding.sticker = {
        ...binding.sticker,
        keyText: event.code.replace(/^Key/, '').replace(/^Digit/, '')
      };
      inputMappingCaptureBindingId.value = '';
      await saveActiveInputMappingProfile();
      return true;
    };

    const applyInputMappingCapturedMouseButton = async (event: MouseEvent) => {
      const profile = activeInputMappingProfile.value;
      const binding = profile?.bindings.find((item) => item.id === inputMappingCaptureBindingId.value);
      if (!binding) {
        return false;
      }

      binding.trigger = { type: 'mouseButton', button: event.button };
      binding.sticker = {
        ...binding.sticker,
        keyText: event.button === 0 ? '左键' : event.button === 1 ? '中键' : event.button === 2 ? '右键' : `M${event.button}`,
        shape: 'mouse'
      };
      inputMappingCaptureBindingId.value = '';
      inputMappingCaptureIgnoreMouseUntil.value = 0;
      await saveActiveInputMappingProfile();
      return true;
    };

    const deleteSelectedInputMappingBinding = async () => {
      const profile = activeInputMappingProfile.value;
      const binding = selectedInputMappingBinding.value;
      const sticker = selectedInputMappingSticker.value;
      if (!profile || !sticker) {
        return;
      }

      const joystickBindingIds = getJoystickStickerBindingIds(sticker.bindingId);
      if (joystickBindingIds.length > 0) {
        profile.bindings = profile.bindings.filter((item) => !joystickBindingIds.includes(item.id));
      } else if (binding) {
        profile.bindings = profile.bindings.filter((item) => item.id !== binding.id);
      } else {
        return;
      }

      selectedInputMappingStickerId.value = '';
      inputMappingCaptureBindingId.value = '';
      inputMappingCaptureIgnoreMouseUntil.value = 0;
      await saveActiveInputMappingProfile();
    };

    const updateInputMappingStickerPoint = async (bindingId: string, clientX: number, clientY: number) => {
      const point = getInputMappingPointFromClient(clientX, clientY);
      const profile = activeInputMappingProfile.value;
      if (!point || !profile) {
        return;
      }

      if (bindingId.startsWith('joystick:')) {
        const bindingIds = getJoystickStickerBindingIds(bindingId);
        for (const binding of profile.bindings) {
          if (bindingIds.includes(binding.id) && binding.action.type === 'virtualJoystick') {
            binding.action.center = point;
          }
        }
      } else {
        const binding = profile.bindings.find((item) => item.id === bindingId);
        if (!binding) {
          return;
        }
        if (binding.action.type === 'tap' || binding.action.type === 'rapidTap' || binding.action.type === 'hold') {
          binding.action.point = point;
        } else if (binding.action.type === 'swipe') {
          const center = {
            x: (binding.action.from.x + binding.action.to.x) / 2,
            y: (binding.action.from.y + binding.action.to.y) / 2
          };
          const delta = {
            x: point.x - center.x,
            y: point.y - center.y
          };
          binding.action.from = {
            x: Math.min(1, Math.max(0, binding.action.from.x + delta.x)),
            y: Math.min(1, Math.max(0, binding.action.from.y + delta.y))
          };
          binding.action.to = {
            x: Math.min(1, Math.max(0, binding.action.to.x + delta.x)),
            y: Math.min(1, Math.max(0, binding.action.to.y + delta.y))
          };
        } else if (binding.action.type === 'mouseLook') {
          binding.action.touchStart = point;
        }
      }

      await saveActiveInputMappingProfile();
    };

    const selectedInputMappingRapidTapAction = computed(() => {
      const action = selectedInputMappingBinding.value?.action;
      return action?.type === 'rapidTap' ? action : null;
    });

    const updateSelectedInputMappingRapidTapMode = (event: Event) => {
      const action = selectedInputMappingRapidTapAction.value;
      if (!action) {
        return;
      }

      const value = (event.target as HTMLSelectElement | null)?.value;
      action.mode = value === 'burst' ? 'burst' : 'whileHeld';
      void saveActiveInputMappingProfile();
    };

    const updateSelectedInputMappingRapidTapCount = (event: Event) => {
      const action = selectedInputMappingRapidTapAction.value;
      if (!action) {
        return;
      }

      const value = Number((event.target as HTMLInputElement | null)?.value || 20);
      const normalized = Math.min(200, Math.max(1, Math.round(Number.isFinite(value) ? value : 20)));
      if (action.mode === 'burst') {
        action.tapCount = normalized;
      } else {
        action.tapsPerSecond = Math.min(60, normalized);
      }
      void saveActiveInputMappingProfile();
    };

    const closeInputMappingContextMenu = () => {
      inputMappingContextMenu.value.visible = false;
    };

    const openInputMappingProfileDialog = (mode: 'new' | 'info') => {
      const profile = activeInputMappingProfile.value;
      if (!profile) {
        notifications.show({
          type: 'warning',
          title: t('InputMapping.NoActiveProfile', '没有可编辑的方案'),
          message: t('InputMapping.NoActiveProfileMessage', '请先新建或选择一个按键映射方案。')
        });
        return;
      }

      inputMappingProfileDialogMode.value = mode;
      inputMappingProfileForm.value = {
        name: profile.name || '',
        author: profile.author || '',
        description: profile.description || '',
        packageName: profile.target.packageName || getCurrentInputMappingPackageName()
      };
      isInputMappingProfileDialogVisible.value = true;
    };

    const closeInputMappingProfileDialog = () => {
      isInputMappingProfileDialogVisible.value = false;
    };

    const submitInputMappingProfileDialog = async () => {
      const profile = activeInputMappingProfile.value;
      if (!profile) {
        return;
      }

      const name = inputMappingProfileForm.value.name.trim();
      if (!name) {
        notifications.show({
          type: 'warning',
          title: t('InputMapping.ProfileNameRequired', '请填写方案名称'),
          message: t('InputMapping.ProfileNameRequiredMessage', '保存按键映射方案前需要填写名称。')
        });
        return;
      }

      profile.name = name;
      profile.author = inputMappingProfileForm.value.author.trim();
      profile.description = inputMappingProfileForm.value.description.trim();
      profile.target = {
        ...profile.target,
        packageName: normalizePackageName(inputMappingProfileForm.value.packageName)
      };

      try {
        await inputMappingController.profileStore.save(profile);
        setInputMappingTabState(getCurrentInputMappingTabKey(), {
          activeProfileId: profile.id,
          enabled: true
        });
        isInputMappingEnabled.value = true;
        applyInputMappingProfileToRuntime(profile);
        closeInputMappingProfileDialog();
        notifications.show({
          type: 'success',
          title: t('InputMapping.SaveSuccess', '保存成功'),
          message: profile.name
        });
        if (isNewInputMappingProfileDraft.value) {
          isInputMappingEditMode.value = false;
          selectedInputMappingStickerId.value = '';
          closeInputMappingContextMenu();
          inputMappingCaptureBindingId.value = '';
          inputMappingCaptureIgnoreMouseUntil.value = 0;
          void router.replace({
            name: 'screencast',
            query: {
              ...route.query,
              inputMappingEdit: undefined,
              inputMappingNew: undefined,
              inputMappingProfileId: undefined
            }
          });
        }
      } catch (error) {
        notifications.show({
          type: 'error',
          title: t('InputMapping.SaveFailed', '保存失败'),
          message: error instanceof Error ? error.message : t('InputMapping.SaveFailed', '保存失败')
        });
      }
    };

    const confirmDiscardNewInputMappingProfile = () => {
      if (!isNewInputMappingProfileDraft.value) {
        return true;
      }

      return window.confirm(t(
        'InputMapping.DiscardNewProfileConfirm',
        '当前新增方案尚未保存，退出编辑将放弃该方案。是否继续？'
      ));
    };

    const saveInputMappingProfileFromEditMenu = async () => {
      if (isNewInputMappingProfileDraft.value) {
        openInputMappingProfileDialog('new');
        return;
      }

      try {
        await saveActiveInputMappingProfile();
        notifications.show({
          type: 'success',
          title: t('InputMapping.SaveSuccess', '保存成功'),
          message: activeInputMappingProfile.value?.name || t('InputMapping.ProfileSaved', '按键映射方案已保存')
        });
      } catch (error) {
        notifications.show({
          type: 'error',
          title: t('InputMapping.SaveFailed', '保存失败'),
          message: error instanceof Error ? error.message : t('InputMapping.SaveFailed', '保存失败')
        });
      }
    };

    const exitInputMappingEditMode = () => {
      if (!confirmDiscardNewInputMappingProfile()) {
        return;
      }
      isInputMappingEditMode.value = false;
      selectedInputMappingStickerId.value = '';
      closeInputMappingContextMenu();
      inputMappingCaptureBindingId.value = '';
      inputMappingCaptureIgnoreMouseUntil.value = 0;
      void router.replace({
        name: 'screencast',
        query: {
          ...route.query,
          inputMappingEdit: undefined
        }
      });
    };

    const backToInputMappingProfiles = () => {
      if (!confirmDiscardNewInputMappingProfile()) {
        return;
      }
      const packageName = getCurrentInputMappingPackageName();
      void router.push({
        name: 'input-mapping-profiles',
        query: {
          ...(packageName ? { appPackage: packageName } : {}),
          ...(getCurrentInputMappingTabKey() ? { inputMappingTabKey: getCurrentInputMappingTabKey() } : {})
        }
      });
    };

    const enterInputMappingEditMode = () => {
      const profileId = activeInputMappingProfile.value?.id;
      if (!profileId) {
        backToInputMappingProfiles();
        return;
      }

      void router.replace({
        name: 'screencast',
        query: {
          ...route.query,
          inputMappingProfileId: profileId,
          inputMappingEdit: '1'
        }
      });
    };

    const toggleInputMappingHintsWithNotification = () => {
      toggleInputMappingHints();
      notifications.show({
        type: 'info',
        title: isInputMappingHintsVisible.value
          ? t('InputMapping.HintsEnabled', '按键提示已开启')
          : t('InputMapping.HintsDisabled', '按键提示已关闭'),
        message: activeInputMappingProfile.value?.name || t('InputMapping.InputMapping', '按键映射')
      });
    };

    const toggleInputMappingEnabledWithNotification = async () => {
      await toggleInputMappingEnabled();
      notifications.show({
        type: 'info',
        title: isInputMappingEnabled.value
          ? t('InputMapping.Enabled', '按键映射已开启')
          : t('InputMapping.Disabled', '按键映射已关闭'),
        message: activeInputMappingProfile.value?.name || t('InputMapping.InputMapping', '按键映射')
      });
    };

    const openFloatingMenuPage = (page: Exclude<FloatingMenuPage, 'main'>) => {
      activeFloatingMenuPage.value = page;
      isMenuExpanded.value = false;
      void nextTick(() => {
        isMenuExpanded.value = true;
        ensureMenuInsideStage();
      });
    };

    const returnToFloatingMenuMain = () => {
      activeFloatingMenuPage.value = 'main';
      isMenuExpanded.value = false;
      void nextTick(() => {
        isMenuExpanded.value = true;
        ensureMenuInsideStage();
      });
    };

    const floatingMenuGroups: FloatingMenuGroupItem[] = [
      { id: 'navigation', title: '导航', iconComponent: Home20Regular },
      { id: 'display', title: '显示', iconComponent: FullScreenMaximize20Regular },
      { id: 'volume', title: '音量', iconComponent: Speaker220Regular },
      { id: 'power', title: '电源 / 屏幕', iconComponent: Power20Regular },
      { id: 'inputMapping', title: '按键映射', iconComponent: Apps24Regular }
    ];

    const createBackToMainMenuItem = (): FloatingMenuActionItem => ({
      id: 'back-to-main',
      title: '返回主分组',
      iconComponent: ArrowHookUpLeft20Regular,
      action: returnToFloatingMenuMain
    });

    const getFloatingMenuGroupItems = (page: FloatingMenuPage): FloatingMenuActionItem[] => {
      switch (page) {
        case 'navigation':
          return [
            createBackToMainMenuItem(),
            { id: 'back', title: t('Screencast.Back', '返回'), iconComponent: ChevronLeft20Regular, action: () => sendAndroidCommand('back') },
            { id: 'home', title: t('Screencast.Home', '主页'), iconComponent: Home20Regular, action: () => sendAndroidCommand('home') },
            { id: 'menu', title: t('Screencast.Menu', '菜单'), iconComponent: List20Regular, action: () => sendAndroidCommand('menu') },
            { id: 'recent', title: t('Screencast.RecentApps', '最近任务'), iconComponent: AppRecent20Regular, action: () => sendAndroidCommand('recent') }
          ];
        case 'display':
          return [
            createBackToMainMenuItem(),
            {
              id: 'fill-mode',
              title: effectiveFillMode.value ? t('Screencast.FitDisplay', '适应显示') : t('Screencast.FillDisplay', '拉伸填充'),
              iconComponent: ArrowExpand24Regular,
              action: toggleFillMode
            },
            { id: 'fullscreen', title: t('Screencast.Fullscreen', '全屏'), iconComponent: FullScreenMaximize20Regular, action: toggleFullscreen }
          ];
        case 'volume':
          return [
            createBackToMainMenuItem(),
            { id: 'volume-up', title: t('Screencast.VolumeUp', '音量加'), iconComponent: Speaker220Regular, action: () => sendAndroidCommand('volumeup') },
            { id: 'volume-down', title: t('Screencast.VolumeDown', '音量减'), iconComponent: Speaker020Regular, action: () => sendAndroidCommand('volumedown') },
            { id: 'mute', title: t('Screencast.Mute', '静音'), iconComponent: SpeakerMute20Regular, action: () => sendAndroidCommand('mute') }
          ];
        case 'power':
          return [
            createBackToMainMenuItem(),
            { id: 'power', title: t('Screencast.Power', '电源'), iconComponent: Power20Regular, action: () => sendAndroidCommand('power') },
            { id: 'screen-on', title: t('Screencast.ScreenOn', '亮屏'), iconComponent: Phone20Regular, action: () => sendAndroidCommand('screenon') },
            { id: 'screen-off', title: t('Screencast.ScreenOff', '熄屏'), iconComponent: Phone20Regular, danger: true, action: () => sendAndroidCommand('screenoff') }
          ];
        case 'inputMapping':
          return isInputMappingEditMode.value
            ? [
              createBackToMainMenuItem(),
              { id: 'save-input-mapping', title: t('InputMapping.SaveProfile', '保存方案'), iconComponent: Save20Regular, disabled: !activeInputMappingProfile.value, action: () => void saveInputMappingProfileFromEditMenu() },
              { id: 'edit-input-mapping-info', title: t('InputMapping.EditProfileInfo', '编辑信息'), iconComponent: Edit20Regular, disabled: !activeInputMappingProfile.value, action: () => openInputMappingProfileDialog(isNewInputMappingProfileDraft.value ? 'new' : 'info') },
              { id: 'exit-input-mapping-edit', title: t('InputMapping.ExitEdit', '退出编辑'), iconComponent: DismissCircle20Regular, action: exitInputMappingEditMode },
              { id: 'input-mapping-profiles', title: t('InputMapping.BackToProfiles', '返回管理'), iconComponent: Apps24Regular, action: backToInputMappingProfiles }
            ]
            : [
              createBackToMainMenuItem(),
              { id: 'input-mapping-profiles', title: t('InputMapping.ManageProfiles', '管理方案'), iconComponent: Apps24Regular, action: backToInputMappingProfiles },
              { id: 'edit-input-mapping', title: t('InputMapping.EditBindings', '编辑按键'), iconComponent: Edit20Regular, disabled: !activeInputMappingProfile.value, action: enterInputMappingEditMode },
              {
                id: 'toggle-input-mapping-hints',
                title: isInputMappingHintsVisible.value ? t('InputMapping.HideHints', '隐藏提示') : t('InputMapping.ShowHints', '显示提示'),
                iconComponent: isInputMappingHintsVisible.value ? EyeOff20Regular : Eye20Regular,
                disabled: !activeInputMappingProfile.value,
                action: toggleInputMappingHintsWithNotification
              },
              {
                id: 'toggle-input-mapping-enabled',
                title: isInputMappingEnabled.value ? t('InputMapping.Disable', '关闭映射') : t('InputMapping.Enable', '开启映射'),
                iconComponent: isInputMappingEnabled.value ? DismissCircle20Regular : CheckmarkCircle20Regular,
                disabled: !activeInputMappingProfile.value,
                action: () => void toggleInputMappingEnabledWithNotification()
              }
            ];
        case 'main':
        default:
          return [];
      }
    };

    const activeFloatingMenuItems = computed<FloatingMenuActionItem[]>(() => {
      if (activeFloatingMenuPage.value === 'main') {
        const mainGroupItems: FloatingMenuActionItem[] = floatingMenuGroups.map((group) => ({
          id: group.id,
          title: group.title,
          iconComponent: group.iconComponent,
          action: () => openFloatingMenuPage(group.id)
        }));
        return mainGroupItems.concat({
          id: 'remote-clipboard',
          title: t('Screencast.RemoteClipboard', '远端剪贴板'),
          iconComponent: Clipboard20Regular,
          action: toggleClipboardWindow
        });
      }

      return getFloatingMenuGroupItems(activeFloatingMenuPage.value);
    });

    const activeFloatingMenuItemCount = computed(() => activeFloatingMenuItems.value.length);

    const blockInputMappingEditPointer = (event: Event) => {
      if (!isInputMappingEditMode.value) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      if (event.type === 'pointerdown' || event.type === 'mousedown') {
        selectedInputMappingStickerId.value = '';
        closeInputMappingContextMenu();
      }
      if (inputMappingCaptureBindingId.value && event instanceof MouseEvent && event.type === 'mousedown') {
        if (Date.now() < inputMappingCaptureIgnoreMouseUntil.value) {
          return;
        }
        void applyInputMappingCapturedMouseButton(event);
      }
    };

    const handleInputMappingStageContextMenu = (event: MouseEvent) => {
      if (!isInputMappingEditMode.value) {
        return;
      }

      event.preventDefault();
      const stageRect = videoContainer.value?.getBoundingClientRect();
      const point = getInputMappingPointFromClient(event.clientX, event.clientY);
      selectedInputMappingStickerId.value = '';
      inputMappingContextMenu.value = {
        visible: true,
        x: event.clientX - (stageRect?.left ?? 0),
        y: event.clientY - (stageRect?.top ?? 0),
        point: point ?? inputMappingContextMenu.value.point
      };
    };

    const selectInputMappingSticker = (sticker: InputMappingStickerItem) => {
      if (!isInputMappingEditMode.value) {
        return;
      }

      selectedInputMappingStickerId.value = sticker.bindingId;
      closeInputMappingContextMenu();
    };

    const openInputMappingStickerConfig = (event: MouseEvent, sticker: InputMappingStickerItem) => {
      if (!isInputMappingEditMode.value) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      selectedInputMappingStickerId.value = sticker.bindingId;
      closeInputMappingContextMenu();
    };

    const startInputMappingStickerDrag = (event: PointerEvent, sticker: InputMappingStickerItem) => {
      if (!isInputMappingEditMode.value) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      selectedInputMappingStickerId.value = sticker.bindingId;
      inputMappingStickerDrag.value = {
        bindingId: sticker.bindingId,
        offsetX: 0,
        offsetY: 0
      };
      (event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId);
    };

    const moveInputMappingStickerDrag = (event: PointerEvent) => {
      if (!inputMappingStickerDrag.value) {
        return;
      }

      event.preventDefault();
      void updateInputMappingStickerPoint(inputMappingStickerDrag.value.bindingId, event.clientX, event.clientY);
    };

    const finishInputMappingStickerDrag = (event: PointerEvent) => {
      if (!inputMappingStickerDrag.value) {
        return;
      }

      try {
        (event.currentTarget as HTMLElement | null)?.releasePointerCapture?.(event.pointerId);
      } catch {
        // Ignore capture release failures while leaving edit mode or changing tabs.
      }
      inputMappingStickerDrag.value = null;
    };

    const getPointerRatios = (event: PointerEvent) => {
      return getPointerRatiosFromViewport(event, getVideoViewport());
    };

    const loadActiveInputMappingProfile = async () => {
      isInputMappingEditMode.value = route.query.inputMappingEdit === '1';
      if (route.query.inputMappingNew === '1') {
        const profile = createEmptyInputMappingProfile('');
        profile.target.packageName = getCurrentInputMappingPackageName();
        activeInputMappingProfile.value = profile;
        activeInputMappingProfileName.value = profile.name;
        refreshInputMappingStickerLayout();
        return true;
      }

      return loadRuntimeInputMappingProfile();
    };

    const handleWindowPointerUp = (event: PointerEvent) => {
      if (finishClipboardDrag()) {
        return;
      }

      if (floatingMenu.getIsDraggingMenu()) {
        finishMenuDrag();
        return;
      }

      releasePointer(event.pointerId, 'up', event);
    };

    const handleWindowPointerCancel = (event: PointerEvent) => {
      cancelClipboardDrag();

      if (floatingMenu.getIsDraggingMenu()) {
        finishMenuDrag();
      }

      releasePointer(event.pointerId, 'cancel', event);
    };

    const handleWindowPointerMove = (event: PointerEvent) => {
      if (handleClipboardWindowPointerMove(event)) {
        return;
      }

      handleMenuWindowPointerMove(event);
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
      if (inputMappingCaptureBindingId.value) {
        event.preventDefault();
        if (Date.now() < inputMappingCaptureIgnoreMouseUntil.value) {
          return;
        }
        void applyInputMappingCapturedMouseButton(event);
        return;
      }

      if (isInputMappingEditMode.value) {
        event.preventDefault();
        return;
      }

      if (isConnected.value && isInputMappingMouseModeActive() && handleInputMappingMouseButton('down', event)) {
        event.preventDefault();
        return;
      }

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
      if (isInputMappingEditMode.value) {
        return;
      }

      if (isConnected.value && isInputMappingMouseModeActive() && handleInputMappingMouseMove(event)) {
        event.preventDefault();
        return;
      }

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
      if (isInputMappingEditMode.value) {
        return;
      }

      if (isConnected.value && isInputMappingMouseModeActive() && handleInputMappingMouseButton('up', event)) {
        event.preventDefault();
        return;
      }

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
      cancelClipboardDrag();
      finishMenuDrag();
      releaseInputMapping('blur');
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
      if (shouldIgnoreKeyboardEvent(event)) {
        return;
      }

      if (inputMappingCaptureBindingId.value) {
        event.preventDefault();
        void applyInputMappingCapturedKeyboard(event);
        return;
      }

      if (isInputMappingEditMode.value) {
        event.preventDefault();
        return;
      }

      if (!isConnected.value) {
        return;
      }

      if (!event.repeat && isInputMappingHintsToggleKey(event)) {
        event.preventDefault();
        toggleInputMappingHintsWithNotification();
        return;
      }

      if (!event.repeat && isInputMappingEnabledToggleKey(event)) {
        event.preventDefault();
        void toggleInputMappingEnabledWithNotification();
        return;
      }

      if (!event.repeat && isMouseCaptureToggleKey(event) && canUseMouseLock()) {
        event.preventDefault();
        void toggleMouseLock();
        return;
      }

      if (handleInputMappingKeyboard('down', event)) {
        event.preventDefault();
        return;
      }

      sendKeyboardEvent('down', event);
      event.preventDefault();
    };

    const handleWindowKeyUp = (event: KeyboardEvent) => {
      if (shouldIgnoreKeyboardEvent(event)) {
        return;
      }

      if (isInputMappingEditMode.value) {
        event.preventDefault();
        return;
      }

      if (!isConnected.value) {
        return;
      }

      if (
        isInputMappingHintsToggleKey(event)
        || isInputMappingEnabledToggleKey(event)
        || (isMouseCaptureToggleKey(event) && canUseMouseLock())
      ) {
        event.preventDefault();
        return;
      }

      if (handleInputMappingKeyboard('up', event)) {
        event.preventDefault();
        return;
      }

      sendKeyboardEvent('up', event);
      event.preventDefault();
    };

    const handleMouseWheel = (event: WheelEvent) => {
      if (isConnected.value && isInputMappingMouseModeActive() && handleInputMappingMouseWheel(event)) {
        event.preventDefault();
        return;
      }

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
      if (!isInputMappingEnabled.value) {
        return;
      }

      inputMappingController.executeCommands(inputMappingController.runtime.handleMouseMove({
        movementX: 0,
        movementY: 0,
        pointerLocked: document.pointerLockElement === videoElement.value,
        pressedButtons: 0
      }).commands);
    };

    const handleVideoMetadataLoaded = () => {
      syncVideoFrameSize();
      refreshInputMappingStickerLayout();
      scheduleDisplayResize();
    };

    const handleVideoResize = () => {
      syncVideoFrameSize();
      refreshInputMappingStickerLayout();
      scheduleDisplayResize();
    };

    const handleWindowResize = () => {
      refreshInputMappingStickerLayout();

      if (menuX.value === 0 && menuY.value === 0) {
        initializeMenuPosition();
      } else if (isDocked.value) {
        applyDockPosition(dockedEdge.value);
      } else {
        restoreMenuPositionFromRelative();
      }
      ensureMenuInsideStage();

      if (isClipboardWindowVisible.value || clipboardWindowX.value !== 0 || clipboardWindowY.value !== 0) {
        clampClipboardWindowToStage();
      }

      scheduleDisplayResize();
    };

    const initializeFloatingMenuPlacement = () => {
      loadPersistedMenuPlacement();
      initializeMenuPosition();
      hasInitializedFloatingMenuPlacement = true;
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
        refreshInputMappingStickerLayout();
        scheduleDisplayResize();
      });
      videoContainerResizeObserver.observe(videoContainer.value);
    };

    const teardownVideoContainerResizeObserver = () => {
      videoContainerResizeObserver?.disconnect();
      videoContainerResizeObserver = null;
    };

    watch(
      () => deviceId.value,
      () => remoteClipboard.handleDeviceChanged()
    );

    watch(
      () => route.query,
      async () => {
        await loadActiveInputMappingProfile();
        await consumeIncomingTab(selectedDeviceName.value, t('Screencast.DefaultTabTitle', '设备投屏'), syncRefsFromActiveTab, handleTabOpened);
      }
    );

    watch(
      isInputMappingEditMode,
      async (enabled) => {
        if (enabled) {
          activeFloatingMenuPage.value = 'inputMapping';
          isMenuExpanded.value = true;
        }
        if (!hasInitializedFloatingMenuPlacement) {
          return;
        }
        await nextTick();
        ensureMenuInsideStage();
      },
      { immediate: true }
    );

    watch(
      activeFloatingMenuItemCount,
      async (itemCount) => {
        floatingMenuLayout.expandedLength = getMenuExpandedLength(itemCount);
        if (!hasInitializedFloatingMenuPlacement) {
          return;
        }
        await nextTick();
        ensureMenuInsideStage();
      },
      { immediate: true }
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

    const cleanupCastViewResources = (preserveForBackground: boolean) => {
      rtcConfigRequest.dispose();
      remoteClipboard.dispose();
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
      releaseInputMapping('disconnect');
      releaseAllPointers('cancel');

      if (!preserveForBackground) {
        const releaseTarget = getSessionReleaseTarget();
        stopScrcpySessionHeartbeat();
        void postScrcpySessionAction('release', releaseTarget.deviceId, releaseTarget.sessionId);
        disposeAllPersistedConnections();
      }

      stopConnection(preserveForBackground);
      if (preserveForBackground) {
        showLastFrameOverlayForTab();
      }
    };

    onMounted(async () => {
      enableAutoReconnect();
      loadPersistedTabs(syncRefsFromActiveTab, t('Screencast.DefaultTabTitle', '设备投屏'));
      await loadActiveInputMappingProfile();
      initializeFloatingMenuPlacement();
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
        if (restorePersistedConnection()) {
          void refreshDeviceContext();
          hasUsedInitialConnectionWarmup = true;
          return;
        }
        await refreshDeviceContext();
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
      await loadActiveInputMappingProfile();
      initializeFloatingMenuPlacement();
      stopScrcpySessionHeartbeat();
      setupVideoContainerResizeObserver();

      const consumed = await consumeIncomingTab(selectedDeviceName.value, t('Screencast.DefaultTabTitle', '设备投屏'), syncRefsFromActiveTab, handleTabOpened);
      if (consumed) {
        return;
      }

      if (activeTab.value) {
        if (restorePersistedConnection()) {
          void refreshDeviceContext();
          return;
        }
        await refreshDeviceContext();
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
      SIGNALING_STABLE_DETACH_MS,
      VIDEO_RECOVERY_TIMEOUT_MS,
      VIDEO_STREAM_STALL_THRESHOLD_MS,
      VIDEO_STREAM_WATCHDOG_INTERVAL_MS,
      VIDEO_STREAM_DIAGNOSTIC_INTERVAL_MS,
      DEFAULT_AUTO_NEW_DISPLAY_DPI,
      MIN_NEW_DISPLAY_DPI,
      MAX_NEW_DISPLAY_DPI,
      MIN_NEW_DISPLAY_DIMENSION,
      MAX_NEW_DISPLAY_LONG_EDGE,
      MENU_MARGIN,
      MENU_BUTTON_SIZE,
      MENU_ITEM_SIZE,
      MENU_ITEM_GAP,
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
      lastFrameOverlayElement,
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
      activeInputMappingProfileName,
      inputMappingStickers,
      isInputMappingEditMode,
      isInputMappingProfileDialogVisible,
      inputMappingProfileDialogMode,
      inputMappingProfileForm,
      selectedInputMappingStickerId,
      selectedInputMappingSticker,
      selectedInputMappingBinding,
      selectedInputMappingRapidTapAction,
      selectedInputMappingStickerLabelText,
      selectedInputMappingConfigTitle,
      isInputMappingHintsVisible,
      isInputMappingEnabled,
      inputMappingContextMenu,
      inputMappingCaptureBindingId,
      captureSelectedInputMappingMouseButton,
      inputMappingStickerPaletteItems,
      activeFloatingMenuItems,
      isMenuExpanded,
      isDocked,
      isMenuDragActive,
      isClipboardWindowVisible,
      clipboardText,
      clipboardStatusText,
      isClipboardLoading,
      isClipboardSaving,
      clipboardWindowX,
      clipboardWindowY,
      dockedEdge,
      menuX,
      menuY,
      menuRelativeX,
      menuRelativeY,
      remoteVideoStream,
      remoteAudioStream,
      remoteTracks,
      mediaTracks,
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
      videoStreamHealth,
      pendingResumePlaybackTimer,
      pendingDisplayResizeTimer,
      flexDisplayHeartbeatTimer,
      pendingVideoRecoveryTimer,
      pendingIceRestartFallbackTimer,
      pendingCandidates,
      activeConnectionId,
      hasHandledInitialActivation,
      hasUsedInitialConnectionWarmup,
      lastDisplayResizeRequest,
      videoContainerResizeObserver,
      nextScrcpyPointerId: touchPointerInput.getNextScrcpyPointerId(),
      scrcpyPointerIds: touchPointerInput.getScrcpyPointerIds(),
      currentHidMouseButtons: hidSession.getCurrentMouseButtons(),
      pressedHidKeys: hidSession.getPressedKeys(),
      lastTouchPointerAt: touchPointerInput.getLastTouchPointerAt(),
      pointerMoveFlushHandle: pointerControlQueues.getPointerMoveFlushHandle(),
      pointerMoveSampleTimer: pointerControlQueues.getPointerMoveSampleTimer(),
      pointerReleaseFlushHandle: pointerControlQueues.getPointerReleaseFlushHandle(),
      lastPointerMoveFlushAt: pointerControlQueues.getLastPointerMoveFlushAt(),
      controlChannels,
      isIceRestartInFlight,
      currentScrcpySessionId,
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
      resetVideoStreamWatchdogState,
      stopVideoStreamWatchdog,
      shouldMonitorVideoStream,
      handleVideoStreamWatchdog,
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
      isHorizontalLayout,
      clampCollapsedMenuPosition,
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
      refreshInputMappingStickerLayout,
      getInputMappingStickerStyle,
      getInputMappingConfigPanelStyle,
      handleInputMappingStageContextMenu,
      closeInputMappingContextMenu,
      closeInputMappingProfileDialog,
      submitInputMappingProfileDialog,
      saveInputMappingProfileFromEditMenu,
      exitInputMappingEditMode,
      backToInputMappingProfiles,
      blockInputMappingEditPointer,
      addInputMappingStickerFromPalette,
      updateSelectedInputMappingLabel,
      updateSelectedInputMappingRapidTapMode,
      updateSelectedInputMappingRapidTapCount,
      toggleSelectedInputMappingStickerEnabled,
      startInputMappingTriggerCapture,
      deleteSelectedInputMappingBinding,
      selectInputMappingSticker,
      openInputMappingStickerConfig,
      startInputMappingStickerDrag,
      moveInputMappingStickerDrag,
      finishInputMappingStickerDrag,
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
