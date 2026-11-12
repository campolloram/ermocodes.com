// Pointer and finger state. The grid heat (the lens over the ASCII figure) and the figure parallax
// follow any pointer; the name's melt follows the mouse only.
export const ptr = { x: 0, y: 0, tx: 0, ty: 0, cx: -9999, cy: -9999, on: 0 };
/** The mouse over the page (never a finger or a pen): the melt follows only this. */
const mouseState = { x: -1e4, y: -1e4, on: false };
export const mouse: Readonly<typeof mouseState> = mouseState;

export function bindPointer(onActivity: () => void): void {
  const grid = (cx: number, cy: number) => {
    ptr.tx = (cx / innerWidth) * 2 - 1;
    ptr.ty = (cy / innerHeight) * 2 - 1;
    ptr.cx = cx;
    ptr.cy = cy;
    ptr.on = 1;
    onActivity();
  };
  addEventListener(
    'pointermove',
    (e) => {
      grid(e.clientX, e.clientY);
      if (e.pointerType === 'mouse') {
        mouseState.x = e.clientX;
        mouseState.y = e.clientY;
        mouseState.on = true;
      } else mouseState.on = false;
    },
    { passive: true },
  );
  document.addEventListener('mouseleave', () => {
    ptr.on = 0;
    mouseState.on = false;
  });
  addEventListener('blur', () => (mouseState.on = false));
  const touch = (e: TouchEvent) => {
    const t = e.touches[0];
    if (!t) return;
    mouseState.on = false;
    grid(t.clientX, t.clientY);
  };
  addEventListener('touchstart', touch, { passive: true });
  addEventListener('touchmove', touch, { passive: true });
}
