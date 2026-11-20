// A side pane (src/renderer/chat/side-pane.js) in the DOM fixture, with only what it reads of the window: the
// shared fixture has no layout, native button activation or observers, so these stand in for them.
import { SidePane } from '../../src/renderer/chat/side-pane.js';
import { el } from '../../src/renderer/lib/dom.js';
import { Element, page } from './dom.js';

/**
 * @param {import('node:test').TestContext} t
 * @param {{ localStorage?: Pick<Storage, 'getItem' | 'setItem'> }} [window]  what is kept for the whole app
 */
export function paneFor(t, { localStorage } = {}) {
  const document = page(t);
  const globals = {
    window: { addEventListener() {} },
    getComputedStyle: () => ({ width: '0', minWidth: '0' }),
    ResizeObserver: class {
      observe() {}
    },
    MutationObserver: class {
      observe() {}
    },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    ...(localStorage && { localStorage }),
  };
  const previous = Object.fromEntries(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)])
  );
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, { configurable: true, value });
  const after = Element.prototype.after;
  Element.prototype.after = function (...nodes) {
    if (this.nextElementSibling) this.nextElementSibling.before(...nodes);
    else this.parentElement.append(...nodes);
  };
  t.after(() => {
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    if (after) Element.prototype.after = after;
    else delete Element.prototype.after;
  });
  const main = el('<main></main>');
  const beside = el('<div class="conversation"></div>');
  const root = el('<aside hidden></aside>');
  main.append(beside, root);
  document.body.append(main);
  const opened = [];
  const reorders = [];
  const pane = new SidePane(root, {
    beside,
    room: async () => {},
    opened: (id) => opened.push(id),
    reordered: (ids) => reorders.push(ids),
  });
  return { pane, document, root, opened, reorders };
}
