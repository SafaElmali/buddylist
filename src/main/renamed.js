// The app was called Agent Messenger before it was buddylist. What a copy of it kept
// under that name comes along the first time this one starts.
import fs from 'node:fs';
import path from 'node:path';

export const OLD_NAME = 'Agent Messenger';

/**
 * Moves the data folder the app had under its old name to the one it has now: the contacts,
 * the history, the pack and what the windows remember. An app with a folder of its own keeps that.
 * Call it before anything asks Electron for the folder, because asking makes an empty one.
 * @param {string} appData  where apps keep their data, such as ~/Library/Application Support
 * @param {string} name     what the app is called now
 * @returns {boolean}  whether there was a folder to move, and it was
 */
export function adoptOldData(appData, name) {
  const from = path.join(appData, OLD_NAME);
  const to = path.join(appData, name);
  if (fs.existsSync(to) || !fs.existsSync(from)) return false;
  try {
    fs.renameSync(from, to);
    return true;
  } catch {
    // The app then starts out empty, as a new install does, and the old folder is still there.
    return false;
  }
}
