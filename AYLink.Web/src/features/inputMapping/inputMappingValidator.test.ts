import { describe, expect, it } from 'vitest';
import {
  createEmptyInputMappingProfile,
  createSampleInputMappingProfile
} from './inputMappingSchema';
import {
  InputMappingValidationError,
  assertValidInputMappingProfile,
  validateInputMappingProfile
} from './inputMappingValidator';

describe('inputMappingValidator', () => {
  it('accepts the sample profile', () => {
    expect(validateInputMappingProfile(createSampleInputMappingProfile())).toEqual({
      valid: true,
      issues: []
    });
  });

  it('rejects coordinates outside the normalized range', () => {
    const profile = createEmptyInputMappingProfile('bad');
    profile.bindings.push({
      id: 'bad-tap',
      label: 'bad tap',
      trigger: { type: 'keyboard', code: 'KeyF' },
      action: {
        type: 'tap',
        point: { x: 1.2, y: -0.1 }
      }
    });

    const result = validateInputMappingProfile(profile);

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.path)).toEqual(expect.arrayContaining([
      'bindings[0].action.point.x',
      'bindings[0].action.point.y'
    ]));
  });

  it('rejects duplicate binding ids and multiple mouse look actions', () => {
    const profile = createEmptyInputMappingProfile('bad');
    profile.bindings.push(
      {
        id: 'look',
        label: 'look 1',
        trigger: { type: 'mouseMove', activation: 'pointerLock' },
        action: {
          type: 'mouseLook',
          touchStart: { x: 0.5, y: 0.5 },
          sensitivityX: 1,
          sensitivityY: 1
        }
      },
      {
        id: 'look',
        label: 'look 2',
        trigger: { type: 'mouseMove', activation: 'rightButton' },
        action: {
          type: 'mouseLook',
          touchStart: { x: 0.5, y: 0.5 },
          sensitivityX: 1,
          sensitivityY: 1
        }
      }
    );

    expect(() => assertValidInputMappingProfile(profile)).toThrow(InputMappingValidationError);
    const result = validateInputMappingProfile(profile);
    expect(result.issues.map((issue) => issue.message)).toEqual(expect.arrayContaining([
      '绑定 id 重复',
      'mouseLook 动作同一方案只能配置一个'
    ]));
  });

  it('rejects invalid keyboard modifiers', () => {
    const profile = createEmptyInputMappingProfile('bad modifier');
    profile.bindings.push({
      id: 'bad-modifier',
      label: 'bad modifier',
      trigger: { type: 'keyboard', code: 'KeyF', modifiers: ['alt', 'hyper'] },
      action: { type: 'tap', point: { x: 0.5, y: 0.5 } }
    });

    const result = validateInputMappingProfile(profile);

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.path)).toContain('bindings[0].trigger.modifiers[1]');
  });
});
