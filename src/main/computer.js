// The folders of the contacts on This computer: one each, made empty when the contact is added, for
// the files its agent writes. Nothing else of the user's is in it, and no other contact works there.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freeBranchName } from '../shared/branch-names.js';

/** Where they go: ~/.buddylist/this-computer/<name>, next to the worktrees. */
export const COMPUTER_HOME = path.join(os.homedir(), '.buddylist', 'this-computer');

// What the folders are called, with a number: "chat-1", "chat-2".
const CHAT = 'chat';

/** What a folder holds that nobody put there: the Finder's notes about it. */
const NOBODYS = new Set(['.DS_Store']);

/**
 * The name the next folder gets: the lowest number nothing uses yet.
 * @param {string} home  where the folders go
 */
export const freeComputerName = (home) => freeBranchName(CHAT, (name) => fs.existsSync(path.join(home, name)));

/**
 * Makes a new contact's folder.
 * @param {string} home  where the folders go
 * @returns {string}  where it is
 */
export function makeComputerFolder(home) {
  fs.mkdirSync(home, { recursive: true });
  // Another contact may have taken the name since it was found free.
  for (;;) {
    const dir = path.join(home, freeComputerName(home));
    try {
      fs.mkdirSync(dir);
      return dir;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }
}

/**
 * How many files and folders a contact's agent made in its folder; none for one that is gone.
 * @param {string} dir
 */
export function computerFiles(dir) {
  try {
    return fs.readdirSync(dir).filter((name) => !NOBODYS.has(name)).length;
  } catch {
    return 0;
  }
}

/**
 * The folder a contact's folder on This computer really is, as the disk says, when it is one made for a contact
 * there: exactly one level below where they go, and none of the user's. A contact's folder can come from an older
 * store, from a folder picked by hand or from an agent, so what its path only seems to say is not taken for it:
 * <home>/chat-1/.. is the home, and a link in there to a folder elsewhere is that folder.
 * @param {string} dir
 * @param {string} home  where the folders go
 * @returns {string | null}  where it is, links followed; null for any other folder, and for one that is gone
 */
export function computerFolderOf(dir, home) {
  try {
    const real = fs.realpathSync(path.resolve(dir));
    return path.dirname(real) === fs.realpathSync(path.resolve(home)) ? real : null;
  } catch {
    return null;
  }
}

/**
 * Takes a deleted contact's folder along: an empty one always, one with files only when asked. Only a folder
 * the app made for a contact on This computer goes (see computerFolderOf): the home folder is never touched.
 * @param {string} dir
 * @param {string} home  where the folders go
 * @param {{ files?: boolean }} [opts]  `files`: what the agent made in it goes too
 * @returns {boolean}  whether it went
 */
export function removeComputerFolder(dir, home, { files = false } = {}) {
  const real = computerFolderOf(dir, home);
  if (!real) return false;
  if (computerFiles(real) && !files) return false;
  fs.rmSync(real, { recursive: true, force: true });
  return true;
}
