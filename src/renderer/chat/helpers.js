// The Subagents tab of the side pane: the helpers the agents here handed part of
// their work to, and what each of them is doing. A helper is an agent of an
// agent's own, which the window calls a subagent, as Claude Code does. It works
// on its own beside the conversation, and only its report comes back into it. One at work is listed
// first, with what it is doing right now. One that has ended stays listed, with
// its report, until a new conversation is started. Under a row: what the helper
// was asked, every step it took, and what it came back with.
import { activityStatus, helpersAtWork } from '../../shared/activity-text.js';
import { el, errorText, html } from '../lib/dom.js';
import { clock, plural } from '../lib/format.js';
import { buddy, smallIcon } from '../lib/icons.js';
import { renderMarkdown } from '../lib/markdown.js';
import { ActivityLine } from './activity.js';
import { isGroup, speakerOf } from './participants.js';

/** @typedef {import('../../providers/contract.js').Activity} Activity */

/**
 * A tool call, as a session's event describes it or as its line was saved. With a
 * result, once it has one.
 * @typedef {{ toolId: string, activity: Activity, helper?: string, output?: string, isError?: boolean,
 *   declined?: boolean, stopped?: boolean, durationMs?: number } & import('./participants.js').From} ToolCall
 */

/**
 * @typedef {Object} Helper
 * @property {string} id        the tool id of the call that asked for it
 * @property {string} label     what it was asked to do, in a few words
 * @property {string} agent     the kind of helper, where its provider names one: "Explore"
 * @property {string} prompt    what it was asked, in full
 * @property {string} by        the name of the agent whose helper it is
 * @property {string} [speaker] that agent's contact id; the host's own helpers have none
 * @property {'working' | 'done' | 'failed' | 'stopped' | 'declined'} status
 * @property {number} started   when it was asked
 * @property {number | null} took  how long it worked, once it has ended and that is known
 * @property {string} report    what it came back with, as Markdown
 * @property {{ id: string, activity: Activity, pending: boolean }[]} steps  the tool calls it made, oldest first
 */

/**
 * A helper's row.
 * @typedef {Object} Row
 * @property {Helper} helper
 * @property {HTMLElement} node
 * @property {boolean} open  what it was asked, its steps and its report are on show
 * @property {Map<string, ActivityLine>} lines  the line of each of its steps, by tool id
 * @property {string | null} reported  the report as it is drawn; null while a sentence stands in for it
 */

/** The tab's id in the pane. There is one Subagents tab, whoever is helping. */
const TAB = 'helpers';

/** What a row says of a helper that is no longer at work. */
const ENDED = {
  done: 'Finished',
  failed: 'Ran into a problem',
  stopped: 'Stopped before it was done',
  declined: 'Never started: you declined it',
};

/** What stands in for the report of a helper that brought none. */
const NO_REPORT = {
  done: 'It did not say how it went.',
  failed: 'It did not say what went wrong.',
  stopped: 'It was stopped before it could report.',
  declined: 'It was never started.',
};

/**
 * How a helper ended, going by the result of the call that asked for it.
 * @param {Pick<ToolCall, 'isError' | 'declined' | 'stopped'>} result
 * @returns {Exclude<Helper['status'], 'working'>}
 */
export const endedAs = ({ isError, declined, stopped }) =>
  declined ? 'declined' : stopped ? 'stopped' : isError ? 'failed' : 'done';

/**
 * A helper as the call that asked for it describes it. One that isn't at work has ended:
 * a saved call that never got its result just looks finished.
 * @param {ToolCall} call
 * @param {{ by: string, started: number, working: boolean }} about
 * @returns {Helper}
 */
export function helperOf(call, { by, started, working }) {
  const { label = '', agent = '', prompt = '' } = call.activity;
  /** @type {Helper} */
  const helper = {
    id: call.toolId,
    label,
    agent,
    prompt,
    by,
    speaker: call.speaker,
    status: 'working',
    started,
    took: null,
    report: '',
    steps: [],
  };
  return working ? helper : end(helper, call);
}

/**
 * The call that asked for a helper has its result: the helper has ended, and whatever step it
 * was in the middle of has ended with it.
 * @param {Helper} helper
 * @param {Pick<ToolCall, 'output' | 'isError' | 'declined' | 'stopped' | 'durationMs'>} result
 * @param {number} [now]  when the result came. Left out for a saved result, which doesn't say
 * @returns {Helper} the same helper
 */
export function end(helper, result, now) {
  helper.status = endedAs(result);
  helper.report = result.output || '';
  helper.took = result.durationMs ?? (now === undefined ? null : now - helper.started);
  for (const step of helper.steps) step.pending = false;
  return helper;
}

/**
 * The time at the end of a helper's row: how long it has been at work, or how long it took.
 * @param {Pick<Helper, 'status' | 'started' | 'took'>} helper
 * @param {number} now
 */
export function timeOf({ status, started, took }, now) {
  if (status === 'working') return clock(now - started);
  return took === null ? '' : clock(took);
}

/**
 * The line under a helper's name: what it is doing right now, or how it ended, and how many
 * steps it has taken.
 * @param {Pick<Helper, 'status' | 'steps'>} helper
 */
export function doing({ status, steps }) {
  const count = steps.length ? ` · ${steps.length} ${plural(steps.length, 'step')}` : '';
  if (status !== 'working') return `${ENDED[status]}${count}`;
  const current = steps.findLast((step) => step.pending);
  // Between two steps it reads what the last one printed, and decides on the next.
  const what = current ? activityStatus(current.activity) : steps.length ? 'Thinking' : 'Getting started';
  return `${what}${count}`;
}

/** How many of them are at work. @param {Pick<Helper, 'status'>[]} helpers */
export const atWork = (helpers) => helpers.filter((helper) => helper.status === 'working').length;

/**
 * The line at the top of the tab: "2 helpers at work".
 * @param {Pick<Helper, 'status'>[]} helpers
 */
export function summary(helpers) {
  const working = atWork(helpers);
  if (working) return helpersAtWork(working);
  return helpers.length ? 'No subagent at work' : 'No subagents yet';
}

/** Next to it: how many have ended, once any has. @param {Pick<Helper, 'status'>[]} helpers */
export function endedNote(helpers) {
  const ended = helpers.length - atWork(helpers);
  return ended ? `${ended} ended` : '';
}

/**
 * The order of the rows: the helpers at work first, as they were asked, then the ones that
 * ended, the one asked last on top.
 * @template {Pick<Helper, 'status'>} H
 * @param {H[]} helpers  in the order they were asked
 * @returns {H[]}
 */
export function ordered(helpers) {
  const working = helpers.filter((helper) => helper.status === 'working');
  const ended = helpers.filter((helper) => helper.status !== 'working');
  return [...working, ...ended.reverse()];
}

/**
 * The tag after a helper's name: its kind and, with several agents here, whose helper it is.
 * @param {Pick<Helper, 'agent' | 'by'>} helper
 * @param {boolean} several
 */
export const tagOf = ({ agent, by }, several) => [agent, several ? `for ${by}` : ''].filter(Boolean).join(' ');

/** Without a helper to list. @param {string[]} names  the agents here that can have helpers */
export function nobodyNote(names) {
  const who = names.length === 1 ? names[0] : 'an agent here';
  return `Nobody is helping yet. When ${who} hands part of a job to a subagent, it is listed here, with what it is doing.`;
}

const note = (text) => el(html`<div class="helpers-note">${text}</div>`);

export class Helpers {
  /** @type {Map<string, Row>} every helper of this conversation, in the order they were asked */
  #rows = new Map();
  /** @type {Map<string, Row>} the steps still going on, by tool id: each with the row of its helper */
  #steps = new Map();
  /** The clock that counts up the helpers at work, while any is. */
  #ticking = null;

  /**
   * @param {import('./side-pane.js').SidePane} pane
   * @param {{ contact: { cwd: string }, participants: import('../../providers/contract.js').Participant[] }} ctx
   * @param {object} opts
   * @param {(helper: Helper) => Promise<void>} opts.stop  asks the main process to stop one helper
   * @param {() => void} [opts.changed]  a helper came, or one ended: what the window says about them is out of date
   */
  constructor(pane, ctx, { stop, changed = () => {} }) {
    this.pane = pane;
    this.ctx = ctx;
    this.stop = stop;
    this.changed = changed;
    this.body = el(
      `<div class="helpers-tab">
        <div class="helpers-head">
          <span class="helpers-summary"></span>
          <span class="helpers-ended"></span>
        </div>
        <div class="helpers-list"></div>
      </div>`
    );
    this.summary = this.body.querySelector('.helpers-summary');
    this.ended = this.body.querySelector('.helpers-ended');
    this.list = /** @type {HTMLElement} */ (this.body.querySelector('.helpers-list'));
    /** @type {import('./side-pane.js').PaneTab} */
    this.tab = { id: TAB, title: 'Subagents', icon: smallIcon.helper(), body: this.body };

    this.list.addEventListener('click', (e) => {
      const target = /** @type {HTMLElement} */ (e.target);
      const node = target.closest('.helper');
      const row = node && [...this.#rows.values()].find((r) => r.node === node);
      if (!row) return;
      if (target.closest('.helper-stop')) this.#stop(row);
      else if (target.closest('.helper-row')) this.#toggle(row);
    });
    this.#draw();
  }

  /** How the pane's + lists this kind of tab. Its shortcut is the window's to add. */
  get kind() {
    return { label: 'Subagents', icon: smallIcon.helper(), open: () => this.show() };
  }

  /** How many helpers this conversation has had. */
  get size() {
    return this.#rows.size;
  }

  /** How many of them are at work. */
  get working() {
    return atWork(this.#helpers());
  }

  /** Opens the tab, or goes to it. */
  show() {
    this.pane.open(this.tab);
  }

  /** The toolbar's button: to the tab and, pressed with the tab on show, away with it. */
  toggle() {
    if (this.pane.selected === TAB) this.pane.close(TAB);
    else this.show();
  }

  /** Goes to one helper: its row, opened, in sight. @param {string} id */
  reveal(id) {
    this.show();
    const row = this.#rows.get(id);
    if (!row) return;
    if (!row.open) this.#toggle(row);
    row.node.scrollIntoView({ block: 'nearest' });
  }

  /**
   * The helpers of the conversation so far, from its saved lines.
   * @param {(ToolCall & { kind: string, time: number })[]} entries  the history, oldest first
   * @param {string[]} [running]  the tool calls that are still going on
   */
  restore(entries, running = []) {
    const live = new Set(running);
    for (const entry of entries) {
      if (entry.kind !== 'tool') continue;
      this.#track(entry, { started: entry.time, working: live.has(entry.toolId), saved: true });
    }
    this.#arrange();
  }

  /** An agent made a tool call: one that asks for a helper, or a step of a helper's. @param {ToolCall} call */
  add(call) {
    if (this.#track(call, { started: Date.now(), working: true })) this.#arrange();
  }

  /** The helpers there are changed, or one of them ended: the list is drawn again, and the window is told. */
  #arrange() {
    this.#draw();
    this.changed();
  }

  /**
   * A tool call has its result: a helper's step, or the call that asked for a helper, which
   * means that helper has ended.
   * @param {string} toolId
   * @param {ToolCall} result
   */
  setResult(toolId, result) {
    const row = this.#rows.get(toolId);
    if (row?.helper.status === 'working') {
      end(row.helper, result, Date.now());
      // The step it was in the middle of gets no result of its own.
      for (const [id, of] of this.#steps) {
        if (of !== row) continue;
        row.lines.get(id).rest();
        this.#steps.delete(id);
      }
      this.#paint(row);
      this.#arrange();
    }
    // A helper's helper is a step of the one that asked for it as well.
    const of = this.#steps.get(toolId);
    if (!of) return;
    this.#steps.delete(toolId);
    of.helper.steps.find((step) => step.id === toolId).pending = false;
    of.lines.get(toolId).settle(result);
    this.#paint(of);
  }

  /** A new conversation has had no helpers yet. */
  clear() {
    this.#rows.clear();
    this.#steps.clear();
    this.#arrange();
  }

  #helpers() {
    return [...this.#rows.values()].map((row) => row.helper);
  }

  /**
   * Takes note of a tool call, where it has to do with a helper.
   * @param {ToolCall} call
   * @param {{ started: number, working: boolean, saved?: boolean }} about  `saved`: it is a line of the
   *   history, which carries its result if it ever got one
   * @returns {boolean} whether it asked for a helper that was not listed yet
   */
  #track(call, { started, working, saved = false }) {
    const of = call.helper && this.#rows.get(call.helper);
    if (of) this.#step(of, call, { pending: working && of.helper.status === 'working', saved });
    if (call.activity.kind !== 'delegate' || this.#rows.has(call.toolId)) return false;
    const by = speakerOf(this.ctx.participants, call).name;
    const row = this.#row(helperOf(call, { by, started, working }));
    this.#rows.set(call.toolId, row);
    this.#paint(row);
    return true;
  }

  /** A step one helper took. @param {Row} row @param {ToolCall} call */
  #step(row, call, { pending, saved }) {
    const line = new ActivityLine(call, { actor: '', cwd: this.ctx.contact.cwd });
    row.helper.steps.push({ id: call.toolId, activity: call.activity, pending });
    row.lines.set(call.toolId, line);
    if (pending) {
      line.wait();
      this.#steps.set(call.toolId, row);
    } else if (saved && call.output !== undefined) line.settle(call);
    row.node.querySelector('.helper-steps').appendChild(line.node);
    this.#paint(row);
  }

  /** @param {Helper} helper @returns {Row} a row for a helper that was not listed before */
  #row(helper) {
    const node = el(
      html`<div class="helper">
        <div class="helper-top">
          <button class="helper-row" type="button" aria-expanded="false">
            <span class="helper-arrow"></span>
            <span class="helper-buddy"></span>
            <span class="helper-name" title="${helper.label}"
              ><b>${helper.label}</b><span class="helper-tag"></span
            ></span>
            <span class="helper-time"></span>
          </button>
          <button class="helper-stop link" type="button" title="Stop this subagent. The rest carries on">Stop</button>
        </div>
        <div class="helper-doing"></div>
        <div class="helper-detail" hidden>
          <div class="helper-part">Asked to</div>
          <div class="helper-prompt"></div>
          <div class="helper-part">Steps</div>
          <div class="helper-steps"></div>
          <div class="helper-part">Report</div>
          <div class="helper-report md"></div>
        </div>
      </div>`
    );
    node.querySelector('.helper-prompt').textContent = helper.prompt || helper.label;
    return { helper, node, open: false, lines: new Map(), reported: null };
  }

  /** Brings a row up to date with its helper. @param {Row} row */
  #paint(row) {
    const { helper, node } = row;
    const working = helper.status === 'working';
    node.className = `helper ${helper.status}${node.classList.contains('open') ? ' open' : ''}`;
    // At work it wears the buddy of a contact at work, and afterwards that of one who has left.
    node.querySelector('.helper-buddy').innerHTML = buddy(working ? 'busy' : 'offline', 14);
    node.querySelector('.helper-tag').textContent = tagOf(helper, isGroup(this.ctx.participants));
    node.querySelector('.helper-time').textContent = timeOf(helper, Date.now());
    node.querySelector('.helper-doing').textContent = doing(helper);
    /** @type {HTMLElement} */ (node.querySelector('.helper-stop')).hidden = !working;
    // What the list of its steps says while it is empty (see `.helper-steps:empty`).
    /** @type {HTMLElement} */ (node.querySelector('.helper-steps')).dataset.none = working ? 'None yet.' : 'None.';
    const report = /** @type {HTMLElement} */ (node.querySelector('.helper-report'));
    if (working || !helper.report) {
      report.textContent = working ? 'It reports when it is done.' : NO_REPORT[helper.status];
      row.reported = null;
    } else if (row.reported !== helper.report) {
      // Every step of a helper comes by here, and its report reads the same at each of them.
      renderMarkdown(report, helper.report);
      row.reported = helper.report;
    }
    report.classList.toggle('none', working || !helper.report);
  }

  /**
   * Puts the rows in their order, and says how many there are. A row keeps its node, and
   * with it what was opened in it.
   */
  #draw() {
    const helpers = this.#helpers();
    this.summary.textContent = summary(helpers);
    this.ended.textContent = endedNote(helpers);
    const rows = ordered(helpers).map((helper) => this.#rows.get(helper.id).node);
    const working = atWork(helpers);
    // With helpers at work above them, the ones that ended get a line of their own.
    if (working && working < rows.length) rows.splice(working, 0, el('<div class="helpers-divider">Ended</div>'));
    const offered = this.ctx.participants.filter((p) => p.provider.helpers).map((p) => p.name);
    // Where the list was scrolled to is where it stays.
    const top = this.list.scrollTop;
    this.list.replaceChildren(...(rows.length ? rows : [note(nobodyNote(offered))]));
    this.list.scrollTop = top;
    this.#tick();
  }

  /** Counts up the helpers at work, once a second, for as long as any is. */
  #tick() {
    const working = this.working > 0;
    if (working && !this.#ticking) {
      this.#ticking = setInterval(() => {
        for (const { helper, node } of this.#rows.values()) {
          if (helper.status === 'working') node.querySelector('.helper-time').textContent = timeOf(helper, Date.now());
        }
      }, 1000);
    } else if (!working && this.#ticking) {
      clearInterval(this.#ticking);
      this.#ticking = null;
    }
  }

  /** Shows what a helper was asked, its steps and its report under its row, or puts them away. @param {Row} row */
  #toggle(row) {
    row.open = !row.open;
    row.node.classList.toggle('open', row.open);
    row.node.querySelector('.helper-row').setAttribute('aria-expanded', String(row.open));
    /** @type {HTMLElement} */ (row.node.querySelector('.helper-detail')).hidden = !row.open;
  }

  /** Asks for one helper to be stopped. That it has stopped is said as any ending is: by its call's result. */
  async #stop(row) {
    const button = /** @type {HTMLButtonElement} */ (row.node.querySelector('.helper-stop'));
    button.disabled = true;
    button.textContent = 'Stopping…';
    try {
      await this.stop(row.helper);
    } catch (err) {
      // It could not be asked: the button is there to try again, and says why.
      button.disabled = false;
      button.textContent = 'Stop';
      button.title = errorText(err);
    }
  }
}
