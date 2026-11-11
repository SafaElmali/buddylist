// The toolbar's Create PR button. It asks the contact for a pull request in the
// conversation, as you would by typing: the window itself never commits, pushes or opens
// one. With several agents here, you choose which one to ask. Its ▼ has the other ways,
// as a draft or yourself on GitHub. Once the branch has a
// pull request, the button opens that one instead, with a mark for how its checks stand, and
// its ▼ shows the checks, turns auto-merge on or off, and says whether the contact is archived
// once it is merged. While it has conflicts with its base
// branch, the ▼ and Fix conflicts in the "To:" line ask for them to be resolved in the
// conversation, as Create PR asks for a pull request. After one that is merged or closed, the
// button still opens that one, wearing its tag as the contact's row does, and its ▼ has the ways
// to another and the next branch. A Continue button stands next to it for that branch, which the
// app starts itself, in the contact's folder.
import { api } from '../lib/api.js';
import { confirmDialog } from '../lib/dialog.js';
import { $, el, errorText, html, raw } from '../lib/dom.js';
import { tagIcon } from '../lib/icons.js';
import { linkPullRequestDialog } from '../lib/link-pr-dialog.js';
import { openMenu } from '../lib/menu.js';
import { continueButton, newBranchItems, newBranchQuestion } from '../../shared/new-branch.js';
import {
  autoMergeNotice,
  fixConflictsMessage,
  pullRequestButton,
  pullRequestMenuItems,
  pullRequestMessage,
} from '../../shared/pull-request-button.js';
import { isGroup } from './participants.js';

export class PullRequestButton {
  /** Auto-merge is being turned on or off, and GitHub has not answered yet. */
  #switching = false;

  /**
   * @param {object} ctx  the window's shared state: the contact as the list shows it, who is here, and the settings
   * @param {object} handlers
   * @param {(text: string, recipient?: object) => void} handlers.send    says something in the conversation, as you, with the
   *   project's instructions for Create PR
   * @param {(text: string) => void} handlers.say     the same without them
   * @param {(text: string) => void} handlers.error   says in the conversation what went wrong
   * @param {(text: string) => void} handlers.notice  says in the conversation what the app did
   * @param {() => void} handlers.checks              shows the pull request's checks beside the conversation
   * @param {() => void} handlers.stack               shows its read-only PR relationships beside the conversation
   */
  constructor(ctx, handlers) {
    this.ctx = ctx;
    this.handlers = handlers;
  }

  /** The conversation is the host's: its folder and its branch, whoever is asked. */
  get #host() {
    return this.ctx.participants[0];
  }

  #face() {
    const who = isGroup(this.ctx.participants) ? null : this.#host?.name;
    return pullRequestButton(this.ctx.contact, who, this.ctx.settings);
  }

  /** The contact changed, or what GitHub says of its branch: the button says so. */
  paint() {
    const button = /** @type {HTMLButtonElement} */ ($('#tb-pr'));
    const more = /** @type {HTMLButtonElement} */ ($('#tb-pr-more'));
    if (!button || !more) return;
    const face = this.#face();
    button.disabled = more.disabled = face.disabled;
    button.dataset.tip = face.title;
    // A pull request that is merged or closed wears its tag after its number, as on the contact's row. One linked by
    // hand says so, as its branch didn't lead to it.
    const tag =
      face.tag &&
      el(
        html`<span class="pr-tag" data-kind="${face.tag.kind}">${raw(tagIcon[face.tag.kind]())}${face.tag.text}</span>`
      );
    const linked = face.linked && el('<span class="pr-tag" data-kind="linked">Linked</span>');
    $('.tb-label', button).replaceChildren(face.name, ...[tag, linked].filter(Boolean));
    // The mark on its drawing, red, amber or green, is how the checks stand.
    if (face.checks) button.dataset.checks = face.checks;
    else delete button.dataset.checks;
    more.dataset.tip = face.more;
    // After one that is merged or closed, Continue is there for the next branch.
    const next = /** @type {HTMLButtonElement | null} */ ($('#tb-continue'));
    if (!next) return;
    const onward = continueButton(this.ctx.contact);
    next.hidden = !onward;
    next.disabled = Boolean(onward?.disabled);
    if (onward) next.dataset.tip = onward.tip;
  }

  /** Fix conflicts, in the "To:" line and the menus: a message that asks for them to be resolved. */
  fixConflicts() {
    const face = this.#face();
    const number = this.ctx.contact?.pullRequest?.number;
    if (!face.conflict || !number) return;
    this.handlers.say(fixConflictsMessage(number));
  }

  /** Continue: on to a new branch, as its entry in the menus does. */
  nextBranch() {
    if (continueButton(this.ctx.contact)?.disabled === false) this.#newBranch();
  }

  /** The button: to the branch's pull request, or a message that asks for one. */
  press() {
    const face = this.#face();
    if (face.disabled) return;
    if (face.url) api.app.openExternal(face.url);
    else {
      const create = this.menuItems()[0];
      if (create.submenu) openMenu($('#tb-pr'), create.submenu, { align: 'right' });
      else create.action();
    }
  }

  /** The ▼ next to it. @param {HTMLElement} button */
  more(button) {
    button.classList.add('open');
    // Without the button's own way, which is the button's to offer.
    openMenu(button, this.menuItems().slice(1), { align: 'right', onClose: () => button.classList.remove('open') });
  }

  /**
   * The Code menu's entries: every way to a pull request, or the one there is. After a pull
   * request that is merged or closed, the next branch too.
   */
  menuItems() {
    const ways = pullRequestMenuItems(
      this.#face(),
      {
        open: () => this.press(),
        create: (opts) => this.#create(opts),
        manually: () => this.#manually(),
        checks: () => this.handlers.checks(),
        stack: this.handlers.stack,
        autoMerge: (on) => this.#autoMerge(on),
        fixConflicts: () => this.fixConflicts(),
        archiveMerged: (on) => this.#archiveMerged(on),
        link: () => this.#link(),
        unlink: () => this.#unlink(),
        showOther: (which) => this.#showOther(which),
      },
      this.ctx.participants
    );
    return [...ways, ...newBranchItems(this.ctx.contact, () => this.#newBranch())];
  }

  /**
   * The window came to the front: whatever happened on GitHub meanwhile, such as checks that
   * finished or auto-merge turned on there, is asked about. GitHub is not asked again for a
   * folder it answered about a moment ago.
   */
  focused() {
    if (this.ctx.contact?.status === 'offline') return;
    api.contacts.pullRequest(this.ctx.contactId).catch(() => {});
  }

  /** @param {{ draft: boolean, participantId?: string }} opts */
  #create({ draft, participantId }) {
    if (this.#face().disabled) return;
    const who = participantId ? this.ctx.participants.find(({ id }) => id === participantId) : this.#host;
    if (!who) {
      this.handlers.error('That agent has left this conversation. Choose another agent.');
      return;
    }
    // Choosing a paused agent explicitly asks it once, just as a typed mention does. An active
    // selection that becomes paused while project instructions load still needs a fresh choice.
    const recipient = participantId ? { id: who.id, allowPaused: Boolean(who.paused) } : {};
    const to = participantId && isGroup(this.ctx.participants) ? who.name : null;
    this.handlers.send(pullRequestMessage({ draft, to }), recipient);
  }

  /** The folder goes on to a new branch, if you say so. The conversation hears from the app what it is called. */
  async #newBranch() {
    const question = newBranchQuestion(this.#host.name, this.ctx.contact.pullRequest);
    if (!(await confirmDialog(question, { ok: 'Start Branch' }))) return;
    try {
      await api.contacts.startBranch(this.ctx.contactId);
    } catch (err) {
      this.handlers.error(errorText(err));
    }
  }

  /**
   * Auto-merge on or off, as you, for the folder's own pull request. The conversation says how it
   * went: by GitHub, by the app once its checks pass where GitHub won't wait, or merged at once. Or
   * why GitHub would not.
   * @param {boolean} on
   */
  async #autoMerge(on) {
    const number = this.ctx.contact?.pullRequest?.number;
    if (this.#switching || !number) return;
    this.#switching = true;
    try {
      const { method, ...how } = await api.contacts.autoMerge(this.ctx.contactId, on);
      this.handlers.notice(autoMergeNotice(number, method, how));
    } catch (err) {
      this.handlers.error(errorText(err));
    } finally {
      this.#switching = false;
    }
  }

  /**
   * Whether the contact is archived once its pull request is merged: its own choice from now on, whatever
   * Settings > Git says.
   * @param {boolean} on
   */
  async #archiveMerged(on) {
    try {
      await api.contacts.update(this.ctx.contactId, { archiveMerged: on });
    } catch (err) {
      this.handlers.error(errorText(err));
    }
  }

  /** Link a Pull Request...: one the branch doesn't lead to, in its own dialog. The button shows it once linked. */
  async #link() {
    const shown = await linkPullRequestDialog({ id: this.ctx.contactId, cwd: this.ctx.contact.cwd });
    if (shown) this.handlers.notice(`Linked pull request #${shown.number} to this conversation.`);
  }

  /** Unlink #12: the branch's own is shown again, if it has one. */
  async #unlink() {
    try {
      await api.contacts.unlinkPullRequest(this.ctx.contactId);
    } catch (err) {
      this.handlers.error(errorText(err));
    }
  }

  /** @param {'branch' | 'linked'} which  the branch's own pull request, or the linked one */
  async #showOther(which) {
    try {
      await api.contacts.showPullRequest(this.ctx.contactId, which);
    } catch (err) {
      this.handlers.error(errorText(err));
    }
  }

  /** GitHub's own page for a new pull request, in the browser. */
  async #manually() {
    try {
      api.app.openExternal(await api.contacts.pullRequestPage(this.ctx.contactId));
    } catch (err) {
      this.handlers.error(errorText(err));
    }
  }
}
