/* Tooltips — a reusable (?) affordance with a position-aware bubble.
 *
 * Any element carrying `data-tip` (or a .tip-btn built by tipBtn())
 * shows the text on tap/click — hover-only dies on touch, so tap is the
 * one channel everywhere. The bubble mounts inside the anchor's dialog
 * when there is one (showModal dialogs own the top layer — nothing
 * outside can paint above them), positions via placeTip() and can
 * never render off-screen. Esc or a tap outside dismisses it.
 *
 * placeTip is pure (unit-tested); the rest touches the DOM only when
 * initTooltips runs. */

const TIP_MARGIN = 8;

/* Prefer centered below the anchor; flip above when there is no room
 * below; clamp both axes to the viewport whatever the anchor does. */
export function placeTip(anchor, tip, viewport, margin = TIP_MARGIN) {
  const vw = viewport.w, vh = viewport.h, m = margin;
  const cx = anchor.x + anchor.w / 2;
  let placement = 'below';
  let y = anchor.y + anchor.h + m;
  if (y + tip.h > vh - m && anchor.y - tip.h - m >= m) {
    placement = 'above';
    y = anchor.y - tip.h - m;
  }
  let x = cx - tip.w / 2;
  x = Math.min(Math.max(x, m), vw - tip.w - m);
  y = Math.min(Math.max(y, m), vh - tip.h - m);
  return { x, y, placement };
}

/* The (?) affordance for dynamically built rows. */
export function tipBtn(text) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'tip-btn';
  b.dataset.tip = text;
  b.setAttribute('aria-label', 'More information');
  b.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M15.07 11.25l-.9.92C13.45 12.89 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41a2 2 0 1 0-4 0H8a4 4 0 1 1 8 0c0 .88-.36 1.68-.93 2.25M12 2A10 10 0 0 0 2 12a10 10 0 0 0 10 10 10 10 0 0 0 10-10A10 10 0 0 0 12 2m-1 17h2v-2h-2v2z" fill="currentColor"/></svg>';
  return b;
}

let tipEl = null;

function hideTip() {
  if (tipEl) { tipEl.remove(); tipEl = null; }
  document.removeEventListener('keydown', onKey);
}

function onKey(e) { if (e.key === 'Escape') hideTip(); }

export function initTooltips() {
  document.addEventListener('click', (e) => {
    const anchor = e.target.closest('[data-tip]');
    if (!anchor) { hideTip(); return; }
    const sameAnchor = tipEl && tipEl._anchor === anchor;
    hideTip();
    if (sameAnchor) return;              /* tap toggles */
    e.preventDefault();

    tipEl = document.createElement('div');
    tipEl.className = 'tip-bubble';
    tipEl.setAttribute('role', 'tooltip');
    tipEl.textContent = anchor.dataset.tip;
    tipEl._anchor = anchor;
    /* showModal dialogs live in the top layer — mount inside so the
     * bubble can paint above the backdrop (fixed positioning is still
     * viewport-relative there) */
    (anchor.closest('dialog') || document.body).appendChild(tipEl);

    const a = anchor.getBoundingClientRect();
    const t = tipEl.getBoundingClientRect();
    const p = placeTip(
      { x: a.left, y: a.top, w: a.width, h: a.height },
      { w: t.width, h: t.height },
      { w: window.innerWidth, h: window.innerHeight },
    );
    tipEl.style.left = `${p.x}px`;
    tipEl.style.top = `${p.y}px`;
    document.addEventListener('keydown', onKey);
  });
  window.addEventListener('resize', hideTip);
  window.addEventListener('scroll', hideTip, { capture: true, passive: true });
}
