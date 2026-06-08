import { describe, expect, it } from 'vitest';
import { createEmptyInputMappingProfile, createSampleInputMappingProfile } from './inputMappingSchema';
import { compileInputMappingProfile } from './inputMappingCompiler';

describe('inputMappingCompiler', () => {
  it('indexes bindings by trigger for hot input paths', () => {
    const compiled = compileInputMappingProfile(createSampleInputMappingProfile());

    expect(compiled.keyboardBindingsByCode.get('KeyW')?.[0]?.id).toBe('move-forward');
    expect(compiled.joystickBindingsByGroup.get('movement')).toHaveLength(4);
  });

  it('indexes an explicit mouse look binding', () => {
    const profile = createEmptyInputMappingProfile('mouse look');
    profile.bindings.push({
      id: 'look',
      label: '鼠标视角',
      trigger: { type: 'mouseMove', activation: 'pointerLock' },
      action: {
        type: 'mouseLook',
        sensitivityX: 1,
        sensitivityY: 1,
        invertY: false,
        touchStart: { x: 0.68, y: 0.38 },
        maxStep: 0.08
      }
    });
    const compiled = compileInputMappingProfile(profile);

    expect(compiled.mouseLookBinding).toEqual(expect.objectContaining({
      id: 'look'
    }));
    expect(compiled.mouseMoveBindings).toHaveLength(1);
  });
});
