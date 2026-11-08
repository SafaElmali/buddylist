import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  accountEnv,
  claudeAccounts,
  exactPlan,
  loginPlan,
  ownConfig,
  shareConfig,
  toStatus,
} from '../src/providers/claude/accounts.js';
import { tempDir } from './fixtures/temp-dir.js';

/** A user's own Claude Code folder, with what they set up in it and what is their login's. */
function ownFolder() {
  const home = tempDir('buddylist-own-');
  const dir = path.join(home, '.claude');
  fs.mkdirSync(path.join(dir, 'projects', '-tmp-app'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'projects', '-tmp-app', 'sess-1.jsonl'), '{"type":"user"}\n');
  fs.mkdirSync(path.join(dir, 'skills', 'deploy'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'settings.json'), '{"model":"opus"}');
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# Me');
  // The login's, and its organization's.
  fs.writeFileSync(path.join(dir, '.credentials.json'), '{"secret":true}');
  fs.writeFileSync(path.join(dir, 'policy-limits.json'), '{}');
  fs.writeFileSync(path.join(dir, 'remote-settings.json'), '{}');
  const file = path.join(home, '.claude.json');
  fs.writeFileSync(
    file,
    JSON.stringify({ oauthAccount: { emailAddress: 'me@example.com' }, mcpServers: { docs: { command: 'docs-mcp' } } })
  );
  return { home, own: { dir, file } };
}

test('an account’s folder shares what the user set up, and none of their login', () => {
  const { home, own } = ownFolder();
  const dir = path.join(home, 'accounts', 'acc-1');
  shareConfig(dir, { own });

  for (const name of ['projects', 'skills', 'settings.json', 'CLAUDE.md']) {
    assert.ok(fs.lstatSync(path.join(dir, name)).isSymbolicLink(), `${name} is shared`);
    assert.equal(fs.realpathSync(path.join(dir, name)), fs.realpathSync(path.join(own.dir, name)));
  }
  // A conversation of the user’s own folder is there to be picked up.
  assert.equal(fs.readFileSync(path.join(dir, 'projects', '-tmp-app', 'sess-1.jsonl'), 'utf8'), '{"type":"user"}\n');
  for (const name of ['.credentials.json', 'policy-limits.json', 'remote-settings.json', 'agents']) {
    assert.equal(fs.existsSync(path.join(dir, name)), false, `${name} is not shared`);
  }
  // The MCP servers the user added for themselves come along, and nothing of the account they are in.
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, '.claude.json'), 'utf8')), {
    mcpServers: { docs: { command: 'docs-mcp' } },
  });
});

test('sharing again adds what the user set up since, and leaves alone what the account has', () => {
  const { home, own } = ownFolder();
  const dir = path.join(home, 'accounts', 'acc-1');
  shareConfig(dir, { own });
  // The account signed in meanwhile, and keeps its own settings of Claude Code.
  fs.writeFileSync(path.join(dir, '.claude.json'), '{"oauthAccount":{"emailAddress":"work@example.com"}}');
  fs.mkdirSync(path.join(own.dir, 'agents'));
  shareConfig(dir, { own });
  assert.ok(fs.lstatSync(path.join(dir, 'agents')).isSymbolicLink());
  assert.equal(
    fs.readFileSync(path.join(dir, '.claude.json'), 'utf8'),
    '{"oauthAccount":{"emailAddress":"work@example.com"}}'
  );
});

test('a user without MCP servers of their own gives a new account no .claude.json', () => {
  const { home, own } = ownFolder();
  fs.writeFileSync(own.file, '{"mcpServers":{}}');
  const dir = path.join(home, 'accounts', 'acc-1');
  shareConfig(dir, { own });
  assert.equal(fs.existsSync(path.join(dir, '.claude.json')), false);
  fs.rmSync(own.file);
  shareConfig(path.join(home, 'accounts', 'acc-2'), { own });
  assert.equal(fs.existsSync(path.join(home, 'accounts', 'acc-2', '.claude.json')), false);
});

test('removing an account’s folder takes its links, and never what they lead to', () => {
  const { home, own } = ownFolder();
  const dir = path.join(home, 'accounts', 'acc-1');
  shareConfig(dir, { own });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(fs.existsSync(dir), false);
  assert.ok(fs.existsSync(path.join(own.dir, 'projects', '-tmp-app', 'sess-1.jsonl')));
  assert.ok(fs.existsSync(path.join(own.dir, 'skills', 'deploy')));
  assert.ok(fs.existsSync(path.join(own.dir, 'settings.json')));
});

/** A to-do list Claude Code keeps of a conversation in a config folder, with when it was last changed. */
function taskList(dir, session, tasks, changed) {
  const folder = path.join(dir, 'tasks', session);
  fs.mkdirSync(folder, { recursive: true });
  for (const [id, subject] of Object.entries(tasks)) {
    const file = path.join(folder, `${id}.json`);
    fs.writeFileSync(file, JSON.stringify({ id, subject, status: 'pending' }));
    if (changed) fs.utimesSync(file, changed, changed);
  }
  if (changed) fs.utimesSync(folder, changed, changed);
}
const subjects = (dir, session) =>
  fs
    .readdirSync(path.join(dir, 'tasks', session))
    .sort()
    .map((name) => JSON.parse(fs.readFileSync(path.join(dir, 'tasks', session, name), 'utf8')).subject);

test('Claude’s to-do lists are shared like the conversations, in a folder made for them where the user has none', () => {
  const { home, own } = ownFolder();
  const a = path.join(home, 'accounts', 'acc-1');
  const b = path.join(home, 'accounts', 'acc-2');
  shareConfig(a, { own });
  shareConfig(b, { own });
  assert.ok(fs.lstatSync(path.join(a, 'tasks')).isSymbolicLink());
  assert.equal(fs.realpathSync(path.join(a, 'tasks')), fs.realpathSync(path.join(own.dir, 'tasks')));
  // A list made in one account is there in the other, where the conversation goes on.
  taskList(a, 'sess-1', { 1: 'Research', 2: 'Build' });
  assert.deepEqual(subjects(b, 'sess-1'), ['Research', 'Build']);
});

test('no folder is made for them where the user has no config folder of their own', () => {
  const home = tempDir('buddylist-own-');
  const own = { dir: path.join(home, '.claude'), file: path.join(home, '.claude.json') };
  shareConfig(path.join(home, 'accounts', 'acc-1'), { own });
  assert.equal(fs.existsSync(own.dir), false);
});

test('the to-do lists an account kept of its own move to the user’s folder, which it shares from then on', () => {
  const { home, own } = ownFolder();
  const dir = path.join(home, 'accounts', 'acc-1');
  // Added before the lists were shared: the account has a folder of its own.
  shareConfig(dir, { own });
  fs.rmSync(path.join(dir, 'tasks'));
  const before = new Date('2026-10-30T07:00:00Z');
  const after = new Date('2026-10-30T07:15:00Z');
  taskList(dir, 'sess-mine', { 1: 'Only here' });
  // The same conversation went on in both: the list changed last is the one kept.
  taskList(dir, 'sess-both', { 1: 'Account’s, newer' }, after);
  taskList(own.dir, 'sess-both', { 1: 'User’s, older', 2: 'Gone with it' }, before);
  taskList(dir, 'sess-old', { 1: 'Account’s, older' }, before);
  taskList(own.dir, 'sess-old', { 1: 'User’s, newer' }, after);
  taskList(own.dir, 'sess-theirs', { 1: 'Left alone' });

  shareConfig(dir, { own });
  assert.ok(fs.lstatSync(path.join(dir, 'tasks')).isSymbolicLink());
  assert.deepEqual(subjects(own.dir, 'sess-mine'), ['Only here']);
  assert.deepEqual(subjects(own.dir, 'sess-both'), ['Account’s, newer']);
  assert.deepEqual(subjects(own.dir, 'sess-old'), ['User’s, newer']);
  assert.deepEqual(subjects(own.dir, 'sess-theirs'), ['Left alone']);
  assert.deepEqual(subjects(dir, 'sess-mine'), ['Only here'], 'and the account finds them where it did');
});

test('a list that can’t be moved yet stays in the account’s own folder, and moves the next time', (t) => {
  const { home, own } = ownFolder();
  const dir = path.join(home, 'accounts', 'acc-1');
  fs.mkdirSync(dir, { recursive: true });
  taskList(dir, 'sess-1', { 1: 'Busy' });
  const rename = t.mock.method(fs, 'renameSync', () => {
    throw Object.assign(new Error('busy'), { code: 'EBUSY' });
  });
  shareConfig(dir, { own });
  assert.equal(fs.lstatSync(path.join(dir, 'tasks')).isDirectory(), true, 'not shared yet');
  assert.deepEqual(subjects(dir, 'sess-1'), ['Busy']);
  rename.mock.restore();
  shareConfig(dir, { own });
  assert.ok(fs.lstatSync(path.join(dir, 'tasks')).isSymbolicLink());
  assert.deepEqual(subjects(own.dir, 'sess-1'), ['Busy']);
});

test('a list on another disk than the user’s folder is copied there, and leaves the account’s', (t) => {
  const { home, own } = ownFolder();
  const dir = path.join(home, 'accounts', 'acc-1');
  fs.mkdirSync(dir, { recursive: true });
  taskList(dir, 'sess-1', { 1: 'Far away' });
  t.mock.method(fs, 'renameSync', () => {
    throw Object.assign(new Error('cross-device link'), { code: 'EXDEV' });
  });
  shareConfig(dir, { own });
  assert.ok(fs.lstatSync(path.join(dir, 'tasks')).isSymbolicLink());
  assert.deepEqual(subjects(own.dir, 'sess-1'), ['Far away']);
});

test('the user’s own folder is where a terminal’s Claude Code finds it', () => {
  assert.deepEqual(ownConfig({ CLAUDE_CONFIG_DIR: '/elsewhere/claude' }), {
    dir: '/elsewhere/claude',
    file: path.join('/elsewhere/claude', '.claude.json'),
  });
  assert.deepEqual(ownConfig({}), {
    dir: path.join(os.homedir(), '.claude'),
    file: path.join(os.homedir(), '.claude.json'),
  });
});

test('an account is started in its folder, and the user’s own as Claude Code would be anyway', () => {
  assert.deepEqual(accountEnv('/data/accounts/acc-1'), { CLAUDE_CONFIG_DIR: '/data/accounts/acc-1' });
  assert.deepEqual(accountEnv(''), {});
});

test('what `claude auth status` says, in the app’s words', () => {
  assert.deepEqual(
    toStatus(
      JSON.stringify({
        loggedIn: true,
        email: 'me@example.com',
        subscriptionType: 'team',
        orgId: 'team-org',
        orgName: 'Our team',
        accessToken: 'not-for-settings',
      })
    ),
    { signedIn: true, email: 'me@example.com', plan: 'team', eligible: false, orgId: 'team-org', orgName: 'Our team' }
  );
  assert.deepEqual(
    toStatus('{"loggedIn":true,"authMethod":"claude.ai","email":"me@example.com","subscriptionType":"max"}'),
    { signedIn: true, email: 'me@example.com', plan: 'max', eligible: true }
  );
  assert.deepEqual(toStatus('{"loggedIn":false,"authMethod":"none"}'), {
    signedIn: false,
    email: '',
    plan: null,
    eligible: false,
  });
  assert.deepEqual(toStatus('not json'), { email: '', plan: null, eligible: false });
  assert.deepEqual(toStatus(''), { email: '', plan: null, eligible: false });
  assert.deepEqual(toStatus('{"loggedIn":true,"orgId":{},"orgName":42,"subscriptionType":{}}'), {
    signedIn: true,
    email: '',
    plan: null,
    eligible: false,
  });
});

test('Max and Ultra are told apart by the tier Claude Code keeps with the login, and no other plan is', () => {
  // Claude Code calls both "max": Max is the 5x tier, Ultra the 20x one.
  assert.equal(exactPlan('max', 'default_claude_max_5x'), 'max');
  assert.equal(exactPlan('max', 'default_claude_max_20x'), 'ultra');
  // A Claude Code that names Ultra itself.
  assert.equal(exactPlan('ultra', undefined), 'ultra');
  assert.equal(exactPlan('ultra', 'default_claude_max_5x'), 'ultra');
  // Other plans stay as they are, whatever tier they have.
  for (const plan of ['pro', 'team', 'enterprise']) assert.equal(exactPlan(plan, 'default_claude_max_20x'), plan);
  // A tier that couldn't be read, or isn't known, never makes an Ultra.
  for (const tier of [undefined, null, '', 'default_raven', 'max_20x', 'default_claude_max_20x_beta', 20, {}]) {
    assert.equal(exactPlan('max', tier), 'max');
  }
  assert.equal(exactPlan(null, 'default_claude_max_20x'), null);
});

test('a session’s login is called Ultra only where its .claude.json is of the login Claude Code says it is in', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddylist-login-plan-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const env = { CLAUDE_CONFIG_DIR: dir };
  const big = { email: 'big@example.com', orgName: 'Big Org' };
  assert.equal(loginPlan('max', env, big), 'max', 'no .claude.json');
  fs.writeFileSync(
    path.join(dir, '.claude.json'),
    JSON.stringify({
      oauthAccount: {
        emailAddress: 'Big@example.com',
        organizationName: 'Big Org',
        organizationRateLimitTier: 'default_claude_max_20x',
      },
    })
  );
  assert.equal(loginPlan('max', env, big), 'ultra');
  assert.equal(loginPlan('max', env, { email: 'big@example.com', orgName: '' }), 'ultra');
  assert.equal(loginPlan('max', env, { email: 'other@example.com', orgName: 'Big Org' }), 'max');
  assert.equal(loginPlan('max', env, { email: 'big@example.com', orgName: 'Another Org' }), 'max');
  assert.equal(loginPlan('max', env, { email: '', orgName: '' }), 'max', 'an API key says no email');
  assert.equal(loginPlan('pro', env, big), 'pro');
  assert.equal(loginPlan(null, env, big), null);
});

/**
 * A Claude Code folder with a login: what `claude auth status` says of it, and what Claude Code keeps of it in its
 * .claude.json, which is left out where `saved` is null and written as it is where it is a string.
 */
function loginFolder(parent, name, { said, saved }) {
  const dir = path.join(parent, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify(said));
  const file = path.join(dir, '.claude.json');
  if (saved !== null) fs.writeFileSync(file, typeof saved === 'string' ? saved : JSON.stringify(saved));
  return { dir, file };
}

/** A Claude Code whose `auth status` says what status.json in its config folder says. */
function statusCli(parent) {
  const claude = path.join(parent, 'claude');
  fs.writeFileSync(
    claude,
    `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const dir = process.env.CLAUDE_CONFIG_DIR || path.join(process.env.HOME, '.claude');
process.stdout.write(fs.readFileSync(path.join(dir, 'status.json'), 'utf8'));
`
  );
  fs.chmodSync(claude, 0o755);
  return claude;
}

test(
  'an Ultra login is called Ultra, and one whose tier can’t be read stays Max',
  { skip: process.platform === 'win32' },
  async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buddylist-ultra-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const signedIn = (email, subscriptionType, more = {}) => ({
      loggedIn: true,
      authMethod: 'claude.ai',
      email,
      orgId: `org-${email}`,
      subscriptionType,
      ...more,
    });
    const account = (email, more = {}) => ({
      oauthAccount: {
        emailAddress: email,
        organizationUuid: `org-${email}`,
        organizationName: `${email}’s Organization`,
        accessToken: 'never-shown',
        ...more,
      },
      mcpServers: {},
    });
    const ultra = loginFolder(root, 'ultra', {
      said: signedIn('big@example.com', 'max'),
      saved: account('big@example.com', {
        organizationRateLimitTier: 'default_claude_max_20x',
        userRateLimitTier: null,
      }),
    });
    const max = loginFolder(root, 'max', {
      said: signedIn('mid@example.com', 'max'),
      saved: account('mid@example.com', { organizationRateLimitTier: 'default_claude_max_5x' }),
    });
    const noFile = loginFolder(root, 'no-file', { said: signedIn('gone@example.com', 'max'), saved: null });
    const broken = loginFolder(root, 'broken', {
      said: signedIn('broken@example.com', 'max'),
      saved: '{"oauthAccount":',
    });
    const unknownTier = loginFolder(root, 'unknown-tier', {
      said: signedIn('new@example.com', 'max'),
      saved: account('new@example.com', { organizationRateLimitTier: 'default_claude_max_40x' }),
    });
    // Kept from a login before this one: whose plan it was is not this one's.
    const stale = loginFolder(root, 'stale', {
      said: signedIn('now@example.com', 'max'),
      saved: account('before@example.com', { organizationRateLimitTier: 'default_claude_max_20x' }),
    });
    // A Team seat with a Max-sized tier of its own is still Team.
    const team = loginFolder(root, 'team', {
      said: signedIn('seat@example.com', 'team'),
      saved: account('seat@example.com', {
        organizationRateLimitTier: 'default_raven',
        userRateLimitTier: 'default_claude_max_5x',
      }),
    });
    // Claude Code that names Ultra itself.
    const named = loginFolder(root, 'named', { said: signedIn('named@example.com', 'ultra'), saved: null });
    // An API key has no plan, whatever was kept from a sign-in before it.
    const apiKey = loginFolder(root, 'api-key', {
      said: { loggedIn: true, authMethod: 'api_key', apiKeySource: 'ANTHROPIC_API_KEY' },
      saved: account('big@example.com', { organizationRateLimitTier: 'default_claude_max_20x' }),
    });
    const unreadable = loginFolder(root, 'unreadable', {
      said: signedIn('locked@example.com', 'max'),
      saved: account('locked@example.com', { organizationRateLimitTier: 'default_claude_max_20x' }),
    });
    fs.chmodSync(unreadable.file, 0o000);
    // The terminal login: its .claude.json is in the home folder, or in the config folder where that was moved.
    const home = path.join(root, 'home');
    loginFolder(home, '.claude', { said: signedIn('me@example.com', 'max'), saved: null });
    fs.writeFileSync(
      path.join(home, '.claude.json'),
      JSON.stringify(account('me@example.com', { organizationRateLimitTier: 'default_claude_max_20x' }))
    );
    const moved = loginFolder(root, 'moved', {
      said: signedIn('moved@example.com', 'max'),
      saved: account('moved@example.com', { organizationRateLimitTier: 'default_claude_max_20x' }),
    });
    const before = new Map(
      [ultra, max, broken, unknownTier, stale, team, apiKey, moved].map(({ file }) => [file, fs.readFileSync(file)])
    );

    const claude = statusCli(root);
    const opsWith = (env) => claudeAccounts({ binary: () => claude, env: () => env, loginArgs: () => [] });
    const ops = opsWith({ PATH: process.env.PATH, HOME: home });
    const planOf = async (dir) => (await ops.status(dir)).plan;

    assert.deepEqual(await ops.status(ultra.dir), {
      email: 'big@example.com',
      orgId: 'org-big@example.com',
      orgName: 'big@example.com’s Organization',
      signedIn: true,
      plan: 'ultra',
      eligible: true,
    });
    assert.equal(await planOf(max.dir), 'max');
    assert.equal(await planOf(noFile.dir), 'max');
    assert.equal(await planOf(broken.dir), 'max');
    assert.equal(await planOf(unknownTier.dir), 'max');
    assert.equal(await planOf(stale.dir), 'max');
    assert.equal(await planOf(team.dir), 'team');
    assert.equal(await planOf(named.dir), 'ultra');
    assert.equal(await planOf(apiKey.dir), null);
    if (process.getuid?.() !== 0) assert.equal(await planOf(unreadable.dir), 'max');
    assert.equal(await planOf(''), 'ultra');
    assert.equal(
      (await opsWith({ PATH: process.env.PATH, HOME: home, CLAUDE_CONFIG_DIR: moved.dir }).status('')).plan,
      'ultra'
    );

    // Only the plan's name comes of it: nothing else Claude Code keeps, and nothing is written back.
    const status = await ops.status(ultra.dir);
    assert.ok(!('tier' in status));
    assert.ok(!JSON.stringify(status).includes('never-shown'));
    for (const [file, content] of before) assert.deepEqual(fs.readFileSync(file), content, file);
  }
);

test(
  'each account is asked about, signed in and signed out in its own folder',
  { skip: process.platform === 'win32' },
  async () => {
    const bin = tempDir('buddylist-claude-');
    const log = path.join(bin, 'log');
    // A Claude Code that says who is signed in by the folder it was given, and writes down what it was asked.
    const claude = path.join(bin, 'claude');
    fs.writeFileSync(
      claude,
      `#!${process.execPath}
const fs = require('node:fs');
const dir = process.env.CLAUDE_CONFIG_DIR || '';
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ dir, args: process.argv.slice(2) }) + '\\n');
if (process.argv[3] === 'status') console.log(JSON.stringify({ loggedIn: true, email: dir ? 'work@example.com' : 'me@example.com' }));
if (process.argv[3] === 'login' && process.argv[4] === '--console') { console.error('Login failed: no'); process.exit(1); }
`
    );
    fs.chmodSync(claude, 0o755);
    const ops = claudeAccounts({
      binary: () => claude,
      env: () => ({ PATH: process.env.PATH }),
      loginArgs: (way) => ['auth', 'login', `--${way}`],
    });

    assert.deepEqual(await ops.status(''), { signedIn: true, email: 'me@example.com', plan: null, eligible: false });
    assert.deepEqual(await ops.status('/data/acc-1'), {
      signedIn: true,
      email: 'work@example.com',
      plan: null,
      eligible: false,
    });
    assert.deepEqual(await ops.signIn('/data/acc-1', { way: 'claudeai' }), { ok: true, message: '' });
    assert.deepEqual(await ops.signIn('/data/acc-1', { way: 'console' }), { ok: false, message: 'Login failed: no' });
    await ops.signOut('/data/acc-1');
    const asked = fs
      .readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.deepEqual(asked, [
      { dir: '', args: ['auth', 'status', '--json'] },
      { dir: '/data/acc-1', args: ['auth', 'status', '--json'] },
      { dir: '/data/acc-1', args: ['auth', 'login', '--claudeai'] },
      { dir: '/data/acc-1', args: ['auth', 'login', '--console'] },
      { dir: '/data/acc-1', args: ['auth', 'logout'] },
    ]);
  }
);

test('a missing Claude Code reports an unconfirmed sign-in, not a signed-out account', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'buddylist-missing-cli-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const ops = claudeAccounts({ binary: () => undefined, env: () => ({ HOME: home }), loginArgs: () => [] });
  const status = await ops.status('');
  assert.equal(status.signedIn, undefined);
  assert.equal(status.email, '');
  assert.match(status.error, /Claude Code was not found/);
  assert.equal((await ops.signIn('/x', { way: 'claudeai' })).ok, false);
  await ops.signOut('/x');
});

const ASK_PLAN = 'usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET';

/** A stand-in for the SDK's query(): each Claude Code started answers about its plan as `plan` says. */
function fakeQuery(plan) {
  const started = [];
  const queryFn = ({ prompt, options }) => {
    const call = { options, prompt, closed: false };
    started.push(call);
    return {
      [ASK_PLAN]: async () => plan(options),
      accountInfo: async () => ({ email: 'work@example.com' }),
      close: () => (call.closed = true),
    };
  };
  return { queryFn, started };
}

const accountsWith = (queryFn, cliPath = () => undefined) =>
  claudeAccounts({ binary: () => undefined, env: () => ({ PATH: '/usr/bin' }), loginArgs: () => [], cliPath, queryFn });

test('an account’s limits are asked of a Claude Code started in its folder, which reads nothing and is closed', async () => {
  const { queryFn, started } = fakeQuery(() => ({
    rate_limits_available: true,
    rate_limits: {
      five_hour: { utilization: 8, resets_at: '2026-10-24T13:00:00Z' },
      seven_day: { utilization: 61, resets_at: '2026-10-26T09:00:00Z' },
    },
  }));
  const ops = accountsWith(queryFn, () => '/opt/claude');
  assert.deepEqual(await ops.limits('/data/accounts/acc-1'), [
    { kind: 'session', percent: 8, resetsAt: Date.parse('2026-10-24T13:00:00Z') },
    { kind: 'weekly', percent: 61, resetsAt: Date.parse('2026-10-26T09:00:00Z') },
  ]);
  assert.equal(started.length, 1);
  const [{ options, closed }] = started;
  assert.equal(options.env.CLAUDE_CONFIG_DIR, '/data/accounts/acc-1');
  assert.equal(options.env.PATH, '/usr/bin');
  assert.equal(options.persistSession, false);
  assert.equal(options.pathToClaudeCodeExecutable, '/opt/claude');
  assert.equal(closed, true);
  assert.deepEqual(await started[0].prompt[Symbol.asyncIterator]().next(), { done: true, value: undefined });

  // The user's own is asked as its CLI is, without a folder. Without a Claude Code of the user's, the SDK starts its own.
  await accountsWith(queryFn).limits('');
  assert.equal('CLAUDE_CONFIG_DIR' in started[1].options.env, false);
  assert.equal('pathToClaudeCodeExecutable' in started[1].options, false);
});

test('a login without a plan has no limits; one that couldn’t say, or failed to start, gives none to go by', async () => {
  assert.deepEqual(await accountsWith(fakeQuery(() => ({ rate_limits_available: false })).queryFn).limits(''), []);
  assert.equal(
    await accountsWith(
      fakeQuery(() => {
        throw new Error('unsupported');
      }).queryFn
    ).limits(''),
    null
  );
  const broken = () => {
    throw new Error('spawn ENOENT');
  };
  assert.equal(await accountsWith(broken).limits(''), null);
});

test(
  'quota probes preserve unknown model windows, confirm subscription identity and never send a prompt',
  { skip: process.platform === 'win32' },
  async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buddylist-quota-cli-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const binary = path.join(root, 'claude');
    const writeStatus = (status) => {
      fs.writeFileSync(binary, `#!${process.execPath}\nconsole.log(${JSON.stringify(JSON.stringify(status))});\n`);
      fs.chmodSync(binary, 0o755);
    };
    const { queryFn, started } = fakeQuery(() => ({
      rate_limits_available: true,
      rate_limits: {
        five_hour: { utilization: 20, resets_at: '2030-01-01T00:00:00Z' },
        seven_day: { utilization: 40, resets_at: '2030-01-02T00:00:00Z' },
        seven_day_opus: { utilization: null, resets_at: '2030-01-02T00:00:00Z' },
      },
    }));
    const ops = claudeAccounts({
      binary: () => binary,
      env: () => ({ PATH: process.env.PATH, HOME: root }),
      loginArgs: () => [],
      queryFn,
    });
    writeStatus({ loggedIn: true, authMethod: 'claude.ai', email: 'work@example.com', subscriptionType: 'max' });
    const quota = await ops.quota('/demo/work');
    assert.equal(quota.eligible, true);
    assert.equal(quota.limits.find((window) => window.model === 'Opus').percent, null);
    assert.equal(started[0].options.env.CLAUDE_CONFIG_DIR, '/demo/work');
    assert.equal(started[0].closed, true);
    assert.equal((await started[0].prompt[Symbol.asyncIterator]().next()).done, true);
    writeStatus({ loggedIn: true, authMethod: 'api_key', email: 'work@example.com', subscriptionType: 'max' });
    assert.equal((await ops.quota('')).eligible, false);
    writeStatus({ loggedIn: false, authMethod: 'none' });
    assert.equal((await ops.quota('')).signedIn, false);
    assert.equal(started.length, 2, 'signed-out probes start no SDK process');
    writeStatus({});
    assert.equal((await ops.quota('')).signedIn, undefined, 'an unreadable status is unknown');
  }
);

// A macOS-style layout: identity in ~/.claude.json, with no .credentials.json at all.
// The synthetic CLI stands in for Keychain access; no test reads the user's credentials.
import { accountLoginFixture } from './fixtures/account-login-setup.js';

for (const moved of [false, true]) {
  test(
    `terminal identity and sign-in survive a nonzero CLI exit (${moved ? 'moved config' : 'default HOME'})`,
    { skip: process.platform === 'win32' },
    async (t) => {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), 'buddylist-auth-fixture-'));
      t.after(() => fs.rmSync(home, { recursive: true, force: true }));
      const fixture = accountLoginFixture(home);
      const dir = moved ? path.join(home, 'moved') : home;
      fixture.write(dir, { exitCode: 1, omitOrganization: true });
      const { queryFn, started } = fakeQuery(() => ({
        rate_limits_available: true,
        rate_limits: { five_hour: { utilization: 52, resets_at: '2030-01-01T00:00:00Z' } },
      }));
      const ops = claudeAccounts({
        binary: () => fixture.binary,
        env: () => ({ ...fixture.env, ...(moved && { CLAUDE_CONFIG_DIR: dir }) }),
        loginArgs: () => [],
        queryFn,
      });
      assert.equal(fs.existsSync(path.join(dir, '.credentials.json')), false);
      const reading = await ops.quota('');
      assert.equal(reading.signedIn, true);
      assert.equal(reading.email, 'fixture@example.test');
      assert.equal(reading.orgId, 'fixture-team');
      assert.equal(reading.limits[0].percent, 52);
      assert.equal(started[0].options.cwd, home);
      assert.equal(started[0].closed, true);
      assert.equal((await started[0].prompt[Symbol.asyncIterator]().next()).done, true);
    }
  );
}

test(
  'signed-out, unreadable Keychain and malformed status stay distinct without exposing diagnostics',
  { skip: process.platform === 'win32' },
  async (t) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'buddylist-auth-errors-'));
    t.after(() => fs.rmSync(home, { recursive: true, force: true }));
    const fixture = accountLoginFixture(home);
    const { queryFn, started } = fakeQuery(() => {
      throw new Error('No signed-in query expected');
    });
    const ops = claudeAccounts({ binary: () => fixture.binary, env: () => fixture.env, loginArgs: () => [], queryFn });
    fixture.write(home, { signedOut: true });
    let reading = await ops.quota('');
    assert.equal(reading.signedIn, false);
    assert.equal(reading.email, '');
    assert.match(reading.error, /claude auth login/);
    for (const signedOut of [false, true]) {
      fixture.write(home, {
        noOutput: !signedOut,
        signedOut,
        exitCode: 1,
        stderr: 'Keychain access denied: synthetic-secret-do-not-display',
      });
      reading = await ops.quota('');
      assert.equal(reading.signedIn, undefined);
      assert.equal(reading.email, 'fixture@example.test');
      assert.equal(reading.eligible, false);
      assert.match(reading.error, /Keychain/);
      assert.ok(!JSON.stringify(reading).includes('synthetic-secret'));
    }
    fixture.write(home, { malformed: true });
    reading = await ops.quota('');
    assert.equal(reading.signedIn, undefined);
    assert.match(reading.error, /did not return a sign-in status/);
    assert.equal(started.length, 0);
  }
);

test(
  'usage rate limits keep confirmed identity and the provider retry delay',
  { skip: process.platform === 'win32' },
  async (t) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'buddylist-auth-rate-'));
    t.after(() => fs.rmSync(home, { recursive: true, force: true }));
    const fixture = accountLoginFixture(home);
    const { queryFn } = fakeQuery(() => {
      throw Object.assign(new Error('429 synthetic-secret'), { status: 429, headers: { 'retry-after': '600' } });
    });
    const ops = claudeAccounts({ binary: () => fixture.binary, env: () => fixture.env, loginArgs: () => [], queryFn });
    const reading = await ops.quota('');
    assert.equal(reading.signedIn, true);
    assert.equal(reading.orgId, 'fixture-team');
    assert.equal(reading.retryAfterMs, 600_000);
    assert.match(reading.error, /limiting usage checks/);
    assert.ok(!JSON.stringify(reading).includes('synthetic-secret'));
  }
);
