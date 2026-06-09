import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyInputMappingProfile } from './inputMappingSchema';
import { createLocalInputMappingProfileStore } from './inputMappingProfileStore';
import { setInputMappingTabState } from './inputMappingTabState';
import { useInputMappingRuntimeController } from './useInputMappingRuntimeController';

describe('useInputMappingRuntimeController', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('pauses and resumes input mapping without clearing the active tab profile', async () => {
    const profile = createEmptyInputMappingProfile('Test profile');
    profile.id = 'profile-1';
    profile.bindings = [{
      id: 'hold-1',
      label: 'Hold',
      trigger: { type: 'keyboard', code: 'KeyF' },
      action: { type: 'hold', point: { x: 0.5, y: 0.5 } }
    }];

    await createLocalInputMappingProfileStore().save(profile);
    setInputMappingTabState('device-1::screen', {
      activeProfileId: profile.id,
      enabled: true
    });

    const sendTouchCommand = vi.fn(() => true);
    const controller = useInputMappingRuntimeController({
      getRouteQuery: () => ({}),
      getActiveTabKey: () => 'device-1::screen',
      refreshStickerLayout: vi.fn(),
      sendTouchCommand,
      sendHidKeyCommand: vi.fn(() => true),
      sendHidMouseButtonCommand: vi.fn(() => true),
      sendHidMouseWheelCommand: vi.fn(() => true),
      isPointerLocked: () => false
    });

    await controller.loadActiveProfile();

    expect(controller.handleKeyboard('down', new KeyboardEvent('keydown', { code: 'KeyF' }))).toBe(true);
    expect(sendTouchCommand).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'down' }));

    controller.togglePaused();
    expect(controller.isInputMappingPaused.value).toBe(true);
    expect(sendTouchCommand).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'cancel' }));
    sendTouchCommand.mockClear();

    expect(controller.handleKeyboard('down', new KeyboardEvent('keydown', { code: 'KeyF' }))).toBe(false);
    expect(sendTouchCommand).not.toHaveBeenCalled();
    expect(controller.activeInputMappingProfile.value?.id).toBe(profile.id);

    controller.togglePaused();
    expect(controller.isInputMappingPaused.value).toBe(false);
    expect(controller.handleKeyboard('down', new KeyboardEvent('keydown', { code: 'KeyF' }))).toBe(true);
    expect(sendTouchCommand).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'down' }));
  });
});
