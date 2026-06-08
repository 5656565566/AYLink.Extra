import type { NormalizedPoint } from './inputMappingSchema';

export function clampNormalizedValue(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function clampNormalizedPoint(point: NormalizedPoint): NormalizedPoint {
  return {
    x: clampNormalizedValue(point.x),
    y: clampNormalizedValue(point.y)
  };
}

export function addNormalizedPoints(a: NormalizedPoint, b: NormalizedPoint): NormalizedPoint {
  return {
    x: a.x + b.x,
    y: a.y + b.y
  };
}

export function scaleNormalizedPoint(point: NormalizedPoint, scale: number): NormalizedPoint {
  return {
    x: point.x * scale,
    y: point.y * scale
  };
}

export function normalizeDirection(direction: NormalizedPoint): NormalizedPoint {
  const length = Math.hypot(direction.x, direction.y);
  if (length <= 0) {
    return { x: 0, y: 0 };
  }

  return {
    x: direction.x / length,
    y: direction.y / length
  };
}

export function resolveVirtualJoystickPoint(center: NormalizedPoint, radius: number, direction: NormalizedPoint): NormalizedPoint {
  const normalizedDirection = normalizeDirection(direction);
  return clampNormalizedPoint({
    x: center.x + normalizedDirection.x * radius,
    y: center.y + normalizedDirection.y * radius
  });
}
