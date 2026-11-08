import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { githubSignIn, parseDeviceCode } from '../src/main/github-sign-in.js';
import { NOT_SIGNED_IN } from '../src/providers/setup.js';

const PAGE = 'https://github.com/login/device';
// What `gh auth login --web` says without a terminal, as gh 2.101 and an older one word it.
const NEWER = `\n! One-time code (1A2B-3C4D) copied to clipboard\nOpen this URL to continue in your web browser: ${PAGE}\n`;
const OLDER = `\n! First copy your one-time code: 9Z8Y-7X6W\nOpen this URL to continue in your web browser: ${PAGE}\n`;

/**
 * A sign-in whose `gh` is a script, with what it was started with and what was asked of `gh` after.
 * The script gets what gh would say as SAID.
 */
function signingIn(script, { said = NEWER, signal, git = async () => '' } = {}) {
  const started = [];
  const after = [];
  const codes = [];
  const start = (command, args, options) => {
    started.push({ command, args });
    started.at(-1).env = options.env;
    return spawn(process.execPath, ['-e', script], { ...options, env: { ...process.env, SAID: said } });
  };
  const gh = async (cwd, args) => {
    after.push(args);
    return git(args);
  };
  const done = githubSignIn({ signal, onCode: (step) => codes.push(step) }, { start, gh });
  return { done, started, after, codes };
}

const SAYS_THEN_LEAVES = (code) => `process.stderr.write(process.env.SAID); process.exitCode = ${code};`;

test('the code and the page are read out of what gh says, however it words it', () => {
  assert.deepEqual(parseDeviceCode(NEWER), { code: '1A2B-3C4D', url: PAGE });
  assert.deepEqual(parseDeviceCode(OLDER), { code: '9Z8Y-7X6W', url: PAGE });
  // A gh that was told to write in colour, whatever it writes to.
  const bold = `! First copy your one-time code: \u001b[1m5E6F-7G8H\u001b[0m\n\u001b[1mOpen this URL\u001b[0m to continue in your web browser: ${PAGE}\n`;
  assert.deepEqual(parseDeviceCode(bold), { code: '5E6F-7G8H', url: PAGE });
});

test('a longer run of letters and dashes is no code', () => {
  assert.equal(parseDeviceCode(`request id ABCD-1234-EF56-7890\nOpen this URL: ${PAGE}\n`), null);
});

test('there is nothing to show until gh has said both the code and the page', () => {
  assert.equal(parseDeviceCode(''), null);
  assert.equal(parseDeviceCode('\n! One-time code (1A2B-3C4D) copied to clipboard\n'), null);
  assert.equal(parseDeviceCode(`Open this URL to continue in your web browser: ${PAGE}\n`), null);
  assert.equal(parseDeviceCode('error connecting to github.com\n'), null);
});

test('it runs gh’s own web sign-in for github.com, and reads only', async () => {
  const { done, started } = signingIn(SAYS_THEN_LEAVES(0));
  await done;
  assert.equal(started.length, 1);
  assert.equal(started[0].command, 'gh');
  assert.deepEqual(started[0].args.slice(0, 3), ['auth', 'login', '--web']);
  assert.ok(started[0].args.includes('github.com'));
  assert.ok(!started[0].args.includes('--with-token'), 'no token is ever handed over');
  assert.equal(started[0].env.GH_PROMPT_DISABLED, '1', 'nobody would see a question');
  assert.equal(started[0].env.PATH, process.env.PATH, 'it is found where the app finds it');
});

test('a sign-in that leaves with 0 worked, and its code was said once on the way', async () => {
  const { done, codes } = signingIn(SAYS_THEN_LEAVES(0));
  assert.deepEqual(await done, { ok: true, message: '' });
  assert.deepEqual(codes, [{ code: '1A2B-3C4D', url: PAGE }]);
});

test('what gh says in pieces is still one code, said once', async () => {
  const script = `
    const said = process.env.SAID;
    process.stderr.write(said.slice(0, 20));
    setTimeout(() => process.stderr.write(said.slice(20, 60)), 20);
    setTimeout(() => process.stderr.write(said.slice(60) + '✓ Authentication complete.\\n'), 40);`;
  const { done, codes } = signingIn(script, { said: OLDER });
  assert.deepEqual(await done, { ok: true, message: '' });
  assert.deepEqual(codes, [{ code: '9Z8Y-7X6W', url: PAGE }]);
});

test('signed in, git is given the same sign-in for github.com', async () => {
  const { done, after } = signingIn(SAYS_THEN_LEAVES(0));
  await done;
  assert.deepEqual(after, [['auth', 'setup-git', '--hostname', 'github.com']]);
});

test('signed in is signed in, whether or not git takes the sign-in', async () => {
  const git = async () => {
    throw new Error('git is not installed');
  };
  assert.deepEqual(await signingIn(SAYS_THEN_LEAVES(0), { git }).done, { ok: true, message: '' });
});

test('a sign-in that fails says why in gh’s last words, and git is left alone', async () => {
  const script = `
    process.stderr.write(process.env.SAID);
    process.stderr.write("failed to authenticate via web browser: This 'device_code' has expired. (expired_token)\\n");
    process.exitCode = 1;`;
  const { done, after } = signingIn(script);
  assert.deepEqual(await done, {
    ok: false,
    message: "failed to authenticate via web browser: This 'device_code' has expired. (expired_token)",
  });
  assert.deepEqual(after, []);
});

test('offline, it says so in the app’s words', async () => {
  const script = `process.stderr.write('error connecting to github.com\\ncheck your internet connection or https://githubstatus.com\\n'); process.exitCode = 1;`;
  const { ok, message } = await signingIn(script).done;
  assert.equal(ok, false);
  assert.match(message, /GitHub could not be reached/);
});

test('a gh that leaves without a word, or names its own sign-in as it fails, did not go through', async () => {
  for (const script of [
    'process.exitCode = 1;',
    // "Not signed in" is no answer to somebody who is signing in.
    `process.stderr.write('To get started with GitHub CLI, please run:  gh auth login\\n'); process.exitCode = 4;`,
  ]) {
    const { ok, message } = await signingIn(script).done;
    assert.equal(ok, false);
    assert.doesNotMatch(message, /Connect to GitHub/);
    assert.ok(message);
  }
});

test('a gh that is not there says where to get it, and never rejects', async () => {
  const { ok, message } = await githubSignIn({}, { start: () => spawn('no-such-gh-anywhere', []) });
  assert.equal(ok, false);
  assert.match(message, /not installed.*cli\.github\.com/);
  const thrown = await githubSignIn(
    {},
    {
      start: () => {
        throw Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' });
      },
    }
  );
  assert.match(thrown.message, /not installed/);
});

test('it waits for as long as the user takes, until it is called off', async () => {
  const stop = new AbortController();
  const { done, codes, after } = signingIn('process.stderr.write(process.env.SAID); setInterval(() => {}, 1000);', {
    signal: stop.signal,
  });
  let over = false;
  done.then(() => {
    over = true;
  });
  // The code is said while gh still waits for GitHub to hear it.
  while (!codes.length) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(over, false);
  stop.abort();
  assert.deepEqual(await done, NOT_SIGNED_IN);
  assert.deepEqual(after, [], 'nothing was signed in for git to take');
});

test('called off before it started, gh is never run', async () => {
  const stop = new AbortController();
  stop.abort();
  const { done, started } = signingIn(SAYS_THEN_LEAVES(0), { signal: stop.signal });
  assert.deepEqual(await done, NOT_SIGNED_IN);
  assert.deepEqual(started, []);
});
