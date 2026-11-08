// What a project is called: the one a contact works on, one that is cloned,
// and one that is started from nothing. Nothing in here touches a folder.
import { comparablePath } from './paths.js';

const parts = (folder) =>
  String(folder ?? '')
    .split(/[\\/]+/)
    .filter(Boolean);

// The same, as they compare with another folder's: a Windows folder's in any letter case.
const comparableParts = (folder) => parts(comparablePath(String(folder ?? '')));

/**
 * The project a contact's folder is part of. A worktree made here is kept in
 * <worktrees>/<project>/<branch>, so it says so itself. Any other folder is its own project.
 * @param {string} cwd
 * @param {...string} worktreesHomes  where the worktrees made here go, and where they went before if that
 *   was somewhere else; left out, every folder is its own project
 */
export function projectName(cwd, ...worktreesHomes) {
  const home = homeOf(cwd, worktreesHomes);
  // Named as the contact's folder writes it.
  return (home ? parts(cwd)[home.length] : parts(cwd).at(-1)) || String(cwd ?? '');
}

/**
 * Whether a contact's folder is in a worktree made here, <worktrees>/<project>/<branch>, rather than in its
 * project's main folder.
 * @param {string} cwd
 * @param {...string} worktreesHomes  as projectName takes them
 */
export function inWorktree(cwd, ...worktreesHomes) {
  const home = homeOf(cwd, worktreesHomes);
  return Boolean(home) && comparableParts(cwd).length > home.length + 1;
}

/** The parts of the worktrees home of those given that a folder is in, below it: none for a folder in none. */
function homeOf(cwd, worktreesHomes) {
  const folder = comparableParts(cwd);
  const holds = (home) => home.length > 0 && folder.length > home.length && home.every((part, i) => part === folder[i]);
  return worktreesHomes.map(comparableParts).find(holds);
}

// ---- This computer -------------------------------------------------------------------------------

/**
 * What the contact list calls the contacts that work on no project: questions, research, writing. Each
 * has a folder of its own that the app made for it, in <computer home>/<name>, or works in the home folder
 * itself, as a conversation held there outside the app goes on only there.
 */
export const THIS_COMPUTER = 'This computer';

/**
 * A folder's parts as they compare, with "." and ".." taken as a path takes them: chat-1/.. is the folder chat-1 is
 * in, not one in it. Never above where the path starts: a Windows drive, or a \\server\share. Only what the path
 * says, as nothing in here touches a folder: the main process asks the disk itself before it deletes one (see
 * main/computer.js).
 * @param {string} folder
 */
function resolvedParts(folder) {
  const text = String(folder ?? '');
  let root = 0;
  if (/^[A-Za-z]:([\\/]|$)/.test(text)) root = 1;
  else if (/^[\\/]{2}[^\\/]/.test(text)) root = 2;
  const resolved = [];
  for (const part of comparableParts(text)) {
    if (part === '..') {
      if (resolved.length > root) resolved.pop();
    } else if (part !== '.') resolved.push(part);
  }
  return resolved;
}

/** Whether a folder is `home` itself, or one in it, as their resolved parts say. */
const isOrIn = (folder, home, { inside }) =>
  home.length > 0 &&
  (inside ? folder.length > home.length : folder.length === home.length) &&
  home.every((part, i) => part === folder[i]);

/**
 * Whether a folder is one the app made for a contact on This computer: <computer home>/<name>, or a folder in it.
 * A path that only seems to be in there, such as <computer home>/chat-1/../.., is not.
 * @param {string} cwd
 * @param {string} computerHome  where those folders go
 */
export const madeForComputer = (cwd, computerHome) =>
  isOrIn(resolvedParts(cwd), resolvedParts(computerHome), { inside: true });

/**
 * Whether a contact working in a folder is on This computer: in one made for it, or in the home folder itself.
 * @param {string} cwd
 * @param {string} computerHome  as madeForComputer takes it
 * @param {string} homeFolder  the user's
 */
export const onComputer = (cwd, computerHome, homeFolder) =>
  madeForComputer(cwd, computerHome) || isOrIn(resolvedParts(cwd), resolvedParts(homeFolder), { inside: false });

// ---- a repository to clone ---------------------------------------------------------------------

/** What to tell someone whose repository can't be made out. */
export const REPOSITORY_HELP = 'Type the address of a repository, such as https://github.com/user/repo.git.';

const NAME = /^[A-Za-z0-9._-]+$/;
// "owner/name", as GitHub writes a repository.
const SHORT = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+$/;
const WEB = /^(?:https?|ssh|git|file):\/\/\S+$/i;
// "git@github.com:owner/name.git"
const SCP = /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:\S+$/;

const usable = (name) => NAME.test(name) && !/^\.+$/.test(name);

/**
 * @typedef {Object} RepositoryReference
 * @property {string} name          the folder a clone of it gets
 * @property {string | null} slug   "owner/name", for one on GitHub written the short way
 * @property {string | null} url    its address, for one written in full
 */

/**
 * Reads what was typed for a repository to clone.
 * @param {unknown} text  an address git can clone, or "owner/name" for one on GitHub
 * @returns {RepositoryReference | null}  null for anything else
 */
export function parseRepository(text) {
  const typed = String(text ?? '').trim();
  // A leading dash would read as an option to git.
  if (!typed || typed.startsWith('-')) return null;
  const short = SHORT.test(typed);
  if (!short && !WEB.test(typed) && !SCP.test(typed)) return null;
  const name = typed
    .replace(/[\\/]+$/, '')
    .split(/[\\/:]/)
    .pop()
    .replace(/\.git$/i, '');
  if (!usable(name)) return null;
  return short ? { name, slug: typed.replace(/\.git$/i, ''), url: null } : { name, slug: null, url: typed };
}

/**
 * The address to clone a repository on GitHub from.
 * @param {string} slug  "owner/name"
 * @param {string} [protocol]  how git reaches GitHub on this computer: "ssh", or else https
 */
export const githubAddress = (slug, protocol) =>
  protocol === 'ssh' ? `git@github.com:${slug}.git` : `https://github.com/${slug}.git`;

/**
 * A repository of the user's on GitHub, as the dialog that clones one lists it.
 * @typedef {Object} RecentRepository
 * @property {string} slug         "owner/name"
 * @property {string} description  '' without one
 * @property {boolean} private
 * @property {string} address      where to clone it from, the way git reaches GitHub on this computer
 */

/**
 * The repositories whose name or description has `query` in it, in any letter case.
 * @param {RecentRepository[]} repos
 * @param {string} query
 * @returns {RecentRepository[]}
 */
export function matchingRepositories(repos, query) {
  const q = String(query ?? '')
    .trim()
    .toLowerCase();
  if (!q) return repos;
  return repos.filter((repo) => repo.slug.toLowerCase().includes(q) || repo.description.toLowerCase().includes(q));
}

// ---- a project started from nothing --------------------------------------------------------------

export const PROJECT_NAME_MAX = 100;

/**
 * The folder, and the repository, a new project gets for the name typed for it:
 * what GitHub would make of that name too. Empty when nothing can be made of it.
 * @param {unknown} name
 */
export function projectFolderName(name) {
  const folder = String(name ?? '')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    // A leading dash would read as an option to git.
    .replace(/^-+|-+$/g, '')
    .slice(0, PROJECT_NAME_MAX);
  return usable(folder) ? folder : '';
}

/** The name a new project is made under. Throws a message for the user if there is none. */
export function cleanProjectName(name) {
  const folder = projectFolderName(name);
  if (!folder) throw new Error('Type a name for the project. Letters, numbers, dashes and dots work.');
  return folder;
}
