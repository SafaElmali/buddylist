// "Claude ran `npm test`", "Claude edited app.js": one line per tool call,
// with its output or changes one click away. The calls an agent makes one
// after another are folded into one line, "Claude ran 3 commands and read
// 2 files", that opens on the line of each.
import { el, html, raw } from '../lib/dom.js';
import { clock, listNames, plural } from '../lib/format.js';
import { activityIcon, smallIcon } from '../lib/icons.js';
import { viewPictures } from '../lib/picture-viewer.js';
import { fileTitle } from './files.js';
import { speakerOf } from './participants.js';
import { planFileOf } from './plans.js';
import { activityStatus, clipLines, isDoing } from '../../shared/activity-text.js';
import { describeActivity, outcomeOf } from '../lib/activity-line.js';
import { searchTerms } from '../../shared/search.js';
import { knownTodos } from '../../shared/todo-handoff.js';

// What a call is said as, by the phone too (see lib/activity-line.js).
export { describeActivity, outcomeOf };

/** @typedef {import('../../providers/contract.js').Activity} Activity */

/**
 * One call of a run of them.
 * @typedef {{ activity: Activity, pending: boolean, since: number, sub?: boolean, helper?: string, pictures?: string[], plan?: string }} Step
 *   `pending`: it is going on. `since`: when it started. `sub`: a helper made it, the one `helper`
 *   is the call that asked for, where that is known. `pictures`: what it handed back to look at.
 *   `plan`: the file of a plan it wrote to, from the top of the folder
 */

/** "a file", "3 files". */
const some = (count, one) => `${count === 1 ? 'a' : count} ${plural(count, one)}`;

/** How often, after what was done: nothing for once, " twice", " 3 times". */
const again = (count) => (count === 1 ? '' : count === 2 ? ' twice' : ` ${count} times`);

/** The kinds of call `tally` has words of their own for. Any other is a tool. */
const TALLIED = ['command', 'read', 'edit', 'write', 'search', 'web', 'delegate', 'skill'];

/**
 * What some tool calls came to, in a few words: "ran 3 commands, read 2 files and edited a file".
 * A file read or edited more than once is counted once. A command left running in the background
 * was started, not run.
 * @param {Activity[]} activities
 */
export function tally(activities) {
  const of = (...kinds) => activities.filter((a) => kinds.includes(a.kind));
  const files = (list) => new Set(list.map((a) => a.path)).size;
  const commands = of('command').filter((a) => !a.background).length;
  const left = of('command').length - commands;
  const read = files(of('read'));
  const edited = files(of('edit', 'write'));
  const searches = of('search').length;
  const web = of('web').length;
  const helpers = of('delegate').length;
  const skills = of('skill');
  const said = [
    commands && `ran ${some(commands, 'command')}`,
    left && `started ${some(left, 'command')} in the background`,
    read && `read ${some(read, 'file')}`,
    edited && `edited ${some(edited, 'file')}`,
    searches && `searched the project${again(searches)}`,
    web && `browsed the web${again(web)}`,
    helpers && `asked ${some(helpers, 'subagent')}`,
    skills.length && (skills.length === 1 ? `used the ${skills[0].label} skill` : `used ${skills.length} skills`),
  ].filter(Boolean);
  const others = activities.length - of(...TALLIED).length;
  if (others && said.length) said.push(`used ${others === 1 ? 'one other tool' : `${others} other tools`}`);
  else if (others) said.push(`used ${some(others, 'tool')}`);
  return listNames(said);
}

/**
 * The step a run's line says is going on: a helper's. What the agent itself is doing is said
 * under the newest line, for as long as it is at work (see now.js).
 * @param {Step[]} steps
 */
export const helperGoingOn = (steps) => steps.findLast((step) => step.pending && step.sub);

/**
 * What the line of a run of calls says: what the calls came to, like "Claude ran 3 commands", and
 * what a helper is doing while one is at it. A call going on is counted once it is over, unless
 * none is yet. What its helpers did is theirs: the agent "asked 2 subagents".
 * @param {string} actor
 * @param {Step[]} steps
 */
export function foldSays(actor, steps) {
  const current = helperGoingOn(steps);
  if (current) return isDoing('A subagent', activityStatus(current.activity));
  const own = steps.filter((step) => !step.sub);
  const over = own.filter((step) => !step.pending);
  if (own.length) return `${actor} ${tally((over.length ? over : own).map((step) => step.activity))}`;
  // Only its helpers' steps: the agent said something since it asked for them.
  const helpers = new Set(steps.map((step) => step.helper)).size;
  return `${helpers === 1 ? 'A subagent' : `${helpers} subagents`} ${tally(steps.map((step) => step.activity))}`;
}

/** Line-by-line before/after view of file changes. */
export function diffMarkup(changes = []) {
  const lines = (text, cls, sign) => {
    if (!text) return [];
    // Changes are clipped where they are made; ones saved before that are clipped here.
    return clipLines(text)
      .split('\n')
      .map((l) => html`<span class="${cls}">${sign} ${l}</span>`);
  };
  return changes.map((c) => html`${lines(c.before, 'diff-del', '-')}${lines(c.after, 'diff-add', '+')}`);
}

/**
 * The pictures the calls of a run handed back to look at, in the order the calls were made.
 * @param {Step[]} steps
 */
export const foldPictures = (steps) => steps.flatMap((step) => step.pictures ?? []);

/**
 * The files of plans the calls of a run wrote to, each once, in the order they were first written to.
 * @param {Step[]} steps
 */
export const foldPlans = (steps) => [...new Set(steps.flatMap((step) => step.plan ?? []))];

/**
 * Small pictures of what calls handed back, each opening over the window with the others of its row to go through.
 * @param {string[]} sources  the pictures of the row
 */
function thumbnails(sources) {
  const pictures = sources.map((src) => Object.assign(new Image(), { src, alt: 'Picture' }));
  return pictures.map((img, index) => {
    const button = el(html`<button class="tool-picture" type="button" title="Open the picture"></button>`);
    button.appendChild(img);
    // A press leaves the focus where it was, the message box say, to be there again once the picture is closed.
    button.addEventListener('mousedown', (e) => e.preventDefault());
    button.addEventListener('click', () =>
      viewPictures(
        pictures.map((one) => ({ src: one.src, img: one })),
        index
      )
    );
    return button;
  });
}

/** @type {WeakMap<Element, ActivityLine>} each call's line, by its node */
const lines = new WeakMap();

/**
 * What was opened in the conversation's lines of tool calls, by the id of the call each is of: the runs whose
 * calls are on show, by their first call, and the calls whose output or changes are. Coming back to the
 * conversation, they are opened again (see `ActivityLines.reopen`). The newest of each, up to this many.
 */
export const OPENED_AT_MOST = 200;

/**
 * One tool call's line: who did what, with its changes one click away and, once it has
 * a result, its output and what it handed back to look at. In the conversation, and among
 * a helper's steps in the Helpers tab.
 */
export class ActivityLine {
  /** @type {{ pre: HTMLElement, toggle: HTMLElement, label: string } | null} its output or changes, once it has them */
  #detail = null;

  /**
   * @param {{ activity: Activity, sub?: boolean, toolId?: string }} tool  `toolId`: the call's, which the line is known by
   * @param {object} opts
   * @param {string} opts.actor  whose line it is: "Claude", "Subagent". Empty where that is said above it
   * @param {string} opts.cwd    the folder its paths are shown from
   * @param {(change: () => void) => void} [opts.around]  wraps whatever makes the line taller or
   *   shorter, e.g. to keep the conversation at its newest line
   */
  constructor({ activity, sub = false, toolId }, { actor, cwd, around = (change) => change() }) {
    this.around = around;
    // Under the line of a run of calls, a command reads as why it was run, where it says why.
    const why = activity.kind === 'command' && activity.description;
    this.node = el(
      html`<div class="event tool${sub ? ' sub' : ''}">
        <div class="line">
          ${raw(activityIcon(activity.kind))}<span class="said${why ? ' described' : ''}"
            >${actor ? html`<span class="actor">${actor} </span>` : ''}<span class="what"
              >${describeActivity(activity, cwd)}</span
            >${why ? html`<span class="why" title="${activity.command}">${why}</span>` : ''}<span class="state"></span
          ></span>
        </div>
      </div>`
    );
    if (toolId) this.node.dataset.tool = toolId;
    lines.set(this.node, this);
    this.text = /** @type {HTMLElement} */ (this.node.querySelector('.line > span'));
    this.state = /** @type {HTMLElement} */ (this.node.querySelector('.state'));
    if (activity.description) this.text.title = activity.description;
    if (activity.todos?.length) {
      this.node.appendChild(
        el(
          html`<ul class="todos">
            ${knownTodos(activity).map(
              (t) => html`<li class="${t.status}">${t.status === 'completed' ? '☑' : '☐'} ${t.text}</li>`
            )}
          </ul>`
        )
      );
    }
    if (activity.changes?.length) {
      this.#addToggle(el(html`<pre class="output">${diffMarkup(activity.changes)}</pre>`), 'Show changes');
    }
  }

  /** It is going on: the line says so until it is settled, or left to rest. */
  wait() {
    this.state.className = 'state pending';
    this.state.textContent = '…';
  }

  /** Nothing more will be heard of it: the line just looks finished. */
  rest() {
    this.state.className = 'state';
    this.state.textContent = '';
  }

  /** A link after what the line says. @param {string} label @param {() => void} action */
  link(label, action) {
    const link = el(html`<a class="toggle">${label}</a>`);
    link.addEventListener('click', action);
    this.text.appendChild(link);
  }

  /** @param {{ output?: string, isError?: boolean, declined?: boolean, skipped?: boolean, stopped?: boolean, pictures?: string[] }} result */
  settle(result) {
    const { output, isError, pictures } = result;
    const how = outcomeOf(result);
    this.state.className = `state${how ? ` ${how}` : ''}`;
    this.state.textContent = how ? `(${how})` : '';
    const hasDetail = this.node.querySelector('pre.output, .todos');
    // What a declined or skipped call hands back is only what the agent was told of it.
    if (!['declined', 'skipped'].includes(how) && output?.trim() && !hasDetail) {
      const pre = el(html`<pre class="output${isError ? ' error' : ''}">${output}</pre>`);
      this.#addToggle(pre, isError ? 'Show error' : 'Show output');
    }
    // What it handed back to look at, such as a screenshot, is on show right under the line.
    if (pictures?.length) {
      const row = el(html`<div class="tool-pictures"></div>`);
      row.append(...thumbnails(pictures));
      this.node.querySelector('.line').after(row);
    }
  }

  #addToggle(pre, label) {
    pre.hidden = true;
    this.node.appendChild(pre);
    const toggle = el(html`<a class="toggle">${label}</a>`);
    this.#detail = { pre, toggle, label };
    toggle.addEventListener('click', () => this.around(() => this.showDetail(pre.hidden)));
    this.text.appendChild(toggle);
  }

  /** Whether its output or changes are on show under it. */
  get detailShown() {
    return Boolean(this.#detail) && !this.#detail.pre.hidden;
  }

  /** Shows its output or changes under it, or puts them away. One that has none has nothing to show. @param {boolean} shown */
  showDetail(shown) {
    if (!this.#detail) return;
    const { pre, toggle, label } = this.#detail;
    pre.hidden = !shown;
    toggle.textContent = shown ? 'Hide' : label;
  }
}

/** @type {WeakMap<Element, Fold>} each run's line, by its node */
const folds = new WeakMap();

/**
 * A run of tool calls one agent made with nothing else said in between: one line that says what
 * is going on or what they came to, with the line of each call under it once it is opened. A run
 * of one call is that call's own line.
 */
class Fold {
  /** @type {Step[]} */
  steps = [];
  open = false;
  /** The kind of call its drawing is of. */
  kind = '';

  /**
   * @param {string} actor  whose calls they are
   * @param {(change: () => void) => void} around  wraps whatever makes it taller or shorter
   * @param {(file: string) => void} [showPlan]  opens the tab of a plan kept in a file
   */
  constructor(actor, around, showPlan) {
    this.actor = actor;
    // Whose calls they are, for a picture one of them handed back to be replied with (see picture-reply.js).
    this.node = el(
      html`<div class="event tool fold" data-who="${actor}">
        <button class="line fold-head" type="button" aria-expanded="false">
          <svg></svg
          ><span><span class="fold-says"></span><span class="fold-time"></span><span class="fold-arrow"></span></span>
        </button>
        <div class="fold-plans" hidden></div>
        <div class="tool-pictures" hidden></div>
        <div class="fold-steps"></div>
      </div>`
    );
    this.head = /** @type {HTMLButtonElement} */ (this.node.querySelector('.fold-head'));
    this.plans = /** @type {HTMLElement} */ (this.node.querySelector('.fold-plans'));
    this.plans.addEventListener('click', (e) => {
      const link = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-plan]'));
      if (link) showPlan?.(link.dataset.plan);
    });
    this.pictures = /** @type {HTMLElement} */ (this.node.querySelector('.tool-pictures'));
    this.list = /** @type {HTMLElement} */ (this.node.querySelector('.fold-steps'));
    this.head.addEventListener('click', () => around(() => this.toggle()));
    folds.set(this.node, this);
  }

  /** @param {ActivityLine} line @param {Step} step */
  add(line, step) {
    this.steps.push(step);
    this.list.appendChild(line.node);
    this.paint(Date.now());
  }

  /** Opens the line of each call, or puts them away. @param {boolean} [open] */
  toggle(open = !this.open) {
    this.open = open;
    this.paint(Date.now());
  }

  /**
   * Brings it up to date: what it says, how long a helper's step going on has taken, whether it is open,
   * and what its calls handed back to look at.
   * @param {number} now
   */
  paint(now) {
    const single = this.steps.length === 1;
    const current = helperGoingOn(this.steps);
    this.node.classList.toggle('single', single);
    this.node.classList.toggle('open', this.open);
    this.node.classList.toggle('working', Boolean(current));
    this.head.hidden = single;
    this.head.setAttribute('aria-expanded', String(this.open));
    this.list.hidden = !single && !this.open;
    // With its calls put away, the pictures they handed back are on show under its line. A call's
    // result only ever adds some, so a row with as many as there are is up to date.
    const pictures = foldPictures(this.steps);
    if (pictures.length !== this.pictures.childElementCount) this.pictures.replaceChildren(...thumbnails(pictures));
    this.pictures.hidden = single || this.open || !pictures.length;
    // So is a plan they wrote, with the way to it: no plan kept in a file goes unseen in a run put away.
    const plans = foldPlans(this.steps);
    if (plans.length !== this.plans.childElementCount) {
      this.plans.replaceChildren(
        ...plans.map((file) =>
          el(
            html`<div class="fold-plan" title="${file}">
              ${raw(smallIcon.plan())}<span>${fileTitle(file)}</span><a class="link" data-plan="${file}">View plan</a>
            </div>`
          )
        )
      );
    }
    this.plans.hidden = single || this.open || !plans.length;
    if (single) return;
    // The drawing is of a helper's step going on, or of the agent's own last call.
    const { kind } = (current ?? this.steps.findLast((step) => !step.sub) ?? this.steps.at(-1)).activity;
    if (kind !== this.kind) {
      this.head.firstElementChild.replaceWith(el(activityIcon(kind)));
      this.kind = kind;
    }
    this.head.querySelector('.fold-says').textContent = foldSays(this.actor, this.steps);
    this.head.querySelector('.fold-time').textContent = current ? clock(now - current.since) : '';
  }
}

export class ActivityLines {
  /** The clock that counts up the calls going on, while any is. */
  #ticking = null;

  /**
   * @param {import('./conversation.js').Conversation} conversation
   * @param {{ contact: { cwd: string }, participants: { id: string, name: string }[] }} ctx
   *   `contact`: the host, in whose folder everyone here works
   * @param {object} [tabs]  the tabs beside the conversation, where the window has them
   * @param {Pick<import('./helpers.js').Helpers, 'reveal'>} [tabs.helpers]  the Subagents tab: the line of a
   *   call that asked for a subagent links to it
   * @param {Pick<import('./background.js').Background, 'reveal'>} [tabs.background]  the Background tab: the
   *   line of a call that left something running there links to it
   * @param {Pick<import('./plans.js').Plans, 'addFile' | 'showFile' | 'refreshFile'>} [tabs.plans]  the plans: the
   *   line of a call that wrote to a plan kept in a file links to its tab, and so does its run's, put away
   */
  constructor(conversation, ctx, { helpers, background, plans } = {}) {
    this.conversation = conversation;
    this.ctx = ctx;
    this.helpers = helpers;
    this.background = background;
    this.plans = plans;
    /** @type {Map<string, { line: ActivityLine, step: Step, fold: Fold, helper?: string }>} the calls still going on, by tool id */
    this.pending = new Map();
    /** @type {Fold | null} the run the next call joins, while nothing else has been said since */
    this.fold = null;
  }

  /**
   * @param {{ toolId: string, activity: Activity, sub?: boolean, helper?: string, output?: string, isError?: boolean, declined?: boolean, skipped?: boolean, stopped?: boolean, pictures?: string[] } & import('./participants.js').From} tool
   * @param {{ fromHistory?: boolean }} [opts]
   */
  add(tool, { fromHistory = false } = {}) {
    const { activity, sub } = tool;
    const { name } = speakerOf(this.ctx.participants, tool);
    const around = (change) => this.conversation.keepPinned(change);
    const line = new ActivityLine(tool, { actor: sub ? 'Subagent' : name, cwd: this.ctx.contact.cwd, around });
    if (activity.kind === 'delegate' && this.helpers) {
      line.link('View subagent', () => this.helpers.reveal(tool.toolId));
    }
    if (activity.kind === 'command' && activity.background && this.background) {
      line.link('View in Background', () => this.background.reveal(tool.toolId));
    }
    const plan = (this.plans && planFileOf(activity, this.ctx.contact.cwd)) || undefined;
    if (plan) {
      this.plans.addFile(plan, tool);
      line.link('View plan', () => this.plans.showFile(plan));
    }
    const step = {
      activity,
      pending: !fromHistory,
      since: Date.now(),
      sub: Boolean(sub),
      helper: tool.helper,
      pictures: tool.pictures,
      plan,
    };
    const joins = this.#joins(name, activity);
    const fold = joins ? this.fold : new Fold(name, around, (file) => this.plans?.showFile(file));
    if (joins) {
      around(() => fold.add(line, step));
    } else {
      // Known by its first call, as the window draws it again.
      if (tool.toolId) fold.node.dataset.run = tool.toolId;
      fold.add(line, step);
      this.conversation.append(fold.node);
      // A to-do list is on show as it is, on a line of its own.
      this.fold = activity.kind === 'todo' ? null : fold;
    }
    if (fromHistory) {
      if (tool.output !== undefined) line.settle(tool);
    } else {
      line.wait();
      this.pending.set(tool.toolId, { line, step, fold, helper: tool.helper });
      this.#tick();
    }
  }

  /** @param {string} toolId @param {{ output: string, isError: boolean, declined: boolean, skipped?: boolean, stopped?: boolean, pictures?: string[] }} result */
  setResult(toolId, result) {
    const call = this.pending.get(toolId);
    if (!call) return;
    this.conversation.keepPinned(() => {
      call.step.pictures = result.pictures;
      call.line.settle(result);
      this.#over(toolId);
      // The plan it wrote to is in its file now.
      if (call.step.plan) this.plans.refreshFile(call.step.plan);
      // A helper that has ended takes no more steps: one it was in the middle of gets no result.
      for (const [id, step] of this.pending) {
        if (step.helper !== toolId) continue;
        step.line.rest();
        this.#over(id);
      }
    });
    this.#tick();
  }

  /** Lines restored from history that never got a result just look finished. */
  settleAll() {
    for (const [id, { line }] of this.pending) {
      line.rest();
      this.#over(id);
    }
    this.#tick();
  }

  /**
   * Opens every run with a call whose line says a word of `text`, for a search to find it there.
   * @param {string} text  searched for as shared/search.js has it: its words, and its "quoted phrases"
   */
  unfold(text) {
    const terms = searchTerms(text);
    if (!terms.length) return;
    for (const node of this.conversation.root.querySelectorAll('.fold:not(.single):not(.open)')) {
      const fold = folds.get(node);
      const lines = [...fold.list.querySelectorAll('.line')].map((line) => line.textContent.toLowerCase());
      if (lines.some((line) => terms.some((term) => line.includes(term)))) fold.toggle(true);
    }
  }

  /**
   * What is opened in the conversation's lines (see OPENED_AT_MOST): to open again as the window comes back to it.
   * @returns {{ runs: string[], details: string[] }}
   */
  get opened() {
    const { root } = this.conversation;
    const runs = [...root.querySelectorAll('.fold.open[data-run]')].map((node) => node.dataset.run);
    const details = [...root.querySelectorAll('.tool[data-tool]')]
      .filter((node) => lines.get(node)?.detailShown)
      .map((node) => node.dataset.tool);
    return { runs: runs.slice(-OPENED_AT_MOST), details: details.slice(-OPENED_AT_MOST) };
  }

  /**
   * Opens again what was opened in the conversation's lines (see `opened`), where they are still there.
   * @param {{ runs?: unknown, details?: unknown } | null} [opened]
   */
  reopen(opened) {
    const ids = (list) => new Set(Array.isArray(list) ? list.filter((id) => typeof id === 'string') : []);
    const runs = ids(opened?.runs);
    const details = ids(opened?.details);
    if (!runs.size && !details.size) return;
    const { root } = this.conversation;
    for (const node of root.querySelectorAll('.fold[data-run]'))
      if (runs.has(node.dataset.run)) folds.get(node).toggle(true);
    for (const node of root.querySelectorAll('.tool[data-tool]')) {
      if (details.has(node.dataset.tool)) lines.get(node)?.showDetail(true);
    }
  }

  /** Whether a call of `actor`'s goes in the run before it: that run is theirs, and nothing was said since. */
  #joins(actor, activity) {
    const { fold } = this;
    return Boolean(fold) && fold.actor === actor && activity.kind !== 'todo' && fold.node === this.conversation.last;
  }

  /** A call is no longer going on: its run says what the calls came to, or what the next one is doing. */
  #over(toolId) {
    const { step, fold } = this.pending.get(toolId);
    this.pending.delete(toolId);
    step.pending = false;
    fold.paint(Date.now());
  }

  /** Counts up the time of the calls going on, once a second, for as long as any is. */
  #tick() {
    if (this.pending.size && !this.#ticking) {
      this.#ticking = setInterval(() => {
        const now = Date.now();
        for (const fold of new Set([...this.pending.values()].map((call) => call.fold))) fold.paint(now);
      }, 1000);
    } else if (!this.pending.size && this.#ticking) {
      clearInterval(this.#ticking);
      this.#ticking = null;
    }
  }
}
