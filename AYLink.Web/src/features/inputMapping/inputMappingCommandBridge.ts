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
