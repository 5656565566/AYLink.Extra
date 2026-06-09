import type { NormalizedPoint } from './inputMappingSchema';

export type InputMappingCommand =
  | {
    type: 'touch';
    phase: 'down' | 'move' | 'up' | 'cancel';
    pointerKey: string;
    point: NormalizedPoint;
    pressure?: number;
    delayMs?: number;
  }
  | {
    type: 'touchRepeat';
    pointerKey: string;
    point: NormalizedPoint;
    intervalMs: number;
    downMs: number;
  }
  | {
    type: 'stopTouchRepeat';
    pointerKey: string;
  }
  | {
    type: 'hidKey';
    phase: 'down' | 'up';
    code: string;
  }
  | {
    type: 'hidMouseButton';
    phase: 'down' | 'up';
    button: number;
  }
  | {
    type: 'hidMouseWheel';
    deltaY: number;
  };

export interface InputMappingRuntimeResult {
  handled: boolean;
  commands: InputMappingCommand[];
}

export function createInputMappingResult(commands: InputMappingCommand[] = []): InputMappingRuntimeResult {
  return {
    handled: commands.length > 0,
    commands
  };
}
