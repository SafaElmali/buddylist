// The Setup and Run tabs beside a conversation: what the project's setup script
// and its run scripts print, with the buttons that start and stop them. They are
// always there with the terminals, and can't be closed. A project that has no
// script yet is asked for one right here: typed in, or worked out by the contact.
// The runs themselves are the Run button's (run.js), which also keeps a line for
// each in the conversation. A right-click on a tab adds what its scripts printed
// to the message.
import { api } from '../lib/api.js';
import { el, errorText, html, raw } from '../lib/dom.js';
import { smallIcon } from '../lib/icons.js';
import { askForScript } from '../../shared/project-settings.js';
import { howItEnded, oneLine } from './run.js';

/** @typedef {import('../../main/runs.js').RunView} RunView */

/** What each tab is called, and what it says while there is nothing to show. */
const KINDS = {
  setup: {
    id: 'script-setup',
    title: 'Setup',
    add: 'Add a setup script',
    why: (project) => `Runs in each new worktree of ${project}, to install what it needs or to set up its environment.`,
    none: 'No setup output yet',
    noneWhy: 'What the setup script prints shows here once it has run.',
    placeholder: 'pnpm install',
  },
  run: {
    id: 'script-run',
    title: 'Run',
    add: 'Add a run script',
    why: (project) => `Starts ${project}, such as its dev server, on this contact’s own port.`,
    none: 'Nothing is running',
    noneWhy: 'What a run script prints shows here while it runs.',
    placeholder: 'npm run dev',
  },
};

/**
 * What a tab shows: the form a script is typed into, the output of the runs there were, the
 * button that starts a script, or the offer to add the script the project has none of.
 * @param {{ has: boolean, runs: unknown[], editing: boolean }} tab
 * @returns {'edit' | 'output' | 'ready' | 'add'}
 */
export function tabState({ has, runs, editing }) {
  if (editing) return 'edit';
  if (runs.length) return 'output';
  return has ? 'ready' : 'add';
}

/**
 * The buttons of a tab: one for each script it can start or, while that runs, stop.
 * @param {'setup' | 'run'} kind
 * @param {{ setup: string, scripts: { id: string, name: string }[], runs: { run: RunView }[] }} project
 * @returns {{ script: string, label: string, running: boolean }[]}
 */
export function scriptButtons(kind, { setup, scripts, runs }) {
  const running = (id) => runs.some(({ run }) => run.script === id && !run.ended);
  if (kind === 'setup') {
    if (!setup) return [];
    const again = runs.length > 0;
    return [
      {
        script: 'setup',
        running: running('setup'),
        label: running('setup') ? 'Stop setup' : again ? 'Run setup again' : 'Run setup',
      },
    ];
  }
  // The first is the Run button's own, and says so by having no name of its own.
  return scripts.map(({ id, name }, index) => ({
    script: id,
    running: running(id),
    label: `${running(id) ? 'Stop' : 'Run'}${index ? ` ${name}` : ''}`,
  }));
}

/** How a run stands, after its command. @param {RunView} run */
const standing = (run) => (run.ended ? `${howItEnded(run.ended).text}.` : 'is running...');

class ScriptTab {
  /** Whether the form a script is typed into is open. */
  #editing = false;
  /** What the tab was last drawn from: it is drawn again only when that changes. */
  #drawn = '';

  /**
   * @param {'setup' | 'run'} kind
   * @param {import('./side-pane.js').SidePane} pane
   * @param {import('./run.js').RunCommand} run
   * @param {ScriptHandlers} handlers
   * @param {{ contactId: string }} ctx
   */
  constructor(kind, pane, run, handlers, ctx) {
    this.kind = kind;
    this.words = KINDS[kind];
    this.pane = pane;
    this.run = run;
    this.handlers = handlers;
    this.ctx = ctx;
    this.body = el('<div class="script-tab"></div>');
    this.body.addEventListener('click', (e) => this.#clicked(/** @type {HTMLElement} */ (e.target)));
    this.body.addEventListener('submit', (e) => this.#save(e));
    run.watch(() => this.#draw());
    /** @type {import('./side-pane.js').PaneTab} */
    this.tab = {
      id: this.id,
      title: this.words.title,
      icon: smallIcon.terminal(),
      body: this.body,
      // With the terminals: what runs in the folder.
      lower: true,
      onSelect: () => this.#draw(),
      menu: () => this.#mentionItems(),
    };
    // Whenever the terminals are there, so is this.
    pane.keep(this.tab);
  }

  get id() {
    return this.words.id;
  }

  /** What a right-click on the tab offers: the output of each of its scripts that printed something, for the message. */
  #mentionItems() {
    const scripts = this.run.outputs().filter(({ id }) => (id === 'setup') === (this.kind === 'setup'));
    return scripts.map((card) => ({
      label: scripts.length > 1 ? `Add ${card.name} to message` : 'Add to message',
      action: () => this.handlers.mention?.(card, 'menu'),
    }));
  }

  open() {
    this.pane.open(this.tab);
    this.#draw();
  }

  /** What the tab is about, as the Run button knows it now. */
  #project() {
    const { key, project, setup, suggestion, setupSuggestion } = this.run.project;
    const setupKind = this.kind === 'setup';
    return {
      key,
      name: project || 'this project',
      setup,
      scripts: this.run.scripts,
      runs: this.run.runs(this.kind),
      has: setupKind ? Boolean(setup) : this.run.scripts.length > 0,
      script: setupKind ? setup : (this.run.scripts[0]?.command ?? ''),
      suggestion: setupKind ? setupSuggestion : suggestion,
    };
  }

  #draw() {
    // A tab that is not in the pane has nobody to draw for.
    if (!this.pane.has(this.id)) return;
    const project = this.#project();
    const state = tabState({ has: project.has, runs: project.runs, editing: this.#editing });
    const buttons = scriptButtons(this.kind, project);
    const drawn = JSON.stringify([
      state,
      project.name,
      buttons,
      project.runs.map(({ run }) => [run.id, run.ended]),
      this.handlers.who(),
    ]);
    // The form is left alone while it is typed in. Everything else follows what there is to show.
    if (drawn !== this.#drawn) {
      this.#drawn = drawn;
      if (state === 'edit') this.#drawForm(project);
      else if (state === 'output') this.#drawOutput(project, buttons);
      else this.#drawEmpty(state, project, buttons);
    }
    if (state === 'output') this.#print(project.runs);
  }

  /** The buttons that start and stop the scripts, as one row. */
  #buttonRow(buttons) {
    return html`<div class="script-buttons">
      ${buttons.map(
        ({ script, label, running }, index) =>
          html`<button
            class="btn${index === 0 && !running ? ' default' : ''}"
            type="button"
            data-do="toggle"
            data-script="${script}"
          >
            ${label}
          </button>`
      )}
      ${this.handlers.settings && html`<a data-do="settings">Project settings...</a>`}
    </div>`;
  }

  #drawEmpty(state, project, buttons) {
    const { add, why, none, noneWhy } = this.words;
    this.body.replaceChildren(
      el(
        state === 'add'
          ? html`<div class="script-empty">
              <b>${add}</b>
              <p>${why(project.name)}</p>
              <div class="script-buttons script-offer">
                <button class="btn default" type="button" data-do="ask" title="Ask ${this.handlers.who()}">
                  Ask ${this.handlers.who()}
                </button>
                <button class="btn" type="button" data-do="edit">Add manually</button>
              </div>
            </div>`
          : html`<div class="script-empty">
              <b>${none}</b>
              <p>${noneWhy}</p>
              ${this.#buttonRow(buttons)}
            </div>`
      )
    );
  }

  #drawForm(project) {
    // A setup script is often several lines. What Run starts is one, or a few before the server.
    const lines = this.kind === 'setup' ? 6 : 3;
    const form = el(
      html`<form class="script-form">
        <label
          >${this.kind === 'setup' ? `The setup script of ${project.name}` : `The command that starts ${project.name}`}
          <textarea class="input" name="script" rows="${lines}" spellcheck="false"></textarea>
        </label>
        <div class="script-buttons">
          <button class="btn default" type="submit">Save</button>
          <button class="btn" type="button" data-do="cancel">Cancel</button>
        </div>
        <div class="script-error" hidden></div>
      </form>`
    );
    const box = /** @type {HTMLTextAreaElement} */ (form.querySelector('textarea'));
    // What the project has, or else a guess from what is in its folder.
    box.value = project.script || project.suggestion;
    box.placeholder = this.words.placeholder;
    this.body.replaceChildren(form);
    box.focus();
    box.select();
  }

  #drawOutput(project, buttons) {
    this.body.replaceChildren(
      el(this.#buttonRow(buttons)),
      ...project.runs.map(({ run }) =>
        el(
          html`<section class="script-run" data-run="${run.id}">
            <div class="script-head${run.ended && howItEnded(run.ended).failed ? ' failed' : ''}">
              ${raw(smallIcon.terminal())}<code>${oneLine(run.command)}</code> <span>${standing(run)}</span>
            </div>
            <pre class="output"></pre>
          </section>`
        )
      )
    );
  }

  /** Puts what each run printed in its box. As text, never as markup: a command prints whatever it likes. */
  #print(runs) {
    for (const { run, text } of runs) {
      const box = this.body.querySelector(`[data-run="${run.id}"] pre`);
      if (!box || box.textContent === text) continue;
      // Follows the newest, unless you scrolled up in it to read.
      const atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 20;
      box.textContent = text;
      if (atEnd) box.scrollTop = box.scrollHeight;
    }
  }

  #clicked(target) {
    const control = /** @type {HTMLElement | null} */ (target.closest('[data-do]'));
    if (!control) return;
    const what = control.dataset.do;
    if (what === 'toggle') this.run.toggleScript(control.dataset.script);
    else if (what === 'ask') this.handlers.ask(askForScript(this.kind));
    else if (what === 'settings') this.handlers.settings?.();
    else if (what === 'edit' || what === 'cancel') {
      this.#editing = what === 'edit';
      this.#draw();
    }
  }

  /** Keeps what was typed as the project's script: for every contact that works on it. */
  async #save(e) {
    e.preventDefault();
    const form = /** @type {HTMLFormElement} */ (e.target);
    const error = /** @type {HTMLElement} */ (form.querySelector('.script-error'));
    const { value } = /** @type {HTMLTextAreaElement} */ (form.elements.namedItem('script'));
    error.hidden = true;
    try {
      const { key } = this.run.project;
      if (this.kind === 'run') await api.run.setCommand(this.ctx.contactId, value);
      else if (!value.trim()) throw new Error('Type the script that sets this project up.');
      else if (!key) throw new Error('The project of this contact could not be found.');
      else await api.projects.update(key, { setup: value });
      this.#editing = false;
      // The button that runs it is drawn from what the project has now.
      await this.run.refresh();
    } catch (err) {
      error.textContent = errorText(err);
      error.hidden = false;
    }
  }
}

/**
 * @typedef {Object} ScriptHandlers
 * @property {(text: string) => void} ask  says something to the contact, as if it was typed
 * @property {() => string} who            what the contact is called, for the button that asks it
 * @property {(() => void) | null} [settings]  opens the project's scripts in Settings, where there is one
 * @property {(card: import('../../shared/terminal-mentions.js').OutputCard, how: 'menu') => void} [mention]  puts a
 *   script's output in the message box
 */

export class ScriptTabs {
  /**
   * @param {import('./side-pane.js').SidePane} pane
   * @param {import('./run.js').RunCommand} run
   * @param {{ contactId: string }} ctx
   * @param {ScriptHandlers} handlers
   */
  constructor(pane, run, ctx, handlers) {
    this.setup = new ScriptTab('setup', pane, run, handlers, ctx);
    this.runs = new ScriptTab('run', pane, run, handlers, ctx);
  }

  /** The two kinds of tab, for the menu that lists what can be opened beside the conversation. */
  get kinds() {
    return [
      { label: 'Setup', icon: smallIcon.terminal(), open: () => this.setup.open() },
      { label: 'Run', icon: smallIcon.terminal(), open: () => this.runs.open() },
    ];
  }

  /** Both tabs, with Setup in front: what a conversation that is new starts with. */
  open() {
    this.setup.open();
    this.runs.open();
    this.showSetup();
  }

  showSetup() {
    this.setup.pane.select(this.setup.id);
  }
}
