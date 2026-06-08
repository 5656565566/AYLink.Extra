import { describe, expect, it, vi } from 'vitest';
import { createInputMappingTouchBridge } from './inputMappingTouchBridge';

describe('inputMappingTouchBridge', () => {
  it('converts input mapping touch commands into pointer ratio commands', () => {
    const sendPointerRatiosCommand = vi.fn(() => true);
    const bridge = createInputMappingTouchBridge({
      getVideoViewport: () => ({
        offsetX: 0,
        offsetY: 0,
        displayWidth: 1200,
        displayHeight: 800,
        frameWidth: 2400,
        frameHeight: 1080
      }),
      sendPointerRatiosCommand
    });

    expect(bridge.sendTouchCommand({
      phase: 'down',
      pointerId: 123,
      pointerKey: 'binding:fire',
      point: { x: 0.25, y: 0.5 },
      pressure: 1
    })).toBe(true);

    expect(sendPointerRatiosCommand).toHaveBeenCalledWith({
      phase: 'down',
      pointerId: 123,
      ratios: {
        xRatio: 0.25,
        yRatio: 0.5,
        frameWidth: 2400,
        frameHeight: 1080
      },
      pressure: 1,
      pointerType: 'touch'
    });
  });

  it('fails when the current video viewport is unavailable', () => {
    const bridge = createInputMappingTouchBridge({
      getVideoViewport: () => null,
      sendPointerRatiosCommand: vi.fn(() => true)
    });

    expect(bridge.sendTouchCommand({
      phase: 'down',
      pointerId: 1,
      pointerKey: 'binding:fire',
      point: { x: 0.25, y: 0.5 }
    })).toBe(false);
  });
});
