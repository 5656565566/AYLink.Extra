import { describe, expect, it } from 'vitest';
import {
  SCRCPY_ACTION_DOWN,
  SCRCPY_ACTION_MOVE,
  SCRCPY_MSG_INJECT_KEYCODE,
  SCRCPY_MSG_INJECT_TOUCH_EVENT,
  SCRCPY_MSG_RESIZE_DISPLAY,
  SCRCPY_MSG_SET_SCREEN_POWER_MODE,
  buildInjectKeycodeMessage,
  buildResizeDisplayMessage,
  buildScreenPowerMessage,
  buildTouchMessage,
  mapAndroidCommandToKeycode,
  mapBrowserCodeToAndroidKeyCode
} from './scrcpyControlProtocol';

describe('scrcpyControlProtocol', () => {
  it('builds inject keycode messages in scrcpy wire format', () => {
    expect([...buildInjectKeycodeMessage(SCRCPY_ACTION_DOWN, 66, 1, 2)]).toEqual([
      SCRCPY_MSG_INJECT_KEYCODE,
      SCRCPY_ACTION_DOWN,
      0, 0, 0, 66,
      0, 0, 0, 1,
      0, 0, 0, 2
    ]);
  });

  it('builds touch messages with clamped pressure', () => {
    const payload = buildTouchMessage(SCRCPY_ACTION_MOVE, 3n, 100, 200, 1920, 1080, 2, 1, 1);

    expect(payload.length).toBe(32);
    expect(payload[0]).toBe(SCRCPY_MSG_INJECT_TOUCH_EVENT);
    expect(payload[1]).toBe(SCRCPY_ACTION_MOVE);

    const view = new DataView(payload.buffer);
    expect(view.getBigUint64(2, false)).toBe(3n);
    expect(view.getUint32(10, false)).toBe(100);
    expect(view.getUint32(14, false)).toBe(200);
    expect(view.getUint16(18, false)).toBe(1920);
    expect(view.getUint16(20, false)).toBe(1080);
    expect(view.getUint16(22, false)).toBe(0xffff);
  });

  it('builds screen power and resize messages', () => {
    expect([...buildScreenPowerMessage(true)]).toEqual([SCRCPY_MSG_SET_SCREEN_POWER_MODE, 1]);
    expect([...buildScreenPowerMessage(false)]).toEqual([SCRCPY_MSG_SET_SCREEN_POWER_MODE, 0]);
    expect([...buildResizeDisplayMessage(1280, 720)]).toEqual([
      SCRCPY_MSG_RESIZE_DISPLAY,
      5, 0,
      2, 208
    ]);
  });

  it('maps app commands and browser codes to Android keycodes', () => {
    expect(mapAndroidCommandToKeycode('back')).toBe(4);
    expect(mapAndroidCommandToKeycode('volumeup')).toBe(24);
    expect(mapAndroidCommandToKeycode('unknown')).toBe(0);

    expect(mapBrowserCodeToAndroidKeyCode('Enter')).toBe(66);
    expect(mapBrowserCodeToAndroidKeyCode('KeyA')).toBe(29);
    expect(mapBrowserCodeToAndroidKeyCode('KeyZ')).toBe(54);
    expect(mapBrowserCodeToAndroidKeyCode('Digit0')).toBe(7);
    expect(mapBrowserCodeToAndroidKeyCode('Digit9')).toBe(16);
    expect(mapBrowserCodeToAndroidKeyCode('F13')).toBe(0);
  });
});
