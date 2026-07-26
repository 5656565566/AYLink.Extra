import { computed, nextTick, ref } from 'vue';
import { createLatestRequestController } from '../../lib/async/latestRequest';
import { isAbortError } from '../../lib/async/abort';
import { normalizeDeviceId } from '../../lib/input/normalize';
import { apiFetch, readApiErrorMessage } from '../../utils/api';
import type { StageBounds } from './floatingMenuLayout';

interface RemoteClipboardOptions {
  margin: number;
  defaultWidth: number;
  defaultHeight: number;
  getDeviceId: () => string;
  getStageBounds: () => StageBounds;
  t: (key: string, fallback?: string, ...args: (string | number)[]) => string;
  logger?: Pick<Console, 'error'>;
}

export function useRemoteClipboard(options: RemoteClipboardOptions) {
  const logger = options.logger ?? console;
  const request = createLatestRequestController();
  const clipboardFloatElement = ref<HTMLDivElement | null>(null);
  const isClipboardWindowVisible = ref(false);
  const clipboardText = ref('');
  const clipboardStatusText = ref('');
  const isClipboardLoading = ref(false);
  const isClipboardSaving = ref(false);
  const clipboardWindowX = ref(0);
  const clipboardWindowY = ref(0);

  let isDraggingClipboard = false;
  let clipboardDragStartOffset = { x: 0, y: 0 };

  const getClipboardWindowSize = () => {
    const rect = clipboardFloatElement.value?.getBoundingClientRect();
    return {
      width: rect?.width && rect.width > 0 ? rect.width : options.defaultWidth,
      height: rect?.height && rect.height > 0 ? rect.height : options.defaultHeight
    };
  };

  const clampClipboardWindowPosition = (x: number, y: number) => {
    const bounds = options.getStageBounds();
    const size = getClipboardWindowSize();
    const minX = bounds.offsetLeft + options.margin;
    const minY = bounds.offsetTop + options.margin;
    const maxX = Math.max(minX, bounds.offsetLeft + bounds.width - size.width - options.margin);
    const maxY = Math.max(minY, bounds.offsetTop + bounds.height - size.height - options.margin);
    return {
      x: Math.min(Math.max(minX, x), maxX),
      y: Math.min(Math.max(minY, y), maxY)
    };
  };

  const initializeClipboardWindowPosition = () => {
    const bounds = options.getStageBounds();
    const size = getClipboardWindowSize();
    const clamped = clampClipboardWindowPosition(
      bounds.offsetLeft + bounds.width - size.width - options.margin,
      bounds.offsetTop + bounds.height - size.height - options.margin
    );
    clipboardWindowX.value = clamped.x;
    clipboardWindowY.value = clamped.y;
  };

  const clipboardWindowStyle = computed(() => {
    let x = clipboardWindowX.value;
    let y = clipboardWindowY.value;
    if (x === 0 && y === 0) {
      const bounds = options.getStageBounds();
      const size = getClipboardWindowSize();
      x = bounds.offsetLeft + bounds.width - size.width - options.margin;
      y = bounds.offsetTop + bounds.height - size.height - options.margin;
    }
    return {
      left: `${x}px`,
      top: `${y}px`,
      right: 'auto',
      bottom: 'auto'
    };
  });

  const clampClipboardWindowToStage = () => {
    const clamped = clampClipboardWindowPosition(clipboardWindowX.value, clipboardWindowY.value);
    clipboardWindowX.value = clamped.x;
    clipboardWindowY.value = clamped.y;
  };

  const applyRemoteClipboardText = (text: string) => {
    clipboardText.value = text;
  };

  const isJsonResponse = (response: Response) => {
    return (response.headers.get('Content-Type') || '').includes('application/json');
  };

  const isClipboardPayload = (payload: unknown): payload is { text?: unknown } => {
    return payload !== null && typeof payload === 'object';
  };

  const getTargetDeviceIdOrWarn = (requestId: number) => {
    const targetDeviceId = normalizeDeviceId(options.getDeviceId());
    if (targetDeviceId) {
      return targetDeviceId;
    }

    clipboardStatusText.value = options.t('Screencast.NoDeviceSelected', '未选中设备');
    request.finalize(requestId);
    return '';
  };

  const readClipboard = async () => {
    const { requestId, signal } = request.begin();
    const targetDeviceId = getTargetDeviceIdOrWarn(requestId);
    if (!targetDeviceId) {
      return;
    }

    isClipboardLoading.value = true;
    clipboardStatusText.value = options.t('Screencast.ClipboardReading', '正在读取...');

    try {
      const response = await apiFetch(`/api/devices/${targetDeviceId}/clipboard`, {
        signal,
        timeoutMs: 15000,
      });
      if (!request.isLatest(requestId)) {
        return;
      }
      if (response.status !== 200 || !isJsonResponse(response)) {
        clipboardStatusText.value = await readApiErrorMessage(response, options.t('Screencast.ClipboardReadFailed', '读取失败'));
        return;
      }

      const payload = await response.json() as unknown;
      if (!isClipboardPayload(payload)) {
        clipboardStatusText.value = options.t('Screencast.ClipboardReadFailed', '读取失败');
        return;
      }
      applyRemoteClipboardText(String(payload.text ?? ''));
      clipboardStatusText.value = options.t('Screencast.ClipboardReadSuccess', '读取成功');
    } catch (error) {
      if (!isAbortError(error)) {
        logger.error('Failed to load remote clipboard:', {
          deviceId: targetDeviceId,
          error
        });
        clipboardStatusText.value = options.t('Screencast.ClipboardReadFailed', '读取失败');
      }
    } finally {
      if (request.isLatest(requestId)) {
        isClipboardLoading.value = false;
      }
      request.finalize(requestId);
    }
  };

  const syncClipboard = async () => {
    const { requestId, signal } = request.begin();
    const targetDeviceId = getTargetDeviceIdOrWarn(requestId);
    if (!targetDeviceId) {
      return;
    }

    isClipboardSaving.value = true;
    clipboardStatusText.value = options.t('Screencast.ClipboardSyncing', '正在同步...');

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
      if (!request.isLatest(requestId)) {
        return;
      }
      if (response.status !== 200) {
        clipboardStatusText.value = await readApiErrorMessage(response, options.t('Screencast.ClipboardSyncFailed', '同步失败'));
        return;
      }
      clipboardStatusText.value = options.t('Screencast.ClipboardSyncSuccess', '已同步');
    } catch (error) {
      if (!isAbortError(error)) {
        logger.error('Failed to save remote clipboard:', {
          deviceId: targetDeviceId,
          error
        });
        clipboardStatusText.value = options.t('Screencast.ClipboardSyncFailed', '同步失败');
      }
    } finally {
      if (request.isLatest(requestId)) {
        isClipboardSaving.value = false;
      }
      request.finalize(requestId);
    }
  };

  const pasteClipboard = async () => {
    const { requestId, signal } = request.begin();
    const targetDeviceId = getTargetDeviceIdOrWarn(requestId);
    if (!targetDeviceId) {
      return;
    }

    isClipboardSaving.value = true;
    clipboardStatusText.value = options.t('Screencast.ClipboardPasting', '正在粘贴...');

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
      if (!request.isLatest(requestId)) {
        return;
      }
      if (response.status !== 200) {
        clipboardStatusText.value = await readApiErrorMessage(response, options.t('Screencast.ClipboardPasteFailed', '粘贴失败'));
        return;
      }
      clipboardStatusText.value = options.t('Screencast.ClipboardPasteSuccess', '已发送粘贴');
    } catch (error) {
      if (!isAbortError(error)) {
        logger.error('Failed to paste remote clipboard:', {
          deviceId: targetDeviceId,
          error
        });
        clipboardStatusText.value = options.t('Screencast.ClipboardPasteFailed', '粘贴失败');
      }
    } finally {
      if (request.isLatest(requestId)) {
        isClipboardSaving.value = false;
      }
      request.finalize(requestId);
    }
  };

  const openClipboardWindow = () => {
    if (clipboardWindowX.value === 0 && clipboardWindowY.value === 0) {
      initializeClipboardWindowPosition();
    } else {
      clampClipboardWindowToStage();
    }
    isClipboardWindowVisible.value = true;

    // The v-if element is not measurable until Vue renders it. Clamp again with
    // the actual size so the initial bottom-right position matches drag limits.
    void nextTick(() => {
      if (isClipboardWindowVisible.value) {
        clampClipboardWindowToStage();
      }
    });
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

  const handleWindowPointerMove = (event: PointerEvent) => {
    if (!isDraggingClipboard) {
      return false;
    }

    const position = clampClipboardWindowPosition(
      event.clientX - clipboardDragStartOffset.x,
      event.clientY - clipboardDragStartOffset.y
    );
    clipboardWindowX.value = position.x;
    clipboardWindowY.value = position.y;
    return true;
  };

  const finishClipboardDrag = () => {
    if (!isDraggingClipboard) {
      return false;
    }

    isDraggingClipboard = false;
    clampClipboardWindowToStage();
    return true;
  };

  const cancelClipboardDrag = () => {
    isDraggingClipboard = false;
  };

  const handleDeviceChanged = () => {
    clipboardStatusText.value = '';

    if (!isClipboardWindowVisible.value) {
      clipboardText.value = '';
      return;
    }

    openClipboardWindow();
  };

  return {
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
    handleWindowPointerMove,
    finishClipboardDrag,
    cancelClipboardDrag,
    handleDeviceChanged,
    dispose: () => request.dispose(),
    getIsDraggingClipboard: () => isDraggingClipboard,
    getClipboardDragStartOffset: () => clipboardDragStartOffset
  };
}
