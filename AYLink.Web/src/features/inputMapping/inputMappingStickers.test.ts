import { describe, expect, it } from 'vitest';
import {
  createEmptyInputMappingProfile,
  createSampleInputMappingProfile
} from './inputMappingSchema';
import { buildInputMappingStickers } from './inputMappingStickers';
import { validateInputMappingProfile } from './inputMappingValidator';

describe('inputMappingStickers', () => {
  it('builds stickers from the sample profile', () => {
    const stickers = buildInputMappingStickers(createSampleInputMappingProfile());

    expect(stickers).toEqual([
      expect.objectContaining({
        bindingId: 'joystick:movement:move-forward+move-left+move-back+move-right',
        point: { x: 0.16, y: 0.78 },
        keyText: 'WASD',
        label: '',
        shape: 'joystick',
        dpadKeys: {
          up: 'W',
          left: 'A',
          down: 'S',
          right: 'D'
        }
      })
    ]);
  });

  it('derives default sticker text and position from the binding', () => {
    const profile = createEmptyInputMappingProfile('stickers');
    profile.bindings.push({
      id: 'interact',
      label: '交互',
      trigger: { type: 'keyboard', code: 'KeyF' },
      action: { type: 'tap', point: { x: 0.5, y: 0.4 } }
    });

    expect(buildInputMappingStickers(profile)).toEqual([
      {
        bindingId: 'interact',
        point: { x: 0.5, y: 0.4 },
        keyText: 'F',
        label: '交互',
        labelEnabled: true,
        shape: 'key',
        opacity: 0.9
      }
    ]);
  });

  it('keeps the key hint while hiding the short note label', () => {
    const profile = createEmptyInputMappingProfile('stickers');
    profile.bindings.push({
      id: 'attack',
      label: '攻击',
      trigger: { type: 'mouseButton', button: 0 },
      action: { type: 'tap', point: { x: 0.7, y: 0.6 } },
      sticker: {
        keyText: '左键',
        label: '攻击',
        labelEnabled: false
      }
    });

    expect(buildInputMappingStickers(profile)).toEqual([
      expect.objectContaining({
        bindingId: 'attack',
        keyText: '左键',
        label: '',
        labelEnabled: false
      })
    ]);
  });

  it('skips disabled stickers and bindings without a resolvable sticker point', () => {
    const profile = createEmptyInputMappingProfile('stickers');
    profile.bindings.push(
      {
        id: 'hidden',
        label: '隐藏',
        trigger: { type: 'keyboard', code: 'KeyH' },
        action: { type: 'tap', point: { x: 0.1, y: 0.2 } },
        sticker: { enabled: false }
      },
      {
        id: 'hid-only',
        label: 'HID',
        trigger: { type: 'keyboard', code: 'KeyR' },
        action: { type: 'hidKey', code: 'KeyR' }
      }
    );

    expect(buildInputMappingStickers(profile)).toEqual([]);
  });

  it('rejects removed sticker coordinates and validates opacity', () => {
    const profile = createEmptyInputMappingProfile('bad-sticker');
    profile.bindings.push({
      id: 'bad',
      label: 'bad',
      trigger: { type: 'keyboard', code: 'KeyB' },
      action: { type: 'tap', point: { x: 0.1, y: 0.2 } },
      sticker: {
        point: { x: 2, y: 0.5 },
        opacity: 1.5
      } as never
    });

    const result = validateInputMappingProfile(profile);

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.path)).toEqual(expect.arrayContaining([
      'bindings[0].sticker.point',
      'bindings[0].sticker.opacity'
    ]));
  });
});
