// The Session tab beside a conversation: where its agent works, and with what, at a
// glance. The account it answers in, its folder and the branch there, whether that is
// a worktree of its own, how full its context window is and how its MCP servers are
// doing. Each opens what there is to do about it: the accounts, the folder, the
// meter's figures, the MCP servers. All of it is the host's, whose folder it is.
import { el, errorText, html, raw } from '../lib/dom.js';
import { buddy, listIcon, smallIcon } from '../lib/icons.js';
import { mcpGlance, mcpSettling } from '../../shared/mcp.js';
import { accountName, contextFigure, percentOf, tokenCount, usageLevel } from '../../shared/usage.js';
import { isGroup } from './participants.js';

const TAB = 'session';

// A server on its way to connecting is asked about again this often while the tab is on show,
// this many times at most: one that never settles is left to the MCP servers dialog.
const AGAIN_MS = 1500;
const AGAIN_TIMES = 10;

/**
 * What the branch row says: the branch, or why there is none.
 * @param {{ branch: string | null } | undefined} card  undefined while git is still to answer
 */
export function branchText(card) {
  if (!card) return 'Asking git...';
  return card.branch ?? 'Not in a git repository';
}

/**
 * What the Context row says: how much of the window is in use, or that nobody knows yet.
 * @param {{ used: number, size: number } | null} context
 */
export const contextText = (context) =>
  context ? `${tokenCount(context.used)} · ${percentOf(context.used, context.size)}%` : 'Not known yet';

/**
 * @typedef {Object} SessionHandlers
 * @property {(contactId: string) => Promise<import('../../main/contact-card.js').ContactCard | null>} card
 * @property {(providerId: string) => Promise<import('../../main/accounts.js').AccountView[]>} accounts
 * @property {(contactId: string) => Promise<import('../../providers/contract.js').McpServer[]>} servers
 * @property {() => { used: number, size: number } | null} context  what the meter knows
 * @property {() => void} openFolder
 * @property {(anchor: HTMLElement, picked: () => void) => void} switchAccount
 * @property {() => void} showContext
 * @property {() => Promise<void>} showServers  resolves when the dialog is closed
 */

export class Session {
  /**
   * What was asked, as it was answered: undefined while it is still to be.
   * @type {{ card?: import('../../main/contact-card.js').ContactCard | null, accounts?: any[], servers?: any[] }}
   */
  #known = {};
  /** @type {Record<string, string>} why something could not be asked, until it is asked again */
  #failed = {};
  /** How many times each was asked: an answer to an older question is not drawn over a newer one. */
  #asked = { card: 0, accounts: 0, servers: 0 };
  #again = 0;

  /**
   * @param {import('./side-pane.js').SidePane} pane
   * @param {{ contactId: string, contact: any, provider: any, participants: any[] }} ctx
   * @param {SessionHandlers} handlers
   */
  constructor(pane, ctx, handlers) {
    this.pane = pane;
    this.ctx = ctx;
    this.handlers = handlers;
    this.body = el('<div class="session-tab"></div>');
    this.body.addEventListener('click', (e) => {
      const row = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-do]'));
      if (row) this.#do(row);
    });
  }

  get kind() {
    return { label: 'Session', icon: smallIcon.info(), open: () => this.show() };
  }

  show() {
    const showing = this.pane.shows(TAB);
    this.pane.open({
      id: TAB,
      title: 'Session',
      icon: smallIcon.info(),
      body: this.body,
      // Asked again whenever it is gone back to: a branch moves on, a server connects.
      onSelect: () => this.refresh(),
    });
    // Going to it asked already. One that was on show is asked again.
    if (showing) this.refresh();
  }

  /** Another account was put in use, wherever that was: the account row says which, if the tab is on show. */
  accountChanged() {
    if (this.ctx.provider?.accounts && this.pane.shows(TAB)) {
      this.#ask('accounts', () => this.handlers.accounts(this.ctx.provider.id));
    }
  }

  /** A turn ended, or the contact went to another folder: the branch there is asked again, if the tab is on show. */
  changed() {
    if (this.pane.shows(TAB)) this.#ask('card', () => this.handlers.card(this.ctx.contactId));
  }

  /** Asks again for all of it. */
  async refresh() {
    clearTimeout(this.#again);
    const { contactId, provider } = this.ctx;
    this.paint();
    await Promise.all([
      this.#ask('card', () => this.handlers.card(contactId)),
      provider?.accounts && this.#ask('accounts', () => this.handlers.accounts(provider.id)),
      provider?.mcp && this.#servers(),
    ]);
  }

  /** Asks about the MCP servers, and again while one is still connecting. */
  async #servers(times = AGAIN_TIMES) {
    await this.#ask('servers', () => this.handlers.servers(this.ctx.contactId));
    if (!times || !this.#known.servers?.some(mcpSettling)) return;
    clearTimeout(this.#again);
    this.#again = setTimeout(() => this.pane.shows(TAB) && this.#servers(times - 1), AGAIN_MS);
  }

  /** @param {'card' | 'accounts' | 'servers'} key @param {() => Promise<any>} ask */
  async #ask(key, ask) {
    const asked = ++this.#asked[key];
    let answer;
    let failed = '';
    try {
      answer = await ask();
    } catch (err) {
      failed = errorText(err);
    }
    if (asked !== this.#asked[key]) return;
    // What was known stays when asking again fails: the error says it may be behind.
    if (!failed) this.#known[key] = answer;
    this.#failed[key] = failed;
    this.paint();
  }

  /** @param {HTMLElement} row */
  async #do(row) {
    const { handlers } = this;
    switch (row.dataset.do) {
      case 'folder':
        return handlers.openFolder();
      case 'account':
        return handlers.switchAccount(row, () => this.#ask('accounts', () => handlers.accounts(this.ctx.provider.id)));
      case 'context':
        return handlers.showContext();
      case 'servers':
        // What was done about them there is what this says next.
        await handlers.showServers();
        return this.#servers();
    }
  }

  /** Draws what is known. The window calls it when the meter, the folder or who is here changed. */
  paint() {
    const { contact, provider, participants } = this.ctx;
    // Not open, it is drawn when it is.
    if (!contact || !provider || !this.pane.has(TAB)) return;
    const host = participants[0];
    // With several agents here, whose all of this is.
    const whose = isGroup(participants) ? html`<small class="session-whose">${host.name}</small>` : '';
    this.body.replaceChildren(
      ...el(
        html`<div>
          <section class="session-card">
            <div class="session-head">Environment${whose}</div>
            ${provider.accounts ? this.#accountRow() : ''} ${this.#folderRow()} ${this.#branchRow()}
          </section>
          ${provider.usage ? this.#contextCard(host) : ''} ${provider.mcp ? this.#serversCard() : ''}
        </div>`
      ).childNodes
    );
  }

  #accountRow() {
    const { provider, participants } = this.ctx;
    const account = this.#known.accounts?.find((one) => one.inUse);
    const failed = this.#failed.accounts;
    const text = account ? accountName(account) : failed || 'Asking...';
    return html`<button
      class="session-row"
      type="button"
      data-do="account"
      title="The ${provider.name} account ${participants[0].name} answers in. Click to switch."
    >
      ${raw(buddy('online', 14))}
      <span class="session-main${account ? '' : ' session-none'}">${text}</span>
      <span class="session-aside">${provider.name}</span>
    </button>`;
  }

  #folderRow() {
    const { contact } = this.ctx;
    return html`<button class="session-row" type="button" data-do="folder" title="Open ${contact.cwd}">
      ${raw(smallIcon.folder())}
      <span class="session-main">${contact.project}</span>
      <span class="session-aside">${contact.location}</span>
    </button>`;
  }

  #branchRow() {
    const { card } = this.#known;
    const failed = this.#failed.card;
    const text = failed && !card ? failed : branchText(card ?? undefined);
    return html`<div class="session-row" title="${card?.branch ? `On ${card.branch}` : text}">
      ${raw(listIcon.branch())}
      <span class="session-main${card?.branch ? '' : ' session-none'}">${text}</span>
      ${
        card?.worktree
          ? html`<span class="session-tag" title="A worktree of its own, made for this contact">Worktree</span>`
          : ''
      }
    </div>`;
  }

  /** @param {{ name: string }} host */
  #contextCard(host) {
    const context = this.handlers.context();
    const level = context ? usageLevel(percentOf(context.used, context.size)) : '';
    const title = context
      ? `${contextFigure(context)}. Click for what is in it.`
      : `Click to ask ${host.name} how full its context window is.`;
    return html`<button class="session-card session-link" type="button" data-do="context" title="${title}">
      <span class="session-head">Context</span>
      <span class="session-value ${level}">${contextText(context)}</span>
      <span class="session-more" aria-hidden="true">›</span>
    </button>`;
  }

  #serversCard() {
    const { servers } = this.#known;
    const failed = this.#failed.servers;
    const glance = servers ? mcpGlance(servers) : { text: failed || 'Asking...', attention: false };
    return html`<button
      class="session-card session-link"
      type="button"
      data-do="servers"
      title="${failed || 'Click to see them, and to reconnect or sign in to one.'}"
    >
      <span class="session-head">MCP servers</span>
      <span class="session-value${glance.attention ? ' attention' : ''}">${glance.text}</span>
      <span class="session-more" aria-hidden="true">›</span>
    </button>`;
  }
}
