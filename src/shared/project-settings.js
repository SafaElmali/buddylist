// What a project is set up with: its scripts, its environment, the branch its
// worktrees start from, what its agents are told, and the files a new worktree
// gets, and its manager. And the variables every project shares. Nothing in here touches a folder
// or starts anything: Settings, the main process and the browser
// preview all clean what is typed the same way.
import { cleanFallbackPolicy } from './fallback-policy.js';
import { cleanManager, cleanManagers } from './managers.js';

/**
 * A variable of the environment.
 * @typedef {Object} Variable
 * @property {string} name
 * @property {string} value
 */

/**
 * A command with a name: the Run button starts a project's first, and its menu the others.
 * @typedef {Object} Script
 * @property {string} id       stays the same when it is renamed or its command changes
 * @property {string} name
 * @property {string} command
 */

/**
 * A page a run can be looked at on.
 * @typedef {Object} PreviewUrl
 * @property {string} name  what its link says; '' for the address itself
 * @property {string} url   may name the contact's port, as a script would: http://localhost:$PORT
 */

/**
 * What a project's agents are told on top of what you type.
 * @typedef {Object} Instructions
 * @property {string} general      at the start of every new conversation
 * @property {string} pullRequest  with what the Create PR button asks for
 * @property {string} review       with the comments sent from the Changes tab: your own, and a reviewer's
 */

/**
 * @typedef {Object} ProjectSettings
 * @property {ReturnType<import('./fallback-policy.js').cleanFallbackPolicy> | null} fallbacks  null inherits the app policy
 * @property {string} setup     the script run in a contact's new worktree; '' for none
 * @property {string} cleanup   the script run in a worktree before it is removed; '' for none
 * @property {Script[]} scripts  what Run starts
 * @property {Variable[]} env
 * @property {string[]} envFiles  files of variables: one in the project is named from its top, so that every
 *   worktree reads its own, unless its branch has it in git (see main/project-settings.js)
 * @property {string} base      the branch new worktrees start from, such as "origin/develop"; '' for the remote's main line
 * @property {string} remote    the remote that branch and pull requests are fetched from; '' for origin
 * @property {Instructions} instructions
 * @property {PreviewUrl[]} previewUrls
 * @property {string[]} copyFiles  the files git does not keep that a new worktree gets a copy of, such as ".env*"
 * @property {import('./managers.js').ManagerSettings} manager  its first manager, the contact that oversees the
 *   conversations under it; with no `id`, what the first one it gets starts with
 * @property {import('./managers.js').ManagerSettings[]} managers  its other managers, each named by its contact, in
 *   the order they were added. Only the main process changes these (see Projects.updateManagers)
 */

export const SCRIPT_MAX = 20000;
export const INSTRUCTIONS_MAX = 20000;
export const VALUE_MAX = 32768;
export const LIST_MAX = 50;

/** The script a worktree is set up with is run under this name, so no run script can have it. */
export const SETUP = 'setup';
/** What the script made of a project's one run command is kept under. */
const RUN = 'run';

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ID = /^[A-Za-z0-9-]{1,64}$/;

const list = (value) => (Array.isArray(value) ? value : []).slice(0, LIST_MAX);
const line = (value, max = 200) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
/** Several lines, as they were typed, without the empty ones around them. */
const lines = (value, max) =>
  String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/^\s*\n|\s+$/g, '')
    .slice(0, max);

/** An id for a new run script: Settings gives one as soon as a script is added, for every save to keep. */
export const newScriptId = () => globalThis.crypto.randomUUID();

/** A setup, cleanup or run script as it is kept. */
export const cleanScript = (value) => lines(value, SCRIPT_MAX);

/**
 * The variables as they are kept. Throws a message for the user for a name no environment takes,
 * and for one that is there twice. A row without a name is one that is not filled in yet.
 * @param {unknown} value
 * @returns {Variable[]}
 */
export function cleanVariables(value) {
  const seen = new Set();
  const variables = [];
  for (const item of list(value)) {
    const name = String(item?.name ?? '').trim();
    if (!name) continue;
    if (!NAME.test(name)) {
      throw new Error(`“${name}” can’t be the name of a variable. Letters, numbers and underscores work.`);
    }
    if (seen.has(name)) throw new Error(`${name} is there twice. Keep one of them.`);
    seen.add(name);
    variables.push({ name, value: String(item?.value ?? '').slice(0, VALUE_MAX) });
  }
  return variables;
}

/** The files variables are read from, each once. @param {unknown} value @returns {string[]} */
export function cleanEnvFiles(value) {
  return [
    ...new Set(
      list(value)
        .map((file) => String(file ?? '').trim())
        .filter(Boolean)
    ),
  ];
}

/**
 * The run scripts as they are kept. One without a command is not filled in yet; one without a
 * name is called after its place in the list.
 * @param {unknown} value
 * @returns {Script[]}
 */
export function cleanScripts(value) {
  const seen = new Set();
  const scripts = [];
  for (const item of list(value)) {
    const command = cleanScript(item?.command);
    if (!command) continue;
    const kept = typeof item?.id === 'string' && ID.test(item.id) && item.id !== SETUP && !seen.has(item.id);
    const id = kept ? item.id : newScriptId();
    seen.add(id);
    scripts.push({
      id,
      name: line(item?.name, 60) || (scripts.length ? `Script ${scripts.length + 1}` : 'Run'),
      command,
    });
  }
  return scripts;
}

/**
 * Which files a new worktree gets a copy of: one pattern on each line, or a list of them. Throws a
 * message for the user for one that reaches outside the project.
 * @param {unknown} value
 * @returns {string[]}
 */
export function cleanPatterns(value) {
  const typed = Array.isArray(value) ? value : String(value ?? '').split(/\r?\n/);
  const patterns = [...new Set(typed.map((pattern) => String(pattern ?? '').trim()).filter(Boolean))].slice(
    0,
    LIST_MAX
  );
  for (const pattern of patterns) {
    if (/^([\\/]|[A-Za-z]:)/.test(pattern) || pattern.split(/[\\/]/).includes('..') || pattern.startsWith(':')) {
      throw new Error(
        `“${pattern}” is not a file in the project. Name files from the top of the project, such as .env*.`
      );
    }
  }
  return patterns;
}

/** One part of a project's instructions as it is kept: as typed, without the empty lines around it. */
export const cleanInstructionText = (value) => lines(value, INSTRUCTIONS_MAX);

/** @param {unknown} value @returns {Instructions} */
export function cleanInstructions(value) {
  const typed = value && typeof value === 'object' ? /** @type {Record<string, unknown>} */ (value) : {};
  return {
    general: cleanInstructionText(typed.general),
    pullRequest: cleanInstructionText(typed.pullRequest),
    review: cleanInstructionText(typed.review),
  };
}

/** The name of a branch or a remote, or '' for anything git would not take as one. */
const refName = (value) => {
  const name = String(value ?? '').trim();
  // A leading dash would read as an option to git.
  return /^[^\s\-~^:?*[\\][^\s~^:?*[\\]*$/.test(name) && !name.includes('..') ? name.slice(0, 200) : '';
};

const CLEAN = {
  fallbacks: (value) => (value === null ? null : cleanFallbackPolicy(value)),
  setup: cleanScript,
  cleanup: cleanScript,
  scripts: cleanScripts,
  env: cleanVariables,
  envFiles: cleanEnvFiles,
  base: refName,
  remote: refName,
  instructions: cleanInstructions,
  previewUrls: cleanPreviewUrls,
  copyFiles: cleanPatterns,
  manager: cleanManager,
};

/** What a window may change about a project, by name. */
export const PROJECT_SETTINGS = Object.freeze(Object.keys(CLEAN));

/**
 * What a window may change about a project, as it is kept: only what `patch` names. Throws a
 * message for the user when something in it can't be kept.
 * @param {unknown} patch
 * @returns {Partial<ProjectSettings>}
 */
export function cleanProjectPatch(patch) {
  const typed = patch && typeof patch === 'object' ? /** @type {Record<string, unknown>} */ (patch) : {};
  return Object.fromEntries(
    Object.entries(CLEAN)
      .filter(([key]) => key in typed)
      .map(([key, clean]) => [key, clean(typed[key])])
  );
}

/** What is left out by `clean` because it can't be kept, instead of refused: the file was written by hand. */
const kept = (clean, value, otherwise) => {
  try {
    return clean(value);
  } catch {
    return otherwise;
  }
};

/**
 * Everything a project is set up with, from what is kept about it. A project nothing is kept
 * about has no scripts, no variables, and starts its worktrees from the remote's main line.
 * @param {Record<string, unknown> | null | undefined} stored
 * @returns {ProjectSettings}
 */
export function projectSettings(stored) {
  const project = stored && typeof stored === 'object' ? stored : {};
  return {
    fallbacks: project.fallbacks == null ? null : cleanFallbackPolicy(project.fallbacks),
    setup: cleanScript(project.setup),
    cleanup: cleanScript(project.cleanup),
    scripts: cleanScripts(project.scripts),
    env: kept(cleanVariables, project.env, []),
    envFiles: cleanEnvFiles(project.envFiles),
    base: refName(project.base),
    remote: refName(project.remote),
    instructions: cleanInstructions(project.instructions),
    previewUrls: kept(cleanPreviewUrls, project.previewUrls, []),
    copyFiles: kept(cleanPatterns, project.copyFiles, []),
    manager: cleanManager(project.manager),
    managers: cleanManagers(project.managers),
  };
}

/**
 * A project's run command, from before it had several: the first of its scripts.
 * @param {Script[]} scripts
 * @param {string} command
 * @returns {Script[]}
 */
export function withRunCommand(scripts, command) {
  const [first, ...rest] = scripts;
  return first ? [{ ...first, command }, ...rest] : [{ id: RUN, name: 'Run', command }];
}

// ---- Fill in from the project -------------------------------------------------------------------

/**
 * Guesses at a project's scripts from what its main checkout has (see suggestScripts in main/run-command.js).
 * @typedef {Object} FoundScripts
 * @property {string} setup    '' for none
 * @property {{ name: string, command: string, keepsRunning: boolean }[]} run  the likeliest first
 * @property {string} cleanup  '' for none
 */

/**
 * One of the scripts Fill in from the project offers, with whether its box starts ticked.
 * @typedef {Object} FillChoice
 * @property {'setup' | 'cleanup' | 'run'} which
 * @property {string} name      for a run script, what it is called; for the others, ''
 * @property {string} command
 * @property {boolean} ticked
 * @property {boolean} replaces  it takes the place of a setup or cleanup script that was typed
 */

/**
 * What Fill in from the project offers, from what was found beside what the project has: only what it doesn't
 * have yet, in the order the Scripts page has them. A box starts ticked where it replaces nothing: a setup or
 * cleanup script where there is none, and the run script that starts the project where there are no run scripts.
 * One that would replace what was typed starts unticked, so nothing is replaced unless the user ticks it.
 * @param {ProjectSettings} settings
 * @param {FoundScripts} found
 * @returns {FillChoice[]}
 */
export function fillChoices(settings, found) {
  const one = (which) => {
    const command = cleanScript(found[which]);
    if (!command || command === settings[which]) return [];
    const replaces = Boolean(settings[which]);
    return [{ which, name: '', command, ticked: !replaces, replaces }];
  };
  const had = new Set(settings.scripts.map(({ command }) => command));
  const run = found.run
    .map((script) => ({ ...script, command: cleanScript(script.command) }))
    .filter(({ command }) => command && !had.has(command))
    .map(({ name, command, keepsRunning }, i) => ({
      which: 'run',
      name,
      command,
      ticked: i === 0 && keepsRunning && !settings.scripts.length,
      replaces: false,
    }));
  return [...one('setup'), ...one('cleanup'), ...run];
}

/**
 * What the project is to be set up with once some of what Fill in from the project offers is picked: a setup or
 * cleanup script in place of the one it has, and run scripts after the ones it has.
 * @param {ProjectSettings} settings
 * @param {FillChoice[]} picked
 * @returns {Partial<Pick<ProjectSettings, 'setup' | 'cleanup' | 'scripts'>>}  only what changes
 */
export function filledScripts(settings, picked) {
  const patch = {};
  const had = new Set(settings.scripts.map(({ command }) => command));
  const added = picked
    .filter(({ which, command }) => which === 'run' && !had.has(command))
    .map(({ name, command }) => ({ id: newScriptId(), name, command }));
  for (const { which, command, replaces } of picked) {
    if (which === 'run') continue;
    if (!replaces && settings[which] && settings[which] !== command) {
      throw new Error(`The ${which} script changed. Cancel and choose scripts again.`);
    }
    patch[which] = command;
  }
  if (added.length) patch.scripts = [...settings.scripts, ...added];
  return patch;
}

// ---- the variables and instructions every project shares, and where each agent's program is -------

/**
 * The settings of the app that are about the environment, as they are kept: only what `patch`
 * names. Throws a message for the user when something in it can't be kept.
 * @param {unknown} patch
 * @returns {{ env?: Variable[], envFiles?: string[] }}
 */
export function cleanEnvironmentSettings(patch) {
  const typed = patch && typeof patch === 'object' ? /** @type {Record<string, unknown>} */ (patch) : {};
  return {
    ...('env' in typed && { env: cleanVariables(typed.env) }),
    ...('envFiles' in typed && { envFiles: cleanEnvFiles(typed.envFiles) }),
  };
}

/**
 * What every project's agents are told, as Settings > Every project > Instructions keeps it: only when `patch`
 * names it. A part it leaves out stays as it is.
 * @param {unknown} patch
 * @param {{ instructions?: unknown }} current  the app's settings
 * @returns {{ instructions?: Instructions }}
 */
export function cleanEveryProjectInstructions(patch, current) {
  const typed = /** @type {any} */ (patch)?.instructions;
  if (!typed || typeof typed !== 'object') return {};
  return { instructions: cleanInstructions({ ...cleanInstructions(current?.instructions), ...typed }) };
}

/**
 * Where the user keeps a service's program, for the services there are. A service without a
 * path runs the one the app finds itself.
 * @param {unknown} patch  may have `agents`: service id -> { path }
 * @param {{ agents?: Record<string, { path: string }> }} current
 * @param {{ id: string }[]} providers
 * @returns {{ agents?: Record<string, { path: string }> }}
 */
export function cleanAgentSettings(patch, current, providers) {
  const typed = /** @type {any} */ (patch)?.agents;
  if (!typed || typeof typed !== 'object') return {};
  const agents = { ...current.agents };
  for (const { id } of providers) {
    if (!(id in typed)) continue;
    const path = String(typed[id]?.path ?? '').trim();
    if (path) agents[id] = { path };
    else delete agents[id];
  }
  return { agents };
}

// ---- files of variables ---------------------------------------------------------------------

const ESCAPES = { n: '\n', r: '\r', t: '\t' };

/** What stands for a value in a file of variables: quoted, or up to a comment. */
function valueOf(written) {
  const text = written.trim();
  const quote = text[0];
  if ((quote === '"' || quote === "'" || quote === '`') && text.lastIndexOf(quote) > 0) {
    const inner = text.slice(1, text.lastIndexOf(quote));
    // Only double quotes read \n as a new line, as a shell does.
    return quote === '"' ? inner.replace(/\\([nrt"\\])/g, (_all, c) => ESCAPES[c] ?? c) : inner;
  }
  return text.replace(/\s+#.*$/, '').trim();
}

/**
 * Reads a file of variables, written the way a .env file is: NAME=value on a line of its own,
 * with or without `export` and quotes. Lines that say nothing of the kind are passed over.
 * @param {string} text
 * @returns {Record<string, string>}
 */
export function parseEnvFile(text) {
  /** @type {Record<string, string>} */
  const variables = {};
  for (const written of String(text ?? '').split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(written);
    if (match) variables[match[1]] = valueOf(match[2]);
  }
  return variables;
}

/** @param {Variable[]} variables @returns {Record<string, string>} */
export const asEnvironment = (variables) => Object.fromEntries(variables.map(({ name, value }) => [name, value]));

// ---- where a run is looked at ---------------------------------------------------------------

const PORT = '(?:BUDDYLIST_PORT|PORT)';
const PORT_PLUS = new RegExp(`\\$\\(\\(\\s*${PORT}\\s*\\+\\s*(\\d+)\\s*\\)\\)`, 'g');
const PORT_NAMED = new RegExp(`\\$\\{${PORT}\\}|\\$${PORT}\\b`, 'g');

/**
 * An address with the contact's port in it, where it is written the way a script names it:
 * $PORT, ${PORT}, and $((PORT + 1)) for the ports after it.
 * @param {string} url
 * @param {number} port
 */
export const withPort = (url, port) =>
  url.replace(PORT_PLUS, (_all, more) => String(port + Number(more))).replace(PORT_NAMED, String(port));

/**
 * The pages a run on `port` is looked at on, the one its line links to first. A project that
 * names none is looked at on the port itself.
 * @param {PreviewUrl[]} urls
 * @param {number} port
 * @returns {PreviewUrl[]}
 */
export const previewLinks = (urls, port) =>
  urls.length
    ? urls.map(({ name, url }) => ({ name, url: withPort(url, port) }))
    : [{ name: '', url: `http://localhost:${port}` }];

/**
 * The pages a run is looked at on. Throws a message for the user for one a browser can't open.
 * @param {unknown} value
 * @returns {PreviewUrl[]}
 */
export function cleanPreviewUrls(value) {
  const urls = [];
  for (const item of list(value)) {
    const url = String(item?.url ?? '').trim();
    if (!url) continue;
    // With a port in it, as it is opened: "$((PORT + 1))" has spaces of its own.
    if (!/^https?:\/\/\S+$/i.test(withPort(url, 4100))) {
      throw new Error(`“${url}” is not an address a browser opens. Start it with http:// or https://.`);
    }
    urls.push({ name: line(item?.name, 40), url });
  }
  return urls;
}

// ---- what an agent is told on top of what was typed --------------------------------------------

/**
 * What a project's agents are told, part by part: what every project is told first, then the project's own, so
 * that its own can add to it or say otherwise. A part neither has is ''.
 * @param {Instructions} every  Settings > Every project > Instructions
 * @param {Instructions} own
 * @returns {Instructions}
 */
export const allInstructions = (every, own) =>
  /** @type {Instructions} */ (
    Object.fromEntries(
      Object.entries(own).map(([part, text]) => [part, [every[part], text].filter(Boolean).join('\n\n')])
    )
  );

/** A message with the project's own instructions for it under it. @param {string} text @param {string} [more] */
export const withInstructions = (text, more) => (more ? `${text}\n\n${more}` : text);

/**
 * What a contact is asked when it is to work out one of its project's scripts: the one that sets
 * up a new worktree, or the one Run starts. It answers in the conversation, for you to keep.
 * @param {'setup' | 'run'} kind
 */
export const askForScript = (kind) =>
  kind === 'setup'
    ? 'Work out the setup script for this project: the commands that get a fresh checkout of it ready to work in, ' +
      'such as installing its dependencies and making the files git does not keep. Look at the project to find ' +
      'out, and don’t run anything yet. The main checkout is at $BUDDYLIST_ROOT_PATH, if something is better ' +
      'linked or copied from there. Reply with the script in one code block, for me to add as the setup script.'
    : 'Work out the command that starts this project for development, such as its dev server. Look at the ' +
      'project to find out, and don’t run anything yet. It gets a free port in $PORT: pass that on where the ' +
      'server takes its port as an option. Reply with the command in one code block, for me to add as the run script.';
