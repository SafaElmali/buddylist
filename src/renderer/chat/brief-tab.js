// The Brief tab beside a project's manager: what it knows of the project, as it keeps it in its brief.
// It is drawn again whenever the manager saves the brief, or you change it in Settings > Manager.
import { el, html } from '../lib/dom.js';
import { smallIcon } from '../lib/icons.js';
import { renderMarkdown } from '../lib/markdown.js';

/** The tab's id in the pane. */
const TAB = 'brief';

/** How wide the pane need be for the brief to read well: about as wide as a plan. */
const ROOM = 360;

export class BriefTab {
  /**
   * @param {import('./side-pane.js').SidePane} pane
   * @param {{ readonly edit: (() => void) | null }} handlers  `edit`: opens the brief where it can be changed.
   *   None where there is no Settings, as in the browser preview
   */
  constructor(pane, handlers) {
    this.pane = pane;
    this.handlers = handlers;
    this.body = el(
      html`<div class="brief-tab">
        <div class="brief-head"></div>
        <div class="brief-text md md-doc"></div>
        <div class="brief-empty" hidden>
          No brief yet. The manager writes one as it reads the project's sources, and keeps it up to date as it goes.
        </div>
        <div class="brief-foot" hidden><button class="btn brief-edit" type="button">Edit in Settings...</button></div>
      </div>`
    );
    this.head = /** @type {HTMLElement} */ (this.body.querySelector('.brief-head'));
    this.text = /** @type {HTMLElement} */ (this.body.querySelector('.brief-text'));
    this.empty = /** @type {HTMLElement} */ (this.body.querySelector('.brief-empty'));
    this.foot = /** @type {HTMLElement} */ (this.body.querySelector('.brief-foot'));
    this.foot.querySelector('button').addEventListener('click', () => this.handlers.edit?.());
    /** The brief drawn last, so that the same one is not drawn again. */
    this.drawn = null;
    /** @type {import('./side-pane.js').PaneTab} */
    this.tab = { id: TAB, title: 'Brief', icon: smallIcon.plan(), body: this.body, room: ROOM };
  }

  /** How the pane's + lists this kind of tab. */
  get kind() {
    return { label: 'Brief', icon: smallIcon.plan(), open: () => this.show() };
  }

  /**
   * The project and its brief, as they are now.
   * @param {{ name: string, settings: { brief: string } }} project
   */
  set({ name, settings }) {
    this.head.textContent = `What the manager knows of ${name}`;
    this.foot.hidden = !this.handlers.edit;
    const brief = settings.brief.trim();
    if (brief === this.drawn) return;
    this.drawn = brief;
    this.empty.hidden = Boolean(brief);
    this.text.hidden = !brief;
    renderMarkdown(this.text, brief);
  }

  /** Opens the tab, or goes to it. */
  show() {
    this.pane.open(this.tab);
  }
}
