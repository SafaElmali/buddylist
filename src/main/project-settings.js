// What each project is set up with, as the rest of the main process asks for
// it: the settings kept under its key, the variables its scripts, terminals and
// agents are started with, and the projects there are for Settings.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanManagers } from '../shared/managers.js';
import {
  allInstructions,
  asEnvironment,
  cleanInstructions,
  cleanProjectPatch,
  parseEnvFile,
  projectSettings,
  takenFromFile,
} from '../shared/project-settings.js';
import { THIS_COMPUTER, onComputer } from '../shared/projects.js';
import { execToolSync } from './git-command.js';
import { describeProject, describeProjectSync, projectOfKey, suggestScripts } from './run-command.js';

/** @typedef {import('./run-command.js').Project} Project */
/** @typedef {import('../shared/project-settings.js').ProjectSettings} ProjectSettings */

/**
 * A project as Settings lists it.
 * @typedef {Object} ProjectView
 * @property {string} key
 * @property {string} name
 * @property {string} root       its main checkout; outside a repository, the folder
 * @property {string | null} worktrees  where its contacts' worktrees go; null for a folder outside a repository
 * @property {number} contacts   how many contacts work on it
 * @property {ProjectSettings} settings
 * @property {ReturnType<typeof suggestScripts>} found  guesses at its scripts from what its main checkout has, which
 *   its Scripts page offers to fill in
 * @property {{ id: string, name: string, archived: boolean, conversations: number }[]} [managers]  its managers, its
 *   first first, with how many conversations are under each: Settings is told them with the projects
 */

// A file of variables is a few lines. Anything much bigger was picked by mistake.
const ENV_FILE_MAX = 1024 * 1024;
// Asking git which files it keeps should feel instant; past this it counts as keeping them all.
const LS_TIMEOUT_MS = 4000;

/**
 * The files git keeps in a folder's branch, of some named from that folder, as git names them back.
 * A git that can't say keeps them all.
 * @param {string[]} files
 * @param {string} folder
 * @returns {Set<string>}  where each is, in full
 */
function keptByGit(files, folder) {
  const own = files.filter((file) => !path.isAbsolute(file));
  if (!own.length) return new Set();
  try {
    const said = execToolSync('git', ['ls-files', '-z', '--', ...own], {
      cwd: folder,
      timeout: LS_TIMEOUT_MS,
      windowsHide: true,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return new Set(
      said
        .split('\0')
        .filter(Boolean)
        .map((file) => path.resolve(folder, file))
    );
  } catch {
    return new Set(own.map((file) => path.resolve(folder, file)));
  }
}

/**
 * The variables in some files, the later ones winning. A file that is gone or can't be read
 * says nothing: a worktree may not have its copy yet. In a worktree, one its branch has in git
 * is read from the main checkout instead. The branch can be anyone's pull request, and what it
 * sets would reach the agent, ANTHROPIC_BASE_URL say. Its own copy, one git doesn't keep, is its own. No file sets
 * which programs start or what they load as they do (see takenFromFile): that is typed in Settings.
 * @param {string[]} files
 * @param {string} folder  where one that is not named in full is looked for
 * @param {string} [mainFolder]  the same folder in the main checkout, for a folder in a worktree
 */
function readEnvFiles(files, folder, mainFolder) {
  const variables = {};
  const theirs = mainFolder ? keptByGit(files, folder) : new Set();
  for (const file of files) {
    try {
      const at = theirs.has(path.resolve(folder, file)) ? path.resolve(mainFolder, file) : path.resolve(folder, file);
      if (fs.statSync(at).size <= ENV_FILE_MAX) {
        Object.assign(variables, takenFromFile(parseEnvFile(fs.readFileSync(at, 'utf8'))));
      }
    } catch {
      // not there
    }
  }
  return variables;
}

export class Projects {
  /**
   * The project each folder was last found to be part of. An agent is started without the app
   * standing still while git says so, unless nothing was asked about its folder yet.
   * @type {Map<string, Project>}
   */
  #known = new Map();

  /**
   * @param {object} deps
   * @param {Pick<import('./storage/store.js').Store, 'settings' | 'contacts' | 'projects' | 'getProject' | 'updateProject'>} deps.store
   * @param {string} deps.worktreesHome  where contacts' worktrees go
   * @param {string} [deps.computerHome]  where the folders of the contacts on This computer go (see main/computer.js):
   *   they all share one project, named This computer. Nobody is on This computer when left out
   * @param {typeof describeProject} [deps.describe]  stand-ins for tests: how a folder's project is found,
   * @param {typeof describeProjectSync} [deps.describeNow]  and how while the app waits
   */
  constructor({
    store,
    worktreesHome,
    computerHome = '',
    describe = describeProject,
    describeNow = describeProjectSync,
  }) {
    this.store = store;
    this.worktreesHome = worktreesHome;
    /**
     * The project of every contact on This computer: what they are told and started with is on one page of
     * Settings, not on one for each. Its key is where their folders go as it is written, so that it stays the
     * same before the first of them is made.
     * @type {Project | null}
     */
    this.computer = computerHome
      ? { key: `dir:${path.resolve(computerHome)}`, name: THIS_COMPUTER, root: path.resolve(computerHome) }
      : null;
    const computer = (cwd) => (this.computer && onComputer(cwd, computerHome, os.homedir()) ? this.computer : null);
    this.describe = async (cwd) => computer(cwd) ?? describe(cwd);
    this.describeNow = (cwd) => computer(cwd) ?? describeNow(cwd);
  }

  /** The project a folder is part of, found without holding up the app, and kept. @param {string} cwd */
  async #find(cwd) {
    const project = await this.describe(cwd);
    this.#known.set(cwd, project);
    return project;
  }

  /**
   * Finds the projects of these folders ahead of their agents, one at a time, out of the way.
   * @param {string[]} cwds
   */
  async know(cwds) {
    for (const cwd of new Set(cwds)) await this.#find(cwd);
  }

  /**
   * The project a folder was last found to be part of, found now only for a folder nothing was asked about yet.
   * For whatever asks about many folders again and again, such as which contacts work on a project.
   * @param {string} cwd
   * @returns {Promise<Project>}
   */
  async known(cwd) {
    return this.#known.get(cwd) ?? this.#find(cwd);
  }

  /** Everything a project is set up with. @param {string} key @returns {ProjectSettings} */
  settings(key) {
    return projectSettings(this.store.getProject(key));
  }

  /**
   * The project a folder is part of, with what it is set up with.
   * @param {string} cwd
   * @returns {Promise<Project & { settings: ProjectSettings }>}
   */
  async of(cwd) {
    const project = await this.#find(cwd);
    return { ...project, settings: this.settings(project.key) };
  }

  /**
   * Changes what a project is set up with. Throws a message for the user when something
   * in `patch` can't be kept; nothing is changed then.
   * @param {string} key
   * @param {unknown} patch  only what it names is changed
   * @returns {ProjectSettings}
   */
  update(key, patch) {
    if (typeof key !== 'string' || !/^(git|dir):./.test(key)) throw new Error('That project is not known.');
    this.store.updateProject(key, cleanProjectPatch(patch));
    return this.settings(key);
  }

  /**
   * Keeps a project's managers besides its first (see ProjectSettings), which only the managers change: a window
   * changes one of them through `manager`, named by its contact (see REQUESTS.projectUpdate in ipc.js).
   * @param {string} key
   * @param {unknown} managers
   * @returns {ProjectSettings}
   */
  updateManagers(key, managers) {
    if (typeof key !== 'string' || !/^(git|dir):./.test(key)) throw new Error('That project is not known.');
    this.store.updateProject(key, { managers: cleanManagers(managers) });
    return this.settings(key);
  }

  /**
   * The variables whatever is started for a project gets on top of the app's own: the ones every
   * project shares, then the project's, a variable typed in winning over one read from a file.
   * And where the project is, for a script that needs something from its main checkout.
   * @param {Project} project
   * @param {string} cwd  the contact's folder
   * @returns {Record<string, string>}
   */
  environment(project, cwd) {
    const shared = projectSettings({ env: this.store.settings.env, envFiles: this.store.settings.envFiles });
    const own = this.settings(project.key);
    return {
      ...readEnvFiles(shared.envFiles, cwd, project.mainFolder),
      ...asEnvironment(shared.env),
      ...readEnvFiles(own.envFiles, cwd, project.mainFolder),
      ...asEnvironment(own.env),
      BUDDYLIST_ROOT_PATH: project.root,
      BUDDYLIST_WORKSPACE_PATH: cwd,
    };
  }

  /** The same, for a folder whose project is still to be found. @param {string} cwd */
  async environmentIn(cwd) {
    return this.environment(await this.#find(cwd), cwd);
  }

  /**
   * What a project's agents are told on top of what you type, part by part: what every project is told, from
   * Settings > Every project, then the project's own, which can add to it or say otherwise.
   * @param {string} key
   * @returns {import('../shared/project-settings.js').Instructions}
   */
  instructions(key) {
    return allInstructions(cleanInstructions(this.store.settings.instructions), this.settings(key).instructions);
  }

  /**
   * What an agent working in a folder is started with: its project's variables, what every new
   * conversation of the project is told (see instructions), and, in a worktree, the same folder in the main
   * checkout, where the agent's own settings for the project are read (see Project). An agent is
   * started where it is asked for, so the project is the one the folder was last found to be part
   * of. Only a folder nothing was asked about yet has the app stand still while git says. It is
   * looked at again behind it, for the next agent there: a folder can become a repository.
   * @param {string} cwd
   * @returns {{ env: Record<string, string>, instructions: string, mainFolder?: string }}
   */
  forAgent(cwd) {
    let project = this.#known.get(cwd);
    if (!project) this.#known.set(cwd, (project = this.describeNow(cwd)));
    this.#find(cwd);
    return {
      fallbacks: this.settings(project.key).fallbacks,
      env: this.environment(project, cwd),
      instructions: this.instructions(project.key).general,
      ...(project.mainFolder && { mainFolder: project.mainFolder }),
    };
  }

  /**
   * Every project there is something to set up: the ones contacts work on, and the ones
   * something is kept about. By name.
   * @returns {Promise<ProjectView[]>}
   */
  async list() {
    const { contacts } = this.store;
    const found = await Promise.all(contacts.map((contact) => this.#find(contact.cwd)));
    /** @type {Map<string, Project & { contacts: number }>} */
    const projects = new Map(
      Object.keys(this.store.projects).map((key) => [key, { ...projectOfKey(key), contacts: 0 }])
    );
    for (const project of found) {
      projects.set(project.key, { ...project, contacts: (projects.get(project.key)?.contacts ?? 0) + 1 });
    }
    return [...projects.values()]
      .map(({ key, name, root, contacts: working }) => ({
        key,
        // One known by its key alone is named after its folder: This computer's is called This computer all the same.
        name: key === this.computer?.key ? THIS_COMPUTER : name,
        root,
        worktrees: key.startsWith('git:') ? path.join(this.worktreesHome, name) : null,
        contacts: working,
        settings: this.settings(key),
        found: suggestScripts(root),
      }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
  }

  /**
   * Keeps a project in the contact list once its contacts are deleted: something is kept about it from then on, if
   * nothing was, and only Remove project forgets it (see empty). This computer is listed without.
   * @param {string} key
   */
  keep(key) {
    if (key === this.computer?.key || this.store.getProject(key)) return;
    this.store.updateProject(key, {});
  }

  /**
   * The projects the contact list lists with nobody on them: something is kept about each, and no contact works on
   * it, as far as the folders asked about so far say. The list also leaves out one whose name a contact's project
   * has. Not This computer, which the list has without. By name.
   * @returns {import('../shared/groups.js').EmptyProject[]}
   */
  empty() {
    const worked = new Set(this.store.contacts.map(({ cwd }) => this.#known.get(cwd)?.key));
    return Object.keys(this.store.projects)
      .filter((key) => /^(git|dir):./.test(key) && key !== this.computer?.key && !worked.has(key))
      .map((key) => {
        const { name, root } = projectOfKey(key);
        return { key, name, root, repository: key.startsWith('git:') };
      })
      .sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
  }
}
