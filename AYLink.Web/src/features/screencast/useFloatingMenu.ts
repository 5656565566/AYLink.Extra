import { computed, nextTick, ref } from 'vue';
import {
  clampCollapsedMenuPosition,
  getCollapsedMenuPositionRange,
  getDockedMenuPosition,
  getMenuFrame,
  isMenuFrameInsideStage,
  type DockedMenuEdge,
  type MenuLayoutOptions,
  type StageBounds
} from './floatingMenuLayout';

export type DockedEdge = DockedMenuEdge;

interface PersistedFloatingMenuPlacement {
  isDocked?: boolean;
  isExpanded?: boolean;
  dockedEdge?: DockedEdge;
  relativeRight?: number;
  relativeTop?: number;
}

interface FloatingMenuOptions {
  storageKey: string;
  layout: MenuLayoutOptions;
  dragThresholdPx: number;
  dockSnapDistancePx: number;
  getStageBounds: () => StageBounds;
}

interface MenuDragStartState {
  isDocked: boolean;
  isExpanded: boolean;
  dockedEdge: DockedEdge;
  x: number;
  y: number;
  relativeX: number;
  relativeY: number;
}

interface SetMenuPositionOptions {
  syncRelative?: boolean;
  persist?: boolean;
  collapseOverflow?: boolean;
}

export function useFloatingMenu(options: FloatingMenuOptions) {
  const isMenuExpanded = ref(true);
  const isDocked = ref(true);
  const isMenuDragActive = ref(false);
  const dockedEdge = ref<DockedEdge>('right');
  const menuX = ref(0);
  const menuY = ref(0);
  const menuRelativeX = ref(0);
  const menuRelativeY = ref(0.5);

  let dragStartOffset = { x: 0, y: 0 };
  let dragStartPoint = { x: 0, y: 0 };
  let isDraggingMenu = false;
  let didDragMenu = false;
  let menuDragStartState: MenuDragStartState | null = null;

  const menuFrame = computed(() =>
    getMenuFrame(menuX.value, menuY.value, isMenuExpanded.value, options.getStageBounds(), options.layout)
  );

  const isHorizontalLayout = computed(() => menuFrame.value.horizontal);

  const menuStyle = computed(() => ({
    left: `${menuFrame.value.x}px`,
    top: `${menuFrame.value.y}px`
  }));

  const getCollapsedMenuRange = () =>
    getCollapsedMenuPositionRange(options.getStageBounds(), options.layout);

  const clampCollapsedPosition = (x: number, y: number) =>
    clampCollapsedMenuPosition(x, y, options.getStageBounds(), options.layout);

  const updateMenuRelativePosition = () => {
    const clamped = clampCollapsedPosition(menuX.value, menuY.value);
    const range = getCollapsedMenuRange();

    menuRelativeX.value = range.maxX <= range.minX ? 0 : (range.maxX - clamped.x) / (range.maxX - range.minX);
    menuRelativeY.value = range.maxY <= range.minY ? 0 : (clamped.y - range.minY) / (range.maxY - range.minY);
  };

  const persistMenuPlacement = () => {
    try {
      const placement: PersistedFloatingMenuPlacement = {
        isDocked: isDocked.value,
        isExpanded: isMenuExpanded.value,
        dockedEdge: dockedEdge.value,
        relativeRight: menuRelativeX.value,
        relativeTop: menuRelativeY.value
      };
      localStorage.setItem(options.storageKey, JSON.stringify(placement));
    } catch {
      // ignore local persistence failures
    }
  };

  const syncFloatingMenuSideFromAnchor = () => {
    const direction = getMenuFrame(menuX.value, menuY.value, isMenuExpanded.value, options.getStageBounds(), options.layout).direction;
    dockedEdge.value = direction === 'left' ? 'right' : 'left';
  };

  const setMenuPosition = (x: number, y: number, positionOptions: SetMenuPositionOptions = {}) => {
    const {
      syncRelative = true,
      persist = true,
      collapseOverflow = true
    } = positionOptions;
    const clamped = clampCollapsedPosition(x, y);
    menuX.value = clamped.x;
    menuY.value = clamped.y;
    if (!isDocked.value) {
      syncFloatingMenuSideFromAnchor();
    }
    if (syncRelative) {
      updateMenuRelativePosition();
    }
    if (collapseOverflow) {
      collapseMenuIfExpandedFrameOverflows();
    }
    if (persist) {
      persistMenuPlacement();
    }
  };

  const restoreMenuPositionFromRelative = (persist = true) => {
    const range = getCollapsedMenuRange();

    setMenuPosition(
      range.maxX - (range.maxX - range.minX) * menuRelativeX.value,
      range.minY + (range.maxY - range.minY) * menuRelativeY.value,
      { syncRelative: false, persist }
    );
  };

  const loadPersistedMenuPlacement = () => {
    try {
      const raw = localStorage.getItem(options.storageKey);
      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw) as PersistedFloatingMenuPlacement | null;
      if (!parsed || typeof parsed !== 'object') {
        return;
      }

      if (typeof parsed.relativeRight === 'number' && Number.isFinite(parsed.relativeRight)) {
        menuRelativeX.value = Math.min(Math.max(parsed.relativeRight, 0), 1);
      }

      if (typeof parsed.relativeTop === 'number' && Number.isFinite(parsed.relativeTop)) {
        menuRelativeY.value = Math.min(Math.max(parsed.relativeTop, 0), 1);
      }

      if (parsed.dockedEdge === 'left' || parsed.dockedEdge === 'right') {
        dockedEdge.value = parsed.dockedEdge;
      }

      if (typeof parsed.isDocked === 'boolean') {
        isDocked.value = parsed.isDocked;
      }

      if (typeof parsed.isExpanded === 'boolean') {
        isMenuExpanded.value = parsed.isExpanded;
      }
    } catch {
      // ignore local persistence failures
    }
  };

  const collapseMenuIfExpandedFrameOverflows = () => {
    if (!isMenuExpanded.value) {
      return;
    }

    const bounds = options.getStageBounds();
    const frame = getMenuFrame(menuX.value, menuY.value, true, bounds, options.layout);
    if (!isMenuFrameInsideStage(frame, bounds, options.layout)) {
      isMenuExpanded.value = false;
    }
  };

  const ensureMenuInsideStage = () => {
    if (isDocked.value) {
      const position = getDockedPosition(dockedEdge.value);
      menuX.value = position.x;
      menuY.value = position.y;
    } else {
      const clamped = clampCollapsedPosition(menuX.value, menuY.value);
      menuX.value = clamped.x;
      menuY.value = clamped.y;
    }

    if (isMenuExpanded.value) {
      const bounds = options.getStageBounds();
      const minX = bounds.offsetLeft + options.layout.margin;
      const maxX = bounds.offsetLeft + bounds.width - options.layout.margin;
      const minY = bounds.offsetTop + options.layout.margin;
      const maxY = bounds.offsetTop + bounds.height - options.layout.margin;

      for (let index = 0; index < 3; index += 1) {
        const frame = getMenuFrame(menuX.value, menuY.value, true, bounds, options.layout);
        if (isMenuFrameInsideStage(frame, bounds, options.layout)) {
          break;
        }

        if (frame.width > maxX - minX || frame.height > maxY - minY) {
          isMenuExpanded.value = false;
          break;
        }

        let nextX = menuX.value;
        let nextY = menuY.value;
        if (frame.x < minX) {
          nextX += minX - frame.x;
        } else if (frame.x + frame.width > maxX) {
          nextX -= frame.x + frame.width - maxX;
        }

        if (frame.y < minY) {
          nextY += minY - frame.y;
        } else if (frame.y + frame.height > maxY) {
          nextY -= frame.y + frame.height - maxY;
        }

        const clamped = clampCollapsedPosition(nextX, nextY);
        if (clamped.x === menuX.value && clamped.y === menuY.value) {
          isMenuExpanded.value = false;
          break;
        }

        menuX.value = clamped.x;
        menuY.value = clamped.y;
      }
    }

    if (!isDocked.value) {
      syncFloatingMenuSideFromAnchor();
    }
    updateMenuRelativePosition();
    persistMenuPlacement();
  };

  const setFloatingMenuState = () => {
    isDocked.value = false;
  };

  const setDockedMenuState = (edge: DockedEdge) => {
    isDocked.value = true;
    dockedEdge.value = edge;
  };

  const getDockedPosition = (edge: DockedEdge) =>
    getDockedMenuPosition(edge, menuY.value, options.getStageBounds(), options.layout);

  const applyDockPosition = (edge: DockedEdge, collapseExpanded = false, persist = true) => {
    setDockedMenuState(edge);
    if (collapseExpanded) {
      isMenuExpanded.value = false;
    }
    const position = getDockedPosition(edge);
    setMenuPosition(position.x, position.y, { persist });
  };

  const initializeMenuPosition = () => {
    if (isDocked.value) {
      applyDockPosition(dockedEdge.value, false, false);
    } else {
      restoreMenuPositionFromRelative(false);
    }
    ensureMenuInsideStage();
  };

  const resolveDockEdge = () => {
    const collapsedRange = getCollapsedMenuRange();
    const distances = [
      { edge: 'left' as DockedEdge, value: Math.abs(menuX.value - collapsedRange.minX) },
      { edge: 'right' as DockedEdge, value: Math.abs(menuX.value - collapsedRange.maxX) }
    ].sort((a, b) => a.value - b.value);

    const nearest = distances[0];
    if (nearest.value <= options.dockSnapDistancePx) {
      applyDockPosition(nearest.edge, true, false);
    } else {
      setFloatingMenuState();
      syncFloatingMenuSideFromAnchor();
      setMenuPosition(menuX.value, menuY.value, { persist: false });
    }
    persistMenuPlacement();
  };

  const handleMenuPointerEnter = () => {
    if (isDocked.value && !isMenuExpanded.value) {
      applyDockPosition(dockedEdge.value, false, false);
    }
  };

  const handleMenuPointerLeave = () => {
    if (!isDraggingMenu && isDocked.value && !isMenuExpanded.value) {
      applyDockPosition(dockedEdge.value, false, false);
    }
  };

  const restoreMenuDragStartState = () => {
    if (!menuDragStartState) {
      return;
    }

    isDocked.value = menuDragStartState.isDocked;
    isMenuExpanded.value = menuDragStartState.isExpanded;
    dockedEdge.value = menuDragStartState.dockedEdge;
    menuX.value = menuDragStartState.x;
    menuY.value = menuDragStartState.y;
    menuRelativeX.value = menuDragStartState.relativeX;
    menuRelativeY.value = menuDragStartState.relativeY;
  };

  const finishMenuDrag = () => {
    if (!isDraggingMenu) return;
    isDraggingMenu = false;
    isMenuDragActive.value = false;
    if (!didDragMenu && menuDragStartState) {
      restoreMenuDragStartState();
      menuDragStartState = null;
      return;
    }
    menuDragStartState = null;
    resolveDockEdge();
  };

  const cancelMenuDrag = () => {
    if (!isDraggingMenu) {
      return;
    }

    restoreMenuDragStartState();
    isDraggingMenu = false;
    isMenuDragActive.value = false;
    didDragMenu = false;
    menuDragStartState = null;
  };

  const startMenuDrag = (event: PointerEvent) => {
    const target = event.currentTarget as HTMLElement | null;
    if (!target) return;
    event.preventDefault();
    isDraggingMenu = true;
    isMenuDragActive.value = true;
    didDragMenu = false;
    menuDragStartState = {
      isDocked: isDocked.value,
      isExpanded: isMenuExpanded.value,
      dockedEdge: dockedEdge.value,
      x: menuX.value,
      y: menuY.value,
      relativeX: menuRelativeX.value,
      relativeY: menuRelativeY.value
    };

    if (isDocked.value) {
      const position = getDockedPosition(dockedEdge.value);
      menuX.value = position.x;
      menuY.value = position.y;
    }

    // Pointer down only starts a tentative drag. Persist after pointer up so an
    // interrupted gesture cannot replace a stable docked placement.
    setFloatingMenuState();
    setMenuPosition(menuX.value, menuY.value, { persist: false });

    dragStartOffset = {
      x: event.clientX - menuX.value,
      y: event.clientY - menuY.value
    };
    dragStartPoint = {
      x: event.clientX,
      y: event.clientY
    };
    target.setPointerCapture?.(event.pointerId);
  };

  const handleWindowPointerMove = (event: PointerEvent) => {
    if (!isDraggingMenu) return false;

    const position = clampCollapsedPosition(event.clientX - dragStartOffset.x, event.clientY - dragStartOffset.y);
    if (isMenuExpanded.value) {
      const bounds = options.getStageBounds();
      const frame = getMenuFrame(position.x, position.y, true, bounds, options.layout);
      if (!isMenuFrameInsideStage(frame, bounds, options.layout)) {
        isMenuExpanded.value = false;
      }
    }
    setMenuPosition(position.x, position.y, { persist: false });

    const distanceX = Math.abs(event.clientX - dragStartPoint.x);
    const distanceY = Math.abs(event.clientY - dragStartPoint.y);
    if (distanceX > options.dragThresholdPx || distanceY > options.dragThresholdPx) {
      didDragMenu = true;
    }

    return true;
  };

  const toggleMenu = () => {
    if (didDragMenu) {
      didDragMenu = false;
      return;
    }

    isMenuExpanded.value = !isMenuExpanded.value;
    if (!isDocked.value) {
      syncFloatingMenuSideFromAnchor();
    }
    setMenuPosition(menuX.value, menuY.value);
    void nextTick(() => ensureMenuInsideStage());
  };

  return {
    isMenuExpanded,
    isDocked,
    isMenuDragActive,
    dockedEdge,
    menuX,
    menuY,
    menuRelativeX,
    menuRelativeY,
    isHorizontalLayout,
    menuStyle,
    setMenuPosition,
    loadPersistedMenuPlacement,
    setFloatingMenuState,
    initializeMenuPosition,
    ensureMenuInsideStage,
    handleMenuPointerEnter,
    handleMenuPointerLeave,
    finishMenuDrag,
    cancelMenuDrag,
    startMenuDrag,
    handleWindowPointerMove,
    toggleMenu,
    getIsDraggingMenu: () => isDraggingMenu
  };
}
