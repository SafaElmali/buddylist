// The list under the GitHub field of the "New Contact" dialog: the project's open
// pull requests and issues, narrowed down as you type. Choosing one puts its number
// in the field, which then looks it up as if it had been typed.
import { listedHint, listMatching, parseReference, withFound } from '../../shared/github-item.js';
import { el, errorText, html, raw } from '../lib/dom.js';
import { listIcon } from '../lib/icons.js';
import { closeMenu, openPopover, position } from '../lib/menu.js';

/** @typedef {import('../../shared/github-item.js').ItemList} ItemList */
/** @typedef {import('../../shared/github-item.js').ListedItem} ListedItem */

// Long enough to finish a word before GitHub is searched for what was typed.
const SEARCH_PAUSE_MS = 400;
/** What the list says while it has nothing to show, of open issues and pull requests. */
const ITEMS = {
  looking: 'Looking for open issues and pull requests...',
  none: 'There are no open issues or pull requests.',
  unmatched: (text) => `No open issue or pull request matches “${text}”.`,
};
const NOTHING = { pulls: [], issues: [] };

/**
 * Gives the GitHub field its list. The project is asked at once, so the list is there by the time it is wanted.
 * @param {HTMLInputElement} input
 * @param {(search?: string) => Promise<ItemList>} ask  the project's open ones; with `search`, what GitHub finds for those words
 * @param {{ hint?: (item: ListedItem) => string, words?: typeof ITEMS }} [opts]  `hint`: what each row says at its
 *   end, yours or a draft unless it says. `words`: what the list says while it has nothing to show
 * @returns {{ open: () => void }}  shows the list, as for a contact that is to be started from one
 */
export function itemList(input, ask, { hint = listedHint, words = ITEMS } = {}) {
  /** @type {ItemList | null} */
  let list = null;
  let failure = '';
  /** What GitHub found for words that matched nothing listed, by the words. */
  const found = new Map();
  let timer;
  /** @type {HTMLElement | null} the list while it is open */
  let node = null;
  let above = false;

  const rows = el('<div class="menu"></div>');
  // Clicking a row must not take the caret out of the field first.
  rows.addEventListener('mousedown', (e) => e.preventDefault());

  /** @param {ListedItem} item */
  const pick = (item) => {
    input.value = `#${item.number}`;
    // The form looks up what the field says when it is told.
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  /** @param {ListedItem} item */
  const row = (item) => {
    const entry = el(
      html`<div class="menu-item" role="menuitem" title="${item.title}">
        <span class="menu-check">${raw(item.kind === 'pull' ? listIcon.pullRequest() : listIcon.issue())}</span>
        <span class="menu-label"><span class="item-number">#${item.number}</span> ${item.title}</span>
        <span class="menu-hint">${hint(item)}</span>
      </div>`
    );
    entry.addEventListener('mouseenter', () => {
      rows.querySelector('.menu-item.active')?.classList.remove('active');
      entry.classList.add('active');
    });
    entry.addEventListener('click', () => {
      closeMenu();
      pick(item);
    });
    return entry;
  };
  const group = (heading, items) =>
    items.length ? [el(html`<div class="menu-heading">${heading}</div>`), ...items.map(row)] : [];
  const note = (text) => el(html`<div class="item-note">${text}</div>`);

  /** The ones `text` names: in the list, and what GitHub found for it. */
  const matching = (text) => withFound(listMatching(list, text), found.get(text) ?? NOTHING);

  /** What the list shows for what the field says now; null when there is nothing to show at all. */
  function content() {
    if (failure) return [note(failure)];
    if (!list) return [note(words.looking)];
    const text = input.value.trim();
    const { pulls, issues } = matching(text);
    if (pulls.length || issues.length) return [...group('Pull requests', pulls), ...group('Issues', issues)];
    // A number or a link that isn't listed is looked up all the same, and the line under the field says what it is.
    if (parseReference(text)) return null;
    if (!text) return [note(words.none)];
    return [note(found.has(text) ? words.unmatched(text) : 'Searching GitHub...')];
  }

  // Enter takes the highlighted row: the first, which once you type is the best match.
  function draw() {
    const shown = content();
    if (!shown) {
      if (node) closeMenu();
      return;
    }
    rows.replaceChildren(...shown);
    rows.querySelector('.menu-item')?.classList.add('active');
    if (!node) {
      node = openPopover(input, rows, { className: 'item-list', onClose: () => (node = null) });
      // A list that opened over the field stays against it as typing makes it shorter.
      above = node.getBoundingClientRect().top < input.getBoundingClientRect().top;
    }
    // The borders are the list's own, so it is exactly as wide as the field.
    node.style.width = `${input.offsetWidth}px`;
    position(node, input, { above });
  }

  // Words that match nothing listed may be in an older one, which GitHub is asked for.
  function search() {
    clearTimeout(timer);
    const text = input.value.trim();
    if (!list || !text || parseReference(text) || found.has(text)) return;
    const { pulls, issues } = matching(text);
    if (pulls.length || issues.length) return;
    timer = setTimeout(() => {
      ask(text)
        .catch(() => NOTHING)
        .then((answer) => {
          found.set(text, answer);
          if (node) draw();
        });
    }, SEARCH_PAUSE_MS);
  }

  ask()
    .then(
      (answer) => {
        list = answer;
      },
      (err) => {
        failure = errorText(err);
      }
    )
    .finally(() => node && draw());

  // Only what the user types opens it: the number of one chosen from it is put in the field too.
  input.addEventListener('input', (e) => {
    if (!e.isTrusted) return;
    draw();
    search();
  });
  input.addEventListener('click', () => node || draw());
  input.addEventListener('keydown', (e) => {
    // Tab moves on through the form, and the list does not stay behind.
    if (e.key === 'Tab' && node) closeMenu();
    if (!['ArrowDown', 'ArrowUp'].includes(e.key) || node) return;
    e.preventDefault();
    draw();
  });
  return { open: draw };
}
