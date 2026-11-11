// The Run button, and what it started as a line in the conversation: the
// command, its port as a link, and what it prints one click away. A project
// can have more scripts than the button's own: the Code menu starts those,
// each with a line of its own, and the script that sets up a new worktree
// shows the same way. The agent is not told any of it: like a wink, this is
// between you and the window. Unless you add a script's output to a message:
// then it reads what that printed.
import { api } from '../lib/api.js';
import { $, el, errorText, html, raw } from '../lib/dom.js';
import { formatDate, formatTime } from '../lib/format.js';
import { smallIcon, toolbarIcon } from '../lib/icons.js';
import { OUTPUT_KEPT, tailOf } from '../../shared/run-output.js';
import { runDialog } from './run-dialog.js';

/** @typedef {import('../../main/runs.js').RunView} RunView */
/** @typedef {import('../../main/runs.js').RunEvent} RunEvent */
/** @typedef {import('../../main/runs.js').RunEnd} RunEnd */

/** A command on one line: the lines of a script, each after the one before. @param {string} command */
export const oneLine = (command) =>
  command
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ↵ ');

const clip = (command, max = 80) => {
  const line = oneLine(command);
  return line.length > max ? `${line.slice(0, max)}…` : line;
};

/** @param {RunView | null} run  the run a window is showing, if any */
const isRunning = (run) => Boolean(run && !run.ended);

/**
 * The Run button's two faces. While a command runs it stops that command, and says so:
 * "Stop" on its own, in Send's place, is the button that stops the agent.
 * @param {RunView | null} run
 */
export function runButton(run) {
  if (!isRunning(run)) {
    return { running: false, label: 'Run', title: 'Start this project (a dev server, say) on a port of its own' };
  }
  return { running: true, label: 'Stop Run', title: `Stop ${clip(run.command)}, which is running on port ${run.port}` };
}

/** Where a run listens, and why not where the contact's runs used to. @param {RunView} run */
export const portText = ({ port, movedFrom }) =>
  movedFrom ? `port ${port}, because ${movedFrom} was taken by something else` : `port ${port}`;

/**
 * How a run ended, to follow its command in a sentence. `failed`: neither stopped nor done.
 * @param {RunEnd} ended
 */
export function howItEnded({ code, signal, stopped }) {
  if (stopped) return { text: 'was stopped', failed: false };
  if (code === 0) return { text: 'has ended', failed: false };
  return { text: code == null ? `was ended by ${signal}` : `ended with exit code ${code}`, failed: true };
}

/**
 * What a run's line says was started. A setup script serves no page, so it names no port.
 * @param {RunView} run
 */
export function startedText(run) {
  if (run.kind === 'setup') return html`Setting up this worktree with <code>${clip(run.command)}</code>`;
  const [first, ...more] = run.urls ?? [];
  const url = first?.url ?? `http://localhost:${run.port}`;
  return html`You started <code>${clip(run.command)}</code> on ${portText(run)}:
    <a href="${url}">${first?.name || url}</a>${more.map(
      (link) => html`, <a href="${link.url}">${link.name || link.url}</a>`
    )}`;
}

/**
 * What the setup line of a pull request's worktree says: its setup script was not run, and why.
 * @param {string} command  the project's setup script
 */
export const waitingText = (command) =>
  html`This worktree is not set up yet: its setup script, <code>${clip(command)}</code>, would run code that is not on
    the project’s own branches, such as a pull request’s. Press Run setup in the Setup tab once you have looked it over.`;

/** What a run is called once it has ended: its command, or what it was for. @param {RunView} run */
const endedSubject = (run) => (run.kind === 'setup' ? 'The setup script' : html`<code>${clip(run.command)}</code>`);

/**
 * The Code menu's entries for what runs in the folder: what the button does, the project's other
 * scripts, and changing what they are.
 * @param {RunView | null} run  the run of the button's own script
 * @param {{ toggle: () => void, change: () => void }} actions
 * @param {{ name: string, running: boolean, toggle: () => void }[]} [others]  the project's scripts
 *   after the button's own
 * @returns {import('../lib/menu.js').MenuItem[]}
 */
export function runMenuItems(run, { toggle, change }, others = []) {
  return [
    { label: isRunning(run) ? `Stop running ${clip(run.command, 40)}` : 'Run this project', action: toggle },
    ...others.map((script) => ({
      label: `${script.running ? 'Stop' : 'Run'} ${clip(script.name, 40)}`,
      action: script.toggle,
    })),
    { label: 'Change the run command...', action: change },
  ];
}

/**
 * The project's pages in Settings: its scripts and the rest, and what its agents are told. None
 * where there is no Settings, as in the browser preview.
 * @param {((section?: string) => void) | null} settings  opens the project in Settings: at its
 *   scripts, or at the page it names
 * @returns {import('../lib/menu.js').MenuItem[]}
 */
export const projectSettingsItems = (settings) =>
  settings
    ? [
        { label: 'Project settings...', action: () => settings() },
        { label: 'Project instructions...', action: () => settings('instructions') },
      ]
    : [];

export class RunCommand {
  /**
   * The runs this window is showing, by id: the ones going on and the ones it saw end, each
   * with its line in the conversation.
   * @type {Map<string, { run: RunView, line: HTMLElement, shown: number, text: string }>}  `text`: the end of
   *   what it printed, for the tab that shows it too
   */
  #shown = new Map();
  /** @type {import('../../shared/project-settings.js').Script[]} the project's scripts, the button's own first */
  #scripts = [];
  /** The project the contact works on, by its key: news of another project is not this window's. */
  #project = null;
  /** What the project is called, its setup script, and a guess at each script it does not have yet. */
  #known = { project: '', setup: '', suggestion: '', setupSuggestion: '' };
  /** Between a press of the button and the answer: a second press does nothing. */
  #busy = false;
  /** @type {Set<() => void>} whoever else shows the runs: the Setup and Run tabs beside the conversation */
  #watching = new Set();

  /**
   * @param {import('./conversation.js').Conversation} conversation
   * @param {{ contactId: string, web?: boolean }} ctx
   */
  constructor(conversation, ctx) {
    this.conversation = conversation;
    this.ctx = ctx;
  }

  // ---- for the tabs beside the conversation (script-tabs.js) -------------------------------------

  /** Calls `changed` whenever a run starts, prints or ends, and when the project's scripts change. */
  watch(changed) {
    this.#watching.add(changed);
  }

  #changed() {
    for (const changed of this.#watching) changed();
  }

  /** The project's run scripts, the button's own first. */
  get scripts() {
    return this.#scripts;
  }

  /** The project: its key and name, its setup script, and a guess at each script it has none of. */
  get project() {
    return { key: this.#project, ...this.#known };
  }

  /**
   * The runs of one kind this window has seen, the oldest first, each with what it printed.
   * @param {'run' | 'setup'} kind
   * @returns {{ run: RunView, text: string }[]}
   */
  runs(kind) {
    return [...this.#shown.values()].filter(({ run }) => run.kind === kind).map(({ run, text }) => ({ run, text }));
  }

  /**
   * The scripts that printed something in this window, as a message can hand their output to the agent: the
   * setup script first, then the project's scripts in their order.
   * @returns {import('../../shared/terminal-mentions.js').OutputCard[]}
   */
  outputs() {
    const ran = new Set([...this.#shown.values()].map(({ run }) => run.script));
    return ['setup', ...this.#scripts.map((script) => script.id)]
      .filter((id) => ran.has(id))
      .map((id) => ({ kind: 'script', id, name: this.#nameOf(id) }));
  }

  /**
   * What the newest run of a script printed so far, by the script's id. Null for one that never ran here.
   * @param {string} scriptId  'setup' for the setup script
   * @returns {{ name: string, text: string } | null}
   */
  output(scriptId) {
    const newest = [...this.#shown.values()].findLast(({ run }) => run.script === scriptId);
    return newest ? { name: this.#nameOf(scriptId), text: newest.text } : null;
  }

  /** What a script is called: its name in the project, or for the setup script, its tab's. */
  #nameOf(scriptId) {
    if (scriptId === 'setup') return 'Setup';
    return this.#scripts.find((script) => script.id === scriptId)?.name || 'Run';
  }

  /** Reads the project's scripts again, after one was added or changed from a tab. */
  async refresh() {
    await this.#readScripts();
    this.#paint();
  }

  /** Starts one of the project's scripts by its id, or the setup script, unless it is running: then it is stopped. */
  toggleScript(scriptId) {
    return this.#press(() =>
      this.#runningOf(scriptId)
        ? api.run.stop(this.ctx.contactId, scriptId)
        : api.run.start(this.ctx.contactId, scriptId)
    );
  }

  /** The run of one of the project's scripts that is going on, if one is. */
  #runningOf(scriptId) {
    return [...this.#shown.values()].map(({ run }) => run).find((run) => run.script === scriptId && isRunning(run));
  }

  /** What the button stands for: the run of the project's first script. */
  get #own() {
    const first = this.#scripts[0];
    return (first && this.#runningOf(first.id)) || null;
  }

  get running() {
    return isRunning(this.#own);
  }

  /**
   * Call once the window has drawn its conversation. The commands that are already running
   * are shown under it, with their output so far, and everything from here on is followed.
   */
  async attach() {
    api.on.run((event) => this.#onEvent(event));
    // The scripts are the project's: Settings, or another contact's window, may change them.
    api.on.project(({ key, settings }) => {
      if (key !== this.#project) return;
      this.#scripts = settings.scripts;
      this.#known.setup = settings.setup;
      this.#paint();
    });
    const [runs] = await Promise.all([api.run.state(this.ctx.contactId), this.#readScripts()]);
    for (const run of runs) {
      // One that started in the meantime is here already.
      if (this.#shown.has(run.id)) continue;
      this.#started(run);
      // It ended while this window was closed, and is said now.
      if (run.ended) this.#ended(run.id, run.ended);
    }
    this.#paint();
  }

  /**
   * The setup line of a worktree whose setup script was not run by itself, a pull request's or one
   * started from it: it says the script waits for the user. Call once `attach` is done. A project with no setup
   * script, or one whose script runs already, has nothing to say.
   */
  setupWaits() {
    const { setup } = this.#known;
    if (!setup || this.runs('setup').length) return;
    this.conversation.line('run', smallIcon.terminal(), waitingText(setup));
  }

  /** The project's scripts as they are now. A window that can't be told keeps the ones it knew. */
  async #readScripts() {
    try {
      const [known, project] = await Promise.all([
        api.run.scripts(this.ctx.contactId),
        api.projects.of(this.ctx.contactId),
      ]);
      this.#scripts = known.scripts;
      this.#project = project?.key ?? null;
      this.#known = {
        project: known.project,
        setup: known.setup ?? '',
        suggestion: known.suggestion ?? '',
        setupSuggestion: known.setupSuggestion ?? '',
      };
      return known;
    } catch {
      return { project: '', scripts: this.#scripts, suggestion: '' };
    }
  }

  /** @param {RunEvent} event */
  #onEvent(event) {
    if (event.type === 'started') return this.#started(event.run);
    // The rest is about a run this window saw start.
    if (!this.#shown.has(event.id)) return;
    if (event.type === 'output') this.#print(event.id, event.text);
    else if (event.type === 'ended') this.#ended(event.id, event);
  }

  // ---- the button and the menu -----------------------------------------------------------------

  /** Presses made while one is being answered do nothing. */
  async #press(act) {
    if (this.#busy) return;
    this.#busy = true;
    this.#paint();
    try {
      await act();
    } catch (err) {
      this.conversation.addError(errorText(err));
    } finally {
      this.#busy = false;
      this.#paint();
    }
  }

  /** The button: starts the project's first script or, while it runs, stops it. */
  toggle() {
    return this.#press(async () => {
      const known = await this.#readScripts();
      const first = known.scripts[0];
      if (first && this.#runningOf(first.id)) return api.run.stop(this.ctx.contactId, first.id);
      // A project with nothing to run yet is asked what starts it.
      if (!first && !(await this.#ask(known))) return;
      await api.run.start(this.ctx.contactId);
    });
  }

  /** Asks for the run command. Null when the user gave none. */
  async #ask(known) {
    const saved = await runDialog(this.ctx, { ...known, command: known.scripts[0]?.command ?? '' });
    if (saved) await this.#readScripts();
    return saved;
  }

  /** Code > Change the run command...: for this project, so for every contact working on it. */
  async change() {
    try {
      const own = this.#own;
      const saved = await this.#ask(await this.#readScripts());
      if (saved && own && saved.command !== own.command) {
        this.conversation.addNotice('The new run command is used the next time you press Run.');
      }
    } catch (err) {
      this.conversation.addError(errorText(err));
    }
  }

  menuItems() {
    return runMenuItems(
      this.#own,
      { toggle: () => this.toggle(), change: () => this.change() },
      this.#scripts.slice(1).map((script) => ({
        name: script.name,
        running: Boolean(this.#runningOf(script.id)),
        toggle: () => this.toggleScript(script.id),
      }))
    );
  }

  /** The project's pages in Settings. The preview has no Settings. */
  settingsItems() {
    return projectSettingsItems(
      this.ctx.web ? null : (section = 'scripts') => api.settings.open({ section, contactId: this.ctx.contactId })
    );
  }

  #paint() {
    this.#changed();
    const button = /** @type {HTMLButtonElement} */ ($('#tb-run'));
    if (!button) return;
    const face = runButton(this.#own);
    button.classList.toggle('running', face.running);
    button.disabled = this.#busy;
    button.dataset.tip = face.title;
    $('svg', button).replaceWith(el(face.running ? toolbarIcon.running() : toolbarIcon.run()));
    $('.tb-label', button).textContent = face.label;
  }

  // ---- the lines in the conversation --------------------------------------------------------------

  /** @param {RunView} run */
  #started(run) {
    const line = el(
      html`<div class="event run" title="${formatDate(run.startedAt)} ${formatTime(run.startedAt)}">
        <div class="line">
          ${raw(smallIcon.terminal())}<span
            >${startedText(run)}<span class="state pending">…</span><a class="toggle">Show output</a></span
          >
        </div>
        <pre class="output" hidden></pre>
      </div>`
    );
    // As text, never as markup: a command prints whatever it likes.
    $('pre', line).textContent = run.output;
    $('.toggle', line).addEventListener('click', () => this.#showOutput(line, $('pre', line).hidden));
    this.#shown.set(run.id, { run: { ...run }, line, shown: run.output.length, text: run.output });
    this.conversation.append(line, { force: true });
    this.#paint();
  }

  /** Opens or closes the output under a run's line. */
  #showOutput(line, show) {
    const box = $('pre', line);
    this.conversation.keepPinned(() => {
      box.hidden = !show;
    });
    $('.toggle', line).textContent = show ? 'Hide' : 'Show output';
    // Opened, it shows the newest: that is where a dev server says what just went wrong.
    if (show) box.scrollTop = box.scrollHeight;
  }

  /**
   * @param {string} id  the run that printed
   * @param {string} text  what it printed since the last time
   */
  #print(id, text) {
    const entry = this.#shown.get(id);
    const box = $('pre', entry.line);
    this.conversation.keepPinned(() => {
      // Follows the newest, unless you scrolled up in it to read.
      const atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 20;
      box.append(text);
      entry.shown += text.length;
      entry.text = tailOf(entry.text + text);
      // A dev server prints for hours: once the box holds twice what is kept, it is cut back.
      if (entry.shown > 2 * OUTPUT_KEPT) {
        box.textContent = tailOf(box.textContent);
        entry.shown = box.textContent.length;
      }
      if (atEnd) box.scrollTop = box.scrollHeight;
    });
    this.#changed();
  }

  /**
   * @param {string} id  the run that ended
   * @param {RunEnd} ended
   */
  #ended(id, { code, signal, stopped }) {
    const { run, line } = this.#shown.get(id);
    run.ended = { code, signal, stopped };
    const { text, failed } = howItEnded(run.ended);
    const state = $('.state', line);
    state.className = `state${failed ? ' failed' : ''}`;
    state.textContent = failed ? '(failed)' : '';
    const said = this.conversation.line(
      failed ? 'result error' : 'result',
      failed ? smallIcon.warn() : '',
      html`${endedSubject(run)} ${text}.${failed ? html`<a class="toggle">Show output</a>` : ''}`,
      { force: failed }
    );
    // Why it failed is in its output, and the line that has it may be a long way up by now.
    $('.toggle', said)?.addEventListener('click', () => {
      this.#showOutput(line, true);
      line.scrollIntoView({ block: 'nearest' });
    });
    this.#paint();
  }

  /** The conversation was cleared for a new one, and commands are still running: their lines go back in. */
  keepShowing() {
    for (const { run, line } of this.#shown.values()) {
      if (isRunning(run) && !line.isConnected) this.conversation.append(line);
    }
  }
}
