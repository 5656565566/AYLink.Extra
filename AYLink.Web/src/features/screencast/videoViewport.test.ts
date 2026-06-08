import { describe, expect, it } from 'vitest';
import { getPointerRatios, getVideoViewport } from './videoViewport';

function createVideoSource(options: {
  left: number;
  top: number;
  width: number;
  height: number;
  videoWidth: number;
  videoHeight: number;
}) {
  return {
    videoWidth: options.videoWidth,
    videoHeight: options.videoHeight,
    getBoundingClientRect: () => ({
      left: options.left,
      top: options.top,
      width: options.width,
      height: options.height,
      right: options.left + options.width,
      bottom: options.top + options.height,
      x: options.left,
      y: options.top,
      toJSON: () => ({})
    } as DOMRect)
  };
}

describe('videoViewport', () => {
  it('uses the full element rect in fill mode', () => {
    const viewport = getVideoViewport(createVideoSource({
      left: 10,
      top: 20,
      width: 1000,
      height: 500,
      videoWidth: 1920,
      videoHeight: 1080
    }), true);

    expect(viewport).toEqual({
      offsetX: 10,
      offsetY: 20,
      displayWidth: 1000,
      displayHeight: 500,
      frameWidth: 1920,
      frameHeight: 1080
    });
  });

  it('accounts for letterboxing in contain mode', () => {
    const viewport = getVideoViewport(createVideoSource({
      left: 10,
      top: 20,
      width: 1000,
      height: 500,
      videoWidth: 1000,
      videoHeight: 1000
    }), false);

    expect(viewport).toEqual({
      offsetX: 260,
      offsetY: 20,
      displayWidth: 500,
      displayHeight: 500,
      frameWidth: 1000,
      frameHeight: 1000
    });
  });

  it('falls back to element dimensions before the video metadata is known', () => {
    const viewport = getVideoViewport(createVideoSource({
      left: 0,
      top: 0,
      width: 320,
      height: 240,
      videoWidth: 0,
      videoHeight: 0
    }), false);

    expect(viewport?.frameWidth).toBe(320);
    expect(viewport?.frameHeight).toBe(240);
  });

  it('returns clamped pointer ratios in frame coordinates', () => {
    const viewport = {
      offsetX: 100,
      offsetY: 50,
      displayWidth: 400,
      displayHeight: 200,
      frameWidth: 1920,
      frameHeight: 1080
    };

    expect(getPointerRatios({ clientX: 300, clientY: 150 }, viewport)).toEqual({
      xRatio: 0.5,
      yRatio: 0.5,
      frameWidth: 1920,
      frameHeight: 1080
    });
    expect(getPointerRatios({ clientX: 0, clientY: 400 }, viewport)?.xRatio).toBe(0);
    expect(getPointerRatios({ clientX: 0, clientY: 400 }, viewport)?.yRatio).toBe(1);
  });
});
