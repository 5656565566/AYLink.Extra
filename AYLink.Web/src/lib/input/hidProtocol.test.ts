import { describe, expect, it } from 'vitest';
import {
  buildHidKeyboardReport,
  buildUhidCreateMessage,
  KEYBOARD_REPORT_DESC,
  SCRCPY_HID_KEYBOARD_ID
} from './hidProtocol';

describe('hidProtocol', () => {
  it('serializes uhid create messages with vendor, product and device name', () => {
    const payload = buildUhidCreateMessage(SCRCPY_HID_KEYBOARD_ID, KEYBOARD_REPORT_DESC);

    expect(payload[0]).toBe(12);
    expect(payload[1]).toBe(0);
    expect(payload[2]).toBe(SCRCPY_HID_KEYBOARD_ID);
    expect(payload[3]).toBe(0);
    expect(payload[4]).toBe(0);
    expect(payload[5]).toBe(0);
    expect(payload[6]).toBe(0);
    expect(payload[7]).toBe(6);
    expect(new TextDecoder().decode(payload.slice(8, 14))).toBe('AYLink');

    const reportDescSizeOffset = 14;
    const reportDescSize = (payload[reportDescSizeOffset] << 8) | payload[reportDescSizeOffset + 1];
    expect(reportDescSize).toBe(KEYBOARD_REPORT_DESC.length);
    expect(payload.slice(reportDescSizeOffset + 2)).toEqual(KEYBOARD_REPORT_DESC);
  });

  it('packs modifier and normal keys into a standard keyboard report', () => {
    const report = buildHidKeyboardReport([0xe1, 0x04, 0x05, 0x06]);

    expect(Array.from(report)).toEqual([0x02, 0x00, 0x04, 0x05, 0x06, 0x00, 0x00, 0x00]);
  });
});
