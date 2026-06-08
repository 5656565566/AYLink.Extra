import type { ResolvedInputMappingTouchCommand } from '../inputMapping/inputMappingCommandBridge';
import { clampNormalizedPoint } from '../inputMapping/inputMappingCoordinates';
import type { PointerRatiosCommand } from './useTouchPointerInput';
import type { VideoViewport } from './videoViewport';

interface InputMappingTouchBridgeOptions {
  getVideoViewport: () => VideoViewport | null;
  sendPointerRatiosCommand: (command: PointerRatiosCommand) => boolean;
}

export function createInputMappingTouchBridge(options: InputMappingTouchBridgeOptions) {
  return {
    sendTouchCommand(command: ResolvedInputMappingTouchCommand) {
      const viewport = options.getVideoViewport();
      if (!viewport) {
        return false;
      }

      const point = clampNormalizedPoint(command.point);
      return options.sendPointerRatiosCommand({
        phase: command.phase,
        pointerId: command.pointerId,
        ratios: {
          xRatio: point.x,
          yRatio: point.y,
          frameWidth: viewport.frameWidth,
          frameHeight: viewport.frameHeight
        },
        pressure: command.pressure,
        pointerType: 'touch',
        onFinalized: command.onFinalized
      });
    }
  };
}
