export interface VideoViewport {
  offsetX: number;
  offsetY: number;
  displayWidth: number;
  displayHeight: number;
  frameWidth: number;
  frameHeight: number;
}

export interface PointerRatios {
  xRatio: number;
  yRatio: number;
  frameWidth: number;
  frameHeight: number;
}

interface VideoViewportSource {
  getBoundingClientRect: () => DOMRect;
  videoWidth?: number;
  videoHeight?: number;
  naturalWidth?: number;
  naturalHeight?: number;
}

interface ClientPoint {
  clientX: number;
  clientY: number;
}

export const getVideoViewport = (videoElement: VideoViewportSource | null, fillMode: boolean): VideoViewport | null => {
  if (!videoElement) return null;

  const rect = videoElement.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;

  const videoWidth = videoElement.videoWidth || videoElement.naturalWidth || rect.width;
  const videoHeight = videoElement.videoHeight || videoElement.naturalHeight || rect.height;
  if (videoWidth <= 0 || videoHeight <= 0) return null;

  if (fillMode) {
    return {
      offsetX: rect.left,
      offsetY: rect.top,
      displayWidth: rect.width,
      displayHeight: rect.height,
      frameWidth: Math.round(videoWidth),
      frameHeight: Math.round(videoHeight)
    };
  }

  const scale = Math.min(rect.width / videoWidth, rect.height / videoHeight);
  const displayWidth = videoWidth * scale;
  const displayHeight = videoHeight * scale;
  const offsetX = rect.left + (rect.width - displayWidth) / 2;
  const offsetY = rect.top + (rect.height - displayHeight) / 2;

  return {
    offsetX,
    offsetY,
    displayWidth,
    displayHeight,
    frameWidth: Math.round(videoWidth),
    frameHeight: Math.round(videoHeight)
  };
};

export const getPointerRatios = (point: ClientPoint, viewport: VideoViewport | null): PointerRatios | null => {
  if (!viewport) return null;

  const xRatio = (point.clientX - viewport.offsetX) / viewport.displayWidth;
  const yRatio = (point.clientY - viewport.offsetY) / viewport.displayHeight;
  return {
    xRatio: Math.min(1, Math.max(0, xRatio)),
    yRatio: Math.min(1, Math.max(0, yRatio)),
    frameWidth: viewport.frameWidth,
    frameHeight: viewport.frameHeight
  };
};
