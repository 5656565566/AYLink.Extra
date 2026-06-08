import type {
  InputMappingAction,
  InputMappingBinding,
  InputMappingProfile
} from './inputMappingSchema';
import { assertValidInputMappingProfile } from './inputMappingValidator';

export interface CompiledInputMappingProfile {
  profile: InputMappingProfile;
  keyboardBindingsByCode: Map<string, InputMappingBinding[]>;
  mouseButtonBindingsByButton: Map<number, InputMappingBinding[]>;
  mouseWheelBindingsByDirection: Map<'up' | 'down', InputMappingBinding[]>;
  mouseMoveBindings: InputMappingBinding[];
  mouseLookBinding: InputMappingBinding | null;
  joystickBindingsByGroup: Map<string, InputMappingBinding[]>;
}

function addBinding<TKey>(map: Map<TKey, InputMappingBinding[]>, key: TKey, binding: InputMappingBinding) {
  const bindings = map.get(key);
  if (bindings) {
    bindings.push(binding);
    return;
  }

  map.set(key, [binding]);
}

function getJoystickGroup(action: InputMappingAction, bindingId: string) {
  return action.type === 'virtualJoystick' ? (action.group || `joystick:${bindingId}`) : '';
}

export function compileInputMappingProfile(profile: InputMappingProfile): CompiledInputMappingProfile {
  assertValidInputMappingProfile(profile);

  const keyboardBindingsByCode = new Map<string, InputMappingBinding[]>();
  const mouseButtonBindingsByButton = new Map<number, InputMappingBinding[]>();
  const mouseWheelBindingsByDirection = new Map<'up' | 'down', InputMappingBinding[]>();
  const mouseMoveBindings: InputMappingBinding[] = [];
  const joystickBindingsByGroup = new Map<string, InputMappingBinding[]>();
  let mouseLookBinding: InputMappingBinding | null = null;

  for (const binding of profile.bindings) {
    switch (binding.trigger.type) {
      case 'keyboard':
        addBinding(keyboardBindingsByCode, binding.trigger.code, binding);
        break;
      case 'mouseButton':
        addBinding(mouseButtonBindingsByButton, binding.trigger.button, binding);
        break;
      case 'mouseWheel':
        addBinding(mouseWheelBindingsByDirection, binding.trigger.direction, binding);
        break;
      case 'mouseMove':
        mouseMoveBindings.push(binding);
        break;
    }

    if (binding.action.type === 'virtualJoystick') {
      addBinding(joystickBindingsByGroup, getJoystickGroup(binding.action, binding.id), binding);
    }

    if (binding.action.type === 'mouseLook') {
      mouseLookBinding = binding;
    }
  }

  return {
    profile,
    keyboardBindingsByCode,
    mouseButtonBindingsByButton,
    mouseWheelBindingsByDirection,
    mouseMoveBindings,
    mouseLookBinding,
    joystickBindingsByGroup
  };
}
