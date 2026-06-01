export const SCRCPY_MSG_UHID_CREATE = 12;

export const SCRCPY_MSG_UHID_INPUT = 13;

export const SCRCPY_MSG_UHID_DESTROY = 14;

export const SCRCPY_HID_MOUSE_ID = 1;

export const SCRCPY_HID_KEYBOARD_ID = 2;

const HID_DEVICE_NAME = 'AYLink';

const HID_DEVICE_VENDOR_ID = 0;

const HID_DEVICE_PRODUCT_ID = 0;

export const RELATIVE_MOUSE_REPORT_DESC = new Uint8Array([
  0x05, 0x01, 0x09, 0x02, 0xA1, 0x01, 0x09, 0x01, 0xA1, 0x00,
  0x05, 0x09, 0x19, 0x01, 0x29, 0x05, 0x15, 0x00, 0x25, 0x01,
  0x95, 0x05, 0x75, 0x01, 0x81, 0x02, 0x95, 0x01, 0x75, 0x03,
  0x81, 0x01, 0x05, 0x01, 0x09, 0x30, 0x09, 0x31, 0x09, 0x38,
  0x15, 0x81, 0x25, 0x7F, 0x75, 0x08, 0x95, 0x03, 0x81, 0x06,
  0x05, 0x0C, 0x0A, 0x38, 0x02, 0x15, 0x81, 0x25, 0x7F, 0x75,
  0x08, 0x95, 0x01, 0x81, 0x06, 0xC0, 0xC0
]);

export const KEYBOARD_REPORT_DESC = new Uint8Array([
  0x05, 0x01, 0x09, 0x06, 0xA1, 0x01, 0x05, 0x07, 0x19, 0xE0,
  0x29, 0xE7, 0x15, 0x00, 0x25, 0x01, 0x75, 0x01, 0x95, 0x08,
  0x81, 0x02, 0x95, 0x01, 0x75, 0x08, 0x81, 0x01, 0x95, 0x05,
  0x75, 0x01, 0x05, 0x08, 0x19, 0x01, 0x29, 0x05, 0x91, 0x02,
  0x95, 0x01, 0x75, 0x03, 0x91, 0x01, 0x95, 0x06, 0x75, 0x08,
  0x15, 0x00, 0x25, 0x65, 0x05, 0x07, 0x19, 0x00, 0x29, 0x65,
  0x81, 0x00, 0xC0
]);

const writeUInt16BE = (view: DataView, offset: number, value: number) => {
  view.setUint16(offset, Math.max(0, Math.min(0xffff, value)), false);
};

export const buildUhidCreateMessage = (id: number, reportDesc: Uint8Array, name = HID_DEVICE_NAME) => {
  const nameBytes = new TextEncoder().encode(name).slice(0, 0x7f);
  const buffer = new ArrayBuffer(1 + 2 + 2 + 2 + 1 + nameBytes.length + 2 + reportDesc.length);
  const view = new DataView(buffer);
  view.setUint8(0, SCRCPY_MSG_UHID_CREATE);
  writeUInt16BE(view, 1, id);
  writeUInt16BE(view, 3, HID_DEVICE_VENDOR_ID);
  writeUInt16BE(view, 5, HID_DEVICE_PRODUCT_ID);
  view.setUint8(7, nameBytes.length);
  new Uint8Array(buffer, 8, nameBytes.length).set(nameBytes);
  writeUInt16BE(view, 8 + nameBytes.length, reportDesc.length);
  new Uint8Array(buffer, 10 + nameBytes.length).set(reportDesc);
  return new Uint8Array(buffer);
};

export const buildUhidInputMessage = (id: number, data: Uint8Array) => {
  const buffer = new ArrayBuffer(1 + 2 + 2 + data.length);
  const view = new DataView(buffer);
  view.setUint8(0, SCRCPY_MSG_UHID_INPUT);
  writeUInt16BE(view, 1, id);
  writeUInt16BE(view, 3, data.length);
  new Uint8Array(buffer, 5).set(data);
  return new Uint8Array(buffer);
};

export const buildUhidDestroyMessage = (id: number) => {
  const buffer = new ArrayBuffer(3);
  const view = new DataView(buffer);
  view.setUint8(0, SCRCPY_MSG_UHID_DESTROY);
  writeUInt16BE(view, 1, id);
  return new Uint8Array(buffer);
};

export const buildHidMouseReport = (buttons: number, dx: number, dy: number, vWheel: number, hWheel: number) => {
  return new Uint8Array([
    buttons & 0xff,
    dx & 0xff,
    dy & 0xff,
    vWheel & 0xff,
    hWheel & 0xff
  ]);
};

export const buildHidKeyboardReport = (pressedKeys: Iterable<number>) => {
  const report = new Uint8Array(8);
  let modifiers = 0;
  let keyIndex = 2;

  for (const key of pressedKeys) {
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

export const mapBrowserCodeToHidKey = (code: string) => {
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
    case 'Insert': return 0x49;
    case 'Home': return 0x4a;
    case 'PageUp': return 0x4b;
    case 'Delete': return 0x4c;
    case 'End': return 0x4d;
    case 'PageDown': return 0x4e;
    case 'ArrowRight': return 0x4f;
    case 'ArrowLeft': return 0x50;
    case 'ArrowDown': return 0x51;
    case 'ArrowUp': return 0x52;
    case 'NumLock': return 0x53;
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

export const mapMouseButtonToHidMask = (button: number) => {
  switch (button) {
    case 0: return 0x01;
    case 1: return 0x04;
    case 2: return 0x02;
    case 3: return 0x08;
    case 4: return 0x10;
    default: return 0;
  }
};

export const clampSignedByte = (value: number) => Math.max(-127, Math.min(127, value)) | 0;
