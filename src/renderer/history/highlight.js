// Marks every place a text appears in a pane without touching its markup: the
// browser paints the ranges we name, styled by ::highlight(search) in history.css.
import { placesOf, searchTerms } from '../../shared/search.js';

const NAME = 'search';

/**
 * @param {HTMLElement} root
 * @param {string} text  what was searched for: each of its words and "quoted phrases" is marked (see
 *   shared/search.js). Nothing is marked when it is empty
 * @returns {Range[]}  the matches, in reading order
 */
export function highlight(root, text) {
  const registry = globalThis.CSS?.highlights;
  // An older browser marks nothing; the list of conversations is still filtered.
  if (!registry) return [];
  registry.delete(NAME);
  const terms = searchTerms(text);
  if (!terms.length) return [];

  const ranges = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    // Text that is folded away, or not drawn at all, can't be seen, so it is not a match.
    if (!node.parentElement.checkVisibility()) continue;
    for (const [start, end] of placesOf(node.nodeValue, terms)) {
      const range = new Range();
      range.setStart(node, start);
      range.setEnd(node, end);
      ranges.push(range);
    }
  }
  if (ranges.length) {
    // Added one by one: one letter is in a long transcript more often than a call can be given things.
    const marks = new Highlight();
    for (const range of ranges) marks.add(range);
    registry.set(NAME, marks);
  }
  return ranges;
}
