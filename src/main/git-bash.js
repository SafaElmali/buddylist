// On Windows a project's scripts run in Git Bash, the bash that comes with Git for Windows, so that a
// script written as on a Mac or Linux runs there as it is: `$PORT`, more lines than one. Claude Code
// on Windows needs it too. It is looked for when the first script starts, not while the app starts.
import fs from 'node:fs';
import path from 'node:path';
import { execTool } from './git-command.js';

// Asking git where it is should take a moment; past this it counts as not there.
const LOOK_TIMEOUT_MS = 4000;
// WSL's bash, in System32 or as the app alias of it, starts a Linux of its own, with other files and
// another environment. Wherever it is named, it is never the one: which is also why a bash on the PATH isn't.
const WSL_BASH = /[\\/](system32|sysnative|windowsapps)[\\/]bash\.exe$/i;

/** Where the git on the PATH keeps its own programs, as it says; '' without git. */
function gitExecPath() {
  return new Promise((resolve) => {
    execTool('git', ['--exec-path'], { timeout: LOOK_TIMEOUT_MS, windowsHide: true }, (err, stdout) =>
      resolve(err ? '' : stdout.trim())
    );
  });
}

/**
 * Where Git Bash is: where Claude Code is told it is, else in the Git for Windows the git on the
 * PATH comes from, else where Git for Windows installs itself.
 * @param {object} [opts]  stand-ins for tests
 * @param {Record<string, string | undefined>} [opts.env]
 * @param {(file: string) => boolean} [opts.exists]
 * @param {() => Promise<string>} [opts.execPath]  where git keeps its own programs, as `git --exec-path`
 *   says; '' without git
 * @returns {Promise<string | null>}  null where there is none. Never rejects.
 */
export async function findGitBash({ env = process.env, exists = fs.existsSync, execPath = gitExecPath } = {}) {
  const usable = (file) => Boolean(file) && !WSL_BASH.test(file) && exists(file);
  if (usable(env.CLAUDE_CODE_GIT_BASH_PATH)) return env.CLAUDE_CODE_GIT_BASH_PATH;
  // git keeps its programs in <Git>\mingw64\libexec\git-core, and its bash is <Git>\bin\bash.exe.
  const programs = await execPath();
  const besideGit = programs && path.win32.join(programs, '..', '..', '..', 'bin', 'bash.exe');
  // For everyone, and for one user.
  const installed = [
    env.ProgramFiles,
    env['ProgramFiles(x86)'],
    env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, 'Programs'),
  ];
  const candidates = [besideGit, ...installed.map((dir) => dir && path.win32.join(dir, 'Git', 'bin', 'bash.exe'))];
  return candidates.find(usable) ?? null;
}

/** @type {Promise<string | null> | undefined} */
let found;

/** The same, looked for once: the first script waits for the answer, and the ones after it find it there. */
export const gitBash = () => (found ??= findGitBash());
