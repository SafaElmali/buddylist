// The Agents tab of the side pane, with several agents here: a row each with its picture, name
// and status, what it answers with, a pause, a ✕ and a grip to drag it by, in the order they
// answer in, and how they reply under the rows. chrome.js draws the list, and main.js wires what
// its buttons do. One agent on its own has no tab: its badges are under the conversation.
import { el } from '../lib/dom.js';
import { smallIcon } from '../lib/icons.js';
import { roster } from './chrome.js';

/** The tab's id in the pane. */
const TAB = 'agents';

/** How wide the pane need be for the list: a name and its badges, a line each. */
const ROOM = 320;

export class AgentsTab {
  /** @param {import('./side-pane.js').SidePane} pane */
  constructor(pane) {
    this.pane = pane;
    const body = el('<div class="agents-tab"></div>');
    body.append(roster);
    /** @type {import('./side-pane.js').PaneTab} */
    this.tab = { id: TAB, title: 'Agents', icon: smallIcon.agents(), body, room: ROOM };
  }

  /** How the pane's + lists this kind of tab. */
  get kind() {
    return { label: 'Agents', icon: smallIcon.agents(), open: () => this.show() };
  }

  /** Whether the pane shows the list now. */
  get shown() {
    return this.pane.shows(TAB);
  }

  /** Opens the tab, or goes to it. */
  show() {
    this.pane.open(this.tab);
  }

  /** The button under the conversation: to the tab and, pressed with the tab on show, away with it. */
  toggle() {
    if (this.shown) this.close();
    else this.show();
  }

  /** Puts the tab away. It stays with an agent on its own, until it is put away. */
  close() {
    this.pane.close(TAB);
  }
}
