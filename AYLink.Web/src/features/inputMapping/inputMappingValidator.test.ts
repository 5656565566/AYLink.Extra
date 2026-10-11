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

  it.each([
    { type: 'tap', point: { x: 0, y: 1 }, durationMs: 0 },
    { type: 'rapidTap', point: { x: 0, y: 1 }, mode: 'burst', tapsPerSecond: 60, tapCount: 200 },
    { type: 'rapidTap', point: { x: 0, y: 1 }, mode: 'whileHeld', tapsPerSecond: 1 },
    { type: 'hold', point: { x: 0, y: 1 } },
    { type: 'virtualJoystick', center: { x: 0, y: 1 }, direction: { x: -1, y: 1 }, radius: 1, controlMode: 'slide' },
    { type: 'swipe', from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, durationMs: 1, startHoldMs: 0, straight: false },
    { type: 'mouseLook', touchStart: { x: 0, y: 1 }, sensitivityX: 1, sensitivityY: 1, maxStep: 1, rangeX: 1, rangeY: 1 },
    { type: 'hidKey', code: 'KeyF' },
    { type: 'hidMouseButton', button: 0 },
  ])('accepts valid $type actions at their boundaries', (action) => {
    expect(validateInputMappingProfile(profileWithAction(action))).toEqual({ valid: true, issues: [] });
  });

  it.each([
    {
      action: { type: 'tap', point: { x: -1, y: NaN }, durationMs: -1 },
      issues: [
        ['point.x', '必须是 0..1 之间的数字'],
        ['point.y', '必须是 0..1 之间的数字'],
        ['durationMs', '点击时长必须是非负数字'],
      ],
    },
    {
      action: { type: 'rapidTap', point: null, mode: 'invalid', tapsPerSecond: 0, tapCount: 201 },
      issues: [['point', '必须是坐标对象'], ['mode', '连击模式无效'], ['tapsPerSecond', '每秒连击次数必须是 1..60 之间的数字']],
    },
    {
      action: { type: 'rapidTap', point: null, mode: 'burst', tapsPerSecond: Infinity, tapCount: 201 },
      issues: [['point', '必须是坐标对象'], ['tapsPerSecond', '每秒连击次数必须是 1..60 之间的数字'], ['tapCount', '连击次数必须是 1..200 之间的整数']],
    },
    {
      action: { type: 'virtualJoystick', center: null, direction: { x: NaN, y: '1' }, controlMode: 'invalid', radius: 0 },
      issues: [['center', '必须是坐标对象'], ['direction.x', '必须是数字'], ['direction.y', '必须是数字'], ['controlMode', '方向按键操作方式无效'], ['radius', '摇杆半径必须是 0..1 之间的正数']],
    },
    {
      action: { type: 'swipe', from: null, to: { x: NaN, y: 2 }, path: [{}], straight: 'false', startHoldMs: -1, durationMs: 0 },
      issues: [['from', '必须是坐标对象'], ['to.x', '必须是 0..1 之间的数字'], ['to.y', '必须是 0..1 之间的数字'], ['path', '滑动轨迹至少需要两个点'], ['straight', '直线轨迹开关必须是布尔值'], ['startHoldMs', '起始停留时间必须是非负数字'], ['durationMs', '滑动时长必须是正数']],
    },
    {
      action: { type: 'mouseLook', touchStart: {}, sensitivityX: 0, sensitivityY: NaN, maxStep: 2, rangeX: 0, rangeY: Infinity },
      issues: [['touchStart.x', '必须是 0..1 之间的数字'], ['touchStart.y', '必须是 0..1 之间的数字'], ['sensitivityX', '横向灵敏度必须是正数'], ['sensitivityY', '纵向灵敏度必须是正数'], ['maxStep', 'maxStep 必须是 0..1 之间的正数'], ['rangeX', '视角范围必须是 0..1 之间的正数'], ['rangeY', '视角范围必须是 0..1 之间的正数']],
    },
  ])('preserves $action.type issue order and error text', ({ action, issues }) => {
    const expected = issues.map(([field, message]) => ({ path: `bindings[0].action.${field}`, message }));
    const profile = profileWithAction(action);
    expect(validateInputMappingProfile(profile)).toEqual({ valid: false, issues: expected });
    expect(() => assertValidInputMappingProfile(profile)).toThrow(expected.map((issue) => `${issue.path}: ${issue.message}`).join('\n'));
  });
});

function profileWithAction(action: unknown) {
  return {
    ...createEmptyInputMappingProfile('validation'),
    bindings: [{ id: 'binding', label: 'binding', trigger: { type: 'keyboard', code: 'KeyF' }, action }],
  };
}
