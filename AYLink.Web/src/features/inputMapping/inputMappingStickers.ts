import { clampNormalizedPoint } from './inputMappingCoordinates';
import type {
  InputMappingAction,
  InputMappingBinding,
  InputMappingProfile,
  InputMappingStickerShape,
  InputMappingTrigger,
  NormalizedPoint
} from './inputMappingSchema';

export interface InputMappingStickerItem {
  bindingId: string;
  point: NormalizedPoint;
  keyText: string;
  label: string;
  labelEnabled: boolean;
  shape: InputMappingStickerShape;
  opacity: number;
  radius?: number;
  width?: number;
  height?: number;
  dpadKeys?: {
    up?: string;
    left?: string;
    down?: string;
    right?: string;
  };
}

export function formatInputMappingKeyboardCode(code: string) {
  switch (code) {
    case 'ArrowUp':
      return '↑';
    case 'ArrowLeft':
      return '←';
    case 'ArrowDown':
      return '↓';
    case 'ArrowRight':
      return '→';
    case 'ControlLeft':
      return 'CtrlL';
    case 'ControlRight':
      return 'CtrlR';
    case 'ShiftLeft':
      return 'ShiftL';
    case 'ShiftRight':
      return 'ShiftR';
    case 'AltLeft':
      return 'AltL';
    case 'AltRight':
      return 'AltR';
    case 'MetaLeft':
      return 'MetaL';
    case 'MetaRight':
      return 'MetaR';
    default:
      return code.replace(/^Key/, '').replace(/^Digit/, '');
  }
}

function getTriggerText(trigger: InputMappingTrigger) {
  switch (trigger.type) {
    case 'keyboard':
      return formatInputMappingKeyboardCode(trigger.code);
    case 'mouseButton':
      if (trigger.button === 0) return '左键';
      if (trigger.button === 1) return '中键';
      if (trigger.button === 2) return '右键';
      return `Mouse${trigger.button}`;
    case 'mouseWheel':
      return trigger.direction === 'up' ? '滚轮上' : '滚轮下';
    case 'mouseMove':
      return '鼠标';
  }
}

function getDefaultStickerShape(trigger: InputMappingTrigger, action: InputMappingAction): InputMappingStickerShape {
  if (action.type === 'virtualJoystick') return 'joystick';
  if (action.type === 'mouseLook') return 'aimArea';
  if (trigger.type === 'mouseButton' || trigger.type === 'mouseMove') return 'mouse';
  return 'key';
}

function getActionPoint(action: InputMappingAction): NormalizedPoint | null {
  switch (action.type) {
    case 'tap':
    case 'rapidTap':
    case 'hold':
      return action.point;
    case 'virtualJoystick':
      return action.center;
    case 'swipe':
      return action.from;
    case 'mouseLook':
      return action.touchStart;
    case 'hidKey':
    case 'hidMouseButton':
      return null;
  }
}

function resolveStickerPoint(binding: InputMappingBinding) {
  const point = getActionPoint(binding.action);
  return point ? clampNormalizedPoint(point) : null;
}

function getJoystickGroup(binding: InputMappingBinding) {
  return binding.action.type === 'virtualJoystick'
    ? (binding.action.group || `joystick:${binding.id}`)
    : '';
}

function getJoystickDirection(binding: InputMappingBinding): keyof NonNullable<InputMappingStickerItem['dpadKeys']> | null {
  if (binding.action.type !== 'virtualJoystick') {
    return null;
  }

  const { direction } = binding.action;
  if (Math.abs(direction.x) > Math.abs(direction.y)) {
    return direction.x < 0 ? 'left' : 'right';
  }

  if (Math.abs(direction.y) > 0) {
    return direction.y < 0 ? 'up' : 'down';
  }

  return null;
}

function buildJoystickStickers(profile: InputMappingProfile): InputMappingStickerItem[] {
  const groups = new Map<string, {
    bindingIds: string[];
    center: NormalizedPoint;
    keys: NonNullable<InputMappingStickerItem['dpadKeys']>;
    opacity: number;
    radius: number;
    shape: InputMappingStickerShape;
  }>();

  for (const binding of profile.bindings) {
    if (binding.action.type !== 'virtualJoystick' || binding.sticker?.enabled === false) {
      continue;
    }

    const groupKey = getJoystickGroup(binding);
    const direction = getJoystickDirection(binding);
    if (!direction) {
      continue;
    }

    const group = groups.get(groupKey) ?? {
      bindingIds: [],
      center: binding.action.center,
      keys: {},
      opacity: binding.sticker?.opacity ?? 0.9,
      radius: binding.action.radius,
      shape: binding.sticker?.shape === 'look' ? 'look' : 'joystick'
    };

    group.bindingIds.push(binding.id);
    group.keys[direction] = binding.sticker?.keyText ?? getTriggerText(binding.trigger);
    group.opacity = Math.max(group.opacity, binding.sticker?.opacity ?? 0.9);
    group.radius = Math.max(group.radius, binding.action.radius);
    if (binding.sticker?.shape === 'look') {
      group.shape = 'look';
    }
    groups.set(groupKey, group);
  }

  return Array.from(groups.entries()).map(([groupKey, group]) => ({
    bindingId: `joystick:${groupKey}:${group.bindingIds.join('+')}`,
    point: clampNormalizedPoint(group.center),
    keyText: [
      group.keys.up,
      group.keys.left,
      group.keys.down,
      group.keys.right
    ].filter(Boolean).join(''),
    label: '',
    labelEnabled: false,
    shape: group.shape,
    opacity: group.opacity,
    radius: group.radius,
    dpadKeys: group.keys
  }));
}

export function buildInputMappingStickers(profile: InputMappingProfile): InputMappingStickerItem[] {
  const stickers: InputMappingStickerItem[] = buildJoystickStickers(profile);

  for (const binding of profile.bindings) {
    if (binding.action.type === 'virtualJoystick') {
      continue;
    }

    const sticker = binding.sticker;
    if (sticker?.enabled === false) {
      continue;
    }

    const point = resolveStickerPoint(binding);
    if (!point) {
      continue;
    }

    const item: InputMappingStickerItem = {
      bindingId: binding.id,
      point,
      keyText: sticker?.keyText ?? getTriggerText(binding.trigger),
      label: sticker?.label ?? binding.label,
      labelEnabled: sticker?.labelEnabled !== false,
      shape: sticker?.shape ?? getDefaultStickerShape(binding.trigger, binding.action),
      opacity: sticker?.opacity ?? 0.9
    };

    if (binding.action.type === 'mouseLook') {
      item.width = (binding.action.rangeX ?? binding.action.maxStep ?? 0.08) * 2;
      item.height = (binding.action.rangeY ?? binding.action.maxStep ?? 0.08) * 2;
    }

    stickers.push(item);
  }

  return stickers;
}
