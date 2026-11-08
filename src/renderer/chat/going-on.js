// What goes on beside the conversation, under its newest line: a button while subagents are at
// work, "2 subagents at work", and one while something runs in the background, "A command running
// in the background". Each opens its tab. They come when the first one starts and go when the last
// one ends, also once the agent's own turn is over and nothing else here says that they go on.
import { el, html, raw } from '../lib/dom.js';
import { smallIcon } from '../lib/icons.js';
import { helpersAtWork } from '../../shared/activity-text.js';

/** The tabs they open, by id: what each is called, and its drawing. */
const TABS = {
  helpers: { title: 'Subagents', icon: smallIcon.helper },
  background: { title: 'Background', icon: smallIcon.background },
};

/**
 * The buttons there are, in the order the toolbar has their tabs.
 * @param {number} helpers  how many subagents are at work
 * @param {string} background  what runs in the background, in words. Empty while nothing does
 * @returns {{ tab: 'helpers' | 'background', text: string }[]}
 */
export const goingOn = (helpers, background) => [
  ...(helpers > 0 ? [{ tab: /** @type {const} */ ('helpers'), text: helpersAtWork(helpers) }] : []),
  ...(background ? [{ tab: /** @type {const} */ ('background'), text: background }] : []),
];

export class GoingOn {
  /** The buttons as they are drawn, so that they are drawn again only once that changed. */
  #drawn = '[]';

  /**
   * @param {import('./conversation.js').Conversation} conversation
   * @param {object} tabs
   * @param {Pick<import('./helpers.js').Helpers, 'working' | 'show'>} tabs.helpers
   * @param {Pick<import('./background.js').Background, 'status' | 'show'>} tabs.background
   * @param {(tab: 'helpers' | 'background') => string} hint  the shortcut that opens a tab, as people write it
   */
  constructor(conversation, tabs, hint) {
    this.conversation = conversation;
    this.tabs = tabs;
    this.hint = hint;
    this.node = el(html`<div class="going-on"></div>`);
    this.node.addEventListener('click', (e) => {
      const button = /** @type {HTMLElement} */ (e.target).closest('button');
      if (button) this.tabs[button.dataset.tab].show();
    });
    conversation.tail.append(this.node);
  }

  /**
   * Draws them again: a subagent came or ended, something started or ended in the background, or
   * the shortcuts were changed.
   */
  paint() {
    const buttons = goingOn(this.tabs.helpers.working, this.tabs.background.status).map((button) => ({
      ...button,
      hint: this.hint(button.tab),
    }));
    const drawn = JSON.stringify(buttons);
    if (drawn === this.#drawn) return;
    this.#drawn = drawn;
    this.conversation.keepPinned(() => {
      this.node.replaceChildren(
        ...buttons.map(({ tab, text, hint }) => {
          const { title, icon } = TABS[tab];
          return el(
            html`<button class="going-on-btn" type="button" data-tab="${tab}" title="Open the ${title} tab (${hint})">
              ${raw(icon())}<span>${text}</span>
            </button>`
          );
        })
      );
    });
  }
}
