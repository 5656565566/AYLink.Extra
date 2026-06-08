export type MenuExpandDirection = 'left' | 'right';

export type DockedMenuEdge = 'left' | 'right';

export interface StageBounds {
  width: number;
  height: number;
  offsetLeft: number;
  offsetTop: number;
}

export interface MenuLayoutOptions {
  margin: number;
  buttonSize: number;
  expandedLength: number;
  expandDirectionSwitchRatio: number;
}

export interface MenuFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  horizontal: boolean;
  direction: MenuExpandDirection;
}

export interface MenuPositionRange {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export const clampValue = (value: number, min: number, max: number) => Math.min(Math.max(min, value), max);

export const getCollapsedMenuPositionRange = (
  bounds: StageBounds,
  options: MenuLayoutOptions
): MenuPositionRange => {
  const minX = bounds.offsetLeft + options.margin;
  const maxX = Math.max(minX, bounds.offsetLeft + bounds.width - options.buttonSize - options.margin);
  const minY = bounds.offsetTop + options.margin;
  const maxY = Math.max(minY, bounds.offsetTop + bounds.height - options.buttonSize - options.margin);
  return { minX, maxX, minY, maxY };
};

export const clampCollapsedMenuPosition = (
  x: number,
  y: number,
  bounds: StageBounds,
  options: MenuLayoutOptions
) => {
  const range = getCollapsedMenuPositionRange(bounds, options);
  return {
    x: clampValue(x, range.minX, range.maxX),
    y: clampValue(y, range.minY, range.maxY)
  };
};

export const shouldUseHorizontalMenuLayout = (
  anchorY: number,
  expanded: boolean,
  bounds: StageBounds,
  options: MenuLayoutOptions
) => {
  if (!expanded) {
    return false;
  }

  const stageBottom = bounds.offsetTop + bounds.height - options.margin;
  return anchorY + options.expandedLength > stageBottom;
};

export const getMenuExpandDirection = (
  anchorX: number,
  horizontal: boolean,
  bounds: StageBounds,
  options: MenuLayoutOptions
): MenuExpandDirection => {
  const centerX = anchorX + (options.buttonSize / 2);
  const centerRatio = bounds.width <= 0 ? 0.5 : (centerX - bounds.offsetLeft) / bounds.width;
  if (!horizontal) {
    return centerRatio <= 0.5 ? 'right' : 'left';
  }

  const extraWidth = Math.max(0, options.expandedLength - options.buttonSize);
  const availableLeft = anchorX - bounds.offsetLeft - options.margin;
  const availableRight = bounds.offsetLeft + bounds.width - (anchorX + options.buttonSize) - options.margin;
  const leftEnough = availableLeft >= extraWidth;
  const rightEnough = availableRight >= extraWidth;

  if (leftEnough && !rightEnough) {
    return 'left';
  }

  if (rightEnough && !leftEnough) {
    return 'right';
  }

  if (centerRatio <= (1 - options.expandDirectionSwitchRatio)) {
    return 'right';
  }

  return 'left';
};

export const getMenuFrame = (
  anchorX: number,
  anchorY: number,
  expanded: boolean,
  bounds: StageBounds,
  options: MenuLayoutOptions
): MenuFrame => {
  const horizontal = shouldUseHorizontalMenuLayout(anchorY, expanded, bounds, options);
  const direction = getMenuExpandDirection(anchorX, horizontal, bounds, options);
  const width = horizontal && expanded ? options.expandedLength : options.buttonSize;
  const height = horizontal ? options.buttonSize : (expanded ? options.expandedLength : options.buttonSize);

  return {
    x: horizontal && direction === 'left' ? anchorX - (width - options.buttonSize) : anchorX,
    y: anchorY,
    width,
    height,
    horizontal,
    direction
  };
};

export const isMenuFrameInsideStage = (
  frame: MenuFrame,
  bounds: StageBounds,
  options: MenuLayoutOptions
) => {
  const minX = bounds.offsetLeft + options.margin;
  const maxX = bounds.offsetLeft + bounds.width - options.margin;
  const minY = bounds.offsetTop + options.margin;
  const maxY = bounds.offsetTop + bounds.height - options.margin;

  return frame.x >= minX
    && frame.y >= minY
    && frame.x + frame.width <= maxX
    && frame.y + frame.height <= maxY;
};

export const getDockedMenuPosition = (
  edge: DockedMenuEdge,
  y: number,
  bounds: StageBounds,
  options: MenuLayoutOptions
) => {
  const range = getCollapsedMenuPositionRange(bounds, options);
  return {
    x: edge === 'left' ? range.minX : range.maxX,
    y: clampValue(y, range.minY, range.maxY)
  };
};
