export const INPUT_MAPPING_SCHEMA_VERSION = 1;

export type InputMappingOrientation = 'landscape' | 'portrait' | 'any';

export type InputMappingOrientationPolicy = 'strict' | 'responsive' | 'rotate';

export interface NormalizedPoint {
  x: number;
  y: number;
}

export interface InputMappingReferenceResolution {
  width: number;
  height: number;
}

export interface InputMappingTarget {
  packageName?: string;
  orientation: InputMappingOrientation;
  orientationPolicy: InputMappingOrientationPolicy;
  referenceResolution?: InputMappingReferenceResolution;
}

export type InputMappingTrigger =
  | { type: 'keyboard'; code: string; modifiers?: string[] }
  | { type: 'mouseButton'; button: number }
  | { type: 'mouseWheel'; direction: 'up' | 'down' }
  | { type: 'mouseMove'; activation: 'pointerLock' | 'rightButton' | 'middleButton' };

export type InputMappingAction =
  | { type: 'tap'; point: NormalizedPoint; durationMs?: number }
  | { type: 'rapidTap'; point: NormalizedPoint; mode: 'whileHeld' | 'burst'; tapsPerSecond: number; tapCount?: number }
  | { type: 'hold'; point: NormalizedPoint }
  | { type: 'virtualJoystick'; center: NormalizedPoint; radius: number; direction: NormalizedPoint; group?: string }
  | { type: 'swipe'; from: NormalizedPoint; to: NormalizedPoint; durationMs: number }
  | { type: 'mouseLook'; touchStart: NormalizedPoint; sensitivityX: number; sensitivityY: number; invertY?: boolean; maxStep?: number }
  | { type: 'hidKey'; code: string }
  | { type: 'hidMouseButton'; button: number };

export type InputMappingStickerShape = 'key' | 'button' | 'joystick' | 'mouse' | 'text';

export interface InputMappingSticker {
  enabled?: boolean;
  labelEnabled?: boolean;
  keyText?: string;
  label?: string;
  shape?: InputMappingStickerShape;
  opacity?: number;
}

export interface InputMappingBinding {
  id: string;
  label: string;
  trigger: InputMappingTrigger;
  action: InputMappingAction;
  sticker?: InputMappingSticker;
}

export interface InputMappingProfile {
  schemaVersion: 1;
  id: string;
  name: string;
  author?: string;
  description?: string;
  target: InputMappingTarget;
  bindings: InputMappingBinding[];
  createdAt?: string;
  updatedAt?: string;
}

export interface InputMappingProfileSummary {
  id: string;
  name: string;
  author?: string;
  description?: string;
  bindingCount: number;
  packageName?: string;
  updatedAt?: string;
}

export function createEmptyInputMappingProfile(name = '新的按键映射方案'): InputMappingProfile {
  const now = new Date().toISOString();

  return {
    schemaVersion: INPUT_MAPPING_SCHEMA_VERSION,
    id: createInputMappingProfileId(),
    name,
    author: '',
    description: '',
    target: {
      orientation: 'landscape',
      orientationPolicy: 'responsive',
      referenceResolution: {
        width: 2400,
        height: 1080
      }
    },
    bindings: [],
    createdAt: now,
    updatedAt: now
  };
}

export function createSampleInputMappingProfile(): InputMappingProfile {
  const profile = createEmptyInputMappingProfile('示例 3D 游戏方案');
  profile.description = '包含 WASD 虚拟摇杆方向键的示例方案。';
  profile.bindings = [
    {
      id: 'move-forward',
      label: '前进',
      trigger: { type: 'keyboard', code: 'KeyW' },
      action: {
        type: 'virtualJoystick',
        center: { x: 0.16, y: 0.78 },
        radius: 0.08,
        direction: { x: 0, y: -1 },
        group: 'movement'
      },
      sticker: {
        keyText: 'W',
        label: '前进',
        shape: 'key'
      }
    },
    {
      id: 'move-left',
      label: '左移',
      trigger: { type: 'keyboard', code: 'KeyA' },
      action: {
        type: 'virtualJoystick',
        center: { x: 0.16, y: 0.78 },
        radius: 0.08,
        direction: { x: -1, y: 0 },
        group: 'movement'
      },
      sticker: {
        keyText: 'A',
        label: '左移',
        shape: 'key'
      }
    },
    {
      id: 'move-back',
      label: '后退',
      trigger: { type: 'keyboard', code: 'KeyS' },
      action: {
        type: 'virtualJoystick',
        center: { x: 0.16, y: 0.78 },
        radius: 0.08,
        direction: { x: 0, y: 1 },
        group: 'movement'
      },
      sticker: {
        keyText: 'S',
        label: '后退',
        shape: 'key'
      }
    },
    {
      id: 'move-right',
      label: '右移',
      trigger: { type: 'keyboard', code: 'KeyD' },
      action: {
        type: 'virtualJoystick',
        center: { x: 0.16, y: 0.78 },
        radius: 0.08,
        direction: { x: 1, y: 0 },
        group: 'movement'
      },
      sticker: {
        keyText: 'D',
        label: '右移',
        shape: 'key'
      }
    }
  ];
  profile.updatedAt = new Date().toISOString();
  return profile;
}

export function summarizeInputMappingProfile(profile: InputMappingProfile): InputMappingProfileSummary {
  return {
    id: profile.id,
    name: profile.name,
    author: profile.author,
    description: profile.description,
    bindingCount: profile.bindings.length,
    packageName: profile.target.packageName,
    updatedAt: profile.updatedAt
  };
}

export function createInputMappingProfileId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `input-map-${crypto.randomUUID()}`;
  }

  return `input-map-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
