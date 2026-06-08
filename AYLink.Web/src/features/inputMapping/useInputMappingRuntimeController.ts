import { ref } from 'vue';
import { storageKeys } from '../../core/storage/keys';
import { createInputMappingCommandBridge } from './inputMappingCommandBridge';
import { createInputMappingRuntime, type InputMappingMouseMoveInput } from './inputMappingRuntime';
import { createLocalInputMappingProfileStore } from './inputMappingProfileStore';
import type { InputMappingProfile } from './inputMappingSchema';
import type { ResolvedInputMappingTouchCommand } from './inputMappingCommandBridge';

interface InputMappingRuntimeControllerOptions {
  getRouteQuery: () => Record<string, unknown>;
  getActiveTabKey: () => string;
  refreshStickerLayout: () => void;
  sendTouchCommand: (command: ResolvedInputMappingTouchCommand) => boolean;
  sendHidKeyCommand: (phase: 'down' | 'up', code: string) => boolean;
  sendHidMouseButtonCommand: (phase: 'down' | 'up', button: number) => boolean;
  sendHidMouseWheelCommand: (deltaY: number) => boolean;
  isPointerLocked: () => boolean;
}

type ReleaseReason = 'blur' | 'disconnect' | 'profile-change';

function readInputMappingSetting(key: string, fallback: string) {
  return (localStorage.getItem(key) || fallback).trim() || fallback;
}

function readInputMappingMouseSensitivity() {
  const value = Number(readInputMappingSetting(storageKeys.inputMapping.mouseSensitivity, '1'));
  return Number.isFinite(value) ? Math.min(5, Math.max(0.1, value)) : 1;
}

function matchesConfiguredInputKey(event: KeyboardEvent, configuredKey: string) {
  const key = configuredKey.trim().toLowerCase();
  if (!key) {
    return false;
  }

  const eventKey = event.key.toLowerCase();
  const eventCode = event.code.toLowerCase();
  if (key === eventKey || key === eventCode) {
    return true;
  }

  if (key === 'alt') {
    return event.code === 'AltLeft' || event.code === 'AltRight' || event.key === 'Alt';
  }

  if (key === '~' || key === '`') {
    return event.code === 'Backquote';
  }

  if (key === '-') {
    return event.code === 'Minus';
  }

  return false;
}

export function useInputMappingRuntimeController(options: InputMappingRuntimeControllerOptions) {
  const profileStore = createLocalInputMappingProfileStore();
  const runtime = createInputMappingRuntime(null);
  const commandBridge = createInputMappingCommandBridge({
    sendTouchCommand: (command) => options.sendTouchCommand(command),
    sendHidKeyCommand: (phase, code) => options.sendHidKeyCommand(phase, code),
    sendHidMouseButtonCommand: (phase, button) => options.sendHidMouseButtonCommand(phase, button),
    sendHidMouseWheelCommand: (deltaY) => options.sendHidMouseWheelCommand(deltaY)
  });

  const activeInputMappingProfileName = ref('');
  const activeInputMappingProfile = ref<InputMappingProfile | null>(null);
  const isInputMappingHintsVisible = ref(true);
  const isInputMappingPaused = ref(false);

  const executeCommands = (commands: ReturnType<typeof runtime.releaseAll>) => {
    if (commands.length === 0) {
      return {
        handled: false,
        sent: 0,
        failed: []
      };
    }

    const result = commandBridge.execute(commands);
    if (result.failed.length > 0) {
      console.warn('[InputMapping] Some commands failed to send.', result.failed);
    }
    return result;
  };

  const release = (reason: ReleaseReason) => {
    commandBridge.clearPendingCommands();
    executeCommands(runtime.releaseAll(reason));
  };

  const clearProfile = () => {
    release('profile-change');
    runtime.setProfile(null);
    activeInputMappingProfileName.value = '';
    activeInputMappingProfile.value = null;
    options.refreshStickerLayout();
  };

  const loadActiveProfile = async () => {
    try {
      const query = options.getRouteQuery();
      const queryProfileId = typeof query.inputMappingProfileId === 'string'
        ? query.inputMappingProfileId
        : '';
      const isEnabled = localStorage.getItem(storageKeys.inputMapping.enabled) === 'true' || !!queryProfileId;
      const profileId = queryProfileId || localStorage.getItem(storageKeys.inputMapping.activeProfileId) || '';

      if (!isEnabled || !profileId) {
        clearProfile();
        return false;
      }

      const profile = await profileStore.get(profileId);
      if (!profile) {
        clearProfile();
        return false;
      }

      executeCommands(runtime.setProfile(profile));
      activeInputMappingProfile.value = profile;
      activeInputMappingProfileName.value = profile.name;
      options.refreshStickerLayout();
      console.info('[InputMapping] Loaded active profile.', {
        profileId: profile.id,
        profileName: profile.name,
        tabKey: options.getActiveTabKey()
      });
      return true;
    } catch (error) {
      console.warn('[InputMapping] Failed to load active profile:', error);
      clearProfile();
      return false;
    }
  };

  const saveActiveProfile = async () => {
    if (!activeInputMappingProfile.value) {
      return;
    }

    await profileStore.save(activeInputMappingProfile.value);
    executeCommands(runtime.setProfile(activeInputMappingProfile.value));
    options.refreshStickerLayout();
  };

  const handleKeyboard = (phase: 'down' | 'up', event: KeyboardEvent) => {
    if (isInputMappingPaused.value) {
      return false;
    }

    const result = runtime.handleKeyboardEvent(phase, {
      code: event.code,
      repeat: event.repeat,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey
    });
    return executeCommands(result.commands).sent > 0;
  };

  const handleMouseButton = (phase: 'down' | 'up', event: MouseEvent) => {
    if (isInputMappingPaused.value) {
      return false;
    }

    const result = runtime.handleMouseButtonEvent(phase, {
      button: event.button
    });
    return executeCommands(result.commands).sent > 0;
  };

  const handleMouseMove = (event: MouseEvent) => {
    if (isInputMappingPaused.value) {
      return false;
    }

    const sensitivity = readInputMappingMouseSensitivity();
    const input: InputMappingMouseMoveInput = {
      movementX: event.movementX * sensitivity,
      movementY: event.movementY * sensitivity,
      pointerLocked: options.isPointerLocked(),
      pressedButtons: event.buttons
    };
    const result = runtime.handleMouseMove(input);
    return executeCommands(result.commands).sent > 0;
  };

  const handleMouseWheel = (event: WheelEvent) => {
    if (isInputMappingPaused.value) {
      return false;
    }

    const result = runtime.handleMouseWheel({
      deltaY: event.deltaY
    });
    return executeCommands(result.commands).sent > 0;
  };

  const hasMouseLook = () => (runtime.getCompiledProfile()?.mouseLookBinding ?? null) !== null;

  const isMouseCaptureToggleKey = (event: KeyboardEvent) => matchesConfiguredInputKey(
    event,
    readInputMappingSetting(storageKeys.inputMapping.mouseCaptureKey, 'Alt')
  );

  const isHintsToggleKey = (event: KeyboardEvent) => matchesConfiguredInputKey(
    event,
    readInputMappingSetting(storageKeys.inputMapping.toggleHintsKey, '~')
  );

  const isPauseToggleKey = (event: KeyboardEvent) => matchesConfiguredInputKey(
    event,
    readInputMappingSetting(storageKeys.inputMapping.pauseKey, '-')
  );

  const toggleHints = () => {
    isInputMappingHintsVisible.value = !isInputMappingHintsVisible.value;
  };

  const togglePaused = () => {
    isInputMappingPaused.value = !isInputMappingPaused.value;
    if (isInputMappingPaused.value) {
      release('blur');
    }
  };

  const clearPointerKeys = () => {
    commandBridge.clearPointerKeys();
  };

  return {
    profileStore,
    runtime,
    commandBridge,
    activeInputMappingProfileName,
    activeInputMappingProfile,
    isInputMappingHintsVisible,
    isInputMappingPaused,
    executeCommands,
    release,
    loadActiveProfile,
    saveActiveProfile,
    handleKeyboard,
    handleMouseButton,
    handleMouseMove,
    handleMouseWheel,
    hasMouseLook,
    isMouseCaptureToggleKey,
    isHintsToggleKey,
    isPauseToggleKey,
    toggleHints,
    togglePaused,
    clearPointerKeys
  };
}
