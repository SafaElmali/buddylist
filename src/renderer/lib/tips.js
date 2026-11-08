// A helper line for a button: one line that says what it does, shown as soon as the button
// is pointed at. A `title` says the same only after a wait, and in the system's own look, so
// a button whose word alone does not say what it does has `data-tip` instead.

/** Between a tip and what it is about. */
export const TIP_GAP = 5;
/** Between a tip and the edges of the window. */
export const TIP_MARGIN = 4;
// Long enough for a pointer on its way elsewhere not to leave a trail of tips.
const SHOW_AFTER_MS = 120;

/**
 * Where a tip goes: above what it is about and centred on it, below when there is no room
 * above, and never past the left or right edge of the window.
 * @param {{ left: number, top: number, width: number, height: number }} anchor  what it is about
 * @param {{ width: number, height: number }} tip
 * @param {{ width: number, height: number }} view  the window
 * @returns {{ left: number, top: number, below: boolean }}  in whole pixels
 */
export function placeTip(anchor, tip, view) {
  const above = anchor.top - TIP_GAP - tip.height;
  const below = above < TIP_MARGIN;
  const centred = anchor.left + anchor.width / 2 - tip.width / 2;
  // A tip wider than the window starts at its left edge: its first words are the ones to read.
  const left = Math.max(TIP_MARGIN, Math.min(centred, view.width - tip.width - TIP_MARGIN));
  return { left: Math.round(left), top: Math.round(below ? anchor.top + anchor.height + TIP_GAP : above), below };
}

/**
 * Shows the tip of whatever in the window has a `data-tip`, while it is pointed at. One
 * call serves the whole window, also for what is drawn later.
 * @param {Document} [doc]
 */
export function mountTips(doc = document) {
  /** @type {HTMLElement | null} */
  let node = null;
  /** @type {HTMLElement | null} what the pointer is on, whether its tip is showing yet or not */
  let about = null;
  let timer = null;

  const hide = () => {
    clearTimeout(timer);
    about = null;
    if (node) node.hidden = true;
  };

  const show = (target) => {
    const text = target.dataset.tip;
    // Redrawn or emptied while the pointer rested on it.
    if (!text || !target.isConnected) return hide();
    if (!node) {
      node = doc.createElement('div');
      node.className = 'tip';
      node.setAttribute('role', 'tooltip');
      doc.body.appendChild(node);
    }
    node.textContent = text;
    node.hidden = false;
    const view = { width: doc.documentElement.clientWidth, height: doc.documentElement.clientHeight };
    const { left, top } = placeTip(target.getBoundingClientRect(), node.getBoundingClientRect(), view);
    node.style.left = `${left}px`;
    node.style.top = `${top}px`;
  };

  doc.addEventListener('mouseover', (e) => {
    const target = /** @type {HTMLElement | null} */ (
      /** @type {Element} */ (e.target).closest?.('[data-tip]') ?? null
    );
    if (target === about) return;
    hide();
    if (!target) return;
    about = target;
    timer = setTimeout(() => show(target), SHOW_AFTER_MS);
  });
  // The pointer left the window, or the button is being used: it has said what it had to say.
  doc.documentElement.addEventListener('mouseleave', hide);
  for (const used of ['mousedown', 'keydown', 'wheel']) doc.addEventListener(used, hide, true);
  doc.defaultView?.addEventListener('blur', hide);
}
