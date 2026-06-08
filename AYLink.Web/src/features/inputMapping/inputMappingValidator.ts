import {
  INPUT_MAPPING_SCHEMA_VERSION,
  type InputMappingAction,
  type InputMappingBinding,
  type InputMappingProfile,
  type InputMappingTrigger,
  type NormalizedPoint
} from './inputMappingSchema';

export interface InputMappingValidationIssue {
  path: string;
  message: string;
}

export interface InputMappingValidationResult {
  valid: boolean;
  issues: InputMappingValidationIssue[];
}

export class InputMappingValidationError extends Error {
  readonly issues: InputMappingValidationIssue[];

  constructor(issues: InputMappingValidationIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n'));
    this.name = 'InputMappingValidationError';
    this.issues = issues;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validateNormalizedPoint(point: unknown, path: string, issues: InputMappingValidationIssue[]) {
  if (!isRecord(point)) {
    issues.push({ path, message: '必须是坐标对象' });
    return;
  }

  for (const axis of ['x', 'y'] as const) {
    const value = point[axis];
    if (!isFiniteNumber(value) || value < 0 || value > 1) {
      issues.push({ path: `${path}.${axis}`, message: '必须是 0..1 之间的数字' });
    }
  }
}

function validateDirection(direction: unknown, path: string, issues: InputMappingValidationIssue[]) {
  if (!isRecord(direction)) {
    issues.push({ path, message: '必须是方向对象' });
    return;
  }

  for (const axis of ['x', 'y'] as const) {
    if (!isFiniteNumber(direction[axis])) {
      issues.push({ path: `${path}.${axis}`, message: '必须是数字' });
    }
  }
}

function validateTrigger(trigger: InputMappingTrigger | unknown, path: string, issues: InputMappingValidationIssue[]) {
  if (!isRecord(trigger) || typeof trigger.type !== 'string') {
    issues.push({ path, message: '缺少触发器类型' });
    return;
  }

  switch (trigger.type) {
    case 'keyboard':
      if (typeof trigger.code !== 'string' || trigger.code.trim().length === 0) {
        issues.push({ path: `${path}.code`, message: '键盘触发器必须包含 KeyboardEvent.code' });
      }
      if (trigger.modifiers !== null && trigger.modifiers !== undefined) {
        if (!Array.isArray(trigger.modifiers)) {
          issues.push({ path: `${path}.modifiers`, message: '修饰键必须是数组' });
        } else {
          const allowedModifiers = new Set(['alt', 'ctrl', 'control', 'meta', 'cmd', 'command', 'shift']);
          trigger.modifiers.forEach((modifier, index) => {
            if (typeof modifier !== 'string' || !allowedModifiers.has(modifier.trim().toLowerCase())) {
              issues.push({ path: `${path}.modifiers[${index}]`, message: '修饰键无效' });
            }
          });
        }
      }
      break;
    case 'mouseButton':
      {
        const button = trigger.button;
        if (!Number.isInteger(button) || typeof button !== 'number' || button < 0) {
          issues.push({ path: `${path}.button`, message: '鼠标按键必须是非负整数' });
        }
      }
      break;
    case 'mouseWheel':
      if (trigger.direction !== 'up' && trigger.direction !== 'down') {
        issues.push({ path: `${path}.direction`, message: '滚轮方向必须是 up 或 down' });
      }
      break;
    case 'mouseMove':
      if (!['pointerLock', 'rightButton', 'middleButton'].includes(String(trigger.activation))) {
        issues.push({ path: `${path}.activation`, message: '鼠标滑动触发方式无效' });
      }
      break;
    default:
      issues.push({ path: `${path}.type`, message: `未知触发器类型 ${trigger.type}` });
      break;
  }
}

function validateAction(action: InputMappingAction | unknown, path: string, issues: InputMappingValidationIssue[]) {
  if (!isRecord(action) || typeof action.type !== 'string') {
    issues.push({ path, message: '缺少动作类型' });
    return;
  }

  switch (action.type) {
    case 'tap':
      validateNormalizedPoint(action.point, `${path}.point`, issues);
      {
        const durationMs = action.durationMs;
        if (durationMs !== null && durationMs !== undefined && (!isFiniteNumber(durationMs) || durationMs < 0)) {
          issues.push({ path: `${path}.durationMs`, message: '点击时长必须是非负数字' });
        }
      }
      break;
    case 'hold':
      validateNormalizedPoint(action.point, `${path}.point`, issues);
      break;
    case 'virtualJoystick':
      validateNormalizedPoint(action.center, `${path}.center`, issues);
      validateDirection(action.direction, `${path}.direction`, issues);
      {
        const radius = action.radius;
        if (!isFiniteNumber(radius) || radius <= 0 || radius > 1) {
          issues.push({ path: `${path}.radius`, message: '摇杆半径必须是 0..1 之间的正数' });
        }
      }
      break;
    case 'swipe':
      validateNormalizedPoint(action.from, `${path}.from`, issues);
      validateNormalizedPoint(action.to, `${path}.to`, issues);
      {
        const durationMs = action.durationMs;
        if (!isFiniteNumber(durationMs) || durationMs <= 0) {
          issues.push({ path: `${path}.durationMs`, message: '滑动时长必须是正数' });
        }
      }
      break;
    case 'mouseLook':
      validateNormalizedPoint(action.touchStart, `${path}.touchStart`, issues);
      {
        const sensitivityX = action.sensitivityX;
        if (!isFiniteNumber(sensitivityX) || sensitivityX <= 0) {
          issues.push({ path: `${path}.sensitivityX`, message: '横向灵敏度必须是正数' });
        }
      }
      {
        const sensitivityY = action.sensitivityY;
        if (!isFiniteNumber(sensitivityY) || sensitivityY <= 0) {
          issues.push({ path: `${path}.sensitivityY`, message: '纵向灵敏度必须是正数' });
        }
      }
      {
        const maxStep = action.maxStep;
        if (maxStep !== null && maxStep !== undefined && (!isFiniteNumber(maxStep) || maxStep <= 0 || maxStep > 1)) {
          issues.push({ path: `${path}.maxStep`, message: 'maxStep 必须是 0..1 之间的正数' });
        }
      }
      break;
    case 'hidKey':
      if (typeof action.code !== 'string' || action.code.trim().length === 0) {
        issues.push({ path: `${path}.code`, message: 'HID 按键动作必须包含 code' });
      }
      break;
    case 'hidMouseButton':
      {
        const button = action.button;
        if (!Number.isInteger(button) || typeof button !== 'number' || button < 0) {
          issues.push({ path: `${path}.button`, message: 'HID 鼠标按键必须是非负整数' });
        }
      }
      break;
    default:
      issues.push({ path: `${path}.type`, message: `未知动作类型 ${action.type}` });
      break;
  }
}

function validateSticker(sticker: unknown, path: string, issues: InputMappingValidationIssue[]) {
  if (sticker === null || sticker === undefined) {
    return;
  }

  if (!isRecord(sticker)) {
    issues.push({ path, message: '贴纸配置必须是对象' });
    return;
  }

  if ('point' in sticker) {
    issues.push({ path: `${path}.point`, message: '贴纸坐标已移除，请使用动作坐标' });
  }

  if (sticker.shape !== null && sticker.shape !== undefined && !['key', 'button', 'joystick', 'mouse', 'text'].includes(String(sticker.shape))) {
    issues.push({ path: `${path}.shape`, message: '贴纸形状无效' });
  }

  if (sticker.labelEnabled !== null && sticker.labelEnabled !== undefined && typeof sticker.labelEnabled !== 'boolean') {
    issues.push({ path: `${path}.labelEnabled`, message: '备注显示开关必须是布尔值' });
  }

  if (sticker.opacity !== null && sticker.opacity !== undefined) {
    const opacity = sticker.opacity;
    if (!isFiniteNumber(opacity) || opacity < 0 || opacity > 1) {
      issues.push({ path: `${path}.opacity`, message: '贴纸透明度必须是 0..1 之间的数字' });
    }
  }
}

function validateBinding(binding: InputMappingBinding | unknown, index: number, issues: InputMappingValidationIssue[]) {
  const path = `bindings[${index}]`;
  if (!isRecord(binding)) {
    issues.push({ path, message: '绑定必须是对象' });
    return;
  }

  if (typeof binding.id !== 'string' || binding.id.trim().length === 0) {
    issues.push({ path: `${path}.id`, message: '绑定缺少 id' });
  }

  if (typeof binding.label !== 'string' || binding.label.trim().length === 0) {
    issues.push({ path: `${path}.label`, message: '绑定缺少显示名称' });
  }

  validateTrigger(binding.trigger, `${path}.trigger`, issues);
  validateAction(binding.action, `${path}.action`, issues);
  validateSticker(binding.sticker, `${path}.sticker`, issues);
}

export function validateInputMappingProfile(profile: unknown): InputMappingValidationResult {
  const issues: InputMappingValidationIssue[] = [];

  if (!isRecord(profile)) {
    return {
      valid: false,
      issues: [{ path: '$', message: '映射方案必须是 JSON 对象' }]
    };
  }

  if (profile.schemaVersion !== INPUT_MAPPING_SCHEMA_VERSION) {
    issues.push({ path: 'schemaVersion', message: `必须是 ${INPUT_MAPPING_SCHEMA_VERSION}` });
  }

  if (typeof profile.id !== 'string' || profile.id.trim().length === 0) {
    issues.push({ path: 'id', message: '缺少方案 id' });
  }

  if (typeof profile.name !== 'string' || profile.name.trim().length === 0) {
    issues.push({ path: 'name', message: '缺少方案名称' });
  }

  if (profile.author !== null && profile.author !== undefined && typeof profile.author !== 'string') {
    issues.push({ path: 'author', message: '作者必须是字符串' });
  }

  if (!isRecord(profile.target)) {
    issues.push({ path: 'target', message: '缺少目标信息' });
  } else {
    if (!['landscape', 'portrait', 'any'].includes(String(profile.target.orientation))) {
      issues.push({ path: 'target.orientation', message: '方向必须是 landscape、portrait 或 any' });
    }
    if (!['strict', 'responsive', 'rotate'].includes(String(profile.target.orientationPolicy))) {
      issues.push({ path: 'target.orientationPolicy', message: '方向策略无效' });
    }
  }

  if (!Array.isArray(profile.bindings)) {
    issues.push({ path: 'bindings', message: '必须是数组' });
  } else {
    const bindingIds = new Set<string>();
    let mouseLookCount = 0;
    profile.bindings.forEach((binding, index) => {
      validateBinding(binding, index, issues);
      if (isRecord(binding)) {
        if (typeof binding.id === 'string') {
          if (bindingIds.has(binding.id)) {
            issues.push({ path: `bindings[${index}].id`, message: '绑定 id 重复' });
          }
          bindingIds.add(binding.id);
        }
        if (isRecord(binding.action) && binding.action.type === 'mouseLook') {
          mouseLookCount += 1;
        }
      }
    });

    if (mouseLookCount > 1) {
      issues.push({ path: 'bindings', message: 'mouseLook 动作同一方案只能配置一个' });
    }
  }

  return {
    valid: issues.length === 0,
    issues
  };
}

export function assertValidInputMappingProfile(profile: unknown): asserts profile is InputMappingProfile {
  const result = validateInputMappingProfile(profile);
  if (!result.valid) {
    throw new InputMappingValidationError(result.issues);
  }
}

export function isNormalizedPoint(value: unknown): value is NormalizedPoint {
  if (!isRecord(value)) {
    return false;
  }

  const x = value.x;
  const y = value.y;
  return isFiniteNumber(x)
    && x >= 0
    && x <= 1
    && isFiniteNumber(y)
    && y >= 0
    && y <= 1;
}
