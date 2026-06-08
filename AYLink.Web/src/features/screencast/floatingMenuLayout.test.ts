import { describe, expect, it } from 'vitest';
import {
  clampCollapsedMenuPosition,
  getCollapsedMenuPositionRange,
  getDockedMenuPosition,
  getMenuExpandDirection,
  getMenuFrame,
  isMenuFrameInsideStage,
  shouldUseHorizontalMenuLayout,
  type MenuLayoutOptions,
  type StageBounds
} from './floatingMenuLayout';

const bounds: StageBounds = {
  width: 1000,
  height: 600,
  offsetLeft: 10,
  offsetTop: 20
};

const options: MenuLayoutOptions = {
  margin: 20,
  buttonSize: 48,
  expandedLength: 600,
  expandDirectionSwitchRatio: 0.75
};

const compactOptions: MenuLayoutOptions = {
  ...options,
  expandedLength: 300
};

describe('floatingMenuLayout', () => {
  it('calculates collapsed movement bounds inside the stage', () => {
    expect(getCollapsedMenuPositionRange(bounds, options)).toEqual({
      minX: 30,
      maxX: 942,
      minY: 40,
      maxY: 552
    });

    expect(clampCollapsedMenuPosition(-100, 1000, bounds, options)).toEqual({
      x: 30,
      y: 552
    });
  });

  it('keeps the toggle button anchor stable for a horizontal left expansion', () => {
    const frame = getMenuFrame(900, 520, true, bounds, options);

    expect(frame.horizontal).toBe(true);
    expect(frame.direction).toBe('left');
    expect(frame.x).toBe(348);
    expect(frame.y).toBe(520);
    expect(frame.width).toBe(600);
  });

  it('detects expanded frames that do not fully fit inside the stage', () => {
    expect(isMenuFrameInsideStage(getMenuFrame(900, 520, true, bounds, options), bounds, options)).toBe(true);
    expect(isMenuFrameInsideStage(getMenuFrame(450, 520, true, bounds, options), bounds, options)).toBe(false);
  });

  it('uses vertical layout when the expanded menu fits below the anchor', () => {
    const frame = getMenuFrame(40, 60, true, bounds, compactOptions);

    expect(frame.horizontal).toBe(false);
    expect(frame.direction).toBe('right');
    expect(frame.x).toBe(40);
    expect(frame.y).toBe(60);
    expect(frame.height).toBe(300);
  });

  it('chooses horizontal direction from available space around the anchor', () => {
    expect(getMenuExpandDirection(40, false, bounds, options)).toBe('right');
    expect(getMenuExpandDirection(900, false, bounds, options)).toBe('left');
    expect(getMenuExpandDirection(40, true, bounds, options)).toBe('right');
    expect(getMenuExpandDirection(900, true, bounds, options)).toBe('left');
  });

  it('uses a horizontal layout only when vertical expansion would overflow', () => {
    expect(shouldUseHorizontalMenuLayout(60, true, bounds, compactOptions)).toBe(false);
    expect(shouldUseHorizontalMenuLayout(520, true, bounds, options)).toBe(true);
    expect(shouldUseHorizontalMenuLayout(520, false, bounds, options)).toBe(false);
  });

  it('calculates docked menu positions for either edge from the collapsed anchor range', () => {
    expect(getDockedMenuPosition('left', 999, bounds, options)).toEqual({
      x: 30,
      y: 552
    });
    expect(getDockedMenuPosition('right', 40, bounds, options)).toEqual({
      x: 942,
      y: 40
    });
  });
});
