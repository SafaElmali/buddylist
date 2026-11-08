// Signs the GitHub CLI in from the app. `gh auth login --web` needs no terminal: it says a
// one-time code, waits while the user types that into GitHub's page in the browser, and leaves
// once GitHub has heard it. The app shows the code and opens the page.
import { spawn } from 'node:child_process';
import os from 'node:os';
import { NOT_SIGNED_IN } from '../providers/setup.js';
import { ghProblem, ghTrouble, lastWord, runGh } from './github-lookup.js';

/** @typedef {import('../providers/setup.js').SignInResult} SignInResult */

/**
 * What the user has to do in the browser.
 * @typedef {Object} DeviceCode
 * @property {string} code  the one-time code, such as "1A2B-3C4D"
 * @property {string} url   GitHub's page that asks for it
 */

const LOGIN_ARGS = ['auth', 'login', '--web', '--hostname', 'github.com'];
// What `gh auth login` in a terminal offers to do next: git uses the same sign-in for github.com.
const GIT_ARGS = ['auth', 'setup-git', '--hostname', 'github.com'];

/**
 * Reads the code and the page out of what `gh auth login --web` says: "First copy your one-time
 * code: 1A2B-3C4D" (a newer gh: "One-time code (1A2B-3C4D) copied to clipboard"), then "Open this
 * URL to continue in your web browser: https://github.com/login/device".
 * @param {string} said
 * @returns {DeviceCode | null}  null until it has said both
 */
export function parseDeviceCode(said) {
  // Not by word boundaries: a gh told to write in colour puts the code between the letters that make it bold.
  const code = /(?<![A-Z0-9-])[A-Z0-9]{4}-[A-Z0-9]{4}(?![A-Z0-9-])/.exec(said)?.[0];
  const url = /https:\/\/\S+\/login\/device\b/.exec(said)?.[0];
  return code && url ? { code, url } : null;
}

/** Why the sign-in did not go through, in words for the user. */
function explain(err) {
  // A sign-in is what was asked for: "not signed in" is no news here, what gh said as it left is.
  const problem = ghProblem(err);
  if (problem && problem !== 'signed-out') return ghTrouble(err);
  // Stopped from outside, or never started, it said nothing about why.
  return typeof err?.code === 'number' && err.stderr?.trim()
    ? lastWord(err)
    : 'The sign-in did not go through. Try again.';
}

/**
 * Signs `gh` in to github.com. It waits for as long as the user takes in the browser (GitHub
 * gives a code fifteen minutes), and never rejects.
 * @param {object} [opts]
 * @param {AbortSignal} [opts.signal]  calls the sign-in off, and stops `gh`
 * @param {(step: DeviceCode) => void} [opts.onCode]  called once, with what to type where
 * @param {{ start?: typeof spawn, gh?: typeof runGh }} [deps]  replaceable in tests
 * @returns {Promise<SignInResult>}
 */
export function githubSignIn({ signal, onCode } = {}, { start = spawn, gh = runGh } = {}) {
  return new Promise((resolve) => {
    let stderr = '';
    let told = false;
    let over = false;
    const finish = (result) => {
      if (over) return;
      over = true;
      resolve(signal?.aborted ? NOT_SIGNED_IN : result);
    };
    const failed = (err) => finish({ ok: false, message: explain(Object.assign(err, { stderr })) });

    if (signal?.aborted) return finish(NOT_SIGNED_IN);
    let child;
    try {
      child = start('gh', LOGIN_ARGS, {
        signal,
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe'],
        // Never stop to ask anything: nobody would see the question.
        env: { ...process.env, GH_PROMPT_DISABLED: '1' },
      });
    } catch (err) {
      return failed(err);
    }
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      const step = told ? null : parseDeviceCode(stderr);
      if (!step) return;
      told = true;
      onCode?.(step);
    });
    // Not there to start, or called off.
    child.on('error', failed);
    child.on('close', (code) => {
      if (code !== 0) return failed(Object.assign(new Error('gh auth login failed'), { code }));
      // Cloning and pushing over https ask git, not gh. Signed in is signed in, whether or not git takes it.
      gh(os.homedir(), GIT_ARGS)
        .catch(() => {})
        .then(() => finish({ ok: true, message: '' }));
    });
  });
}
