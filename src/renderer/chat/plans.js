// An agent's plan opens beside the conversation instead of in it: a plan is a
// document to read through, and the conversation goes on next to it. Each plan
// has a tab in the side pane, with the ways to answer it underneath. A plan an
// agent keeps in a file of the folder, COM-630-plan.md say, has a tab too: it
// shows the file as it is now, and there is nothing to answer under it.
import { planTitle } from '../../shared/plan-title.js';
import { pathInside } from '../../shared/paths.js';
import { el, errorText, html } from '../lib/dom.js';
import { smallIcon } from '../lib/icons.js';
import { isMarkdownFile, renderMarkdown } from '../lib/markdown.js';
import { fileNote, fileTitle } from './files.js';
import { speakerOf } from './participants.js';

/**
 * @typedef {Object} Plan
 * @property {string} id               its request while it waits for an answer, its saved line afterwards
 * @property {string} title
 * @property {string} text             Markdown
 * @property {string} by               the name of the agent that made it
 * @property {string} speaker          that agent's contact id
 * @property {string | null} decision  how it was answered, or null while it waits
 * @property {string} [file]           the file it is kept in, from the top of the folder: its text is read from there
 * @property {HTMLElement} [body]      its tab's contents, once it has been opened
 */

/** Under a plan that has been answered. */
const ANSWERED = {
  'approve-plan': 'You approved this plan.',
  feedback: 'You sent this plan back with feedback.',
  cancelled: 'This plan was withdrawn before you answered.',
};

/** Next to a plan in the list of them. */
const STATE = { 'approve-plan': 'approved', feedback: 'sent back', cancelled: 'withdrawn' };

/** What a list of plans says about one: "approved", or that it is still waiting for you. */
export const planState = (decision) => (decision ? STATE[decision] || 'answered' : 'waiting for you');

/**
 * The plans whose tab a new plan takes over: its agent's earlier ones that weren't
 * approved. They were drafts of this one. An approved plan is being worked on, and stays.
 * @param {Pick<Plan, 'id' | 'speaker' | 'decision'>[]} plans
 * @param {Pick<Plan, 'speaker'>} next
 */
export const draftsOf = (plans, next) =>
  plans.filter((p) => p.speaker === next.speaker && p.decision && p.decision !== 'approve-plan').map((p) => p.id);

/** A name that says it is a plan, or plans: COM-630-plan, PLAN, implementation_plan. Not explain, nor planet. */
const NAMES_A_PLAN = /(^|[^a-z])plan(s|ning)?([^a-z]|$)/i;

/**
 * The plan in a file that a call wrote or changed: a Markdown file of the folder named for a plan, or
 * in a folder that is (docs/plans/auth.md).
 * @param {import('../../providers/contract.js').Activity} activity
 * @param {string} folder  the contact's
 * @returns {string | null}  its path from the top of the folder. null for any other call
 */
export function planFileOf({ kind, path }, folder) {
  if ((kind !== 'write' && kind !== 'edit') || !isMarkdownFile(path)) return null;
  const file = pathInside(path, folder);
  return file?.split(/[\\/]/).some((part) => NAMES_A_PLAN.test(part)) ? file : null;
}

/** The tab of a plan kept in a file: one for each file, whoever wrote to it. @param {string} file */
const planFileTab = (file) => `plan-file:${file}`;

export class Plans {
  /**
   * @param {import('./side-pane.js').SidePane} pane
   * @param {{ participants: import('../../providers/contract.js').Participant[] }} ctx
   * @param {(requestId: string, response: import('../../providers/contract.js').PermissionResponse) => void} respond
   * @param {(file: string) => Promise<{ text: string, binary: boolean, cut: boolean, size: number }>} read
   *   what a file of the folder says now
   */
  constructor(pane, ctx, respond, read) {
    this.pane = pane;
    this.ctx = ctx;
    this.respond = respond;
    this.read = read;
    /** @type {Map<string, Plan>} every plan of this conversation, oldest first */
    this.plans = new Map();
  }

  get size() {
    return this.plans.size;
  }

  /**
   * A plan that waits for an answer. It opens in a tab of its own.
   * @param {import('./invitations.js').PromptEvent} event
   * @returns {Plan}
   */
  add(event) {
    const plan = this.#keep(event.requestId, event, { text: event.plan });
    for (const id of draftsOf([...this.plans.values()], plan)) this.pane.close(id);
    this.show(plan.id);
    return plan;
  }

  /**
   * One answered before this window opened. It is kept for the links to it, and opens when asked for.
   * @param {{ id: string, plan: string, decision: string } & import('./participants.js').From} entry
   * @returns {Plan}
   */
  addHistory(entry) {
    return this.#keep(entry.id, entry, { text: entry.plan, decision: entry.decision });
  }

  /**
   * A plan kept in a file, that a call wrote to: the newest of the conversation's plans now.
   * @param {string} file  its path from the top of the folder
   * @param {import('./participants.js').From} [from]  the call, which says whose it is
   * @returns {Plan}
   */
  addFile(file, from = {}) {
    const id = planFileTab(file);
    const plan = this.plans.get(id) ?? this.#keep(id, from, { title: fileTitle(file), file });
    this.plans.delete(id);
    this.plans.set(id, plan);
    return plan;
  }

  /** Opens the tab of a plan kept in a file. @param {string} file */
  showFile(file) {
    this.show((this.plans.get(planFileTab(file)) ?? this.addFile(file)).id);
  }

  /** A call wrote to a plan's file: its tab, where it is open, shows what the file says now. @param {string} file */
  refreshFile(file) {
    const plan = this.plans.get(planFileTab(file));
    if (plan?.body && this.pane.has(plan.id)) void this.#readFile(plan);
  }

  /** @param {string} id @param {string} decision */
  resolve(id, decision) {
    const plan = this.plans.get(id);
    if (!plan) return;
    plan.decision = decision;
    if (plan.body) this.#drawFoot(plan);
  }

  /** @param {string} id */
  show(id) {
    const plan = this.plans.get(id);
    if (!plan) return;
    if (!plan.body) this.#draw(plan);
    this.pane.open({
      id,
      title: plan.title,
      icon: smallIcon.plan(),
      body: plan.body,
      // One kept in a file is read again when it is gone back to: the agent may have changed it since.
      ...(plan.file && { onSelect: () => void this.#readFile(plan), again: () => ({ planFile: plan.file }) }),
    });
    if (plan.file) void this.#readFile(plan);
  }

  /** The conversation's plans as menu items, the newest first: choosing one opens it. */
  menu() {
    if (!this.size) return [{ label: 'No plans in this conversation yet', disabled: true }];
    return [...this.plans.values()].reverse().map((plan) => ({
      label: plan.title,
      icon: smallIcon.plan(),
      // One kept in a file is not asked about.
      hint: plan.file ? '' : planState(plan.decision),
      action: () => this.show(plan.id),
    }));
  }

  /**
   * A new conversation has no plans yet. Redrawing an archived conversation keeps its files open to read,
   * while plans that asked for an answer are rebuilt from their saved, settled history.
   * @param {{ keepFiles?: boolean }} [options]
   */
  clear({ keepFiles = false } = {}) {
    for (const [id, plan] of this.plans) {
      if (keepFiles && plan.file) continue;
      this.pane.close(id, { unavailable: true });
      this.plans.delete(id);
    }
  }

  /**
   * @param {string} id
   * @param {import('./participants.js').From} from  the event or saved line that says whose plan it is
   * @param {{ text?: string, title?: string, decision?: string | null, file?: string }} what
   */
  #keep(id, from, { text = '', title = planTitle(text), decision = null, file }) {
    /** @type {Plan} */
    const plan = {
      id,
      text,
      title,
      by: speakerOf(this.ctx.participants, from).name,
      // A saved line of the host's doesn't say whose it is.
      speaker: from.speaker ?? this.ctx.participants[0].id,
      decision,
      file,
    };
    this.plans.set(id, plan);
    return plan;
  }

  /**
   * A plan's tab: the plan, and under it what #drawFoot puts there. Under one kept in a file is
   * where it is: it is read when the tab is shown (see #readFile).
   * @param {Plan} plan
   */
  #draw(plan) {
    plan.body = el('<div class="plan-tab"><div class="plan-text md md-doc"></div><div class="plan-foot"></div></div>');
    if (!plan.file) {
      renderMarkdown(plan.body.querySelector('.plan-text'), plan.text);
      this.#drawFoot(plan);
      return;
    }
    plan.body
      .querySelector('.plan-foot')
      .append(el(html`<div class="plan-answered">${plan.by} keeps this plan in ${plan.file}.</div>`));
  }

  /** Shows what a plan's file says now. @param {Plan} plan */
  async #readFile(plan) {
    const node = /** @type {HTMLElement} */ (plan.body.querySelector('.plan-text'));
    try {
      const file = await this.read(plan.file);
      renderMarkdown(node, file.binary ? '' : file.text);
      const note = fileNote(file);
      if (note) node.append(el(html`<p class="plan-answered">${note}</p>`));
    } catch (err) {
      node.textContent = errorText(err);
    }
  }

  /** The ways to answer a plan, or how it was answered. @param {Plan} plan */
  #drawFoot(plan) {
    const foot = plan.body.querySelector('.plan-foot');
    if (plan.decision) {
      foot.replaceChildren(el(html`<div class="plan-answered">${ANSWERED[plan.decision] || 'You answered.'}</div>`));
      return;
    }
    // The ways to approve a plan are those of the provider that made it.
    const { provider } = speakerOf(this.ctx.participants, plan);
    foot.replaceChildren(
      ...el(
        html`<div>
          <div class="plan-ask">${plan.by} has a plan. Ready to go?</div>
          <div class="plan-actions">
            ${provider.planApprovals.map(
              (a) =>
                html`<button class="btn${a.primary ? ' default' : ''}" type="button" data-mode="${a.mode}">
                  ${a.label}
                </button>`
            )}<a data-keep>No, keep planning</a>
          </div>
          <div class="plan-feedback" hidden>
            <textarea placeholder="What should change about the plan?"></textarea>
            <button class="btn" type="button">Send feedback</button>
          </div>
        </div>`
      ).children
    );
    for (const button of foot.querySelectorAll('[data-mode]')) {
      button.addEventListener('click', () =>
        this.respond(plan.id, { decision: 'approve-plan', mode: /** @type {HTMLElement} */ (button).dataset.mode })
      );
    }
    const feedback = /** @type {HTMLElement} */ (foot.querySelector('.plan-feedback'));
    const text = feedback.querySelector('textarea');
    foot.querySelector('[data-keep]').addEventListener('click', () => {
      feedback.hidden = false;
      text.focus();
    });
    feedback.querySelector('button').addEventListener('click', () => {
      const said = text.value.trim();
      this.respond(plan.id, {
        decision: 'feedback',
        message: said ? `Keep planning. Feedback: ${said}` : 'Keep planning.',
      });
    });
  }
}
