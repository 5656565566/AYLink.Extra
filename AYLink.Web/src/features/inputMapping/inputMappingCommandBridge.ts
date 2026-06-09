import type { InputMappingCommand } from './inputMappingCommands';
import type { NormalizedPoint } from './inputMappingSchema';

export interface ResolvedInputMappingTouchCommand {
  phase: 'down' | 'move' | 'up' | 'cancel';
  pointerId: number;
  pointerKey: string;
  point: NormalizedPoint;
  pressure?: number;
  onFinalized?: () => void;
}

export interface InputMappingCommandBridgeOptions {
  sendTouchCommand: (command: ResolvedInputMappingTouchCommand) => boolean;
  sendHidKeyCommand: (phase: 'down' | 'up', code: string) => boolean;
  sendHidMouseButtonCommand: (phase: 'down' | 'up', button: number) => boolean;
  sendHidMouseWheelCommand: (deltaY: number) => boolean;
  firstPointerId?: number;
}

export interface InputMappingCommandBridgeResult {
  handled: boolean;
  sent: number;
  failed: InputMappingCommand[];
}

export interface InputMappingCommandBridge {
  execute(commands: InputMappingCommand[]): InputMappingCommandBridgeResult;
  releasePointerKey(pointerKey: string): void;
  clearPointerKeys(): void;
  clearPendingCommands(): void;
  getPointerId(pointerKey: string): number | null;
  getPointerIds(): Map<string, number>;
}

export function createInputMappingCommandBridge(options: InputMappingCommandBridgeOptions): InputMappingCommandBridge {
  const pointerIds = new Map<string, number>();
  const pointerGenerations = new Map<string, number>();
  const pendingCommandHandles = new Set<number>();
  const repeatStates = new Map<string, {
    intervalHandle: number;
    upHandle: number | null;
    point: NormalizedPoint;
    isDown: boolean;
  }>();
  let nextPointerId = options.firstPointerId ?? 10_000;

  const getPointerGeneration = (pointerKey: string) => pointerGenerations.get(pointerKey) ?? 0;

  const bumpPointerGeneration = (pointerKey: string) => {
    pointerGenerations.set(pointerKey, getPointerGeneration(pointerKey) + 1);
  };

  const getOrCreatePointerId = (pointerKey: string) => {
    const existing = pointerIds.get(pointerKey);
    if (existing !== undefined) {
      return existing;
    }

    const pointerId = nextPointerId;
    nextPointerId += 1;
    pointerIds.set(pointerKey, pointerId);
    pointerGenerations.set(pointerKey, getPointerGeneration(pointerKey));
    return pointerId;
  };

  const releasePointerKeyInternal = (pointerKey: string, pointerId?: number) => {
    if (pointerId !== undefined && pointerIds.get(pointerKey) !== pointerId) {
      return;
    }

    pointerIds.delete(pointerKey);
  };

  const stopTouchRepeat = (pointerKey: string) => {
    const state = repeatStates.get(pointerKey);
    if (!state) {
      bumpPointerGeneration(pointerKey);
      releasePointerKeyInternal(pointerKey);
      return true;
    }

    window.clearInterval(state.intervalHandle);
    if (state.upHandle !== null) {
      window.clearTimeout(state.upHandle);
    }
    repeatStates.delete(pointerKey);
    bumpPointerGeneration(pointerKey);
    if (state.isDown) {
      executeNow({
        type: 'touch',
        phase: 'cancel',
        pointerKey,
        point: state.point,
        pressure: 0
      });
    } else {
      releasePointerKeyInternal(pointerKey);
    }
    return true;
  };

  const startTouchRepeat = (command: Extract<InputMappingCommand, { type: 'touchRepeat' }>) => {
    stopTouchRepeat(command.pointerKey);
    const state = {
      intervalHandle: 0,
      upHandle: null as number | null,
      point: command.point,
      isDown: false
    };

    const tapOnce = () => {
      if (state.isDown) {
        return;
      }
      state.isDown = true;
      executeNow({
        type: 'touch',
        phase: 'down',
        pointerKey: command.pointerKey,
        point: command.point,
        pressure: 1
      });
      state.upHandle = window.setTimeout(() => {
        state.upHandle = null;
        state.isDown = false;
        executeNow({
          type: 'touch',
          phase: 'up',
          pointerKey: command.pointerKey,
          point: command.point,
          pressure: 0
        });
      }, command.downMs);
    };

    tapOnce();
    state.intervalHandle = window.setInterval(tapOnce, command.intervalMs);
    repeatStates.set(command.pointerKey, state);
    return true;
  };

  const executeNow = (command: InputMappingCommand) => {
    switch (command.type) {
      case 'touch': {
        const pointerId = getOrCreatePointerId(command.pointerKey);
        const sent = options.sendTouchCommand({
          phase: command.phase,
          pointerId,
          pointerKey: command.pointerKey,
          point: command.point,
          pressure: command.pressure,
          onFinalized: command.phase === 'up' || command.phase === 'cancel'
            ? () => releasePointerKeyInternal(command.pointerKey, pointerId)
            : undefined
        });
        return sent;
      }
      case 'hidKey':
        return options.sendHidKeyCommand(command.phase, command.code);
      case 'hidMouseButton':
        return options.sendHidMouseButtonCommand(command.phase, command.button);
      case 'hidMouseWheel':
        return options.sendHidMouseWheelCommand(command.deltaY);
      case 'touchRepeat':
        return startTouchRepeat(command);
      case 'stopTouchRepeat':
        return stopTouchRepeat(command.pointerKey);
      default:
        return false;
    }
  };

  const executeOne = (command: InputMappingCommand) => {
    if (command.type !== 'touch' || !command.delayMs || command.delayMs <= 0) {
      return executeNow(command);
    }

    const pointerGeneration = getPointerGeneration(command.pointerKey);
    const handle = window.setTimeout(() => {
      pendingCommandHandles.delete(handle);
      if (getPointerGeneration(command.pointerKey) !== pointerGeneration) {
        return;
      }
      executeNow({
        ...command,
        delayMs: undefined
      });
    }, command.delayMs);
    pendingCommandHandles.add(handle);
    return true;
  };

  const clearPendingCommands = () => {
    for (const handle of pendingCommandHandles) {
      window.clearTimeout(handle);
    }
    pendingCommandHandles.clear();
    for (const pointerKey of [...repeatStates.keys()]) {
      stopTouchRepeat(pointerKey);
    }
  };

  return {
    execute(commands) {
      let sent = 0;
      const failed: InputMappingCommand[] = [];

      for (const command of commands) {
        if (executeOne(command)) {
          sent += 1;
        } else {
          failed.push(command);
        }
      }

      return {
        handled: commands.length > 0,
        sent,
        failed
      };
    },

    clearPointerKeys() {
      clearPendingCommands();
      pointerIds.clear();
      pointerGenerations.clear();
    },

    clearPendingCommands,

    releasePointerKey(pointerKey) {
      bumpPointerGeneration(pointerKey);
      releasePointerKeyInternal(pointerKey);
    },

    getPointerId(pointerKey) {
      return pointerIds.get(pointerKey) ?? null;
    },

    getPointerIds() {
      return new Map(pointerIds);
    }
  };
}
