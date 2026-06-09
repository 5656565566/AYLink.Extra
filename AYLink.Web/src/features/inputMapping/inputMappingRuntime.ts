import {
  addNormalizedPoints,
  clampNormalizedPoint,
  normalizeDirection,
  resolveVirtualJoystickPoint,
  scaleNormalizedPoint
} from './inputMappingCoordinates';
import {
  createInputMappingResult,
  type InputMappingCommand,
  type InputMappingRuntimeResult
} from './inputMappingCommands';
import {
  compileInputMappingProfile,
  type CompiledInputMappingProfile
} from './inputMappingCompiler';
import type {
  InputMappingAction,
  InputMappingBinding,
  InputMappingProfile,
  NormalizedPoint
} from './inputMappingSchema';

export interface InputMappingKeyboardInput {
  code: string;
  repeat?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}

export interface InputMappingMouseButtonInput {
  button: number;
}

export interface InputMappingMouseWheelInput {
  deltaY: number;
}

export interface InputMappingMouseMoveInput {
  movementX: number;
  movementY: number;
  pointerLocked?: boolean;
  pressedButtons?: number;
}

interface ActiveTouchState {
  pointerKey: string;
  point: NormalizedPoint;
}

interface JoystickGroupState {
  center: NormalizedPoint;
  radius: number;
  activeBindingIds: Set<string>;
  point: NormalizedPoint;
  isDown: boolean;
}

interface MouseLookState {
  isDown: boolean;
  point: NormalizedPoint;
}

export interface InputMappingRuntime {
  setProfile(profile: InputMappingProfile | null): InputMappingCommand[];
  handleKeyboardEvent(phase: 'down' | 'up', input: InputMappingKeyboardInput): InputMappingRuntimeResult;
  handleMouseButtonEvent(phase: 'down' | 'up', input: InputMappingMouseButtonInput): InputMappingRuntimeResult;
  handleMouseMove(input: InputMappingMouseMoveInput): InputMappingRuntimeResult;
  handleMouseWheel(input: InputMappingMouseWheelInput): InputMappingRuntimeResult;
  releaseAll(reason: 'blur' | 'disconnect' | 'profile-change'): InputMappingCommand[];
  getCompiledProfile(): CompiledInputMappingProfile | null;
}

function getBindingPointerKey(binding: InputMappingBinding) {
  return `binding:${binding.id}`;
}

function getJoystickGroup(action: InputMappingAction, bindingId: string) {
  return action.type === 'virtualJoystick' ? (action.group || `joystick:${bindingId}`) : '';
}

function getWheelDirection(input: InputMappingMouseWheelInput): 'up' | 'down' {
  return input.deltaY < 0 ? 'up' : 'down';
}

function isMouseLookActive(binding: InputMappingBinding, input: InputMappingMouseMoveInput) {
  if (binding.trigger.type !== 'mouseMove') {
    return false;
  }

  switch (binding.trigger.activation) {
    case 'pointerLock':
      return input.pointerLocked === true;
    case 'rightButton':
      return ((input.pressedButtons ?? 0) & 2) !== 0;
    case 'middleButton':
      return ((input.pressedButtons ?? 0) & 4) !== 0;
    default:
      return false;
  }
}

function createTapCommands(binding: InputMappingBinding, point: NormalizedPoint, pressure = 1): InputMappingCommand[] {
  const pointerKey = getBindingPointerKey(binding);
  const durationMs = binding.action.type === 'tap' ? binding.action.durationMs : undefined;
  const upCommand: InputMappingCommand = { type: 'touch', phase: 'up', pointerKey, point, pressure: 0 };
  if (durationMs !== null && durationMs !== undefined) {
    upCommand.delayMs = durationMs;
  }
  return [
    { type: 'touch', phase: 'down', pointerKey, point, pressure },
    upCommand
  ];
}

function clampRapidTapRate(tapsPerSecond: number) {
  return Math.min(60, Math.max(1, Number.isFinite(tapsPerSecond) ? tapsPerSecond : 20));
}

function createRapidTapBurstCommands(binding: InputMappingBinding): InputMappingCommand[] {
  if (binding.action.type !== 'rapidTap') {
    return [];
  }

  const tapsPerSecond = clampRapidTapRate(binding.action.tapsPerSecond);
  const tapCount = Math.min(200, Math.max(1, Math.round(binding.action.tapCount ?? tapsPerSecond)));
  const intervalMs = Math.round(1000 / tapsPerSecond);
  const downMs = Math.max(16, Math.min(40, Math.round(intervalMs / 2)));
  const pointerKey = getBindingPointerKey(binding);
  const commands: InputMappingCommand[] = [];
  for (let index = 0; index < tapCount; index += 1) {
    const delayMs = index * intervalMs;
    commands.push({
      type: 'touch',
      phase: 'down',
      pointerKey,
      point: binding.action.point,
      pressure: 1,
      delayMs
    });
    commands.push({
      type: 'touch',
      phase: 'up',
      pointerKey,
      point: binding.action.point,
      pressure: 0,
      delayMs: delayMs + downMs
    });
  }
  return commands;
}

function hasKeyboardModifier(input: InputMappingKeyboardInput, modifier: string) {
  switch (modifier.toLowerCase()) {
    case 'alt':
      return input.altKey === true;
    case 'ctrl':
    case 'control':
      return input.ctrlKey === true;
    case 'meta':
    case 'cmd':
    case 'command':
      return input.metaKey === true;
    case 'shift':
      return input.shiftKey === true;
    default:
      return false;
  }
}

function matchesKeyboardModifiers(binding: InputMappingBinding, input: InputMappingKeyboardInput) {
  if (binding.trigger.type !== 'keyboard') {
    return true;
  }

  const modifiers = binding.trigger.modifiers ?? [];
  return modifiers.every((modifier) => hasKeyboardModifier(input, modifier));
}

export function createInputMappingRuntime(profile: InputMappingProfile | null = null): InputMappingRuntime {
  let compiledProfile: CompiledInputMappingProfile | null = profile ? compileInputMappingProfile(profile) : null;
  const activeTouches = new Map<string, ActiveTouchState>();
  const activeJoystickGroups = new Map<string, JoystickGroupState>();
  const activeRapidTapBindings = new Set<string>();
  const mouseLookState: MouseLookState = {
    isDown: false,
    point: { x: 0.5, y: 0.5 }
  };

  const executeBindingDown = (binding: InputMappingBinding): InputMappingCommand[] => {
    const action = binding.action;
    const pointerKey = getBindingPointerKey(binding);

    switch (action.type) {
      case 'tap':
        return createTapCommands(binding, action.point);
      case 'rapidTap': {
        if (action.mode === 'burst') {
          return createRapidTapBurstCommands(binding);
        }
        if (activeRapidTapBindings.has(binding.id)) {
          return [];
        }
        activeRapidTapBindings.add(binding.id);
        const tapsPerSecond = clampRapidTapRate(action.tapsPerSecond);
        const intervalMs = Math.round(1000 / tapsPerSecond);
        return [{
          type: 'touchRepeat',
          pointerKey,
          point: action.point,
          intervalMs,
          downMs: Math.max(16, Math.min(40, Math.round(intervalMs / 2)))
        }];
      }
      case 'hold': {
        if (activeTouches.has(binding.id)) return [];
        activeTouches.set(binding.id, {
          pointerKey,
          point: action.point
        });
        return [{ type: 'touch', phase: 'down', pointerKey, point: action.point, pressure: 1 }];
      }
      case 'swipe':
        return [
          { type: 'touch', phase: 'down', pointerKey, point: action.from, pressure: 1 },
          { type: 'touch', phase: 'move', pointerKey, point: action.to, pressure: 1, delayMs: Math.round(action.durationMs / 2) },
          { type: 'touch', phase: 'up', pointerKey, point: action.to, pressure: 0, delayMs: action.durationMs }
        ];
      case 'virtualJoystick':
        return updateJoystickBinding(binding, true);
      case 'hidKey':
        return [{ type: 'hidKey', phase: 'down', code: action.code }];
      case 'hidMouseButton':
        return [{ type: 'hidMouseButton', phase: 'down', button: action.button }];
      case 'mouseLook':
        return [];
      default:
        return [];
    }
  };

  const executeBindingUp = (binding: InputMappingBinding): InputMappingCommand[] => {
    const action = binding.action;

    switch (action.type) {
      case 'hold': {
        const active = activeTouches.get(binding.id);
        if (!active) return [];
        activeTouches.delete(binding.id);
        return [{ type: 'touch', phase: 'up', pointerKey: active.pointerKey, point: active.point, pressure: 0 }];
      }
      case 'rapidTap':
        if (action.mode !== 'whileHeld') {
          return [];
        }
        activeRapidTapBindings.delete(binding.id);
        return [{ type: 'stopTouchRepeat', pointerKey: getBindingPointerKey(binding) }];
      case 'virtualJoystick':
        return updateJoystickBinding(binding, false);
      case 'hidKey':
        return [{ type: 'hidKey', phase: 'up', code: action.code }];
      case 'hidMouseButton':
        return [{ type: 'hidMouseButton', phase: 'up', button: action.button }];
      default:
        return [];
    }
  };

  function updateJoystickBinding(binding: InputMappingBinding, isDown: boolean): InputMappingCommand[] {
    if (binding.action.type !== 'virtualJoystick' || !compiledProfile) {
      return [];
    }

    const groupKey = getJoystickGroup(binding.action, binding.id);
    let group = activeJoystickGroups.get(groupKey);
    if (!group) {
      group = {
        center: binding.action.center,
        radius: binding.action.radius,
        activeBindingIds: new Set<string>(),
        point: binding.action.center,
        isDown: false
      };
      activeJoystickGroups.set(groupKey, group);
    }

    if (isDown) {
      group.activeBindingIds.add(binding.id);
    } else {
      group.activeBindingIds.delete(binding.id);
    }

    const groupBindings = compiledProfile.joystickBindingsByGroup.get(groupKey) ?? [];
    const direction = groupBindings.reduce<NormalizedPoint>((sum, item) => {
      if (item.action.type !== 'virtualJoystick' || !group?.activeBindingIds.has(item.id)) {
        return sum;
      }

      return {
        x: sum.x + item.action.direction.x,
        y: sum.y + item.action.direction.y
      };
    }, { x: 0, y: 0 });

    const pointerKey = `joystick:${groupKey}`;
    if (group.activeBindingIds.size === 0) {
      activeJoystickGroups.delete(groupKey);
      if (!group.isDown) {
        return [];
      }

      group.isDown = false;
      group.point = group.center;
      return [
        { type: 'touch', phase: 'move', pointerKey, point: group.center, pressure: 1 },
        { type: 'touch', phase: 'up', pointerKey, point: group.center, pressure: 0 }
      ];
    }

    const nextPoint = resolveVirtualJoystickPoint(group.center, group.radius, normalizeDirection(direction));
    if (!group.isDown) {
      group.isDown = true;
      group.point = nextPoint;
      return [
        { type: 'touch', phase: 'down', pointerKey, point: group.center, pressure: 1 },
        { type: 'touch', phase: 'move', pointerKey, point: nextPoint, pressure: 1 }
      ];
    }

    group.isDown = true;
    group.point = nextPoint;
    return [{ type: 'touch', phase: 'move', pointerKey, point: nextPoint, pressure: 1 }];
  }

  function handleBindings(phase: 'down' | 'up', bindings: InputMappingBinding[] | undefined, repeat = false): InputMappingRuntimeResult {
    if (!compiledProfile || !bindings || bindings.length === 0) {
      return createInputMappingResult();
    }

    if (phase === 'down' && repeat) {
      const repeatableBindings = bindings.filter((binding) => binding.action.type === 'tap' || binding.action.type === 'swipe');
      if (repeatableBindings.length === 0) {
        return createInputMappingResult();
      }
      bindings = repeatableBindings;
    }

    const commands = bindings.flatMap((binding) => phase === 'down' ? executeBindingDown(binding) : executeBindingUp(binding));
    return {
      handled: bindings.length > 0,
      commands
    };
  }

  function releaseMouseLook(phase: 'up' | 'cancel' = 'up'): InputMappingCommand[] {
    const binding = compiledProfile?.mouseLookBinding;
    if (!binding || !mouseLookState.isDown) {
      return [];
    }

    mouseLookState.isDown = false;
    return [{
      type: 'touch',
      phase,
      pointerKey: 'mouseLook',
      point: mouseLookState.point,
      pressure: 0
    }];
  }

  function handleMouseLook(input: InputMappingMouseMoveInput): InputMappingRuntimeResult {
    const binding = compiledProfile?.mouseLookBinding;
    if (!binding || binding.action.type !== 'mouseLook') {
      return createInputMappingResult();
    }

    if (!isMouseLookActive(binding, input)) {
      return createInputMappingResult(releaseMouseLook('up'));
    }

    const action = binding.action;
    const touchStart = action.touchStart;
    const maxStep = action.maxStep ?? 0.08;
    const delta = {
      x: (input.movementX / 1000) * action.sensitivityX,
      y: (input.movementY / 1000) * action.sensitivityY * (action.invertY ? -1 : 1)
    };
    const nextPoint = clampNormalizedPoint(addNormalizedPoints(mouseLookState.isDown ? mouseLookState.point : touchStart, delta));
    const distanceFromStart = Math.hypot(nextPoint.x - touchStart.x, nextPoint.y - touchStart.y);
    const commands: InputMappingCommand[] = [];

    if (!mouseLookState.isDown) {
      mouseLookState.isDown = true;
      mouseLookState.point = touchStart;
      commands.push({ type: 'touch', phase: 'down', pointerKey: 'mouseLook', point: touchStart, pressure: 1 });
    }

    if (distanceFromStart > maxStep) {
      const limitedDelta = scaleNormalizedPoint(normalizeDirection({
        x: nextPoint.x - touchStart.x,
        y: nextPoint.y - touchStart.y
      }), maxStep);
      const limitedPoint = clampNormalizedPoint(addNormalizedPoints(touchStart, limitedDelta));
      commands.push({ type: 'touch', phase: 'move', pointerKey: 'mouseLook', point: limitedPoint, pressure: 1 });
      commands.push({ type: 'touch', phase: 'up', pointerKey: 'mouseLook', point: limitedPoint, pressure: 0 });
      commands.push({ type: 'touch', phase: 'down', pointerKey: 'mouseLook', point: touchStart, pressure: 1 });
      mouseLookState.point = touchStart;
      mouseLookState.isDown = true;
      return createInputMappingResult(commands);
    }

    mouseLookState.point = nextPoint;
    commands.push({ type: 'touch', phase: 'move', pointerKey: 'mouseLook', point: nextPoint, pressure: 1 });
    return createInputMappingResult(commands);
  }

  const releaseAll = (_reason: 'blur' | 'disconnect' | 'profile-change') => {
    const commands: InputMappingCommand[] = [];

    for (const active of activeTouches.values()) {
      commands.push({ type: 'touch', phase: 'cancel', pointerKey: active.pointerKey, point: active.point, pressure: 0 });
    }
    activeTouches.clear();

    for (const [groupKey, group] of activeJoystickGroups.entries()) {
      if (group.isDown) {
        commands.push({ type: 'touch', phase: 'cancel', pointerKey: `joystick:${groupKey}`, point: group.point, pressure: 0 });
      }
    }
    activeJoystickGroups.clear();

    for (const bindingId of activeRapidTapBindings) {
      commands.push({ type: 'stopTouchRepeat', pointerKey: `binding:${bindingId}` });
    }
    activeRapidTapBindings.clear();

    commands.push(...releaseMouseLook('cancel'));
    return commands;
  };

  return {
    setProfile(nextProfile) {
      const releaseCommands = releaseAll('profile-change');
      compiledProfile = nextProfile ? compileInputMappingProfile(nextProfile) : null;
      return releaseCommands;
    },

    handleKeyboardEvent(phase, input) {
      const bindings = compiledProfile?.keyboardBindingsByCode.get(input.code)
        ?.filter((binding) => matchesKeyboardModifiers(binding, input));
      return handleBindings(phase, bindings, input.repeat);
    },

    handleMouseButtonEvent(phase, input) {
      return handleBindings(phase, compiledProfile?.mouseButtonBindingsByButton.get(input.button));
    },

    handleMouseMove(input) {
      if (!compiledProfile) {
        return createInputMappingResult();
      }

      return handleMouseLook(input);
    },

    handleMouseWheel(input) {
      if (!compiledProfile) {
        return createInputMappingResult();
      }

      const bindings = compiledProfile.mouseWheelBindingsByDirection.get(getWheelDirection(input));
      const result = handleBindings('down', bindings);
      if (result.commands.length > 0 || result.handled) {
        return result;
      }

      return createInputMappingResult([{ type: 'hidMouseWheel', deltaY: input.deltaY }]);
    },

    releaseAll,

    getCompiledProfile() {
      return compiledProfile;
    }
  };
}
