import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHermesProvider } from '../src/providers/hermes/index.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cliSetup, cliSignIn, NOT_SIGNED_IN, READY, runCli, UNKNOWN } from '../src/providers/setup.js';
import { createProviders } from '../src/providers/index.js';
import { descriptor as claude, loginArgs } from '../src/providers/claude/index.js';
import { createSignIns, GITHUB, githubSetup, setupCheck } from '../src/main/setup-check.js';
import { batchAndCmd, NOT_ON_WINDOWS } from './fixtures/windows.js';

const cli = {
  command: 'buddylist-setup-test-cli',
  args: ['login', 'status'],
  install: 'Install it.',
  signIn: 'Sign in.',
};
/** A CLI that leaves the way `answer` says, and what it was run with. */
function leaving(answer) {
  const asked = [];
  const run = async (...args) => {
    asked.push(args);
    return { killed: false, ...answer };
  };
  return { run, asked };
}

test('a CLI that leaves with 0 is ready', async () => {
  const { run, asked } = leaving({ code: 0 });
  assert.deepEqual(await cliSetup(cli, { run }), { state: 'ready', note: '' });
  assert.deepEqual(asked, [['buddylist-setup-test-cli', ['login', 'status'], { env: undefined }]]);
});

test('a CLI that can only say it is there says what is still to be seen', async () => {
  const { run } = leaving({ code: 0 });
  assert.deepEqual(await cliSetup({ ...cli, ready: 'Installed.' }, { run }), { state: 'ready', note: 'Installed.' });
});

test('a CLI that leaves with anything else is not signed in, and says how to', async () => {
  const { run } = leaving({ code: 1 });
  assert.deepEqual(await cliSetup(cli, { run }), { state: 'signed-out', note: 'Sign in.' });
});

test('a CLI that is not there is missing, and says how to get it', async () => {
  for (const code of ['ENOENT']) {
    const { run } = leaving({ code });
    assert.deepEqual(await cliSetup(cli, { run }), { state: 'missing', note: 'Install it.' }, code);
  }
});

test('a timed out CLI explains why; a missing bundled executable explains how to restore it', async () => {
  const { run, asked } = leaving({ code: 1, killed: true });
  assert.match((await cliSetup(cli, { run })).note, /timed out after 8 seconds/);
  assert.deepEqual(await cliSetup({ ...cli, command: undefined }, { run }), { state: 'missing', note: 'Install it.' });
  assert.equal(asked.length, 1, 'nothing is run without a command');
});

test('running a CLI says how it left, and never rejects', async () => {
  assert.deepEqual(await runCli(process.execPath, ['-e', '']), { code: 0, killed: false, stdout: '' });
  assert.deepEqual(await runCli(process.execPath, ['-e', 'process.exit(3)']), { code: 3, killed: false, stdout: '' });
  assert.deepEqual(await runCli('/no/such/agent-cli', []), { code: 'ENOENT', killed: false, stdout: '' });
  const slow = await runCli(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], { timeout: 100 });
  assert.equal(slow.killed, true);
});

test('a CLI is run with the environment it is given', async () => {
  const env = { ...process.env, AGENT_SETUP_TEST: 'yes' };
  const script = 'process.exit(process.env.AGENT_SETUP_TEST === "yes" ? 0 : 5)';
  assert.equal((await runCli(process.execPath, ['-e', script], { env })).code, 0);
  assert.equal((await runCli(process.execPath, ['-e', script])).code, 5);
});

test('on Windows a batch file is run by cmd.exe, to ask it and to sign in with it', NOT_ON_WINDOWS, async () => {
  const { batch, cmd } = batchAndCmd();
  const env = { ...process.env, ComSpec: cmd };
  // A batch file is no program: started by itself, as on macOS and Linux, it is not run at all.
  assert.deepEqual(await runCli(batch, ['--version'], { env }), { code: 'EACCES', killed: false, stdout: '' });
  assert.equal((await runCli(batch, ['--version'], { env, platform: 'win32' })).code, 0);
  const signIn = { command: batch, args: ['auth', 'login'], env };
  assert.deepEqual(await cliSignIn(signIn, { platform: 'win32' }), { ok: true, message: '' });
  assert.deepEqual(await runCli('/no/such/agent-cli', [], { platform: 'win32' }), {
    code: 'ENOENT',
    killed: false,
    stdout: '',
  });
});

// ---- signing in ------------------------------------------------------------------------------

/** A stand-in for a CLI's sign-in: node, running `script`. */
const signingIn = (script, opts) => cliSignIn({ command: process.execPath, args: ['-e', script] }, opts);

test('a sign-in that leaves with 0 worked', async () => {
  assert.deepEqual(await signingIn('console.log("Login successful.")'), { ok: true, message: '' });
});

test('a sign-in that leaves with anything else says why, in the CLI’s words', async () => {
  const failed = 'console.error("Login failed: no such account\\nCheck your network.\\n"); process.exit(1)';
  assert.deepEqual(await signingIn(failed), {
    ok: false,
    message: 'Login failed: no such account Check your network.',
  });
  const silent = await signingIn('process.exit(1)');
  assert.equal(silent.ok, false);
  assert.match(silent.message, /did not go through/);
});

test('a sign-in whose CLI is not there says so, and never rejects', async () => {
  for (const command of ['/no/such/agent-cli', undefined]) {
    const answer = await cliSignIn({ command, args: ['auth', 'login'] });
    assert.equal(answer.ok, false, String(command));
    assert.ok(answer.message, String(command));
  }
});

test('a sign-in is run with the environment it is given', async () => {
  const script = 'process.exit(process.env.AGENT_SETUP_TEST === "yes" ? 0 : 5)';
  const cli = { command: process.execPath, args: ['-e', script] };
  assert.equal((await cliSignIn({ ...cli, env: { ...process.env, AGENT_SETUP_TEST: 'yes' } })).ok, true);
  assert.equal((await cliSignIn(cli)).ok, false);
});

test('a sign-in waits for as long as the user takes, until it is called off', async () => {
  const stop = new AbortController();
  // Like a CLI that opened the browser: it is not going to leave by itself.
  const waiting = signingIn('setInterval(() => {}, 1000)', { signal: stop.signal });
  const early = await Promise.race([waiting, new Promise((resolve) => setTimeout(resolve, 300, 'still waiting'))]);
  assert.equal(early, 'still waiting');
  stop.abort();
  assert.deepEqual(await waiting, NOT_SIGNED_IN);
  assert.deepEqual(NOT_SIGNED_IN, { ok: false, message: '' }, 'calling it off is nothing to report');
});

test('a sign-in called off before it started is never run', async () => {
  const stop = new AbortController();
  stop.abort();
  assert.deepEqual(await signingIn('process.exit(0)', { signal: stop.signal }), NOT_SIGNED_IN);
});

// ---- the providers ---------------------------------------------------------------------------

test('every provider can say how its CLI stands', () => {
  const providers = createProviders({ app: { isPackaged: false } });
  for (const { id } of providers.list()) assert.equal(typeof providers.get(id).checkSetup, 'function', id);
});

test('in the demo nobody’s CLI is started: everyone is ready', async () => {
  const providers = createProviders({ app: { isPackaged: false }, demo: true });
  for (const { id } of providers.list()) assert.deepEqual(await providers.setup(id), READY, id);
});

test('Claude signs in with Claude Code’s own login, the way that was picked', () => {
  assert.deepEqual(
    claude.signIn.map((way) => way.id),
    ['claudeai', 'console', 'sso'],
    'a Claude subscription comes first: it is what the CLI does when it is not told'
  );
  assert.deepEqual(loginArgs('claudeai'), ['auth', 'login', '--claudeai']);
  assert.deepEqual(loginArgs('console'), ['auth', 'login', '--console']);
  assert.deepEqual(loginArgs('sso'), ['auth', 'login', '--sso']);
  for (const way of claude.signIn) assert.ok(way.label, way.id);
});

test('what Claude says when it is not signed in can be done without a terminal', () => {
  assert.doesNotMatch(claude.loginHint, /Terminal|\/login/);
  assert.match(claude.loginHint, /Help > Getting started/);
});

test('only a provider that says how can be signed in from the app', () => {
  const providers = createProviders({ app: { isPackaged: false } });
  for (const { id, signIn } of providers.list()) {
    assert.equal(typeof providers.get(id).signIn, signIn ? 'function' : 'undefined', id);
  }
  assert.ok(providers.descriptor('claude').signIn);
});

test('a provider without a sign-in of its own, and one nobody knows, is not signed in', async () => {
  const providers = createProviders({ app: { isPackaged: false } });
  assert.deepEqual(await providers.signIn('codex', { way: 'claudeai' }), NOT_SIGNED_IN);
  // Not Claude's, which stands in for a provider that is gone everywhere else.
  assert.deepEqual(await providers.signIn('nobody', { way: 'claudeai' }), NOT_SIGNED_IN);
});

test('in the demo nobody’s sign-in is started', async () => {
  const providers = createProviders({ app: { isPackaged: false }, demo: true });
  for (const { id } of providers.list()) {
    assert.deepEqual(await providers.signIn(id, { way: 'claudeai' }), NOT_SIGNED_IN, id);
  }
});

// ---- what the welcome wizard lists -----------------------------------------------------------

/** A registry of two services that stand the way `setups` says. */
const registry = (setups) => ({
  list: () => [
    { id: 'claude', name: 'Claude', avatar: 'claude' },
    { id: 'codex', name: 'Codex', avatar: 'codex' },
  ],
  setup: async (id) => {
    if (setups[id] instanceof Error) throw setups[id];
    return setups[id];
  },
});

test('the setup check lists every service, then GitHub’s CLI as something extra', async () => {
  const providers = registry({ claude: READY, codex: { state: 'missing', note: 'Install Codex.' } });
  const github = async () => ({ state: 'signed-out', note: 'Run gh auth login.' });
  assert.deepEqual(await setupCheck({ providers, github }), [
    { id: 'claude', name: 'Claude', avatar: 'claude', state: 'ready', note: '' },
    { id: 'codex', name: 'Codex', avatar: 'codex', state: 'missing', note: 'Install Codex.' },
    { id: 'github', name: 'GitHub CLI', optional: true, state: 'signed-out', note: 'Run gh auth login.' },
  ]);
});

test('a service whose check fails is not judged, and the others still answer', async () => {
  const providers = registry({ claude: new Error('boom'), codex: READY });
  const items = await setupCheck({ providers, github: async () => READY });
  assert.deepEqual(
    items.map((item) => [item.id, item.state]),
    [
      ['claude', 'unknown'],
      ['codex', 'ready'],
      ['github', 'ready'],
    ]
  );
});

test('in the demo GitHub’s CLI is not asked either', async () => {
  let asked = false;
  const github = async () => {
    asked = true;
    return UNKNOWN;
  };
  const items = await setupCheck({ providers: registry({ claude: READY, codex: READY }), demo: true, github });
  assert.equal(items.at(-1).state, 'ready');
  assert.equal(asked, false);
});

test('GitHub’s CLI is asked for its sign-in', async () => {
  const { run, asked } = leaving({ code: 0 });
  assert.equal((await githubSetup({ run })).state, 'ready');
  assert.deepEqual(asked[0].slice(0, 2), ['gh', ['auth', 'status']]);
  const missing = await githubSetup({ run: leaving({ code: 'ENOENT' }).run });
  assert.equal(missing.state, 'missing');
  assert.match(missing.note, /cli\.github\.com/);
  const signedOut = await githubSetup({ run: leaving({ code: 1 }).run });
  assert.equal(signedOut.state, 'signed-out');
  assert.match(signedOut.note, /Sign in here/, 'it needs no terminal');
});

// ---- signing in from the list ------------------------------------------------------------------

/**
 * A registry whose Claude can be signed in two ways, and whose Codex can't. Each sign-in waits
 * until it is `finish`ed or called off, and `asked` says what each was started with.
 */
function signInRegistry() {
  const asked = [];
  let finish;
  return {
    asked,
    finish: (result) => finish(result),
    list: () => [
      { id: 'claude', name: 'Claude', signIn: [{ id: 'claudeai' }, { id: 'console' }] },
      { id: 'codex', name: 'Codex' },
    ],
    signIn: (id, { way, signal }) => {
      asked.push({ id, way, signal });
      return new Promise((resolve, reject) => {
        finish = (result) => (result instanceof Error ? reject(result) : resolve(result));
        signal.addEventListener('abort', () => resolve(NOT_SIGNED_IN));
      });
    },
  };
}

test('a sign-in started from the list is its service’s own, the way that was picked', async () => {
  const providers = signInRegistry();
  const signIns = createSignIns({ providers });
  const done = signIns.start('claude', 'console');
  providers.finish({ ok: true, message: '' });
  assert.deepEqual(await done, { ok: true, message: '' });
  assert.deepEqual(
    providers.asked.map(({ id, way }) => [id, way]),
    [['claude', 'console']]
  );
});

test('a way the service does not have is its usual one', async () => {
  const providers = signInRegistry();
  const signIns = createSignIns({ providers });
  for (const way of [undefined, 'constructor', '--help']) {
    const done = signIns.start('claude', way);
    providers.finish({ ok: true, message: '' });
    await done;
  }
  assert.deepEqual(
    providers.asked.map(({ way }) => way),
    ['claudeai', 'claudeai', 'claudeai']
  );
});

test('a service that can’t be signed in from here is not asked to', async () => {
  const providers = signInRegistry();
  const signIns = createSignIns({ providers });
  for (const id of ['codex', 'nobody']) assert.deepEqual(await signIns.start(id, 'claudeai'), NOT_SIGNED_IN);
  assert.deepEqual(providers.asked, []);
});

/** A GitHub sign-in that waits until it is `finish`ed or called off, and what it was started with. */
function githubSignIns(opts = {}) {
  const asked = [];
  let finish;
  const github = ({ signal, onCode }) => {
    asked.push({ signal, onCode });
    return new Promise((resolve) => {
      finish = resolve;
      signal.addEventListener('abort', () => resolve(NOT_SIGNED_IN));
    });
  };
  const providers = signInRegistry();
  return {
    asked,
    providers,
    finish: (result) => finish(result),
    signIns: createSignIns({ providers, github, ...opts }),
  };
}

test('GitHub’s CLI is signed in from the app too, and says the code to type on its way', async () => {
  const { signIns, asked, providers, finish } = githubSignIns();
  const codes = [];
  const done = signIns.start(GITHUB, undefined, { onCode: (step) => codes.push(step) });
  asked[0].onCode({ code: '1A2B-3C4D', url: 'https://github.com/login/device' });
  finish({ ok: true, message: '' });
  assert.deepEqual(await done, { ok: true, message: '' });
  assert.deepEqual(codes, [{ code: '1A2B-3C4D', url: 'https://github.com/login/device' }]);
  assert.deepEqual(providers.asked, [], 'it is nobody’s service');
});

test('GitHub’s sign-in is called off like any other, and a second one calls off the first', async () => {
  const { signIns, asked } = githubSignIns();
  const first = signIns.start(GITHUB);
  const second = signIns.start(GITHUB);
  assert.deepEqual(await first, NOT_SIGNED_IN);
  assert.equal(asked[1].signal.aborted, false);
  signIns.cancel('claude');
  assert.equal(asked[1].signal.aborted, false, 'another’s is left alone');
  signIns.cancel(GITHUB);
  assert.deepEqual(await second, NOT_SIGNED_IN);
});

test('in the demo GitHub’s sign-in is not started either', async () => {
  const { signIns, asked } = githubSignIns({ demo: true });
  assert.deepEqual(await signIns.start(GITHUB), NOT_SIGNED_IN);
  assert.deepEqual(asked, []);
});

test('a sign-in can be called off, and one that is over can’t', async () => {
  const providers = signInRegistry();
  const signIns = createSignIns({ providers });
  const done = signIns.start('claude', 'claudeai');
  signIns.cancel('codex');
  assert.equal(providers.asked[0].signal.aborted, false, 'another service’s is left alone');
  signIns.cancel('claude');
  assert.deepEqual(await done, NOT_SIGNED_IN);
  assert.equal(providers.asked[0].signal.aborted, true);

  const next = signIns.start('claude', 'claudeai');
  providers.finish({ ok: true, message: '' });
  await next;
  signIns.cancel('claude');
  assert.equal(providers.asked[1].signal.aborted, false);
});

test('asked twice, a service’s first sign-in is called off: two would wait for the same browser', async () => {
  const providers = signInRegistry();
  const signIns = createSignIns({ providers });
  const first = signIns.start('claude', 'claudeai');
  const second = signIns.start('claude', 'console');
  assert.deepEqual(await first, NOT_SIGNED_IN);
  assert.equal(providers.asked[1].signal.aborted, false);
  // The first being over must not take the second's way to call it off with it.
  signIns.cancel('claude');
  assert.deepEqual(await second, NOT_SIGNED_IN);
});

test('a sign-in that fails outright says so, and never rejects', async () => {
  const providers = signInRegistry();
  const signIns = createSignIns({ providers });
  const done = signIns.start('claude', 'claudeai');
  providers.finish(new Error('boom'));
  assert.deepEqual(await done, { ok: false, message: 'boom' });
});

test('a version-only probe failure is a check failure, not a missing login', async () => {
  const result = await cliSetup({ ...cli, args: ['--version'] }, leaving({ code: 2 }));
  assert.equal(result.state, 'unknown');
  assert.equal(result.note, 'The program exited with code 2. Sign in.');
  const denied = await cliSetup(cli, leaving({ code: 'EACCES' }));
  assert.equal(denied.state, 'unknown');
  assert.match(denied.note, /permissions/);
});

test('the check returns the resolved executable and extracts only version output', async () => {
  const asked = [];
  const run = async (_command, args) => {
    asked.push(args);
    return {
      code: 0,
      killed: false,
      stdout: args[0] === '--version' ? '2.1.0 (Claude Code)\n' : '{"token":"secret 999.0.0"}',
    };
  };
  const result = await cliSetup({ ...cli, command: process.execPath, bundled: true, version: true }, { run });
  assert.equal(result.path, process.execPath);
  assert.equal(result.version, '2.1.0');
  assert.equal(result.bundled, true);
  assert.deepEqual(asked, [['login', 'status'], ['--version']]);
  assert.ok(!JSON.stringify(result).includes('secret'));
  const only = await cliSetup({ ...cli, args: ['--version'] }, leaving({ code: 0, stdout: 'Hermes Agent v0.9.0' }));
  assert.equal(only.version, '0.9.0');
  const failedVersion = await cliSetup(
    { ...cli, version: true },
    { run: async (_command, args) => ({ code: args[0] === '--version' ? 1 : 0, killed: false, stdout: 'v3.0.0' }) }
  );
  assert.equal(failedVersion.state, 'ready');
  assert.equal(failedVersion.version, undefined);
});

test('a probe ends at its deadline even if a child keeps stdout open', { timeout: 4000 }, async () => {
  const script = `require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 1500)'], { stdio: ['ignore', 1, 2] }); process.exit(0);`;
  const start = Date.now();
  const answer = await runCli(process.execPath, ['-e', script], { timeout: 300 });
  assert.equal(answer.killed, true);
  assert.ok(Date.now() - start < 1300, 'does not wait for the descendant to close stdout');
});

test(
  'Hermes finishes checking even when its executable ignores SIGTERM',
  { ...NOT_ON_WINDOWS, timeout: 12000 },
  async (t) => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'buddylist-hermes-probe-'));
    t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
    const command = path.join(folder, 'hermes');
    fs.writeFileSync(
      command,
      `#!${process.execPath}\nprocess.on('SIGTERM', () => {}); setInterval(() => {}, 1000);\n`,
      { mode: 0o755 }
    );
    const provider = createHermesProvider({ cliPath: () => command });
    const started = Date.now();
    const result = await provider.checkSetup();
    assert.equal(result.state, 'unknown');
    assert.equal(result.path, command);
    assert.match(result.note, /timed out after 8 seconds/);
    assert.ok(Date.now() - started < 11000);
  }
);
