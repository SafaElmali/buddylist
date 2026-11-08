// Permission prompts, shown the way MSN showed file-transfer invitations:
// "Claude would like to run a command. Accept (⌥C) or Decline (⌥D)?"
// Also: multiple-choice questions, plans waiting for approval, and project instructions an agent
// wants to save, as a change to read. A plan itself opens beside the conversation (plans.js); here
// is only the line that says so.
import { activityRequest } from '../../shared/activity-text.js';
import { changeCounts, foldUnchanged, lineChanges } from '../../shared/line-diff.js';
import { planTitle } from '../../shared/plan-title.js';
import { INSTRUCTIONS_MAX, cleanInstructionText } from '../../shared/project-settings.js';
import { matchesShortcut, shortcutKeys, shortcutLabel, systemOf, typesOnMac } from '../../shared/shortcuts.js';
import { el, html, raw } from '../lib/dom.js';
import { relativePath } from '../lib/format.js';
import { smallIcon } from '../lib/icons.js';
import { diffMarkup } from './activity.js';
import { speakerOf } from './participants.js';

/**
 * A prompt as the window is sent it: `speaker` says which agent is asking.
 * @typedef {import('../../providers/contract.js').PermissionRequest & { requestId: string } & import('./participants.js').From} PromptEvent
 */

/**
 * How far you got with a card of questions you have not sent yet: the one on show, and what you
 * chose or wrote for each, by what it asks.
 * @typedef {{ current: number, picked: Record<string, { chosen: string[], other: string }> }} AnswersSoFar
 */

/**
 * How far you got with a card of project instructions: the text as you edited it, and whether the box
 * to edit it in was open.
 * @typedef {{ draft: string, editing: boolean }} InstructionsSoFar
 */

// Node, where the tests load this file, may have no navigator.
const SYSTEM = systemOf(globalThis.navigator?.platform);
const IS_MAC = SYSTEM === 'mac';

// Where you write: a text box, or a page you can type into.
const writable = (target) => Boolean(target?.isContentEditable) || ['INPUT', 'TEXTAREA'].includes(target?.tagName);
// The message box before anything is written in it, where the window keeps you: a message
// started with ç is rarer than an answer to the invitation the window is showing.
const emptyMessageBox = (target) => target?.id === 'input' && !target.value?.trim();

/**
 * What a press answers the newest Accept/Decline invitation with: ⌥C or ⌥D, unless they were
 * changed under Settings > Shortcuts. A shortcut is pressed with exactly its modifiers: ⌥C with
 * Ctrl as well is AltGr on Windows, which types a letter (ć, đ). On a Mac ⌥ types one too (ç, ∂),
 * so where you write such a shortcut is that letter, and it answers from anywhere else in the
 * window, the message box too while nothing is written in it. Holding them down answers once:
 * the repeats would answer the invitation waiting behind it.
 * @param {KeyboardEvent} e  a keydown
 * @param {boolean} mac
 * @param {Record<string, string>} keys  every shortcut's keys (see shared/shortcuts.js)
 * @returns {'allow' | 'deny' | null}  null when the press is no answer
 */
export function shortcutAnswer(e, mac, keys) {
  if (e.repeat) return null;
  const shortcut = [keys.accept, keys.decline].find((one) => matchesShortcut(e, one));
  if (!shortcut || (mac && typesOnMac(shortcut) && writable(e.target) && !emptyMessageBox(e.target))) return null;
  return shortcut === keys.accept ? 'allow' : 'deny';
}

const RESOLVED = {
  allow: 'You accepted.',
  always: 'You accepted, and won’t be asked about this again.',
  deny: 'You declined. Say what to do instead.',
  feedback: 'You sent feedback.',
  answer: 'You answered.',
  skip: 'You skipped this. It goes on without an answer.',
  'approve-plan': 'You approved the plan.',
  cancelled: 'This invitation was cancelled.',
};

const PAST = {
  allow: 'accepted',
  always: 'always allowed',
  deny: 'declined',
  feedback: 'sent feedback on',
  answer: 'answered',
  skip: 'skipped',
  'approve-plan': 'approved',
  cancelled: 'missed',
};

/** What Always allow said and says later where it covers the rest of the conversation only (see alwaysScope). */
const FOR_CONVERSATION = {
  resolved: 'You accepted for the rest of this conversation.',
  past: 'allowed for this conversation',
};

/** What a card of project instructions says once it is answered, and what the line for it says later. */
const SAVED = {
  allow: 'Saved',
  edit: 'Saved with your edits',
  deny: 'Not saved',
  cancelled: 'Not saved: the turn ended before you answered',
};

/** How many rows of a change to project instructions show before Show all: a fold of unchanged lines is one. */
export const PREVIEW_ROWS = 12;

const SIGN = { add: '+', del: '−', same: '' };

/**
 * A row of a change to project instructions: a line with its sign, or a fold of unchanged lines to open.
 * @param {import('../../shared/line-diff.js').DiffRow} row
 * @param {number} [index]  where it is among the rows drawn, for a fold to find its lines by
 */
const rowMarkup = (row, index) => {
  // On one line each: in a pre, room around the words would be shown.
  if (row.kind === 'fold') {
    const folded = `… ${row.lines.length} unchanged lines`;
    return html`<button class="ins-fold" type="button" data-row="${index}">${folded}</button>`;
  }
  const tint = row.kind === 'same' ? 'ins-same' : `diff-${row.kind}`;
  return html`<span class="ins-line ${tint}"><span class="diff-sign">${SIGN[row.kind]}</span>${row.text}</span>`;
};

export class Invitations {
  /** @type {Map<string, AnswersSoFar | InstructionsSoFar>} by request: a card drawn again is as you left it */
  #soFar = new Map();

  /**
   * @param {import('./conversation.js').Conversation} conversation
   * @param {{ contact: { cwd: string }, participants: import('../../providers/contract.js').Participant[], settings?: object }} ctx
   *   `contact`: the host, in whose folder everyone here works. `settings`: the app's, for the keys that answer
   * @param {(requestId: string, response: import('../../providers/contract.js').PermissionResponse) => void} respond
   * @param {import('./plans.js').Plans} [plans]  where plans open. The message history, which only reads, has no such place
   */
  constructor(conversation, ctx, respond, plans) {
    this.conversation = conversation;
    this.ctx = ctx;
    this.respond = respond;
    this.plans = plans;
    /**
     * `settle` draws a card that draws its own answer.
     * @type {Map<string, { node: HTMLElement, event: PromptEvent, settle?: (decision: string) => void }>}
     */
    this.open = new Map();
  }

  /** What you chose on the questions still waiting for you, by request, to keep while the window is on another contact. */
  get unsent() {
    return Object.fromEntries([...this.#soFar].filter(([requestId]) => this.open.has(requestId)));
  }

  /**
   * Puts back what you chose on questions, or wrote in place of instructions, before the window went on to
   * another contact: it is on them again when they are drawn.
   * @param {Record<string, AnswersSoFar | InstructionsSoFar>} answers  by request
   */
  restore(answers) {
    for (const [requestId, soFar] of Object.entries(answers)) this.#soFar.set(requestId, soFar);
  }

  /** @param {PromptEvent} event */
  add(event) {
    if (this.open.has(event.requestId)) return;
    const node = el('<div class="invite open"></div>');
    let settle;
    if (event.kind === 'question') this.#question(node, event);
    else if (event.kind === 'plan') this.#plan(node, event);
    else if (event.kind === 'instructions') settle = this.#instructions(node, event);
    else this.#tool(node, event);
    this.open.set(event.requestId, { node, event, settle });
    this.conversation.append(node, { force: true });
  }

  /**
   * @param {string} requestId
   * @param {import('../../providers/contract.js').PermissionResponse['decision']} decision
   * @param {Record<string, string>} [answers]  what you answered its questions, by what each asked
   * @param {{ id: string, name: string }} [answeredBy]  who answered them for you: the project's manager, by name
   */
  resolve(requestId, decision, answers, answeredBy) {
    const invite = this.open.get(requestId);
    if (!invite) return;
    this.open.delete(requestId);
    this.#soFar.delete(requestId);
    if (invite.event.kind === 'plan') this.plans.resolve(requestId, decision);
    this.conversation.keepPinned(() => {
      const { node, event, settle } = invite;
      node.classList.remove('open');
      if (settle) return settle(decision);
      node.querySelectorAll('.actions, .q > :not(.q-title)').forEach((n) => n.remove());
      // Each question keeps what you answered it, under it.
      if (answers) {
        node.querySelectorAll('.q').forEach((q, i) => {
          q.appendChild(el(html`<div class="q-answer">${answers[event.questions[i].question]}</div>`));
        });
      }
      const forConversation = decision === 'always' && event.alwaysScope === 'conversation';
      const said = answeredBy?.name
        ? `Answered by ${answeredBy.name}.`
        : (forConversation ? FOR_CONVERSATION.resolved : RESOLVED[decision]) || 'Done.';
      node.appendChild(el(html`<div class="resolved">${said}</div>`));
    });
  }

  /** The newest Accept/Decline invitation, for ⌥C / ⌥D. */
  latestTool() {
    return [...this.open.values()].reverse().find((i) => i.event.kind === 'tool')?.event || null;
  }

  /** The shortcuts were changed: the invitations still waiting name the keys that answer them now. */
  relabel() {
    for (const { node, event } of this.open.values()) if (event.kind === 'tool') this.#tool(node, event);
  }

  /** Whoever is asking: its name, and what its provider offers. @param {import('./participants.js').From} from */
  #asker(from) {
    return speakerOf(this.ctx.participants, from);
  }

  /** A summary line for prompts restored from history. */
  addHistory(entry) {
    const forConversation = entry.decision === 'always' && entry.scope === 'conversation';
    const answered = (forConversation ? FOR_CONVERSATION.past : PAST[entry.decision]) || 'answered';
    if (entry.plan) return this.#planHistory(entry, answered);
    if (entry.promptKind === 'question') return this.#questionsHistory(entry, answered);
    if (entry.promptKind === 'instructions') return this.#instructionsHistory(entry);
    const what = entry.title || `${this.#asker(entry).name} wanted to ${activityRequest(entry.activity)}`;
    this.conversation.line('notice', '', `You ${answered}: ${what.replace(/\.$/, '')}.`);
  }

  /** Questions answered earlier, each with what you answered it, or the project's manager did for you. */
  #questionsHistory(entry, answered) {
    const { questions = [], answers = {}, answeredBy } = entry;
    const asks = questions.length > 1 ? `${questions.length} questions` : 'question';
    const text = `${answeredBy?.name || 'You'} ${answered} ${this.#asker(entry).name}’s ${asks}`;
    // Saved before what they asked was kept.
    if (!questions.length) return this.conversation.line('notice', '', `${text}.`);
    const lines = questions.map(
      (q) => html`<div class="answer">${q}${answers[q] ? html` <b>${answers[q]}</b>` : ''}</div>`
    );
    this.conversation.line('notice', '', html`${text}:${lines}`);
  }

  /** Project instructions answered earlier: whose change to which, and whether it was saved. */
  #instructionsHistory(entry) {
    const { project = '', part = '' } = entry.instructions || {};
    const whose = project ? `${project}’s` : 'the project’s';
    const what = `${this.#asker(entry).name}’s change to ${whose} ${part ? `${part} ` : ''}instructions`;
    this.conversation.line('notice', '', `${SAVED[entry.decision] || SAVED.deny}: ${what}.`);
  }

  /** A plan answered earlier, with a link that opens it again where there is a pane for it. */
  #planHistory(entry, answered) {
    const text = `You ${answered} ${this.#asker(entry).name}’s plan: ${planTitle(entry.plan).replace(/\.$/, '')}.`;
    const plan = this.plans?.addHistory(entry);
    const node = this.conversation.line('notice', '', plan ? html`${text} <a class="link">View plan</a>` : text);
    node.querySelector('a')?.addEventListener('click', () => this.plans.show(plan.id));
  }

  // ---- the four kinds ----------------------------------------------------------------------

  #head(text) {
    return html`<div class="head">${raw(smallIcon.info())}<span>${text}</span></div>`;
  }

  /** @param {HTMLElement} node @param {PromptEvent} event */
  #tool(node, event) {
    const { activity } = event;
    const { name } = this.#asker(event);
    const show = (p) => relativePath(p, this.ctx.contact.cwd);
    const title = event.title || `${name} would like to ${activityRequest(activity, show)}.`;
    let detail = '';
    // The command the agent wants to run itself, or have typed into the terminals it asks for.
    if (event.detail) detail = html`<pre>${event.detail}</pre>`;
    else if (activity.command) detail = html`<pre>${activity.command}</pre>`;
    else if (activity.changes?.length) detail = html`<pre>${diffMarkup(activity.changes)}</pre>`;
    else if (activity.url || activity.query) detail = html`<pre>${activity.url || activity.query}</pre>`;
    // A manager's message, to read before it goes, and its answers to a worker's questions, under each.
    else if (activity.kind === 'app' && ['message', 'answer-question'].includes(activity.action)) {
      detail = html`<pre>${activity.prompt}</pre>`;
    }
    // What a manager's invite asks the agent to do first, to read before it joins.
    else if (activity.kind === 'app' && activity.action === 'invite' && activity.prompt) {
      detail = html`<pre>${activity.prompt}</pre>`;
    }
    const keys = shortcutKeys(this.ctx.settings, SYSTEM);
    const accept = shortcutLabel(keys.accept, IS_MAC);
    const decline = shortcutLabel(keys.decline, IS_MAC);
    node.replaceChildren(
      ...el(
        html`<div>
          ${this.#head(html`<b>${title}</b>`)}
          <div class="detail">${detail}</div>
          ${event.reason ? html`<div class="reason">${event.reason}</div>` : ''}
          <div class="actions">
            <span class="ask">Do you want to</span>
            <a data-d="allow"><b>Accept</b></a>
            ${
              event.canAlways
                ? // Its comma keeps to it, as a key's does, however long it says what it covers.
                  html`<span class="key">(${accept})<span class="ask">,</span></span>
                    <span
                      ><a data-d="always">${event.alwaysLabel || 'Always allow'}</a><span class="ask">, or</span></span
                    >`
                : html`<span class="key">(${accept})<span class="ask"> or</span></span>`
            }
            <a data-d="deny"><b>Decline</b></a>
            <span class="key">(${decline})<span class="ask"> the invitation?</span></span>
          </div>
        </div>`
      ).childNodes
    );
    node
      .querySelectorAll('[data-d]')
      .forEach((a) =>
        a.addEventListener('click', () => this.respond(event.requestId, { decision: /** @type {any} */ (a).dataset.d }))
      );
  }

  /**
   * Its questions one at a time, like slides: the others wait behind the one on show.
   * @param {HTMLElement} node @param {PromptEvent} event
   */
  #question(node, event) {
    const questions = event.questions || [];
    const last = questions.length - 1;
    const several = last > 0;
    const asks = several ? `${questions.length} questions` : 'a question';
    node.appendChild(
      el(html`<div>${this.#head(html`<b>${this.#asker(event).name} has ${asks} for you.</b>`)}</div>`).firstElementChild
    );
    // As you left it, when it was drawn before.
    const kept = this.#soFar.get(event.requestId);
    /** @type {AnswersSoFar['picked']} */
    const picked = {};
    const answerTo = (q) => picked[q.question]?.other.trim() || picked[q.question]?.chosen.join(', ') || '';
    const answered = (q) => Boolean(answerTo(q));
    const deck = el('<div class="q-deck"></div>');
    const actions = el(
      html`<div class="actions">
        ${several ? html`<button class="btn q-back" type="button">Back</button>` : ''}
        <button class="btn default q-next" type="button"></button>
        <a>Skip</a>
        ${
          several
            ? html`<span class="q-steps">
                <span class="q-dots"
                  >${questions.map((q) => html`<button class="q-dot" type="button" title="${q.question}"></button>`)}</span
                ><span class="q-count"></span>
              </span>`
            : ''
        }
      </div>`
    );
    const back = /** @type {HTMLButtonElement | null} */ (actions.querySelector('.q-back'));
    const next = actions.querySelector('.q-next');
    const dots = [...actions.querySelectorAll('.q-dot')];
    /** @type {HTMLElement[]} */
    const slides = [];
    let current = Number.isInteger(kept?.current) ? Math.max(0, Math.min(kept.current, last)) : 0;
    const keep = () => this.#soFar.set(event.requestId, { current, picked });

    const paint = () => {
      slides.forEach((slide, i) => slide.classList.toggle('current', i === current));
      dots.forEach((dot, i) => {
        dot.classList.toggle('current', i === current);
        dot.classList.toggle('answered', answered(questions[i]));
      });
      if (back) back.disabled = current === 0;
      if (several) actions.querySelector('.q-count').textContent = `${current + 1} of ${questions.length}`;
      next.textContent = current < last ? 'Next' : several ? 'Send answers' : 'Send answer';
    };
    const show = (index) => {
      // The slide comes in from the side it was on.
      deck.classList.toggle('backwards', index < current);
      current = index;
      keep();
      paint();
    };
    const send = () => {
      const missing = questions.findIndex((q) => !answered(q));
      if (missing === -1) {
        const answers = Object.fromEntries(questions.map((q) => [q.question, answerTo(q)]));
        return this.respond(event.requestId, { decision: 'answer', answers });
      }
      slides[missing].classList.add('unanswered');
      show(missing);
    };
    const forward = () => (current < last ? show(current + 1) : send());

    questions.forEach((q, index) => {
      const block = el(
        html`<div class="q">
          <div class="q-title">${q.question}</div>
          ${q.multiSelect ? html`<div class="q-note">Choose as many as you like.</div>` : ''}
          <div class="q-missing">Choose an answer first, or type your own.</div>
          <div class="options"></div>
          <input class="other" placeholder="Or type your own answer…" />
        </div>`
      );
      const options = block.querySelector('.options');
      const other = /** @type {HTMLInputElement} */ (block.querySelector('.other'));
      const was = kept?.picked?.[q.question];
      const offered = q.options.map((opt) => opt.label);
      const chosen = new Set(Array.isArray(was?.chosen) ? was.chosen.filter((label) => offered.includes(label)) : []);
      other.value = typeof was?.other === 'string' ? was.other : '';
      if (chosen.size || other.value) picked[q.question] = { chosen: [...chosen], other: other.value };
      const unchoose = () => {
        chosen.clear();
        options.querySelectorAll('.opt').forEach((b) => b.classList.remove('chosen'));
        options.querySelectorAll('input').forEach((box) => (box.checked = false));
      };
      const sync = () => {
        picked[q.question] = { chosen: [...chosen], other: other.value };
        keep();
        if (answered(q)) block.classList.remove('unanswered');
        paint();
      };
      for (const opt of q.options) {
        const text = html`${opt.label}${opt.description ? html`<small>${opt.description}</small>` : ''}`;
        // One that takes as many as you like has a box to tick by each.
        if (q.multiSelect) {
          const row = el(html`<label class="opt check"><input type="checkbox" /><span>${text}</span></label>`);
          const box = /** @type {HTMLInputElement} */ (row.querySelector('input'));
          box.checked = chosen.has(opt.label);
          row.classList.toggle('chosen', box.checked);
          box.addEventListener('change', () => {
            if (box.checked) chosen.add(opt.label);
            else chosen.delete(opt.label);
            row.classList.toggle('chosen', box.checked);
            other.value = '';
            sync();
          });
          options.appendChild(row);
          continue;
        }
        const button = el(html`<button class="opt" type="button">${text}</button>`);
        button.classList.toggle('chosen', chosen.has(opt.label));
        button.addEventListener('click', () => {
          const picked = !chosen.has(opt.label);
          unchoose();
          if (picked) chosen.add(opt.label);
          button.classList.toggle('chosen', picked);
          other.value = '';
          sync();
          // One answer is all this one takes: on to the next.
          if (picked && index < last) show(index + 1);
        });
        options.appendChild(button);
      }
      other.addEventListener('input', () => {
        // An answer of your own is instead of the ones on offer.
        if (other.value.trim()) unchoose();
        sync();
      });
      other.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.isComposing) forward();
      });
      slides.push(block);
      deck.appendChild(block);
    });

    back?.addEventListener('click', () => show(current - 1));
    next.addEventListener('click', forward);
    dots.forEach((dot, i) => dot.addEventListener('click', () => show(i)));
    // No answer, and no stop: the agent goes on with its own best judgment.
    actions.querySelector('a').addEventListener('click', () => this.respond(event.requestId, { decision: 'skip' }));
    paint();
    node.append(deck, actions);
  }

  /**
   * The plan opens in its tab beside the conversation, where it is read and answered.
   * @param {HTMLElement} node @param {PromptEvent} event
   */
  #plan(node, event) {
    const plan = this.plans.add(event);
    node.replaceChildren(
      ...el(
        html`<div>
          ${this.#head(html`<b>${plan.by} has a plan. Ready to go?</b>`)}
          <div class="plan-link">${raw(smallIcon.plan())}<span>${plan.title}</span><a class="link">View plan</a></div>
        </div>`
      ).childNodes
    );
    node.querySelector('.plan-link a').addEventListener('click', () => this.plans.show(plan.id));
  }

  /**
   * Project instructions an agent wants saved, as a change to read: the lines it takes out and puts in, with the
   * ones that stay folded. Saved as they are, edited first in the card, or not saved. The rest of the window goes
   * on meanwhile. What it answers is only ever what you saved: `edit` sends your text, kept as Settings keeps it.
   * @param {HTMLElement} node @param {PromptEvent} event
   * @returns {(decision: string) => void}  draws the card as answered
   */
  #instructions(node, event) {
    const { project, part, before, after } = event.instructions;
    const { name } = this.#asker(event);
    const kept = /** @type {Partial<InstructionsSoFar> | undefined} */ (this.#soFar.get(event.requestId));
    let draft = typeof kept?.draft === 'string' ? kept.draft : after;
    let editing = kept?.editing === true;
    let all = false;
    const keep = () => this.#soFar.set(event.requestId, { draft, editing });
    // Yours is what it saves once it differs from the agent's, as Settings would keep both.
    const yours = () => cleanInstructionText(draft) !== after;
    const head = el(
      html`<div>
        ${this.#head(html`<b>${name} wants to ${after ? 'change' : 'remove'} ${project}’s ${part} instructions.</b>`)}
      </div>`
    ).firstElementChild;
    const body = el('<div class="detail ins-body"></div>');
    const actions = el(
      html`<div class="actions">
        <button class="btn default" type="button" data-ins="save">Save</button>
        <button class="btn" type="button" data-ins="edit">Edit…</button>
        <button class="btn" type="button" data-ins="discard">Don’t save</button>
      </div>`
    );
    const [save, edit, discard] = /** @type {HTMLButtonElement[]} */ ([...actions.querySelectorAll('button')]);
    const answer = () => {
      const text = cleanInstructionText(draft);
      this.respond(event.requestId, text === after ? { decision: 'allow' } : { decision: 'edit', text });
    };

    /** The change as it would be saved: the agent's, or yours once you edited it. */
    const showChange = (text) => {
      const changes = lineChanges(before, text);
      const { added, removed } = changeCounts(changes);
      const rows = foldUnchanged(changes);
      const shown = all ? rows : rows.slice(0, PREVIEW_ROWS);
      const counts = [
        added > 0 && html`<span class="ins-added">+${added}</span>`,
        removed > 0 && html`<span class="ins-removed">−${removed}</span>`,
      ];
      // Nothing between the rows: in a pre, room between them would be lines of its own.
      const label = `${part} instructions, as they would be saved`;
      const diff = html`<pre class="ins-diff" aria-label="${label}">${shown.map(rowMarkup)}</pre>`;
      body.replaceChildren(
        ...el(
          html`<div>
            <div class="ins-summary">
              <span class="ins-counts">${counts}</span>
              ${text !== after ? html`<span class="ins-note">With your edits</span>` : ''}
            </div>
            ${diff}
            ${
              shown.length < rows.length
                ? html`<button class="link ins-all" type="button">Show all ${rows.length} lines</button>`
                : ''
            }
          </div>`
        ).childNodes
      );
      body.querySelectorAll('.ins-fold').forEach((fold) =>
        fold.addEventListener('click', () => {
          const row = shown[Number(/** @type {HTMLElement} */ (fold).dataset.row)];
          if (row?.kind === 'fold') fold.replaceWith(...row.lines.map((line) => el(rowMarkup(line))));
        })
      );
      body.querySelector('.ins-all')?.addEventListener('click', () => {
        all = true;
        showChange(text);
      });
    };

    /** The box to edit the text in, with what you wrote so far. */
    const showEditor = () => {
      const keys = IS_MAC ? '⌘↩' : 'Ctrl+Enter';
      body.replaceChildren(
        ...el(
          html`<div>
            <textarea
              class="ins-edit"
              rows="8"
              spellcheck="true"
              maxlength="${INSTRUCTIONS_MAX}"
              aria-label="${project}’s ${part} instructions"
            ></textarea>
            <div class="reason">${keys} saves. Esc goes back to the change.</div>
          </div>`
        ).childNodes
      );
      const box = /** @type {HTMLTextAreaElement} */ (body.querySelector('textarea'));
      box.value = draft;
      box.addEventListener('input', () => {
        draft = box.value;
        keep();
      });
      box.addEventListener('keydown', (/** @type {KeyboardEvent} */ e) => {
        if (e.key === 'Enter' && (IS_MAC ? e.metaKey : e.ctrlKey) && !e.isComposing) {
          e.preventDefault();
          answer();
        } else if (e.key === 'Escape') {
          // Back to the change, not a nudge: Esc anywhere else in the window stops the agent, and the card with it.
          e.preventDefault();
          e.stopPropagation();
          toggle();
          edit.focus();
        }
      });
      return box;
    };

    const draw = () => {
      if (editing) showEditor();
      else showChange(cleanInstructionText(draft));
      edit.textContent = editing ? 'Show change' : 'Edit…';
      edit.setAttribute('aria-pressed', String(editing));
    };
    const toggle = () => {
      editing = !editing;
      keep();
      draw();
    };

    save.addEventListener('click', answer);
    edit.addEventListener('click', () => {
      toggle();
      if (editing) {
        const box = /** @type {HTMLTextAreaElement} */ (body.querySelector('textarea'));
        box.focus();
        box.setSelectionRange?.(box.value.length, box.value.length);
      }
    });
    discard.addEventListener('click', () => this.respond(event.requestId, { decision: 'deny' }));
    draw();
    node.replaceChildren(head, body, actions);

    return (decision) => {
      // What was saved: yours, where you edited it. Otherwise the change as it was asked for.
      editing = false;
      showChange(decision === 'edit' && yours() ? cleanInstructionText(draft) : after);
      actions.remove();
      const done = decision === 'allow' && !after ? 'Removed' : SAVED[decision] || SAVED.deny;
      node.appendChild(el(html`<div class="resolved">${done}.</div>`));
    };
  }
}
