// The web addresses in what a command prints, as links: in a terminal beside the conversation, in the Setup
// and Run tabs, under a run's line in the conversation, and in the Background tab. Pointed at, one is
// underlined and says where it goes. A click opens it where a link in the conversation opens, ⌘-click
// (Ctrl-click off a Mac) in your own browser, and a right-click offers both. What a command prints is never
// taken for markup, and nothing but a web page is opened from it (see shared/terminal-links.js).
import { isWebAddress } from '../../shared/browser.js';
import { systemOf } from '../../shared/shortcuts.js';
import { linkAction, linkTip, outputParts, terminalLinks } from '../../shared/terminal-links.js';
import { openMenu } from '../lib/menu.js';
import { tipOver } from '../lib/tips.js';

/**
 * What the window does with a link in output.
 * @typedef {Object} OutputLinks
 * @property {() => boolean} beside  whether a click opens it beside the conversation: as one in the
 *   conversation does, where there is a browser to open it in
 * @property {(url: string, how: 'beside' | 'browser') => void} open
 * @property {(url: string) => import('../lib/menu.js').MenuItem[]} menu  what a right-click on it offers
 */

const MAC = systemOf(globalThis.navigator?.platform) === 'mac';
// A line printed this long without its end is not waited for any longer: it is linked as it is.
const LONGEST_OPEN_LINE = 4096;

/** @type {ReturnType<typeof tipOver> | undefined} the tip of every terminal of the window: one is pointed at at a time */
let terminalTip;

/**
 * Opens a link as a click asks, if it asks for anything. Never an address that is no web page.
 * @param {OutputLinks} links
 * @param {string} url
 * @param {{ button: number, metaKey: boolean, ctrlKey: boolean }} click
 * @param {boolean} selected  whether the click ended a selection
 * @returns {boolean}  whether it was opened
 */
function follow(links, url, click, selected) {
  if (!isWebAddress(url)) return false;
  const how = linkAction(click, { mac: MAC, selected, beside: links.beside() });
  if (how) links.open(url, how);
  return Boolean(how);
}

/**
 * Text as a box of output shows it, with its web addresses as links.
 * @param {string} text
 * @returns {(string | HTMLElement)[]}  for `append`
 */
export function outputNodes(text) {
  return outputParts(text).map(({ text: words, link: isLink }) => {
    if (!isLink) return words;
    const link = document.createElement('a');
    link.className = 'output-link';
    link.textContent = words;
    return link;
  });
}

/**
 * Adds what a command printed to its box of output, with its web addresses as links. The line still being
 * printed is kept apart, and drawn again as more of it comes: an address may come in two pieces.
 * @param {HTMLElement} box
 * @param {string} text
 */
export function appendOutput(box, text) {
  let line = box.lastElementChild;
  if (!line?.classList.contains('output-line')) {
    line = document.createElement('span');
    line.className = 'output-line';
    box.append(line);
  }
  const all = line.textContent + text;
  let end = all.lastIndexOf('\n') + 1;
  if (all.length - end > LONGEST_OPEN_LINE) end = all.length;
  line.before(...outputNodes(all.slice(0, end)));
  line.replaceChildren(...outputNodes(all.slice(end)));
}

/**
 * Has the links in boxes of output (see outputNodes) open as a terminal's do, and say where they go. One call
 * serves the window, also for boxes drawn later. It comes before anything else in the window hears the click.
 * @param {Document} doc
 * @param {OutputLinks} links
 */
export function watchOutputLinks(doc, links) {
  /** @returns {HTMLElement | null} */
  const linkOf = (e) => e.target?.closest?.('.output-link') ?? null;
  doc.addEventListener(
    'click',
    (e) => {
      const link = linkOf(e);
      if (!link) return;
      e.preventDefault();
      e.stopPropagation();
      const selection = doc.getSelection?.();
      follow(links, link.textContent, e, Boolean(selection && !selection.isCollapsed));
    },
    true
  );
  doc.addEventListener(
    'contextmenu',
    (e) => {
      const link = linkOf(e);
      if (!link) return;
      e.preventDefault();
      e.stopPropagation();
      openMenu({ x: e.clientX, y: e.clientY }, links.menu(link.textContent));
    },
    true
  );
  // Its tip says where a click opens it as the setting is now (see tips.js, which shows it).
  doc.addEventListener(
    'mouseover',
    (e) => {
      const link = linkOf(e);
      if (link) link.dataset.tip = linkTip(link.textContent, { beside: links.beside(), mac: MAC });
    },
    true
  );
}

/**
 * Where a terminal draws a link, in the row the pointer is on: what its tip is put over.
 * @param {import('@xterm/xterm').Terminal} term
 * @param {import('../../shared/terminal-links.js').TerminalLink['range']} range
 * @param {MouseEvent} e
 */
function linkPlace(term, { start, end }, e) {
  const screen = term.element?.querySelector('.xterm-screen')?.getBoundingClientRect();
  if (!screen?.width) return { left: e.clientX, top: e.clientY, width: 0, height: 0 };
  const width = screen.width / term.cols;
  const height = screen.height / term.rows;
  const row = Math.min(term.rows - 1, Math.max(0, Math.floor((e.clientY - screen.top) / height)));
  const y = row + 1 + term.buffer.active.viewportY;
  const from = y === start.y ? start.x : 1;
  const to = y === end.y ? end.x : term.cols;
  return {
    left: screen.left + (from - 1) * width,
    top: screen.top + row * height,
    width: (to - from + 1) * width,
    height,
  };
}

/**
 * Makes the web addresses a terminal prints links, and the links a program prints as links (OSC 8) too, whose
 * words can say anything: their tip says the address they go to. Without this, xterm would ask in a box of
 * its own and open any address at all in a window.
 * @param {import('@xterm/xterm').Terminal} term
 * @param {OutputLinks} links
 * @param {ReturnType<typeof tipOver>} [tip]  the window's tip for terminals, shared by all of them
 * @returns {{ pointed: () => string | null }}  the link the pointer is on, for what a right-click offers
 */
export function linkTerminal(term, links, tip = (terminalTip ??= tipOver())) {
  /** @type {string | null} */
  let pointed = null;
  const hover = (e, url, range) => {
    pointed = url;
    tip.show(() => ({ anchor: linkPlace(term, range, e), text: linkTip(url, { beside: links.beside(), mac: MAC }) }));
  };
  const leave = () => {
    pointed = null;
    tip.hide();
  };
  const activate = (e, url) => {
    if (follow(links, url, e, term.hasSelection())) tip.hide();
  };
  term.options.linkHandler = { activate, hover, leave, allowNonHttpProtocols: false };
  term.registerLinkProvider({
    provideLinks: (y, callback) =>
      callback(
        terminalLinks(term.buffer.active, y).map(({ url, range }) => ({
          text: url,
          range,
          activate: (e) => activate(e, url),
          hover: (e) => hover(e, url, range),
          leave,
        }))
      ),
  });
  return { pointed: () => pointed };
}
