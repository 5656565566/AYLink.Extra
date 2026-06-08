import { beforeEach, describe, expect, it } from 'vitest';
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
});
