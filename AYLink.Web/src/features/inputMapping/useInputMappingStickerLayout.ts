import type { Ref } from 'vue';
import type { VideoViewport } from '../screencast/videoViewport';
import type { InputMappingAction, NormalizedPoint } from './inputMappingSchema';
import type { InputMappingStickerItem } from './inputMappingStickers';

type SwipeAction = Extract<InputMappingAction, { type: 'swipe' }>;

export function useInputMappingStickerLayout(options: {
  layoutRevision: Ref<number>;
  selectedSticker: Ref<InputMappingStickerItem | null>;
  contextMenu: Ref<{ x: number; y: number }>;
  videoContainer: Ref<HTMLDivElement | null>;
  selectedSwipeAction: Ref<SwipeAction | null>;
  isSelectedSwipeDrawing: Ref<boolean>;
  swipeRecordingPath: Ref<NormalizedPoint[]>;
  getVideoViewport: () => VideoViewport | null;
}) {
  const refreshInputMappingStickerLayout = () => {
    options.layoutRevision.value += 1;
  };

  const getInputMappingStickerStyle = (sticker: InputMappingStickerItem) => {
    void options.layoutRevision.value;

    const viewport = options.getVideoViewport();
    if (!viewport || viewport.displayWidth <= 0 || viewport.displayHeight <= 0) {
      return {
        display: 'none'
      };
    }
    const stageRect = options.videoContainer.value?.getBoundingClientRect();
    const originX = stageRect?.left ?? 0;
    const originY = stageRect?.top ?? 0;

    return {
      left: `${viewport.offsetX - originX + viewport.displayWidth * sticker.point.x}px`,
      top: `${viewport.offsetY - originY + viewport.displayHeight * sticker.point.y}px`,
      opacity: `${sticker.opacity}`,
      '--joystick-size': sticker.radius ? `${Math.round((sticker.radius / 0.08) * 76)}px` : undefined,
      '--aim-area-width': sticker.width ? `${Math.round(viewport.displayWidth * sticker.width)}px` : undefined,
      '--aim-area-height': sticker.height ? `${Math.round(viewport.displayHeight * sticker.height)}px` : undefined
    };
  };

  const getInputMappingConfigPanelStyle = () => {
    void options.layoutRevision.value;

    const sticker = options.selectedSticker.value;
    const viewport = options.getVideoViewport();
    const stageRect = options.videoContainer.value?.getBoundingClientRect();
    if (!sticker || !viewport || !stageRect) {
      return {
        display: 'none'
      };
    }

    const left = viewport.offsetX - stageRect.left + viewport.displayWidth * sticker.point.x;
    const top = viewport.offsetY - stageRect.top + viewport.displayHeight * sticker.point.y;
    const panelOffsetX = left > stageRect.width - 320 ? -286 : 48;
    const panelOffsetY = top > stageRect.height - 240 ? -172 : -42;
    return {
      left: `${left + panelOffsetX}px`,
      top: `${top + panelOffsetY}px`
    };
  };

  const getInputMappingPaletteStyle = () => {
    void options.layoutRevision.value;

    const stageRect = options.videoContainer.value?.getBoundingClientRect();
    if (!stageRect) {
      return {
        display: 'none'
      };
    }

    const paletteWidth = 246;
    const paletteHeight = Math.min(360, Math.max(0, stageRect.height - 32));
    const margin = 8;
    const maxX = Math.max(margin, stageRect.width - paletteWidth - margin);
    const maxY = Math.max(margin, stageRect.height - paletteHeight - margin);
    return {
      left: `${Math.min(maxX, Math.max(margin, options.contextMenu.value.x))}px`,
      top: `${Math.min(maxY, Math.max(margin, options.contextMenu.value.y))}px`
    };
  };

  const getInputMappingPointFromClient = (clientX: number, clientY: number) => {
    const viewport = options.getVideoViewport();
    if (!viewport || viewport.displayWidth <= 0 || viewport.displayHeight <= 0) {
      return null;
    }

    return {
      x: Math.min(1, Math.max(0, (clientX - viewport.offsetX) / viewport.displayWidth)),
      y: Math.min(1, Math.max(0, (clientY - viewport.offsetY) / viewport.displayHeight))
    };
  };

  const getInputMappingSwipePathPoints = () => {
    const action = options.selectedSwipeAction.value;
    if (!action) {
      return [];
    }

    if (options.isSelectedSwipeDrawing.value && options.swipeRecordingPath.value.length > 0) {
      return options.swipeRecordingPath.value;
    }

    return action.path && action.path.length >= 2 ? action.path : [];
  };

  const getInputMappingSwipePathPolyline = () => {
    void options.layoutRevision.value;

    const viewport = options.getVideoViewport();
    const stageRect = options.videoContainer.value?.getBoundingClientRect();
    const points = getInputMappingSwipePathPoints();
    if (!viewport || !stageRect || points.length < 2) {
      return '';
    }

    return points.map((point) => {
      const x = viewport.offsetX - stageRect.left + viewport.displayWidth * point.x;
      const y = viewport.offsetY - stageRect.top + viewport.displayHeight * point.y;
      return `${Math.round(x)},${Math.round(y)}`;
    }).join(' ');
  };

  return {
    refreshInputMappingStickerLayout,
    getInputMappingStickerStyle,
    getInputMappingConfigPanelStyle,
    getInputMappingPaletteStyle,
    getInputMappingPointFromClient,
    getInputMappingSwipePathPoints,
    getInputMappingSwipePathPolyline
  };
}
