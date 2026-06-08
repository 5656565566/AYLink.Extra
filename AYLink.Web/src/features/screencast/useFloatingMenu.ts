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
  dockedEdge: DockedEdge;
  x: number;
  y: number;
  relativeX: number;
  relativeY: number;
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

  const setMenuPosition = (x: number, y: number, syncRelative = true) => {
    const clamped = clampCollapsedPosition(x, y);
    menuX.value = clamped.x;
    menuY.value = clamped.y;
    if (!isDocked.value) {
      syncFloatingMenuSideFromAnchor();
    }
    if (syncRelative) {
      updateMenuRelativePosition();
    }
    persistMenuPlacement();
  };

  const restoreMenuPositionFromRelative = () => {
    const range = getCollapsedMenuRange();

    setMenuPosition(
      range.maxX - (range.maxX - range.minX) * menuRelativeX.value,
      range.minY + (range.maxY - range.minY) * menuRelativeY.value,
      false
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
    } catch {
      // ignore local persistence failures
    }
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

  const applyDockPosition = (edge: DockedEdge, collapseExpanded = false) => {
    setDockedMenuState(edge);
    if (collapseExpanded) {
      isMenuExpanded.value = false;
    }
    const position = getDockedPosition(edge);
    setMenuPosition(position.x, position.y);
  };

  const initializeMenuPosition = () => {
    if (isDocked.value) {
      applyDockPosition(dockedEdge.value);
    } else {
      restoreMenuPositionFromRelative();
    }
  };

  const resolveDockEdge = () => {
    const collapsedRange = getCollapsedMenuRange();
    const distances = [
      { edge: 'left' as DockedEdge, value: Math.abs(menuX.value - collapsedRange.minX) },
      { edge: 'right' as DockedEdge, value: Math.abs(menuX.value - collapsedRange.maxX) }
    ].sort((a, b) => a.value - b.value);

    const nearest = distances[0];
    if (nearest.value <= options.dockSnapDistancePx) {
      applyDockPosition(nearest.edge, true);
    } else {
      setFloatingMenuState();
      syncFloatingMenuSideFromAnchor();
      setMenuPosition(menuX.value, menuY.value);
    }
    persistMenuPlacement();
  };

  const handleMenuPointerEnter = () => {
    if (isDocked.value && !isMenuExpanded.value) {
      applyDockPosition(dockedEdge.value);
    }
  };

  const handleMenuPointerLeave = () => {
    if (!isDraggingMenu && isDocked.value && !isMenuExpanded.value) {
      applyDockPosition(dockedEdge.value);
    }
  };

  const syncDockedMenuPosition = async () => {
    await nextTick();
    if (!isDocked.value || (menuX.value === 0 && menuY.value === 0)) {
      return;
    }

    applyDockPosition(dockedEdge.value);
  };

  const finishMenuDrag = () => {
    if (!isDraggingMenu) return;
    isDraggingMenu = false;
    isMenuDragActive.value = false;
    if (!didDragMenu && menuDragStartState) {
      isDocked.value = menuDragStartState.isDocked;
      dockedEdge.value = menuDragStartState.dockedEdge;
      menuX.value = menuDragStartState.x;
      menuY.value = menuDragStartState.y;
      menuRelativeX.value = menuDragStartState.relativeX;
      menuRelativeY.value = menuDragStartState.relativeY;
      menuDragStartState = null;
      persistMenuPlacement();
      return;
    }
    menuDragStartState = null;
    setMenuPosition(menuX.value, menuY.value);
    resolveDockEdge();
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

    setFloatingMenuState();
    setMenuPosition(menuX.value, menuY.value);

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
    setMenuPosition(position.x, position.y);

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
    void syncDockedMenuPosition();
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
    getCollapsedMenuPositionRange: getCollapsedMenuRange,
    clampCollapsedMenuPosition: clampCollapsedPosition,
    updateMenuRelativePosition,
    persistMenuPlacement,
    setMenuPosition,
    restoreMenuPositionFromRelative,
    loadPersistedMenuPlacement,
    setFloatingMenuState,
    setDockedMenuState,
    getDockedMenuPosition: getDockedPosition,
    applyDockPosition,
    initializeMenuPosition,
    resolveDockEdge,
    handleMenuPointerEnter,
    handleMenuPointerLeave,
    syncDockedMenuPosition,
    finishMenuDrag,
    startMenuDrag,
    handleWindowPointerMove,
    toggleMenu,
    getIsDraggingMenu: () => isDraggingMenu,
    getDidDragMenu: () => didDragMenu,
    getDragStartOffset: () => dragStartOffset,
    getDragStartPoint: () => dragStartPoint
  };
}
