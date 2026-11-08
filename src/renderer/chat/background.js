// The Background tab of the side pane: what the agents here left running in the background, a
// command such as a dev server or a watcher on CI, and what each of them printed. One that runs
// is listed first. One that ended stays listed, with how it ended, until a new conversation is
// started. Under a row: what it runs, and the end of what it printed, read again every few
// seconds while the row is open and it runs. Its rows are drawn as the Subagents tab's are.
import { backgroundStatus, runningOf } from '../../shared/background.js';
import { plainText } from '../../shared/run-output.js';
import { el, errorText, html } from '../lib/dom.js';
import { clock } from '../lib/format.js';
import { smallIcon } from '../lib/icons.js';
import { isGroup } from './participants.js';

/** @typedef {import('../../providers/contract.js').BackgroundTask} BackgroundTask */
/** @typedef {import('../../providers/contract.js').BackgroundOutput} BackgroundOutput */
/** @typedef {import('../../providers/contract.js').Participant} Participant */

/**
 * A task as the tab lists it, with whose it is.
 * @typedef {BackgroundTask & { key: string, by: string, speaker: string }} Listed
 *   `key`: what the tab knows it by, apart from another agent's. `by`: the name of the agent that
 *   left it running. `speaker`: that agent's contact id
 */

/**
 * A task's row.
 * @typedef {Object} Row
 * @property {Listed} task
 * @property {HTMLElement} node
 * @property {boolean} open  what it runs and what it printed are on show
 * @property {string | null} output  what it printed, as last read; null while it has not been
 * @property {boolean} reading  a read of it is on its way
 */

/** The tab's id in the pane. There is one Background tab, whoever left something running. */
const TAB = 'background';

/** How often what an open row's task printed is read again, while it runs. */
export const READ_EVERY_MS = 2000;

/** What a row says of a task that has ended, where its agent's service said nothing of how. */
const ENDED = { done: 'Finished', failed: 'Failed', stopped: 'Stopped' };

/** The tag after a task's name, by its kind. */
const KINDS = { command: 'Command', watcher: 'Watcher' };

/**
 * Everything the agents here left running, with whose each is, in the order they started.
 * @param {Pick<Participant, 'id' | 'name' | 'background'>[]} participants
 * @returns {Listed[]}
 */
export function listedOf(participants) {
  return participants
    .flatMap(({ id, name, background = [] }) =>
      background.map((task) => ({ ...task, key: `${id}:${task.id}`, by: name, speaker: id }))
    )
    .sort((a, b) => a.started - b.started);
}

/**
 * The order of the rows: the ones that run first, as they started, then the ones that ended,
 * the one started last on top.
 * @template {Pick<BackgroundTask, 'status'>} T
 * @param {T[]} tasks  in the order they started
 * @returns {T[]}
 */
export function ordered(tasks) {
  const ended = tasks.filter((task) => task.status !== 'running');
  return [...runningOf(tasks), ...ended.reverse()];
}

/** The line at the top of the tab: "2 running". @param {Pick<BackgroundTask, 'status'>[]} tasks */
export function summary(tasks) {
  const running = runningOf(tasks).length;
  if (running) return `${running} running`;
  return tasks.length ? 'Nothing running' : 'Nothing yet';
}

/** Next to it: how many have ended, once any has. @param {Pick<BackgroundTask, 'status'>[]} tasks */
export function endedNote(tasks) {
  const ended = tasks.length - runningOf(tasks).length;
  return ended ? `${ended} ended` : '';
}

/**
 * The time at the end of a task's row: how long it has run, or ran.
 * @param {Pick<BackgroundTask, 'status' | 'started' | 'ended'>} task
 * @param {number} now
 */
export function timeOf({ status, started, ended }, now) {
  if (status === 'running') return clock(now - started);
  return ended ? clock(ended - started) : '';
}

/**
 * The line under a task's name: that it runs, or how it ended, in its agent's words where it said.
 * @param {Pick<BackgroundTask, 'status' | 'summary'>} task
 */
export const doing = ({ status, summary: said }) =>
  status === 'running' ? 'Running in the background' : said || ENDED[status];

/**
 * The tag after a task's name: its kind and, with several agents here, whose it is.
 * @param {Pick<Listed, 'kind' | 'by'>} task
 * @param {boolean} several
 */
export const tagOf = ({ kind, by }, several) => [KINDS[kind], several ? `for ${by}` : ''].filter(Boolean).join(' ');

/** Without a task to list. @param {string[]} names  the agents here that can leave something running */
export function nobodyNote(names) {
  const who = names.length === 1 ? names[0] : 'an agent here';
  return `Nothing has run in the background yet. When ${who} starts a command or a watcher there, it is listed here, with what it prints.`;
}

/**
 * What a row shows of what its task printed.
 * @param {string | null} output  as last read, or null while it has not been
 * @param {boolean} running
 */
export function outputText(output, running) {
  if (output === null) return running ? 'Reading what it printed…' : 'What it printed can no longer be read.';
  return output.trimEnd() || (running ? 'Nothing printed yet.' : 'It printed nothing.');
}

const note = (text) => el(html`<div class="helpers-note">${text}</div>`);

export class Background {
  /** @type {Map<string, Row>} every task listed, by its key */
  #rows = new Map();
  /** The clock that counts up the tasks that run, while any does. */
  #ticking = null;
  /** Reads again what the open rows' tasks print, while any of them runs. */
  #reading = null;

  /**
   * @param {import('./side-pane.js').SidePane} pane
   * @param {{ participants: Participant[] }} ctx
   * @param {object} opts
   * @param {(task: Listed) => Promise<void>} opts.stop  asks the main process to stop one task
   * @param {(task: Listed) => Promise<BackgroundOutput | null>} opts.output  reads the end of what one printed
   * @param {() => void} [opts.changed]  one started or ended: what the window says about them is out of date
   */
  constructor(pane, ctx, { stop, output, changed = () => {} }) {
    this.pane = pane;
    this.ctx = ctx;
    this.stop = stop;
    this.output = output;
    this.changed = changed;
    this.body = el(
      `<div class="helpers-tab background-tab">
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
    this.tab = {
      id: TAB,
      title: 'Background',
      icon: smallIcon.background(),
      body: this.body,
      onSelect: () => {
        // Time and output may have moved on while another tab was in front.
        for (const { task, node } of this.#rows.values()) {
          if (task.status === 'running') node.querySelector('.helper-time').textContent = timeOf(task, Date.now());
        }
        for (const row of this.#watched()) this.#read(row);
        this.#tick();
        this.#keepReading();
      },
    };

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
    return { label: 'Background', icon: smallIcon.background(), open: () => this.show() };
  }

  /** How many tasks this conversation has had. */
  get size() {
    return this.#rows.size;
  }

  /** How many of them run. */
  get running() {
    return runningOf(this.#tasks()).length;
  }

  /** What runs there, in words: "A command running in the background". Empty while nothing does. */
  get status() {
    return backgroundStatus(this.#tasks());
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

  /** Goes to the task a call started: its row, opened, in sight. @param {string} toolId */
  reveal(toolId) {
    this.show();
    const row = [...this.#rows.values()].find((r) => r.task.toolId === toolId);
    if (!row) return;
    if (!row.open) this.#toggle(row);
    row.node.scrollIntoView({ block: 'nearest' });
  }

  /**
   * Who is here, or what they left running, changed: the rows follow the participants. A task no
   * longer listed went with its conversation, which started over.
   */
  update() {
    const listed = listedOf(this.ctx.participants);
    const before = JSON.stringify(this.#tasks().map(({ key, status }) => [key, status]));
    const keys = new Set(listed.map((task) => task.key));
    for (const key of [...this.#rows.keys()]) if (!keys.has(key)) this.#rows.delete(key);
    for (const task of listed) {
      const row = this.#rows.get(task.key);
      if (!row) {
        this.#rows.set(task.key, this.#row(task));
        continue;
      }
      const ended = row.task.status === 'running' && task.status !== 'running';
      row.task = task;
      // What it printed last is read once more after it ended, while that can still be done.
      if (ended && row.open) this.#read(row);
    }
    // In the order they started: a row keeps its node, and with it what was opened in it.
    const rows = new Map(listed.map((task) => [task.key, this.#rows.get(task.key)]));
    this.#rows = rows;
    for (const row of rows.values()) this.#paint(row);
    this.#draw();
    if (JSON.stringify(this.#tasks().map(({ key, status }) => [key, status])) !== before) this.changed();
  }

  /** A new conversation has had nothing in the background yet. */
  clear() {
    this.#rows.clear();
    this.#draw();
    this.changed();
  }

  /** @returns {Listed[]} */
  #tasks() {
    return [...this.#rows.values()].map((row) => row.task);
  }

  /** @param {Listed} task @returns {Row} a row for a task that was not listed before */
  #row(task) {
    const node = el(
      html`<div class="helper">
        <div class="helper-top">
          <button class="helper-row" type="button" aria-expanded="false">
            <span class="helper-arrow"></span>
            <span class="helper-buddy background-icon"></span>
            <span class="helper-name"><b></b><span class="helper-tag"></span></span>
            <span class="helper-time"></span>
          </button>
          <button class="helper-stop link" type="button" title="Stop it. The agent is told, and carries on">
            Stop
          </button>
        </div>
        <div class="helper-doing"></div>
        <div class="helper-detail" hidden>
          <div class="helper-part">Runs</div>
          <div class="helper-prompt background-command"></div>
          <div class="helper-part">Output</div>
          <pre class="background-output"></pre>
        </div>
      </div>`
    );
    node.querySelector('.helper-buddy').innerHTML = smallIcon.terminal();
    return { task, node, open: false, output: null, reading: false };
  }

  /** Brings a row up to date with its task. @param {Row} row */
  #paint(row) {
    const { task, node } = row;
    const running = task.status === 'running';
    // Drawn as a subagent's row is: one that runs as one at work, and one that ended as one that has.
    node.className = `helper ${running ? 'working' : task.status}${row.open ? ' open' : ''}`;
    const name = /** @type {HTMLElement} */ (node.querySelector('.helper-name'));
    name.title = task.command || task.label;
    name.querySelector('b').textContent = task.label || task.command || 'A task';
    node.querySelector('.helper-tag').textContent = tagOf(task, isGroup(this.ctx.participants));
    node.querySelector('.helper-time').textContent = timeOf(task, Date.now());
    node.querySelector('.helper-doing').textContent = doing(task);
    /** @type {HTMLElement} */ (node.querySelector('.helper-stop')).hidden = !running;
    node.querySelector('.background-command').textContent = task.command || 'Its service did not say.';
    this.#paintOutput(row);
  }

  /** @param {Row} row */
  #paintOutput(row) {
    const pre = /** @type {HTMLElement} */ (row.node.querySelector('.background-output'));
    // Read at the end, as a terminal is: unless it was scrolled up to read what came before.
    const atEnd = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 4;
    pre.textContent = outputText(row.output, row.task.status === 'running');
    pre.classList.toggle('none', !row.output?.trim());
    if (atEnd) pre.scrollTop = pre.scrollHeight;
  }

  /** Puts the rows in their order, and says how many there are. */
  #draw() {
    const tasks = this.#tasks();
    this.summary.textContent = summary(tasks);
    this.ended.textContent = endedNote(tasks);
    const rows = ordered(tasks).map((task) => this.#rows.get(task.key).node);
    const running = runningOf(tasks).length;
    // With tasks that run above them, the ones that ended get a line of their own.
    if (running && running < rows.length) rows.splice(running, 0, el('<div class="helpers-divider">Ended</div>'));
    const offered = this.ctx.participants.filter((p) => p.provider.background).map((p) => p.name);
    // Where the list was scrolled to is where it stays.
    const top = this.list.scrollTop;
    this.list.replaceChildren(...(rows.length ? rows : [note(nobodyNote(offered))]));
    this.list.scrollTop = top;
    this.#tick();
    this.#keepReading();
  }

  /** Counts up the tasks that run, once a second, while their tab is on show. */
  #tick() {
    const running = this.pane.shows(TAB) && this.running > 0;
    if (running && !this.#ticking) {
      this.#ticking = setInterval(() => {
        if (!this.pane.shows(TAB)) {
          this.#tick();
          return;
        }
        for (const { task, node } of this.#rows.values()) {
          if (task.status === 'running') node.querySelector('.helper-time').textContent = timeOf(task, Date.now());
        }
      }, 1000);
    } else if (!running && this.#ticking) {
      clearInterval(this.#ticking);
      this.#ticking = null;
    }
  }

  /** The open rows whose task runs: what each prints is read again every few seconds. */
  #watched() {
    if (!this.pane.shows(TAB)) return [];
    return [...this.#rows.values()].filter((row) => row.open && row.task.status === 'running');
  }

  /** Reads again what the open rows' tasks print, for as long as any of them runs. */
  #keepReading() {
    const any = this.#watched().length > 0;
    if (any && !this.#reading) {
      this.#reading = setInterval(() => {
        for (const row of this.#watched()) this.#read(row);
        // A hidden tab stops its clock too; selecting it starts both clocks again.
        this.#keepReading();
      }, READ_EVERY_MS);
    } else if (!any && this.#reading) {
      clearInterval(this.#reading);
      this.#reading = null;
    }
  }

  /** Reads the end of what a row's task printed. One that can't be read keeps what was read before. @param {Row} row */
  async #read(row) {
    if (row.reading) return;
    row.reading = true;
    try {
      const read = await this.output(row.task);
      if (read) row.output = plainText(read.output);
    } catch {
      // Its agent is gone, say.
    } finally {
      row.reading = false;
    }
    // Gone while it was read: its conversation started over.
    if (this.#rows.get(row.task.key) === row) this.#paintOutput(row);
  }

  /** Shows what a task runs and what it printed under its row, or puts them away. @param {Row} row */
  #toggle(row) {
    row.open = !row.open;
    row.node.classList.toggle('open', row.open);
    row.node.querySelector('.helper-row').setAttribute('aria-expanded', String(row.open));
    /** @type {HTMLElement} */ (row.node.querySelector('.helper-detail')).hidden = !row.open;
    if (row.open && (row.task.status === 'running' || row.output === null)) this.#read(row);
    this.#keepReading();
  }

  /** Asks for one task to be stopped. That it has stopped is said as any ending is: in the list. */
  async #stop(row) {
    const button = /** @type {HTMLButtonElement} */ (row.node.querySelector('.helper-stop'));
    button.disabled = true;
    button.textContent = 'Stopping…';
    try {
      await this.stop(row.task);
    } catch (err) {
      // It could not be asked: the button is there to try again, and says why.
      button.disabled = false;
      button.textContent = 'Stop';
      button.title = errorText(err);
    }
  }
}
