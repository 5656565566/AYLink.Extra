import { formatInputMappingKeyboardCode } from './inputMappingStickers';
import type { InputMappingBinding, NormalizedPoint } from './inputMappingSchema';

export function createInputMappingBindingId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getInputMappingTriggerText(binding: InputMappingBinding) {
  if (binding.trigger.type === 'keyboard') {
    return formatInputMappingKeyboardCode(binding.trigger.code);
  }
  if (binding.trigger.type === 'mouseButton') {
    if (binding.trigger.button === 0) return '左键';
    if (binding.trigger.button === 1) return '中键';
    if (binding.trigger.button === 2) return '右键';
    return `M${binding.trigger.button}`;
  }
  if (binding.trigger.type === 'mouseWheel') {
    return binding.trigger.direction === 'up' ? '滚上' : '滚下';
  }
  return '鼠标';
}

export function createInputMappingBindingAtPoint(type: string, point: NormalizedPoint): InputMappingBinding[] {
  const id = createInputMappingBindingId(type);
  const sticker = {
    keyText: '1',
    label: '',
    shape: 'key' as const,
    opacity: 0.9
  };

  switch (type) {
    case 'rapidTap':
      return [{
        id,
        label: '连击',
        trigger: { type: 'keyboard', code: 'Digit1' },
        action: {
          type: 'rapidTap',
          point,
          mode: 'whileHeld',
          tapsPerSecond: 20,
          tapCount: 20
        },
        sticker: { ...sticker, label: '连击' }
      }];
    case 'swipe':
      {
        const to = { x: Math.min(1, point.x + 0.08), y: point.y };
        return [{
          id,
          label: '滑动',
          trigger: { type: 'keyboard', code: 'Digit1' },
          action: {
            type: 'swipe',
            from: point,
            to,
            durationMs: 120,
            straight: false,
            startHoldMs: 0
          },
          sticker: { ...sticker, label: '滑动' }
        }];
      }
    case 'joystick': {
      const group = createInputMappingBindingId('movement');
      const directions = [
        ['move-forward', 'W', 'KeyW', { x: 0, y: -1 }],
        ['move-left', 'A', 'KeyA', { x: -1, y: 0 }],
        ['move-back', 'S', 'KeyS', { x: 0, y: 1 }],
        ['move-right', 'D', 'KeyD', { x: 1, y: 0 }]
      ] as const;
      return directions.map(([suffix, keyText, code, direction]) => ({
        id: `${group}-${suffix}`,
        label: keyText,
        trigger: { type: 'keyboard', code },
        action: {
          type: 'virtualJoystick',
          center: point,
          radius: 0.08,
          direction,
          group,
          controlMode: 'slide'
        },
        sticker: {
          keyText,
          label: '',
          shape: 'key' as const,
          opacity: 0.9
        }
      }));
    }
    case 'look':
      {
        const group = createInputMappingBindingId('look');
        const directions = [
          ['look-up', '↑', 'ArrowUp', { x: 0, y: -1 }],
          ['look-left', '←', 'ArrowLeft', { x: -1, y: 0 }],
          ['look-down', '↓', 'ArrowDown', { x: 0, y: 1 }],
          ['look-right', '→', 'ArrowRight', { x: 1, y: 0 }]
        ] as const;
        return directions.map(([suffix, keyText, code, direction]) => ({
          id: `${group}-${suffix}`,
          label: '视角移动',
          trigger: { type: 'keyboard', code },
          action: {
            type: 'virtualJoystick',
            center: point,
            radius: 0.08,
            direction,
            group,
            controlMode: 'slide'
          },
          sticker: {
            keyText,
            label: '',
            shape: 'look' as const,
            opacity: 0.86
          }
        }));
      }
    case 'fire':
      return [{
        id,
        label: '攻击',
        trigger: { type: 'mouseButton', button: 0 },
        action: { type: 'hold', point },
        sticker: { ...sticker, keyText: '左键', label: '攻击', shape: 'mouse', role: 'attack' }
      }];
    case 'aim':
      return [{
        id,
        label: '准星',
        trigger: { type: 'mouseMove', activation: 'pointerLock' },
        action: {
          type: 'mouseLook',
          touchStart: point,
          sensitivityX: 1,
          sensitivityY: 1,
          invertY: false,
          maxStep: 0.08,
          rangeX: 0.08,
          rangeY: 0.08
        },
        sticker: {
          keyText: '',
          label: '',
          labelEnabled: false,
          shape: 'aimArea',
          opacity: 0.72
        }
      }];
    case 'click':
    default:
      return [{
        id,
        label: '点击',
        trigger: { type: 'keyboard', code: 'Digit1' },
        action: { type: 'tap', point },
        sticker: { ...sticker, label: '点击' }
      }];
  }
}
