import { describe, expect, it, vi } from 'vitest';
import type { InputMappingCommand } from './inputMappingCommands';
import {
  createInputMappingCommandBridge,
  type ResolvedInputMappingTouchCommand
} from './inputMappingCommandBridge';

function createBridge() {
  return {
    sendTouchCommand: vi.fn(() => true),
    sendHidKeyCommand: vi.fn(() => true),
    sendHidMouseButtonCommand: vi.fn(() => true),
    sendHidMouseWheelCommand: vi.fn(() => true)
  };
}

describe('inputMappingCommandBridge', () => {
  it('dispatches delayed touch commands and cancels pending commands on clear', () => {
    vi.useFakeTimers();
    const senders = createBridge();
    const bridge = createInputMappingCommandBridge({
      ...senders,
      firstPointerId: 3
    });

    bridge.execute([
      { type: 'touch', phase: 'down', pointerKey: 'binding:tap', point: { x: 0.1, y: 0.2 }, pressure: 1 },
      { type: 'touch', phase: 'up', pointerKey: 'binding:tap', point: { x: 0.1, y: 0.2 }, pressure: 0, delayMs: 120 }
    ]);

    expect(senders.sendTouchCommand).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(119);
    expect(senders.sendTouchCommand).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1);
    expect(senders.sendTouchCommand).toHaveBeenCalledTimes(2);

    bridge.execute([
      { type: 'touch', phase: 'up', pointerKey: 'binding:tap', point: { x: 0.1, y: 0.2 }, pressure: 0, delayMs: 120 }
    ]);
    bridge.clearPendingCommands();
    vi.advanceTimersByTime(120);
    expect(senders.sendTouchCommand).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('keeps a stable pointer id for a touch pointer key until release', () => {
    const senders = createBridge();
    const bridge = createInputMappingCommandBridge({
      ...senders,
      firstPointerId: 42
    });

    const commands: InputMappingCommand[] = [
      { type: 'touch', phase: 'down', pointerKey: 'binding:jump', point: { x: 0.5, y: 0.6 }, pressure: 1 },
      { type: 'touch', phase: 'move', pointerKey: 'binding:jump', point: { x: 0.6, y: 0.6 }, pressure: 1 },
      { type: 'touch', phase: 'up', pointerKey: 'binding:jump', point: { x: 0.6, y: 0.6 }, pressure: 0 }
    ];

    expect(bridge.execute(commands)).toEqual({
      handled: true,
      sent: 3,
      failed: []
    });
    const touchCommands = (senders.sendTouchCommand.mock.calls as unknown as Array<[ResolvedInputMappingTouchCommand]>)
      .map(([command]) => command);
    expect(touchCommands.map((command) => command.pointerId)).toEqual([42, 42, 42]);
    expect(bridge.getPointerId('binding:jump')).toBe(42);
    touchCommands[2].onFinalized?.();
    expect(bridge.getPointerId('binding:jump')).toBeNull();
  });

  it('keeps pointer ids allocated until a release command is finalized', () => {
    const senders = createBridge();
    const bridge = createInputMappingCommandBridge({
      ...senders,
      firstPointerId: 7
    });

    const upCommand: InputMappingCommand = {
      type: 'touch',
      phase: 'up',
      pointerKey: 'binding:aim',
      point: { x: 0.2, y: 0.3 },
      pressure: 0
    };

    bridge.execute([
      { type: 'touch', phase: 'down', pointerKey: 'binding:aim', point: { x: 0.2, y: 0.3 }, pressure: 1 },
      upCommand
    ]);

    expect(bridge.getPointerId('binding:aim')).toBe(7);
    const touchCommands = (senders.sendTouchCommand.mock.calls as unknown as Array<[ResolvedInputMappingTouchCommand]>)
      .map(([command]) => command);
    touchCommands[1].onFinalized?.();
    expect(bridge.getPointerId('binding:aim')).toBeNull();
  });

  it('keeps pointer ids allocated when a release command fails to queue', () => {
    const senders = createBridge();
    senders.sendTouchCommand
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);
    const bridge = createInputMappingCommandBridge({
      ...senders,
      firstPointerId: 9
    });

    bridge.execute([
      { type: 'touch', phase: 'down', pointerKey: 'binding:hold', point: { x: 0.2, y: 0.3 }, pressure: 1 },
      { type: 'touch', phase: 'cancel', pointerKey: 'binding:hold', point: { x: 0.2, y: 0.3 }, pressure: 0 }
    ]);

    expect(bridge.getPointerId('binding:hold')).toBe(9);
  });

  it('does not let a stale release finalizer clear a newer pointer id', () => {
    const senders = createBridge();
    const bridge = createInputMappingCommandBridge({
      ...senders,
      firstPointerId: 11
    });

    bridge.execute([
      { type: 'touch', phase: 'down', pointerKey: 'joystick:movement', point: { x: 0.16, y: 0.7 }, pressure: 1 },
      { type: 'touch', phase: 'up', pointerKey: 'joystick:movement', point: { x: 0.16, y: 0.78 }, pressure: 0 }
    ]);
    const touchCommands = (senders.sendTouchCommand.mock.calls as unknown as Array<[ResolvedInputMappingTouchCommand]>)
      .map(([command]) => command);
    const staleRelease = touchCommands[1];

    bridge.clearPointerKeys();
    bridge.execute([
      { type: 'touch', phase: 'down', pointerKey: 'joystick:movement', point: { x: 0.16, y: 0.7 }, pressure: 1 }
    ]);

    expect(bridge.getPointerId('joystick:movement')).toBe(12);
    staleRelease.onFinalized?.();
    expect(bridge.getPointerId('joystick:movement')).toBe(12);
  });

  it('dispatches hid commands to the injected senders', () => {
    const senders = createBridge();
    const bridge = createInputMappingCommandBridge(senders);

    bridge.execute([
      { type: 'hidKey', phase: 'down', code: 'KeyR' },
      { type: 'hidMouseButton', phase: 'up', button: 2 },
      { type: 'hidMouseWheel', deltaY: -120 }
    ]);

    expect(senders.sendHidKeyCommand).toHaveBeenCalledWith('down', 'KeyR');
    expect(senders.sendHidMouseButtonCommand).toHaveBeenCalledWith('up', 2);
    expect(senders.sendHidMouseWheelCommand).toHaveBeenCalledWith(-120);
  });
});
