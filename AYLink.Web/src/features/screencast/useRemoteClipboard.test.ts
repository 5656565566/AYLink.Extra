import { nextTick } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  readApiErrorMessage: vi.fn(async (_response: Response, fallback: string) => fallback)
}));

vi.mock('../../utils/api', () => ({
  apiFetch: apiMocks.apiFetch,
  readApiErrorMessage: apiMocks.readApiErrorMessage
}));

import { useRemoteClipboard } from './useRemoteClipboard';

const createClipboard = () => useRemoteClipboard({
  margin: 16,
  defaultWidth: 380,
  defaultHeight: 220,
  getDeviceId: () => 'device-1',
  getStageBounds: () => ({
    width: 1000,
    height: 600,
    offsetLeft: 10,
    offsetTop: 20
  }),
  t: (_key, fallback = '') => fallback,
  logger: {
    error: () => undefined
  }
});

function createPointerEvent(clientX: number, clientY: number) {
  return {
    clientX,
    clientY,
    currentTarget: {
      setPointerCapture: () => undefined
    },
    preventDefault: () => undefined,
    pointerId: 1
  } as unknown as PointerEvent;
}

describe('useRemoteClipboard', () => {
  beforeEach(() => {
    localStorage.clear();
    apiMocks.apiFetch.mockReset();
    apiMocks.readApiErrorMessage.mockClear();
    apiMocks.readApiErrorMessage.mockImplementation(async (_response: Response, fallback: string) => fallback);
  });

  it('opens at the bottom right of the current stage', () => {
    const clipboard = createClipboard();

    clipboard.openClipboardWindow();

    expect(clipboard.isClipboardWindowVisible.value).toBe(true);
    expect(clipboard.clipboardWindowX.value).toBe(614);
    expect(clipboard.clipboardWindowY.value).toBe(384);
    expect(clipboard.clipboardWindowStyle.value).toEqual({
      left: '614px',
      top: '384px',
      right: 'auto',
      bottom: 'auto'
    });
  });

  it('clamps the initial position using the rendered window size', async () => {
    const clipboard = createClipboard();

    clipboard.openClipboardWindow();
    clipboard.clipboardFloatElement.value = {
      getBoundingClientRect: () => ({ width: 380, height: 280 })
    } as HTMLDivElement;
    await nextTick();

    expect(clipboard.clipboardWindowX.value).toBe(614);
    expect(clipboard.clipboardWindowY.value).toBe(324);
  });

  it('clamps drag movement inside the stage', () => {
    const clipboard = createClipboard();
    clipboard.openClipboardWindow();

    clipboard.startClipboardDrag(createPointerEvent(620, 390));
    expect(clipboard.handleWindowPointerMove(createPointerEvent(2000, 2000))).toBe(true);
    expect(clipboard.finishClipboardDrag()).toBe(true);

    expect(clipboard.clipboardWindowX.value).toBe(614);
    expect(clipboard.clipboardWindowY.value).toBe(384);
  });

  it('clears stale text when the device changes while the window is closed', () => {
    const clipboard = createClipboard();
    clipboard.applyRemoteClipboardText('stale text');

    clipboard.handleDeviceChanged();

    expect(clipboard.clipboardStatusText.value).toBe('');
    expect(clipboard.clipboardText.value).toBe('');
  });

  it('treats html clipboard read responses as local errors', async () => {
    apiMocks.apiFetch.mockResolvedValue(new Response('<!DOCTYPE html><title>Bad gateway</title>', {
      status: 502,
      headers: { 'Content-Type': 'text/html; charset=UTF-8' }
    }));

    const clipboard = createClipboard();
    clipboard.applyRemoteClipboardText('previous text');

    await clipboard.readClipboard();

    expect(clipboard.clipboardText.value).toBe('previous text');
    expect(clipboard.clipboardStatusText.value).toBe('读取失败');
    expect(apiMocks.readApiErrorMessage).toHaveBeenCalledTimes(1);
  });

  it('loads clipboard text only from json 200 responses', async () => {
    apiMocks.apiFetch.mockResolvedValue(new Response(JSON.stringify({ text: 'remote text' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }));

    const clipboard = createClipboard();

    await clipboard.readClipboard();

    expect(clipboard.clipboardText.value).toBe('remote text');
    expect(clipboard.clipboardStatusText.value).toBe('读取成功');
  });
});
