export const SCRCPY_PRIMARY_BUTTON = 1;

export const SCRCPY_MSG_INJECT_KEYCODE = 0;

export const SCRCPY_MSG_INJECT_TOUCH_EVENT = 2;

export const SCRCPY_MSG_SET_SCREEN_POWER_MODE = 10;

export const SCRCPY_MSG_RESIZE_DISPLAY = 21;

export const SCRCPY_ACTION_DOWN = 0;

export const SCRCPY_ACTION_UP = 1;

export const SCRCPY_ACTION_MOVE = 2;

export const ANDROID_KEYCODE_BACK = 4;

export const ANDROID_KEYCODE_HOME = 3;

export const ANDROID_KEYCODE_MENU = 82;

export const ANDROID_KEYCODE_RECENT = 187;

export const ANDROID_KEYCODE_POWER = 26;

export const ANDROID_KEYCODE_VOLUME_UP = 24;

export const ANDROID_KEYCODE_VOLUME_DOWN = 25;

export const ANDROID_KEYCODE_MUTE = 164;

export const ANDROID_KEYCODE_FORWARD_DEL = 112;

export const ANDROID_META_SHIFT_ON = 1;

export interface AndroidKeyEventMapping {
  keyCode: number;
  metaState: number;
}

export const writeUInt16BE = (view: DataView, offset: number, value: number) => {
  view.setUint16(offset, Math.max(0, Math.min(0xffff, value)), false);
};

export const writeUInt32BE = (view: DataView, offset: number, value: number) => {
  view.setUint32(offset, value >>> 0, false);
};

export const writeUInt64BE = (view: DataView, offset: number, value: bigint) => {
  view.setBigUint64(offset, value, false);
};

export const buildInjectKeycodeMessage = (action: number, keycode: number, repeat = 0, metaState = 0) => {
  const buffer = new ArrayBuffer(14);
  const view = new DataView(buffer);
  view.setUint8(0, SCRCPY_MSG_INJECT_KEYCODE);
  view.setUint8(1, action);
  writeUInt32BE(view, 2, keycode);
  writeUInt32BE(view, 6, repeat);
  writeUInt32BE(view, 10, metaState);
  return new Uint8Array(buffer);
};

export const buildScreenPowerMessage = (isOn: boolean) => {
  const payload = new Uint8Array(2);
  payload[0] = SCRCPY_MSG_SET_SCREEN_POWER_MODE;
  payload[1] = isOn ? 1 : 0;
  return payload;
};

export const buildResizeDisplayMessage = (width: number, height: number) => {
  const buffer = new ArrayBuffer(5);
  const view = new DataView(buffer);
  view.setUint8(0, SCRCPY_MSG_RESIZE_DISPLAY);
  writeUInt16BE(view, 1, width);
  writeUInt16BE(view, 3, height);
  return new Uint8Array(buffer);
};

export const buildTouchMessage = (
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

export const mapAndroidCommandToKeycode = (action: string) => {
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

export const mapBrowserCodeToAndroidKeyCode = (code: string) => {
  switch (code) {
    case 'Enter':
    case 'NumpadEnter':
      return 66;
    case 'Escape':
      return 111;
    case 'Backspace':
      return 67;
    case 'Delete':
      return ANDROID_KEYCODE_FORWARD_DEL;
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
    case 'Backquote':
      return 68;
    case 'Minus':
    case 'NumpadSubtract':
      return 69;
    case 'Equal':
      return 70;
    case 'BracketLeft':
      return 71;
    case 'BracketRight':
      return 72;
    case 'Backslash':
      return 73;
    case 'Semicolon':
      return 74;
    case 'Quote':
      return 75;
    case 'Slash':
    case 'NumpadDivide':
      return 76;
    case 'Comma':
      return 55;
    case 'Period':
    case 'NumpadDecimal':
      return 56;
    case 'NumpadAdd':
      return 81;
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

const mapBrowserKeyToAndroidKeyCode = (key: string) => {
  switch (key) {
    case 'Backspace':
      return 67;
    case 'Delete':
      return ANDROID_KEYCODE_FORWARD_DEL;
    case ',':
    case '<':
      return 55;
    case '.':
    case '>':
      return 56;
    case '/':
    case '?':
      return 76;
    case '-':
    case '_':
      return 69;
    case '=':
    case '+':
      return 70;
    case '[':
    case '{':
      return 71;
    case ']':
    case '}':
      return 72;
    case '\\':
    case '|':
      return 73;
    case ';':
    case ':':
      return 74;
    case "'":
    case '"':
      return 75;
    case '`':
    case '~':
      return 68;
    default:
      return 0;
  }
};

export const mapKeyboardEventToAndroidKeyEvent = (event: KeyboardEvent): AndroidKeyEventMapping => {
  const keyCode = mapBrowserCodeToAndroidKeyCode(event.code) || mapBrowserKeyToAndroidKeyCode(event.key);
  if (!keyCode) {
    return { keyCode: 0, metaState: 0 };
  }

  return {
    keyCode,
    metaState: event.shiftKey ? ANDROID_META_SHIFT_ON : 0
  };
};
