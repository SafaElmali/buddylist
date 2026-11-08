// Projects that are not on this computer yet: one cloned from GitHub, and a new
// one started from nothing. Either ends up as a folder a contact can be added in.
// Listing the user's repositories only reads. A new project's repository on
// GitHub is only made when the user asked for one.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanProjectName, githubAddress, parseRepository, REPOSITORY_HELP } from '../shared/projects.js';
import { ghTrouble, lastWord, runGh } from './github-lookup.js';
import { git } from './worktrees.js';

// How many of the user's repositories the dialog offers: the ones pushed to last.
const RECENT = 100;
const LIST_TIMEOUT_MS = 15 * 1000;
// A big repository takes a while to arrive.
const CLONE_TIMEOUT_MS = 10 * 60 * 1000;
// Making a repository on GitHub and pushing the first commit to it.
const CREATE_TIMEOUT_MS = 2 * 60 * 1000;

const FIRST_COMMIT = 'Initial commit';

/** @typedef {import('../shared/projects.js').RecentRepository} RecentRepository */

/**
 * Reads what `gh api user/repos` prints.
 * @param {string} output
 * @param {string} [protocol]  how git reaches GitHub here: "ssh", or else https
 * @returns {RecentRepository[] | null}  null when it isn't the list we asked for
 */
export function parseRepositories(output, protocol) {
  let found;
  try {
    found = JSON.parse(output);
  } catch {
    return null;
  }
  if (!Array.isArray(found)) return null;
  return found
    .filter((repo) => typeof repo?.full_name === 'string' && parseRepository(repo.full_name))
    .map((repo) => ({
      slug: repo.full_name,
      description: String(repo.description ?? ''),
      private: Boolean(repo.private),
      address: githubAddress(repo.full_name, protocol),
    }));
}

/** How git reaches GitHub on this computer, as the GitHub CLI was told: "ssh" or "https". */
const gitProtocol = (gh) =>
  gh(os.homedir(), ['config', 'get', 'git_protocol']).then(
    (output) => output.trim(),
    () => 'https'
  );

/**
 * The repositories the user can reach on GitHub, the one pushed to last first: their own,
 * and those of their organizations. Throws a message for the dialog when GitHub can't be asked.
 * @param {{ gh?: typeof runGh }} [opts]  a stand-in for `gh` in tests
 * @returns {Promise<RecentRepository[]>}
 */
export async function recentRepositories({ gh = runGh } = {}) {
  const [output, protocol] = await Promise.all([
    // Only what is listed is asked for: the whole answer is far more than can be read in one go.
    gh(
      os.homedir(),
      ['api', `user/repos?sort=pushed&per_page=${RECENT}`, '--jq', '[.[] | {full_name, description, private}]'],
      LIST_TIMEOUT_MS
    ).catch((err) => {
      throw new Error(ghTrouble(err) ?? `GitHub could not list your repositories: ${lastWord(err)}`, { cause: err });
    }),
    gitProtocol(gh),
  ]);
  const repos = parseRepositories(output, protocol);
  if (!repos) throw new Error('The answer from GitHub could not be read. Try again in a moment.');
  return repos;
}

/** A folder as it was typed: "~" is the user's own. */
const expand = (folder) =>
  String(folder ?? '')
    .trim()
    .replace(/^~(?=$|[\\/])/, os.homedir());

/**
 * The folder a project called `name` gets in `parent`. Throws a message for the
 * user when there is nowhere to put it, or something is there already.
 */
function freeFolder(parent, name) {
  const where = expand(parent);
  if (!where || !path.isAbsolute(where)) throw new Error('Pick the folder the project should go in.');
  if (fs.existsSync(where) && !fs.statSync(where).isDirectory()) throw new Error(`${where} is not a folder.`);
  const folder = path.join(where, name);
  if (fs.existsSync(folder)) throw new Error(`There is already a "${name}" in ${where}. Pick another folder.`);
  return folder;
}

/** Why git could not clone, in words for the user. */
function explainClone(err, name) {
  // Git ends on advice that fits any failure: what went wrong is further up.
  const said = String(err?.stderr || err?.message || '');
  if (/terminal prompts disabled|Permission denied \(publickey\)|Authentication failed/i.test(said)) {
    return `Git could not sign in to clone ${name}. Run "gh auth login" in a terminal, or use the address that works there.`;
  }
  if (/Repository not found|does not appear to be a git repository/i.test(said)) {
    return `There is no repository at that address, or you can't see it.`;
  }
  if (/Could not resolve host|unable to access|Network is unreachable/i.test(said)) {
    return 'The repository could not be reached. Check your internet connection.';
  }
  const why = /^(?:fatal|error): (.+)$/im.exec(said)?.[1] ?? err?.message;
  return `${name} could not be cloned: ${why}`;
}

/**
 * Clones a repository into a folder of its own in `parent`.
 * @param {object} what
 * @param {string} what.repository  an address git can clone, or "owner/name" for one on GitHub
 * @param {string} what.parent      the folder its folder goes in; made if it is not there
 * @param {{ gh?: typeof runGh, run?: typeof git }} [opts]  stand-ins for `gh` and `git` in tests
 * @returns {Promise<string>}  the project's folder
 */
export async function cloneRepository({ repository, parent }, { gh = runGh, run = git } = {}) {
  const reference = parseRepository(repository);
  if (!reference) throw new Error(REPOSITORY_HELP);
  const folder = freeFolder(parent, reference.name);
  const address = reference.url ?? githubAddress(reference.slug, await gitProtocol(gh));
  const where = path.dirname(folder);
  fs.mkdirSync(where, { recursive: true });
  // Git takes away what it made of a clone that fails.
  await run(where, ['clone', '--quiet', '--', address, folder], CLONE_TIMEOUT_MS).catch((err) => {
    throw new Error(explainClone(err, reference.name), { cause: err });
  });
  return folder;
}

/** Why the new project's repository on GitHub was not made, in words for the user. */
function explainCreate(err, name) {
  const trouble = ghTrouble(err);
  if (trouble) return trouble;
  if (/Name already exists/i.test(String(err?.stderr || ''))) {
    return `You already have a repository called "${name}" on GitHub. Pick another name.`;
  }
  return `The repository could not be made on GitHub: ${lastWord(err)}`;
}

/**
 * Starts a project from nothing: a folder with a git repository and a first
 * commit in it, so that a contact added there gets a worktree of its own. With
 * `github` it also gets a private repository on GitHub, as its `origin`. When
 * any of that fails, nothing is left behind.
 * @param {object} what
 * @param {string} what.name     what to call it: its folder and its repository get this name
 * @param {string} what.parent   the folder its folder goes in; made if it is not there
 * @param {boolean} [what.github]  also make a private repository for it on GitHub
 * @param {{ gh?: typeof runGh, run?: typeof git }} [opts]  stand-ins for `gh` and `git` in tests
 * @returns {Promise<string>}  the project's folder
 */
export async function createProject({ name, parent, github = false }, { gh = runGh, run = git } = {}) {
  const clean = cleanProjectName(name);
  const folder = freeFolder(parent, clean);
  // Asked before anything is made: signed out, or without gh, there is no point in starting.
  if (github) {
    await gh(os.homedir(), ['auth', 'status']).catch((err) => {
      throw new Error(explainCreate(err, clean), { cause: err });
    });
  }
  fs.mkdirSync(path.dirname(folder), { recursive: true });
  // Fails if someone made it in the meantime: what is taken away below is only ever what was made here.
  fs.mkdirSync(folder);
  try {
    // The main line is called what the user calls theirs, and "main" when they never said.
    const own = await run(folder, ['config', '--get', 'init.defaultBranch']).catch(() => '');
    await run(folder, ['init', '--quiet', ...(own ? [] : ['--initial-branch=main'])]);
    fs.writeFileSync(path.join(folder, 'README.md'), `# ${clean}\n`);
    await run(folder, ['add', 'README.md']);
    await run(folder, ['commit', '--quiet', '-m', FIRST_COMMIT]).catch((err) => {
      throw new Error(`The first commit could not be made: ${err.message}`, { cause: err });
    });
    if (github) {
      await gh(
        folder,
        ['repo', 'create', clean, '--private', '--source', '.', '--remote', 'origin', '--push'],
        CREATE_TIMEOUT_MS
      ).catch((err) => {
        throw new Error(explainCreate(err, clean), { cause: err });
      });
    }
  } catch (err) {
    fs.rmSync(folder, { recursive: true, force: true });
    throw err;
  }
  return folder;
}
