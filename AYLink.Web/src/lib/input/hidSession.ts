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
  SCRCPY_HID_MOUSE_ID
} from './hidProtocol';

export interface HidMouseEventPayload {
  phase: 'down' | 'up' | 'move' | 'wheel';
  button?: number;
  dx?: number;
  dy?: number;
  wheelX?: number;
  wheelY?: number;
}

interface HidSessionOptions {
  getIsKeyboardEnabled: () => boolean;
  getIsMouseEnabled: () => boolean;
  sendBinaryControlMessage: (payload: Uint8Array, channel?: RTCDataChannel | null) => void;
  sendMetaControlMessage: (payload: Uint8Array) => void;
  getPointerMoveChannel: () => RTCDataChannel | null;
  getDefaultControlChannel: () => RTCDataChannel | null;
  pointerMoveBufferLimit: number;
}

export const createHidSession = (options: HidSessionOptions) => {
  let currentMouseButtons = 0;
  const pressedKeys = new Set<number>();
  let isMouseCreated = false;
  let isKeyboardCreated = false;

  const getHighFrequencyChannel = () => {
    const pointerMoveChannel = options.getPointerMoveChannel();
    if (pointerMoveChannel?.readyState === 'open') {
      return pointerMoveChannel;
    }

    return options.getDefaultControlChannel();
  };

  const initializeDevices = () => {
    if (options.getIsMouseEnabled() && !isMouseCreated) {
      options.sendMetaControlMessage(buildUhidCreateMessage(SCRCPY_HID_MOUSE_ID, RELATIVE_MOUSE_REPORT_DESC));
      currentMouseButtons = 0;
      isMouseCreated = true;
    }

    if (options.getIsKeyboardEnabled() && !isKeyboardCreated) {
      options.sendMetaControlMessage(buildUhidCreateMessage(SCRCPY_HID_KEYBOARD_ID, KEYBOARD_REPORT_DESC));
      pressedKeys.clear();
      isKeyboardCreated = true;
    }
  };

  const resetInputs = () => {
    if (isMouseCreated) {
      currentMouseButtons = 0;
      options.sendBinaryControlMessage(
        buildUhidInputMessage(SCRCPY_HID_MOUSE_ID, buildHidMouseReport(0, 0, 0, 0, 0))
      );
    }

    if (isKeyboardCreated) {
      pressedKeys.clear();
      options.sendBinaryControlMessage(
        buildUhidInputMessage(SCRCPY_HID_KEYBOARD_ID, buildHidKeyboardReport(pressedKeys))
      );
    }
  };

  const releaseDevices = () => {
    resetInputs();

    if (isMouseCreated) {
      options.sendMetaControlMessage(buildUhidDestroyMessage(SCRCPY_HID_MOUSE_ID));
      isMouseCreated = false;
    }

    if (isKeyboardCreated) {
      options.sendMetaControlMessage(buildUhidDestroyMessage(SCRCPY_HID_KEYBOARD_ID));
      isKeyboardCreated = false;
    }

    currentMouseButtons = 0;
    pressedKeys.clear();
  };

  const sendKeyboardCode = (phase: 'down' | 'up', code: string) => {
    if (!options.getIsKeyboardEnabled() || !isKeyboardCreated) {
      return false;
    }

    const hidKey = mapBrowserCodeToHidKey(code);
    if (!hidKey) {
      return false;
    }

    if (phase === 'down') {
      pressedKeys.add(hidKey);
    } else {
      pressedKeys.delete(hidKey);
    }

    options.sendBinaryControlMessage(
      buildUhidInputMessage(SCRCPY_HID_KEYBOARD_ID, buildHidKeyboardReport(pressedKeys))
    );
    return true;
  };

  const sendKeyboardEvent = (phase: 'down' | 'up', event: KeyboardEvent) => {
    return sendKeyboardCode(phase, event.code);
  };

  const sendMouseEvent = (payload: HidMouseEventPayload) => {
    if (!options.getIsMouseEnabled() || !isMouseCreated) {
      return false;
    }

    const highFrequencyChannel = getHighFrequencyChannel();

    switch (payload.phase) {
      case 'down':
      case 'up': {
        const mask = mapMouseButtonToHidMask(payload.button ?? 0);
        if (!mask) {
          return false;
        }

        if (payload.phase === 'down') {
          currentMouseButtons |= mask;
        } else {
          currentMouseButtons &= ~mask;
        }

        options.sendBinaryControlMessage(
          buildUhidInputMessage(
            SCRCPY_HID_MOUSE_ID,
            buildHidMouseReport(currentMouseButtons, 0, 0, 0, 0)
          )
        );
        return true;
      }
      case 'move':
        if (highFrequencyChannel?.bufferedAmount && highFrequencyChannel.bufferedAmount > options.pointerMoveBufferLimit) {
          return true;
        }

        options.sendBinaryControlMessage(
          buildUhidInputMessage(
            SCRCPY_HID_MOUSE_ID,
            buildHidMouseReport(
              currentMouseButtons,
              clampSignedByte(payload.dx ?? 0),
              clampSignedByte(payload.dy ?? 0),
              0,
              0
            )
          ),
          highFrequencyChannel
        );
        return true;
      case 'wheel':
        if (highFrequencyChannel?.bufferedAmount && highFrequencyChannel.bufferedAmount > options.pointerMoveBufferLimit) {
          return true;
        }

        options.sendBinaryControlMessage(
          buildUhidInputMessage(
            SCRCPY_HID_MOUSE_ID,
            buildHidMouseReport(
              currentMouseButtons,
              0,
              0,
              clampSignedByte(-(payload.wheelY ?? 0)),
              clampSignedByte(payload.wheelX ?? 0)
            )
          ),
          highFrequencyChannel
        );
        return true;
    }
  };

  return {
    initializeDevices,
    resetInputs,
    releaseDevices,
    sendKeyboardCode,
    sendKeyboardEvent,
    sendMouseEvent,
    getCurrentMouseButtons: () => currentMouseButtons,
    getPressedKeys: () => new Set(pressedKeys)
  };
};
