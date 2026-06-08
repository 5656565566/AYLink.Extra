import { describe, expect, it, beforeEach } from 'vitest';
import { useFloatingMenu } from './useFloatingMenu';
import type { StageBounds } from './floatingMenuLayout';

const defaultStageBounds: StageBounds = {
  width: 1000,
  height: 600,
  offsetLeft: 0,
  offsetTop: 0
};

const createMenu = (stageBounds = defaultStageBounds) => useFloatingMenu({
  storageKey: 'aylink.test.floating-menu',
  layout: {
    margin: 20,
    buttonSize: 48,
    expandedLength: 600,
    expandDirectionSwitchRatio: 0.75
  },
  dragThresholdPx: 4,
  dockSnapDistancePx: 64,
  getStageBounds: () => stageBounds
});

function createPointerEvent(clientX: number, clientY: number) {
  return {
    clientX,
    clientY,
    currentTarget: {
      setPointerCapture: () => undefined
    },
    preventDefault: () => undefined,
    pointerId: 1
  } as unknown as PointerEvent;
}

describe('useFloatingMenu', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('restores docked state after a pointer down/up without a real drag', () => {
    const menu = createMenu();
    menu.initializeMenuPosition();

    expect(menu.isDocked.value).toBe(true);
    expect(menu.dockedEdge.value).toBe('right');

    menu.startMenuDrag(createPointerEvent(950, 40));
    expect(menu.isDocked.value).toBe(false);

    menu.finishMenuDrag();
    expect(menu.isDocked.value).toBe(true);
    expect(menu.dockedEdge.value).toBe('right');
  });

  it('lets a click toggle the menu after a pointer down/up without drag', () => {
    const menu = createMenu();
    menu.initializeMenuPosition();
    const initialExpanded = menu.isMenuExpanded.value;

    menu.startMenuDrag(createPointerEvent(950, 40));
    menu.finishMenuDrag();
    menu.toggleMenu();

    expect(menu.isMenuExpanded.value).toBe(!initialExpanded);
  });

  it('marks a real drag and suppresses the following click toggle', () => {
    const menu = createMenu();
    menu.initializeMenuPosition();
    menu.toggleMenu();
    expect(menu.isMenuExpanded.value).toBe(false);

    menu.startMenuDrag(createPointerEvent(950, 40));
    expect(menu.handleWindowPointerMove(createPointerEvent(900, 100))).toBe(true);
    menu.finishMenuDrag();
    menu.toggleMenu();

    expect(menu.isMenuExpanded.value).toBe(false);
  });

  it('does not suppress a later toggle when no click follows a real drag', () => {
    const menu = createMenu();
    menu.initializeMenuPosition();
    menu.toggleMenu();
    expect(menu.isMenuExpanded.value).toBe(false);

    menu.startMenuDrag(createPointerEvent(950, 40));
    expect(menu.handleWindowPointerMove(createPointerEvent(900, 100))).toBe(true);
    menu.finishMenuDrag();

    menu.startMenuDrag(createPointerEvent(900, 100));
    menu.finishMenuDrag();
    menu.toggleMenu();

    expect(menu.isMenuExpanded.value).toBe(true);
  });

  it('keeps the collapsed anchor stable when toggling a horizontal left menu', () => {
    const menu = createMenu();
    menu.setFloatingMenuState();
    menu.setMenuPosition(900, 520);

    expect(menu.isHorizontalLayout.value).toBe(true);
    expect(menu.dockedEdge.value).toBe('right');
    expect(menu.menuStyle.value).toEqual({
      left: '348px',
      top: '520px'
    });

    menu.toggleMenu();

    expect(menu.isMenuExpanded.value).toBe(false);
    expect(menu.menuX.value).toBe(900);
    expect(menu.menuY.value).toBe(520);
    expect(menu.menuStyle.value).toEqual({
      left: '900px',
      top: '520px'
    });
  });

  it('collapses while dragging when the expanded menu no longer fits', () => {
    const menu = createMenu();
    menu.setFloatingMenuState();
    menu.setMenuPosition(900, 520);

    expect(menu.isMenuExpanded.value).toBe(true);
    expect(menu.menuStyle.value).toEqual({
      left: '348px',
      top: '520px'
    });

    menu.startMenuDrag(createPointerEvent(924, 544));
    expect(menu.handleWindowPointerMove(createPointerEvent(474, 544))).toBe(true);

    expect(menu.isMenuExpanded.value).toBe(false);
    expect(menu.menuX.value).toBe(450);
    expect(menu.menuY.value).toBe(520);
    expect(menu.menuStyle.value).toEqual({
      left: '450px',
      top: '520px'
    });
  });

  it('persists and restores the collapsed state', () => {
    const menu = createMenu();
    menu.initializeMenuPosition();

    menu.toggleMenu();
    expect(menu.isMenuExpanded.value).toBe(false);

    const restored = createMenu();
    restored.loadPersistedMenuPlacement();
    restored.initializeMenuPosition();

    expect(restored.isMenuExpanded.value).toBe(false);
    expect(restored.menuStyle.value).toEqual({
      left: '932px',
      top: '20px'
    });
  });

  it('collapses restored expanded placements that no longer fit inside the stage', () => {
    localStorage.setItem('aylink.test.floating-menu', JSON.stringify({
      isDocked: false,
      isExpanded: true,
      relativeRight: 0.5,
      relativeTop: 1
    }));

    const menu = createMenu({
      width: 420,
      height: 260,
      offsetLeft: 0,
      offsetTop: 0
    });

    menu.loadPersistedMenuPlacement();
    menu.initializeMenuPosition();

    expect(menu.isMenuExpanded.value).toBe(false);
    expect(menu.menuStyle.value).toEqual({
      left: '186px',
      top: '192px'
    });
  });

  it('pulls an expanded floating menu back inside the visible stage', () => {
    const menu = createMenu();
    menu.setFloatingMenuState();
    menu.menuX.value = 450;
    menu.menuY.value = 520;
    menu.isMenuExpanded.value = true;
    menu.ensureMenuInsideStage();

    expect(menu.isMenuExpanded.value).toBe(true);
    expect(menu.menuStyle.value).toEqual({
      left: '20px',
      top: '520px'
    });
  });

  it('uses live layout changes when checking whether the expanded menu fits', () => {
    const layout = {
      margin: 20,
      buttonSize: 48,
      expandedLength: 600,
      expandDirectionSwitchRatio: 0.75
    };
    const menu = useFloatingMenu({
      storageKey: 'aylink.test.floating-menu',
      layout,
      dragThresholdPx: 4,
      dockSnapDistancePx: 64,
      getStageBounds: () => ({
        width: 360,
        height: 260,
        offsetLeft: 0,
        offsetTop: 0
      })
    });

    menu.setFloatingMenuState();
    menu.setMenuPosition(280, 40);
    expect(menu.isMenuExpanded.value).toBe(false);

    menu.isMenuExpanded.value = true;
    layout.expandedLength = 180;
    menu.ensureMenuInsideStage();

    expect(menu.isMenuExpanded.value).toBe(true);
    expect(menu.menuStyle.value).toEqual({
      left: '280px',
      top: '40px'
    });
  });
});
