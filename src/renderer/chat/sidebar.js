// The bar between the conversation and a column beside it, which drags the column wider or
// narrower: the list of your contacts on its left. The side pane on its right has a bar of
// its own (side-pane.js), which takes no more from the conversation than this one does.

/**
 * The widest a drag can make the column: what it has, and what the conversation can still
 * give. So the bar goes where the pointer goes, or stays. With the side pane open, a
 * conversation that is as narrow as it gets has nothing to give, and a column made wider all
 * the same would take the room from the pane: it would grow to the right while it is dragged left.
 * @param {number} width  the column's, as the drag starts
 * @param {number} conversation  the conversation's, then
 * @param {number} narrowest  how narrow the conversation gets
 */
export const widestFrom = (width, conversation, narrowest) => width + Math.max(0, conversation - narrowest);

/**
 * How far a drag made a column wider. Dragging its bar away from the conversation makes
 * the column narrower, so it goes by the side the column is on.
 * @param {'left' | 'right'} at  which side of the conversation the column is on
 * @param {number} from  where the pointer was as the drag started
 * @param {number} to  where it is now
 */
export const widerBy = (at, from, to) => (at === 'left' ? to - from : from - to);

/**
 * Makes the bar between the conversation and a column beside it drag the column's
 * width. A double-click puts it back as it was.
 * @param {HTMLElement} splitter
 * @param {HTMLElement} side
 * @param {HTMLElement} conversation  the column on the bar's other side, which gives the room
 * @param {object} column
 * @param {'left' | 'right'} column.at  which side of the conversation it is on
 * @param {(width: number) => number} column.clamp  a width it can have
 * @param {number} column.width  how wide it starts
 * @param {number} column.usual  how wide a double-click makes it
 * @param {(width: number) => void} column.save  keeps the width a drag left it at
 */
export function mountSplitter(splitter, side, conversation, { at, clamp, width, usual, save }) {
  const set = (to) => {
    side.style.width = `${clamp(to)}px`;
  };
  set(width);

  /** @type {{ x: number, width: number, widest: number } | null} where the drag started, and how far it can go */
  let from = null;
  splitter.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); // or the drag selects the conversation's text
    splitter.setPointerCapture(e.pointerId); // so the bar is followed wherever the pointer goes
    splitter.classList.add('dragging');
    // From the width it really has: in a small window that is less than the one asked for.
    const { width: has } = side.getBoundingClientRect();
    const narrowest = parseFloat(getComputedStyle(conversation).minWidth) || 0;
    from = { x: e.clientX, width: has, widest: widestFrom(has, conversation.getBoundingClientRect().width, narrowest) };
  });
  splitter.addEventListener('pointermove', (e) => {
    if (from) set(Math.min(from.width + widerBy(at, from.x, e.clientX), from.widest));
  });
  const done = () => {
    if (!from) return;
    from = null;
    splitter.classList.remove('dragging');
    save(side.getBoundingClientRect().width);
  };
  splitter.addEventListener('pointerup', done);
  splitter.addEventListener('pointercancel', done);
  splitter.addEventListener('dblclick', () => {
    set(usual);
    save(usual);
  });
}
