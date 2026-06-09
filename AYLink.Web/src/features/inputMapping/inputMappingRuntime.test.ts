import { describe, expect, it } from 'vitest';
import {
  createEmptyInputMappingProfile,
  createSampleInputMappingProfile,
  type InputMappingProfile
} from './inputMappingSchema';
import { createInputMappingRuntime } from './inputMappingRuntime';

function createHoldProfile(): InputMappingProfile {
  const profile = createEmptyInputMappingProfile('hold');
  profile.bindings.push({
    id: 'jump',
    label: 'jump',
    trigger: { type: 'keyboard', code: 'Space' },
    action: { type: 'hold', point: { x: 0.8, y: 0.6 } }
  });
  return profile;
}

function createMouseLookProfile(): InputMappingProfile {
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
  return profile;
}

describe('inputMappingRuntime', () => {
  it('turns hold bindings into touch down and up commands', () => {
    const runtime = createInputMappingRuntime(createHoldProfile());

    expect(runtime.handleKeyboardEvent('down', { code: 'Space' }).commands).toEqual([
      {
        type: 'touch',
        phase: 'down',
        pointerKey: 'binding:jump',
        point: { x: 0.8, y: 0.6 },
        pressure: 1
      }
    ]);
    expect(runtime.handleKeyboardEvent('up', { code: 'Space' }).commands).toEqual([
      {
        type: 'touch',
        phase: 'up',
        pointerKey: 'binding:jump',
        point: { x: 0.8, y: 0.6 },
        pressure: 0
      }
    ]);
  });

  it('keeps tap and swipe durations as delayed touch commands', () => {
    const profile = createEmptyInputMappingProfile('duration');
    profile.bindings.push(
      {
        id: 'tap',
        label: 'tap',
        trigger: { type: 'keyboard', code: 'KeyF' },
        action: { type: 'tap', point: { x: 0.4, y: 0.5 }, durationMs: 80 }
      },
      {
        id: 'swipe',
        label: 'swipe',
        trigger: { type: 'keyboard', code: 'KeyG' },
        action: { type: 'swipe', from: { x: 0.1, y: 0.2 }, to: { x: 0.3, y: 0.2 }, durationMs: 120 }
      }
    );
    const runtime = createInputMappingRuntime(profile);

    expect(runtime.handleKeyboardEvent('down', { code: 'KeyF' }).commands[1]).toMatchObject({
      phase: 'up',
      delayMs: 80
    });
    expect(runtime.handleKeyboardEvent('down', { code: 'KeyG' }).commands).toEqual([
      expect.objectContaining({ phase: 'down' }),
      expect.objectContaining({ phase: 'move', delayMs: 60 }),
      expect.objectContaining({ phase: 'up', delayMs: 120 })
    ]);
  });

  it('turns rapid tap bindings into repeat or burst touch commands', () => {
    const profile = createEmptyInputMappingProfile('rapid tap');
    profile.bindings.push(
      {
        id: 'rapid-hold',
        label: 'rapid hold',
        trigger: { type: 'keyboard', code: 'KeyR' },
        action: { type: 'rapidTap', point: { x: 0.3, y: 0.4 }, mode: 'whileHeld', tapsPerSecond: 20 }
      },
      {
        id: 'rapid-burst',
        label: 'rapid burst',
        trigger: { type: 'keyboard', code: 'KeyT' },
        action: { type: 'rapidTap', point: { x: 0.5, y: 0.6 }, mode: 'burst', tapsPerSecond: 20, tapCount: 3 }
      }
    );
    const runtime = createInputMappingRuntime(profile);

    expect(runtime.handleKeyboardEvent('down', { code: 'KeyR' }).commands).toEqual([
      {
        type: 'touchRepeat',
        pointerKey: 'binding:rapid-hold',
        point: { x: 0.3, y: 0.4 },
        intervalMs: 50,
        downMs: 25
      }
    ]);
    expect(runtime.handleKeyboardEvent('up', { code: 'KeyR' }).commands).toEqual([
      {
        type: 'stopTouchRepeat',
        pointerKey: 'binding:rapid-hold'
      }
    ]);
    expect(runtime.handleKeyboardEvent('down', { code: 'KeyT' }).commands).toEqual([
      expect.objectContaining({ type: 'touch', phase: 'down', delayMs: 0 }),
      expect.objectContaining({ type: 'touch', phase: 'up', delayMs: 25 }),
      expect.objectContaining({ type: 'touch', phase: 'down', delayMs: 50 }),
      expect.objectContaining({ type: 'touch', phase: 'up', delayMs: 75 }),
      expect.objectContaining({ type: 'touch', phase: 'down', delayMs: 100 }),
      expect.objectContaining({ type: 'touch', phase: 'up', delayMs: 125 })
    ]);
  });

  it('requires configured keyboard modifiers before a binding matches', () => {
    const profile = createEmptyInputMappingProfile('modifiers');
    profile.bindings.push({
      id: 'alt-fire',
      label: 'alt fire',
      trigger: { type: 'keyboard', code: 'KeyF', modifiers: ['alt'] },
      action: { type: 'tap', point: { x: 0.4, y: 0.5 } }
    });
    const runtime = createInputMappingRuntime(profile);

    expect(runtime.handleKeyboardEvent('down', { code: 'KeyF' }).commands).toHaveLength(0);
    expect(runtime.handleKeyboardEvent('down', { code: 'KeyF', altKey: true }).commands).toHaveLength(2);
  });

  it('combines WASD virtual joystick directions by group', () => {
    const runtime = createInputMappingRuntime(createSampleInputMappingProfile());

    const forward = runtime.handleKeyboardEvent('down', { code: 'KeyW' }).commands;
    const diagonal = runtime.handleKeyboardEvent('down', { code: 'KeyD' }).commands;
    const releaseForward = runtime.handleKeyboardEvent('up', { code: 'KeyW' }).commands;
    const releaseRight = runtime.handleKeyboardEvent('up', { code: 'KeyD' }).commands;

    expect(forward[0]).toMatchObject({
      type: 'touch',
      phase: 'down',
      pointerKey: 'joystick:movement',
      point: { x: 0.16, y: 0.78 }
    });
    expect(forward[1]).toMatchObject({
      type: 'touch',
      phase: 'move',
      pointerKey: 'joystick:movement'
    });
    expect((forward[1] as { point: { x: number; y: number } }).point.x).toBeCloseTo(0.16);
    expect((forward[1] as { point: { x: number; y: number } }).point.y).toBeCloseTo(0.7);
    expect(diagonal[0]).toMatchObject({
      phase: 'move',
      pointerKey: 'joystick:movement'
    });
    expect((diagonal[0] as { point: { x: number; y: number } }).point.x).toBeGreaterThan(0.16);
    expect((diagonal[0] as { point: { x: number; y: number } }).point.y).toBeLessThan(0.78);
    expect(releaseForward[0]).toMatchObject({
      phase: 'move',
      point: { x: 0.24, y: 0.78 }
    });
    expect(releaseRight).toEqual([
      {
        type: 'touch',
        phase: 'move',
        pointerKey: 'joystick:movement',
        point: { x: 0.16, y: 0.78 },
        pressure: 1
      },
      {
        type: 'touch',
        phase: 'up',
        pointerKey: 'joystick:movement',
        point: { x: 0.16, y: 0.78 },
        pressure: 0
      }
    ]);
  });

  it('supports tap control mode for virtual joystick bindings', () => {
    const profile = createEmptyInputMappingProfile('tap joystick');
    profile.bindings.push({
      id: 'turn-right',
      label: 'right',
      trigger: { type: 'keyboard', code: 'KeyD' },
      action: {
        type: 'virtualJoystick',
        center: { x: 0.5, y: 0.5 },
        radius: 0.1,
        direction: { x: 1, y: 0 },
        controlMode: 'tap'
      }
    });
    const runtime = createInputMappingRuntime(profile);

    expect(runtime.handleKeyboardEvent('down', { code: 'KeyD' }).commands).toEqual([
      expect.objectContaining({
        type: 'touch',
        phase: 'down',
        pointerKey: 'binding:turn-right',
        point: { x: 0.6, y: 0.5 }
      }),
      expect.objectContaining({
        type: 'touch',
        phase: 'up',
        pointerKey: 'binding:turn-right',
        point: { x: 0.6, y: 0.5 }
      })
    ]);
    expect(runtime.handleKeyboardEvent('up', { code: 'KeyD' }).commands).toEqual([]);
  });

  it('creates mouse look touch movement while pointer lock is active', () => {
    const runtime = createInputMappingRuntime(createMouseLookProfile());

    const result = runtime.handleMouseMove({
      movementX: 12,
      movementY: -6,
      pointerLocked: true
    });

    expect(result.handled).toBe(true);
    expect(result.commands[0]).toEqual({
      type: 'touch',
      phase: 'down',
      pointerKey: 'mouseLook',
      point: { x: 0.68, y: 0.38 },
      pressure: 1
    });
    expect(result.commands[1]).toMatchObject({
      type: 'touch',
      phase: 'move',
      pointerKey: 'mouseLook',
      pressure: 1
    });
    expect((result.commands[1] as { point: { x: number; y: number } }).point.x).toBeCloseTo(0.692);
    expect((result.commands[1] as { point: { x: number; y: number } }).point.y).toBeCloseTo(0.374);
  });

  it('resets mouse look when the accumulated step exceeds maxStep', () => {
    const runtime = createInputMappingRuntime(createMouseLookProfile());

    const result = runtime.handleMouseMove({
      movementX: 120,
      movementY: 0,
      pointerLocked: true
    });

    expect(result.commands.map((command) => command.type === 'touch' ? command.phase : command.type)).toEqual([
      'down',
      'move',
      'up',
      'down'
    ]);
  });

  it('releases mouse look before starting fixed left-button attack', () => {
    const profile = createMouseLookProfile();
    profile.bindings.push({
      id: 'fire',
      label: '攻击',
      trigger: { type: 'mouseButton', button: 0 },
      action: { type: 'hold', point: { x: 0.82, y: 0.64 } }
    });
    const runtime = createInputMappingRuntime(profile);

    runtime.handleMouseMove({ movementX: 12, movementY: 0, pointerLocked: true });
    const result = runtime.handleMouseButtonEvent('down', { button: 0 });

    expect(result.commands).toEqual([
      expect.objectContaining({ type: 'touch', phase: 'up', pointerKey: 'mouseLook' }),
      {
        type: 'touch',
        phase: 'down',
        pointerKey: 'binding:fire',
        point: { x: 0.82, y: 0.64 },
        pressure: 1
      }
    ]);
  });

  it('releases all active virtual touches', () => {
    const profile = createSampleInputMappingProfile();
    profile.bindings.push(...createHoldProfile().bindings);
    profile.bindings.push(...createMouseLookProfile().bindings);
    const runtime = createInputMappingRuntime(profile);
    runtime.handleKeyboardEvent('down', { code: 'KeyW' });
    runtime.handleKeyboardEvent('down', { code: 'Space' });
    runtime.handleMouseMove({ movementX: 4, movementY: 0, pointerLocked: true });

    const commands = runtime.releaseAll('blur');

    expect(commands).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'touch', phase: 'cancel', pointerKey: 'binding:jump' }),
      expect.objectContaining({ type: 'touch', phase: 'cancel', pointerKey: 'joystick:movement' }),
      expect.objectContaining({ type: 'touch', phase: 'cancel', pointerKey: 'mouseLook' })
    ]));
  });
});
