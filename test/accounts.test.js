import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Accounts, OWN_LOGIN } from '../src/main/accounts.js';
import { tempDir } from './fixtures/temp-dir.js';

/** The settings, kept the way the store keeps them, and how much of its plan each login has used. */
function fakeStore(accounts = {}) {
  const settings = { accounts };
  const limits = new Map();
  return {
    settings,
    limits,
    updateSettings(patch) {
      Object.assign(settings, patch);
      return settings;
    },
    setLimits(provider, account, said) {
      if (said) limits.set(`${provider}:${account}`, said);
      else limits.delete(`${provider}:${account}`);
    },
  };
}

/**
 * A service's logins: who each folder is signed in as, and what was done to them. Signing in makes a
 * folder `next` from `emails`, or fails as `failing` says. Asked about its limits, a folder answers what
 * `plans` has for it, when it is told to: null where `plans` has nothing.
 */
function fakeOps({ emails = [], own = 'me@example.com' } = {}) {
  const signedIn = new Map([['', own]]);
  const done = { prepared: [], signedOut: [], signIns: [], asked: [] };
  /** @type {Map<string, any[]>} folder -> the limits it says */
  const plans = new Map();
  /** @type {(() => void)[]} each answers the question it was asked */
  const answers = [];
  return {
    done,
    signedIn,
    plans,
    /** Lets every question about limits asked so far be answered, and waits for what follows. */
    answer: async () => {
      for (const give of answers.splice(0)) give();
      await new Promise((resolve) => setImmediate(resolve));
    },
    failing: null,
    ops: {
      limits: (dir) => {
        done.asked.push(dir);
        return new Promise((resolve) => answers.push(() => resolve(plans.get(dir) ?? null)));
      },
      status: async (dir) => ({
        signedIn: signedIn.has(dir),
        email: '',
        plan: null,
        ...(typeof signedIn.get(dir) === 'string' ? { email: signedIn.get(dir) } : signedIn.get(dir)),
      }),
      async signIn(dir, { way, signal }) {
        done.signIns.push({ dir, way, signal });
        if (this.failing) return { ok: false, message: this.failing };
        signedIn.set(dir, emails.shift());
        return { ok: true, message: '' };
      },
      signOut: async (dir) => {
        done.signedOut.push(dir);
        signedIn.delete(dir);
      },
      prepare: (dir) => {
        done.prepared.push(dir);
        fs.mkdirSync(dir, { recursive: true });
      },
    },
  };
}

function setUp({ emails, settings } = {}) {
  const root = tempDir('buddylist-accounts-');
  const store = fakeStore(settings);
  const fake = fakeOps({ emails });
  const changes = [];
  const switches = [];
  const told = [];
  const accounts = new Accounts({
    store,
    ops: (id) => (id === 'claude' ? fake.ops : null),
    root,
    onChange: (changed) => changes.push(structuredClone(changed.accounts)),
    onSwitch: (id) => switches.push(id),
    onLimits: (id) => told.push(id),
  });
  return { root, store, fake, accounts, changes, switches, told };
}

test('the user’s own login is always there, and in use until another is put in use', async () => {
  const { accounts } = setUp();
  assert.deepEqual(await accounts.list('claude'), [{ id: '', email: 'me@example.com', own: true, inUse: true }]);
  // A service with one login has its own, whose address nobody asked.
  assert.deepEqual(await accounts.list('codex'), [{ id: '', email: '', own: true, inUse: true }]);
});

test('an account added signs in in a folder of its own, and is listed with the address it signed in as', async () => {
  const { root, fake, accounts, store, changes } = setUp({ emails: ['work@example.com'] });
  assert.deepEqual(await accounts.add('claude', 'claudeai'), { ok: true, message: '' });
  const [{ id }] = store.settings.accounts.claude.added;
  const dir = path.join(root, 'claude', id);
  // Ready before it signs in, so that what it writes goes with what it shares.
  assert.deepEqual(fake.done.prepared, [dir]);
  assert.equal(fake.done.signIns[0].dir, dir);
  assert.equal(fake.done.signIns[0].way, 'claudeai');
  assert.deepEqual(store.settings.accounts.claude, {
    added: [{ id, email: 'work@example.com' }],
    inUse: '',
    switchOnLimit: false,
  });
  assert.equal(changes.length, 1, 'the windows hear of it');
  assert.deepEqual(await accounts.list('claude', { check: true }), [
    { id: '', email: 'me@example.com', own: true, inUse: true, signedIn: true },
    { id, email: 'work@example.com', own: false, inUse: false, signedIn: true },
  ]);
});

test('a sign-in that did not go through leaves no folder and no account behind', async () => {
  const { root, fake, accounts, store } = setUp();
  fake.ops.failing = 'Login failed: denied';
  assert.deepEqual(await accounts.add('claude', 'claudeai'), { ok: false, message: 'Login failed: denied' });
  assert.deepEqual(fs.readdirSync(path.join(root, 'claude')), []);
  assert.equal(store.settings.accounts.claude, undefined);
});

test('a successful login process without a usable login does not save an account', async () => {
  const { root, fake, accounts, store } = setUp();
  fake.ops.signIn = async () => ({ ok: true, message: '' });
  const result = await accounts.add('claude', 'claudeai');
  assert.equal(result.ok, false);
  assert.match(result.message, /Could not verify this sign-in/);
  assert.deepEqual(fs.readdirSync(path.join(root, 'claude')), []);
  assert.equal(store.settings.accounts.claude, undefined);
});

test('an account that is one of the user’s already is signed out again and not added twice', async () => {
  const { root, fake, accounts, store } = setUp({ emails: ['me@example.com', 'work@example.com', 'work@example.com'] });
  await accounts.list('claude');
  assert.deepEqual(await accounts.add('claude', 'claudeai'), {
    ok: false,
    message: 'me@example.com is one of your accounts already. Choose another account or organization in your browser.',
  });
  assert.equal(fake.done.signedOut.length, 1);
  await accounts.add('claude', 'claudeai');
  assert.deepEqual(await accounts.add('claude', 'claudeai'), {
    ok: false,
    message:
      'work@example.com is one of your accounts already. Choose another account or organization in your browser.',
  });
  assert.deepEqual(
    store.settings.accounts.claude.added.map((account) => account.email),
    ['work@example.com']
  );
  assert.equal(fs.readdirSync(path.join(root, 'claude')).length, 1);
});

const personal = { email: 'me@example.com', orgId: 'personal-org', orgName: 'Personal', plan: 'max' };
const team = { email: 'me@example.com', orgId: 'team-org', orgName: 'Our team', plan: 'team' };

test('personal and team logins with the same email are saved, labeled and switched independently', async () => {
  const { accounts, fake, store, root } = setUp({ emails: [team] });
  fake.signedIn.set('', personal);
  assert.deepEqual(await accounts.add('claude', 'claudeai'), { ok: true, message: '' });
  const [added] = store.settings.accounts.claude.added;
  assert.deepEqual(added, { id: added.id, ...team });
  const logins = accounts.switchFor('claude');
  accounts.setSwitchOnLimit('claude', true);
  assert.equal(logins.automatic(), true);
  assert.equal(logins.current().name, 'me@example.com (Personal · Max)');
  const next = logins.next(new Set(['']));
  assert.deepEqual(next, {
    id: added.id,
    dir: path.join(root, 'claude', added.id),
    name: 'me@example.com (Our team · Team)',
  });
  logins.use(next.id);
  assert.equal(accounts.loginOf('claude'), added.id);
  assert.equal(logins.next(new Set(['', added.id])), null);
  assert.deepEqual(await accounts.list('claude'), [
    { id: '', ...personal, own: true, inUse: false },
    { ...added, own: false, inUse: true },
  ]);
  assert.equal(fake.done.signedOut.length, 0);
});

test('a saved Max account found to be on Ultra is called Ultra wherever accounts are named', async () => {
  const big = { email: 'big@example.com', orgId: 'big-org', plan: 'max' };
  const { accounts, store, fake, root } = setUp({
    settings: { claude: { added: [{ id: 'big', ...big }], inUse: '' } },
  });
  fake.signedIn.set(path.join(root, 'claude', 'big'), { ...big, plan: 'ultra' });
  const logins = accounts.switchFor('claude');
  assert.equal(logins.next(new Set([''])).name, 'big@example.com (Max)');
  await accounts.list('claude', { check: true });
  assert.equal(store.settings.accounts.claude.added[0].plan, 'ultra');
  assert.equal(logins.next(new Set([''])).name, 'big@example.com (Ultra)');
});

test('two team organizations on the same plan and email remain separate across restarts', async () => {
  const second = { ...team, orgId: 'other-team-org', orgName: 'Other team' };
  const { accounts, store, fake, root } = setUp({ emails: [team, second] });
  fake.signedIn.set('', personal);
  await accounts.add('claude', 'claudeai');
  await accounts.add('claude', 'claudeai');
  assert.equal(store.settings.accounts.claude.added.length, 2);
  const restarted = new Accounts({ store, ops: () => fake.ops, root });
  const rows = await restarted.list('claude');
  assert.deepEqual(
    rows.map((row) => row.orgId),
    ['personal-org', 'team-org', 'other-team-org']
  );
});

test('the same email and organization is rejected even if its plan or name changed', async () => {
  const { accounts, fake, store } = setUp({ emails: [team, { ...team, orgName: 'Renamed', plan: 'enterprise' }] });
  fake.signedIn.set('', personal);
  await accounts.add('claude', 'claudeai');
  const result = await accounts.add('claude', 'claudeai');
  assert.equal(result.ok, false);
  assert.match(result.message, /Choose another account or organization/);
  assert.equal(store.settings.accounts.claude.added.length, 1);
  assert.equal(fake.done.signedOut.length, 1);
});

test('duplicate checks refresh the terminal login even before the account list is opened', async () => {
  const { accounts, fake } = setUp({ emails: [{ ...personal, email: ' ME@example.com ' }] });
  fake.signedIn.set('', personal);
  assert.equal((await accounts.add('claude', 'claudeai')).ok, false);
  assert.equal(fake.done.signedOut.length, 1);
});

test('older saved logins gain organization details before checking duplicates', async () => {
  const { accounts, fake, root, store } = setUp({
    emails: [team],
    settings: { claude: { added: [{ id: 'old', email: team.email }], inUse: 'old', switchOnLimit: true } },
  });
  fake.signedIn.set('', personal);
  fake.signedIn.set(path.join(root, 'claude', 'old'), team);
  assert.equal((await accounts.add('claude', 'claudeai')).ok, false);
  assert.deepEqual(store.settings.accounts.claude, {
    added: [{ id: 'old', ...team }],
    inUse: 'old',
    switchOnLimit: true,
  });
});

test('unknown organization metadata cannot block a known organization with the same email', async () => {
  const { accounts, fake } = setUp({ emails: [team] });
  fake.signedIn.set('', { email: team.email, plan: 'team' });
  assert.equal((await accounts.add('claude', 'claudeai')).ok, true);
});

test('older CLIs without organization IDs can distinguish personal and team plans', async () => {
  const { accounts, fake } = setUp({ emails: [{ email: team.email, plan: 'team' }] });
  fake.signedIn.set('', { email: team.email, plan: 'max' });
  assert.equal((await accounts.add('claude', 'claudeai')).ok, true);
});

test('checking a signed-out login preserves its saved organization and plan', async () => {
  const { accounts, store, changes } = setUp({
    settings: { claude: { added: [{ id: 'old', ...team }], inUse: 'old', switchOnLimit: true } },
  });
  const rows = await accounts.list('claude', { check: true });
  assert.deepEqual(rows[1], { id: 'old', ...team, own: false, inUse: true, signedIn: false });
  assert.deepEqual(store.settings.accounts.claude.added, [{ id: 'old', ...team }]);
  assert.equal(changes.length, 0);
});

test('checked signed-out accounts cannot be selected or offered after a limit', async () => {
  const { accounts, fake, root } = setUp({
    settings: { claude: { added: [{ id: 'old', ...team }], inUse: '', switchOnLimit: true } },
  });
  await accounts.list('claude', { check: true });
  assert.throws(() => accounts.use('claude', 'old'), /signed out/);
  assert.equal(accounts.switchFor('claude').next(new Set([''])), null);
  fake.signedIn.set(path.join(root, 'claude', 'old'), team);
  await accounts.list('claude', { check: true });
  accounts.use('claude', 'old');
  assert.equal(accounts.loginOf('claude'), 'old');
  fake.signedIn.delete('');
  await accounts.list('claude', { check: true });
  assert.throws(() => accounts.use('claude', ''), /signed out/);
  assert.equal(accounts.loginOf('claude'), 'old');
});

test('disconnecting skips a checked signed-out added account', async () => {
  const { accounts } = setUp({
    settings: { claude: { added: [{ id: 'old', ...team }], inUse: '', switchOnLimit: false } },
  });
  await accounts.list('claude', { check: true });
  await accounts.remove('claude', '');
  assert.equal(accounts.loginOf('claude'), '');
});

test('adding again calls off the sign-in still waiting in the browser, and so does Cancel', async () => {
  const { root, fake, accounts, store } = setUp();
  /** @type {AbortSignal[]} */
  const waiting = [];
  fake.ops.signIn = (_dir, { signal }) =>
    new Promise((resolve) => {
      waiting.push(signal);
      // Called off, Claude Code's sign-in says nothing.
      signal.addEventListener('abort', () => resolve({ ok: false, message: '' }));
    });
  const first = accounts.add('claude', 'claudeai');
  await new Promise((resolve) => setImmediate(resolve));
  const second = accounts.add('claude', 'claudeai');
  assert.deepEqual(await first, { ok: false, message: '' });
  assert.deepEqual(
    waiting.map((signal) => signal.aborted),
    [true, false]
  );
  accounts.cancelAdd('claude');
  assert.deepEqual(await second, { ok: false, message: '' });
  assert.equal(store.settings.accounts.claude, undefined);
  assert.deepEqual(fs.readdirSync(path.join(root, 'claude')), []);
});

test('cancelling while account identities are checked does not save the new login', async () => {
  const { accounts, fake, root, store } = setUp({ emails: [team] });
  const status = fake.ops.status;
  let finish;
  fake.ops.status = (dir) =>
    dir
      ? status(dir)
      : new Promise((resolve) => {
          finish = resolve;
        });
  const adding = accounts.add('claude', 'claudeai');
  await new Promise((resolve) => setImmediate(resolve));
  accounts.cancelAdd('claude');
  finish({ signedIn: true, ...personal });
  assert.deepEqual(await adding, { ok: false, message: '' });
  assert.equal(store.settings.accounts.claude, undefined);
  assert.equal(fake.done.signedOut.length, 1);
  assert.deepEqual(fs.readdirSync(path.join(root, 'claude')), []);
});

test('refreshing old metadata cannot restore an account removed during the check', async () => {
  const { accounts, fake, root, store } = setUp({
    settings: { claude: { added: [{ id: 'old', email: team.email }], inUse: '', switchOnLimit: false } },
  });
  const status = fake.ops.status;
  let finish;
  fake.ops.status = (dir) =>
    dir
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : status(dir);
  const checking = accounts.list('claude', { check: true });
  await new Promise((resolve) => setImmediate(resolve));
  await accounts.remove('claude', 'old');
  finish({ signedIn: true, ...team });
  assert.equal((await checking).length, 1);
  assert.deepEqual(store.settings.accounts.claude.added, []);
  assert.equal(fs.existsSync(path.join(root, 'claude', 'old')), false);
});

test('an account put in use is the one sessions start in, and shares what was set up since', async () => {
  const { root, fake, accounts, store } = setUp({ emails: ['work@example.com'] });
  await accounts.list('claude');
  await accounts.add('claude', 'claudeai');
  const [{ id }] = store.settings.accounts.claude.added;
  const logins = accounts.switchFor('claude');
  assert.deepEqual(logins.current(), { id: '', dir: '', name: 'me@example.com' });

  accounts.use('claude', id);
  assert.equal(store.settings.accounts.claude.inUse, id);
  assert.deepEqual(logins.current(), { id, dir: path.join(root, 'claude', id), name: 'work@example.com' });
  assert.equal(fake.done.prepared.at(-1), path.join(root, 'claude', id));
  assert.equal((await accounts.list('claude')).find((account) => account.inUse).id, id);

  accounts.use('claude', '');
  assert.equal(logins.current().id, '');
  assert.throws(() => accounts.use('claude', 'gone'), /That account is gone/);
});

test('the next account to go on in is the one after the one in use, round from the top, and none tried', async () => {
  const { accounts, store } = setUp({ emails: ['a@example.com', 'b@example.com'] });
  await accounts.list('claude');
  await accounts.add('claude', 'claudeai');
  await accounts.add('claude', 'claudeai');
  const [a, b] = store.settings.accounts.claude.added;
  const logins = accounts.switchFor('claude');
  const names = (account) => account?.name ?? null;

  assert.equal(names(logins.next(new Set(['']))), 'a@example.com');
  logins.use(a.id);
  assert.equal(names(logins.next(new Set([a.id]))), 'b@example.com');
  logins.use(b.id);
  assert.equal(names(logins.next(new Set([b.id]))), 'me@example.com');
  assert.equal(names(logins.next(new Set([b.id, '']))), 'a@example.com');
  assert.equal(logins.next(new Set([b.id, '', a.id])), null);
});

test('the user’s own login goes by its address once that is known', async () => {
  const { accounts } = setUp();
  const logins = accounts.switchFor('claude');
  assert.equal(logins.current().name, OWN_LOGIN);
  await accounts.start('claude');
  assert.equal(logins.current().name, 'me@example.com');
});

test('automatic switching is off until enabled in Settings, persists, and can be disabled again', () => {
  const { accounts, store, fake, root } = setUp();
  const logins = accounts.switchFor('claude');
  assert.equal(logins.automatic(), false);
  accounts.setSwitchOnLimit('claude', true);
  assert.equal(store.settings.accounts.claude.switchOnLimit, true);
  assert.equal(logins.automatic(), true);
  const restarted = new Accounts({ store, ops: () => fake.ops, root });
  assert.equal(restarted.switchFor('claude').automatic(), true);
  accounts.setSwitchOnLimit('claude', false);
  assert.equal(logins.automatic(), false);
  assert.equal(restarted.switchFor('claude').automatic(), false);
});

test('missing or malformed saved preferences do not opt into automatic switching', () => {
  for (const switchOnLimit of [undefined, null, false, 'false', 'true', 1]) {
    const { accounts } = setUp({ settings: { claude: { added: [], inUse: '', switchOnLimit } } });
    assert.equal(accounts.switchFor('claude').automatic(), false);
  }
});

test('removing an account signs it out and forgets it, and the user’s own is in use if it was', async () => {
  const { root, fake, accounts, store } = setUp({ emails: ['work@example.com'] });
  await accounts.add('claude', 'claudeai');
  const [{ id }] = store.settings.accounts.claude.added;
  const dir = path.join(root, 'claude', id);
  accounts.use('claude', id);
  const used = [{ kind: 'session', percent: 40, resetsAt: null }];
  store.setLimits('claude', id, used);
  store.setLimits('claude', '', used);
  await accounts.remove('claude', id);
  assert.deepEqual(fake.done.signedOut, [dir]);
  assert.equal(fs.existsSync(dir), false);
  assert.deepEqual(store.settings.accounts.claude, { added: [], inUse: '', switchOnLimit: false });
  // How much of its plan it had used goes with it.
  assert.deepEqual([...store.limits.keys()], ['claude:']);
  // An unknown account does not touch the user's own.
  await accounts.remove('claude', 'gone');
  assert.deepEqual(fake.done.signedOut, [dir]);
});

test('disconnecting the terminal login signs it out without removing its configuration', async () => {
  const { accounts, fake, store, root } = setUp();
  await accounts.start('claude');
  const marker = path.join(root, 'keep.json');
  fs.writeFileSync(marker, '{}');
  store.setLimits('claude', '', [{ kind: 'weekly', percent: 100 }]);
  await accounts.remove('claude', '');
  assert.deepEqual(fake.done.signedOut, ['']);
  assert.deepEqual(await accounts.list('claude', { check: true }), [
    { id: '', email: '', own: true, inUse: true, signedIn: false },
  ]);
  assert.equal(fs.existsSync(marker), true);
  assert.equal(store.limits.has('claude:'), false);
});

test('disconnecting the terminal login selects an added account and excludes the signed-out fallback', async () => {
  const { accounts, fake, store } = setUp({ emails: [team] });
  fake.signedIn.set('', personal);
  await accounts.add('claude', 'claudeai');
  const [added] = store.settings.accounts.claude.added;
  await accounts.remove('claude', '');
  assert.equal(accounts.loginOf('claude'), added.id);
  assert.equal(accounts.switchFor('claude').next(new Set([added.id])), null);
  assert.deepEqual(store.settings.accounts.claude.added, [added]);
});

test('disconnecting the terminal login leaves another account already in use alone', async () => {
  const { accounts, store } = setUp({ emails: ['work@example.com', 'side@example.com'] });
  await accounts.add('claude', 'claudeai');
  await accounts.add('claude', 'claudeai');
  const [, side] = store.settings.accounts.claude.added;
  accounts.use('claude', side.id);
  await accounts.remove('claude', '');
  assert.equal(accounts.loginOf('claude'), side.id);
});

test('a terminal login that could not be signed out reports the failure', async () => {
  const { accounts, fake, store } = setUp();
  fake.ops.signOut = async () => {};
  await assert.rejects(accounts.remove('claude', ''), /still signed in/);
  assert.equal(store.settings.accounts.claude, undefined);
  assert.equal((await accounts.list('claude', { check: true }))[0].signedIn, true);
});

test('two accounts removed one right after the other are both gone, and one put in use meanwhile stays in use', async () => {
  const { accounts, store } = setUp({ emails: ['work@example.com', 'side@example.com', 'third@example.com'] });
  for (let i = 0; i < 3; i++) await accounts.add('claude', 'claudeai');
  const [work, side, third] = store.settings.accounts.claude.added;
  accounts.use('claude', work.id);
  // Signing out runs the service's program, which takes a moment: the second Remove comes before the first is done.
  const removing = Promise.all([accounts.remove('claude', work.id), accounts.remove('claude', side.id)]);
  accounts.use('claude', third.id);
  accounts.setSwitchOnLimit('claude', true);
  await removing;
  assert.deepEqual(store.settings.accounts.claude, { added: [third], inUse: third.id, switchOnLimit: true });
  await accounts.remove('claude', third.id);
  assert.deepEqual(store.settings.accounts.claude, { added: [], inUse: '', switchOnLimit: true });
});

test('an account in use that is gone from the settings leaves the user’s own in use', () => {
  const { accounts } = setUp({ settings: { claude: { added: [], inUse: 'gone', switchOnLimit: false } } });
  assert.equal(accounts.switchFor('claude').current().id, '');
  assert.equal(accounts.loginOf('claude'), '');
});

test('the login a service’s sessions are in is the one in use, and the user’s own for a service with one', () => {
  const { accounts } = setUp({
    settings: { claude: { added: [{ id: 'acc-1', email: 'work@example.com' }], inUse: 'acc-1', switchOnLimit: false } },
  });
  assert.equal(accounts.loginOf('claude'), 'acc-1');
  accounts.use('claude', '');
  assert.equal(accounts.loginOf('claude'), '');
  assert.equal(accounts.loginOf('codex'), '');
});

// The windows' modules reach for the bridge as they load.
globalThis.window ??= { messenger: {} };
const { switchableAccounts } = await import('../src/renderer/chat/usage.js');
const { accountLine } = await import('../src/renderer/settings/accounts.js');

/** What the switcher shows of each row: which, and whether it is ticked. */
const switcher = (rows) => switchableAccounts(rows).map(({ id, ticked }) => ({ id, ticked }));

test('the user’s own login signed in again as an added one is marked as it, and switched to once', async () => {
  const { accounts, fake, store } = setUp({ emails: [team] });
  fake.signedIn.set('', personal);
  await accounts.add('claude', 'claudeai');
  const [added] = store.settings.accounts.claude.added;
  // `claude /login` in a terminal, to the team organization.
  fake.signedIn.set('', team);
  // Until it is asked again, the user's own is what it last said.
  assert.equal(
    (await accounts.list('claude')).some((row) => 'sameAs' in row),
    false
  );
  const rows = await accounts.list('claude', { check: true });
  assert.deepEqual(rows, [
    { id: '', ...team, own: true, inUse: true, signedIn: true },
    { ...added, own: false, inUse: false, signedIn: true, sameAs: '' },
  ]);
  assert.equal((await accounts.list('claude'))[1].sameAs, '', 'and is kept until it says otherwise');
  // Nothing of the user's is removed on its own.
  assert.deepEqual(store.settings.accounts.claude.added, [added]);
  assert.equal(fake.done.signedOut.length, 0);
  assert.deepEqual(switcher(rows), [{ id: '', ticked: true }]);
  assert.deepEqual(accountLine(rows[1]), {
    name: 'me@example.com (Our team · Team)',
    notes: ['same account as terminal login'],
  });
});

test('with the twin in use, the user’s own row is ticked in its place and puts the user’s own in use', async () => {
  const { accounts, fake, root } = setUp({
    settings: { claude: { added: [{ id: 'twin', ...team }], inUse: 'twin', switchOnLimit: false } },
  });
  fake.signedIn.set('', team);
  fake.signedIn.set(path.join(root, 'claude', 'twin'), team);
  const rows = await accounts.list('claude', { check: true });
  const [own, ...rest] = switchableAccounts(rows);
  assert.equal(rest.length, 0);
  assert.equal(own.id, '');
  assert.equal(own.ticked, true, 'the check mark stays');
  assert.equal(own.inUse, false, 'so picking it is a switch');
  assert.deepEqual(accountLine(rows[1]).notes, ['same account as terminal login', 'in use']);
  accounts.use('claude', own.id);
  assert.equal(accounts.loginOf('claude'), '');
  assert.deepEqual(switcher(await accounts.list('claude')), [{ id: '', ticked: true }]);
});

test('two added rows of the same login: the later one is marked as the first, which is switched to', async () => {
  const { accounts, fake, root } = setUp({
    settings: {
      claude: {
        added: [
          { id: 'a', ...team },
          { id: 'b', ...team },
        ],
        inUse: 'b',
        switchOnLimit: false,
      },
    },
  });
  fake.signedIn.set('', personal);
  fake.signedIn.set(path.join(root, 'claude', 'a'), team);
  fake.signedIn.set(path.join(root, 'claude', 'b'), team);
  const rows = await accounts.list('claude', { check: true });
  assert.deepEqual(
    rows.map((row) => row.sameAs),
    [undefined, undefined, 'a']
  );
  assert.deepEqual(switcher(rows), [
    { id: '', ticked: false },
    { id: 'a', ticked: true },
  ]);
  assert.deepEqual(accountLine(rows[2]).notes, ['same account as one above', 'in use']);
  // And both, once the user's own is that login too.
  fake.signedIn.set('', team);
  assert.deepEqual(
    (await accounts.list('claude', { check: true })).map((row) => row.sameAs),
    [undefined, '', '']
  );
});

test('a signed-out row is never the one a twin that can be used is left out for', async () => {
  const { accounts, fake, root } = setUp({
    settings: {
      claude: {
        added: [
          { id: 'a', ...team },
          { id: 'b', ...team },
        ],
        inUse: '',
        switchOnLimit: false,
      },
    },
  });
  fake.signedIn.set('', personal);
  fake.signedIn.set(path.join(root, 'claude', 'b'), team);
  const rows = await accounts.list('claude', { check: true });
  assert.equal(rows[1].signedIn, false);
  assert.equal(rows[2].sameAs, undefined);
  // Nor the user's own, signed out in its terminal.
  fake.signedIn.delete('');
  fake.signedIn.set(path.join(root, 'claude', 'a'), team);
  assert.deepEqual(
    (await accounts.list('claude', { check: true })).map((row) => row.sameAs),
    [undefined, undefined, 'a']
  );
});

test('older CLIs without organization IDs are marked as the same login by email and plan', async () => {
  const email = team.email;
  const { accounts, fake, root } = setUp({
    settings: {
      claude: {
        added: [
          { id: 'old-team', email, plan: 'team' },
          { id: 'old-max', email, plan: 'max' },
          { id: 'new-team', ...team },
        ],
        inUse: '',
        switchOnLimit: false,
      },
    },
  });
  fake.signedIn.set('', { email: ` ${email.toUpperCase()} `, plan: 'team' });
  for (const id of ['old-team', 'old-max'])
    fake.signedIn.set(path.join(root, 'claude', id), { email, plan: id.slice(4) });
  fake.signedIn.set(path.join(root, 'claude', 'new-team'), team);
  const rows = await accounts.list('claude', { check: true });
  // A known organization is never taken for one that has none.
  assert.deepEqual(
    rows.map((row) => row.sameAs),
    [undefined, '', undefined, undefined]
  );
  assert.deepEqual(
    switcher(rows).map((row) => row.id),
    ['', 'old-max', 'new-team']
  );
});

test('a limit never goes on in a twin of the login that reached it', async () => {
  const { accounts, fake, root } = setUp({
    settings: {
      claude: {
        added: [
          { id: 'work', email: 'work@example.com' },
          { id: 'twin', ...team },
        ],
        inUse: '',
        switchOnLimit: true,
      },
    },
  });
  fake.signedIn.set('', team);
  fake.signedIn.set(path.join(root, 'claude', 'work'), 'work@example.com');
  fake.signedIn.set(path.join(root, 'claude', 'twin'), team);
  await accounts.list('claude', { check: true });
  const logins = accounts.switchFor('claude');
  const next = (tried) => logins.next(new Set(tried))?.id ?? null;
  assert.equal(next(['']), 'work');
  logins.use('work');
  // After the one in use comes the twin, which goes on in the user's own row.
  assert.equal(next(['work']), '');
  assert.equal(next(['', 'work']), null, 'not round to the twin');
  logins.use('twin');
  assert.equal(next(['twin']), 'work');
  assert.equal(next(['twin', 'work']), null, 'not on to the user’s own');
  // With only the twin to go on in, there is none.
  const alone = setUp({ settings: { claude: { added: [{ id: 'twin', ...team }], inUse: '', switchOnLimit: true } } });
  alone.fake.signedIn.set('', team);
  await alone.accounts.list('claude');
  assert.equal(alone.accounts.switchFor('claude').next(new Set([''])), null);
});

test('removing a twin in use signs only it out, and the user’s own is in use', async () => {
  const { accounts, fake, root, store } = setUp({
    settings: { claude: { added: [{ id: 'twin', ...team }], inUse: 'twin', switchOnLimit: false } },
  });
  const dir = path.join(root, 'claude', 'twin');
  fake.signedIn.set('', team);
  fake.signedIn.set(dir, team);
  await accounts.list('claude', { check: true });
  await accounts.remove('claude', 'twin');
  assert.deepEqual(fake.done.signedOut, [dir]);
  assert.equal(accounts.loginOf('claude'), '');
  assert.deepEqual(store.settings.accounts.claude, { added: [], inUse: '', switchOnLimit: false });
  assert.deepEqual(await accounts.list('claude', { check: true }), [
    { id: '', ...team, own: true, inUse: true, signedIn: true },
  ]);
});

test('the app starting gets every account ready again, also one a conversation is yet to move from', async () => {
  const added = [
    { id: 'acc-1', email: 'work@example.com' },
    { id: 'acc-2', email: 'me@example.com' },
  ];
  const { root, fake, accounts } = setUp({ settings: { claude: { added, inUse: 'acc-1', switchOnLimit: false } } });
  await accounts.start('claude');
  assert.deepEqual(fake.done.prepared, [path.join(root, 'claude', 'acc-1'), path.join(root, 'claude', 'acc-2')]);
  await accounts.start('codex');
});

// What each login has used of its plan, as it says when asked.
const OWN_LIMITS = [{ kind: 'session', percent: 43, resetsAt: null }];
const WORK_LIMITS = [{ kind: 'weekly', percent: 61, resetsAt: null }];

test('another account put in use says so, and is asked how much of its plan it has used', async () => {
  const { accounts, fake, root, store, switches, told } = setUp({
    settings: { claude: { added: [{ id: 'acc-1', email: 'work@example.com' }], inUse: '', switchOnLimit: false } },
  });
  const dir = path.join(root, 'claude', 'acc-1');
  // What the status bars knew of it is what a session in it said last, days ago.
  store.setLimits('claude', 'acc-1', [{ kind: 'weekly', percent: 12, resetsAt: null }]);
  fake.plans.set(dir, WORK_LIMITS);

  accounts.use('claude', 'acc-1');
  assert.deepEqual(switches, ['claude'], 'its sessions hear of it at once');
  assert.deepEqual(fake.done.asked, [dir], 'in its own folder');
  assert.deepEqual(told, [], 'nothing is told before it answers');

  await fake.answer();
  assert.deepEqual(store.limits.get('claude:acc-1'), WORK_LIMITS);
  assert.deepEqual(told, ['claude']);

  // Back in the user's own, which is asked as its CLI is, without a folder.
  fake.plans.set('', OWN_LIMITS);
  accounts.switchFor('claude').use('');
  await fake.answer();
  assert.deepEqual(switches, ['claude', 'claude']);
  assert.deepEqual(fake.done.asked, [dir, '']);
  assert.deepEqual(store.limits.get('claude:'), OWN_LIMITS);
  assert.deepEqual(told, ['claude', 'claude']);
});

test('putting in use the account already in use switches nothing, and asks nothing', async () => {
  const { accounts, fake, switches, changes } = setUp({
    settings: { claude: { added: [{ id: 'acc-1', email: 'work@example.com' }], inUse: 'acc-1', switchOnLimit: false } },
  });
  accounts.use('claude', 'acc-1');
  await fake.answer();
  assert.equal(changes.length, 1, 'the settings were saved as they are');
  assert.deepEqual(switches, []);
  assert.deepEqual(fake.done.asked, []);
});

test('a login that can’t say what it has used keeps what it said last', async () => {
  const { accounts, fake, store, told } = setUp({
    settings: { claude: { added: [{ id: 'acc-1', email: 'work@example.com' }], inUse: '', switchOnLimit: false } },
  });
  const before = [{ kind: 'weekly', percent: 12, resetsAt: null }];
  store.setLimits('claude', 'acc-1', before);
  accounts.use('claude', 'acc-1');
  await fake.answer();
  assert.deepEqual(store.limits.get('claude:acc-1'), before);
  assert.deepEqual(told, []);
});

test('one that has no plan says none, and the status bars show none', async () => {
  const { accounts, fake, root, store, told } = setUp({
    settings: { claude: { added: [{ id: 'acc-1', email: 'work@example.com' }], inUse: '', switchOnLimit: false } },
  });
  store.setLimits('claude', 'acc-1', WORK_LIMITS);
  fake.plans.set(path.join(root, 'claude', 'acc-1'), []);
  accounts.use('claude', 'acc-1');
  await fake.answer();
  assert.deepEqual(store.limits.get('claude:acc-1'), []);
  assert.deepEqual(told, ['claude']);
});

test('an account removed while it was asked keeps no limits', async () => {
  const { accounts, fake, root, store, told } = setUp({
    settings: { claude: { added: [{ id: 'acc-1', email: 'work@example.com' }], inUse: '', switchOnLimit: false } },
  });
  const dir = path.join(root, 'claude', 'acc-1');
  fake.signedIn.set(dir, 'work@example.com');
  fake.plans.set(dir, WORK_LIMITS);
  accounts.use('claude', 'acc-1');
  await accounts.remove('claude', 'acc-1');
  await fake.answer();
  assert.equal(store.limits.has('claude:acc-1'), false);
  // The user's own was put back in use by the removal, and was asked in its turn.
  assert.deepEqual(fake.done.asked, [dir, '']);
  assert.deepEqual(told, []);
});

test('removing the account in use switches to the user’s own; removing another switches nothing', async () => {
  const { accounts, fake, root, switches } = setUp({
    settings: {
      claude: {
        added: [
          { id: 'acc-1', email: 'work@example.com' },
          { id: 'acc-2', email: 'side@example.com' },
        ],
        inUse: 'acc-1',
        switchOnLimit: false,
      },
    },
  });
  fake.signedIn.set(path.join(root, 'claude', 'acc-1'), 'work@example.com');
  fake.signedIn.set(path.join(root, 'claude', 'acc-2'), 'side@example.com');
  await accounts.remove('claude', 'acc-2');
  assert.deepEqual(switches, []);
  await accounts.remove('claude', 'acc-1');
  assert.deepEqual(switches, ['claude']);
  assert.deepEqual(fake.done.asked, ['']);
});

test('disconnecting the user’s own login in use goes on in an added one, and asks that one', async () => {
  const { accounts, fake, root, switches } = setUp({
    settings: { claude: { added: [{ id: 'acc-1', email: 'work@example.com' }], inUse: '', switchOnLimit: false } },
  });
  await accounts.remove('claude', '');
  assert.deepEqual(switches, ['claude']);
  assert.deepEqual(fake.done.asked, [path.join(root, 'claude', 'acc-1')]);
});

test('a service whose logins can’t say their limits still switches', async () => {
  const { accounts, fake, switches, told } = setUp({
    settings: { claude: { added: [{ id: 'acc-1', email: 'work@example.com' }], inUse: '', switchOnLimit: false } },
  });
  delete fake.ops.limits;
  accounts.use('claude', 'acc-1');
  await fake.answer();
  assert.deepEqual(switches, ['claude']);
  assert.deepEqual(told, []);
});

test('a fallback account is pinned without changing global account selection or allowing automatic retries', async () => {
  const { accounts, store, fake, switches } = setUp({ emails: ['backup@example.com'] });
  await accounts.add('claude', 'claudeai');
  const backup = store.settings.accounts.claude.added[0];
  const pinned = accounts.switchFor('claude', backup.id);
  const current = accounts.switchFor('claude', 'current');
  accounts.setSwitchOnLimit('claude', true);
  assert.equal(pinned.current().id, backup.id);
  assert.equal(pinned.next(new Set()), null);
  assert.equal(pinned.automatic(), false);
  pinned.use('');
  assert.equal(pinned.current().id, backup.id);
  assert.equal(accounts.loginOf('claude'), '');
  assert.deepEqual(switches, []);
  accounts.use('claude', backup.id);
  assert.equal(current.current().id, '', 'current is resolved when pinned, not followed later');
  fake.signedIn.delete(pinned.current().dir);
  await accounts.list('claude', { check: true });
  assert.throws(() => pinned.current(), /unavailable/);
  assert.throws(() => accounts.switchFor('claude', 'deleted-account'), /unavailable/);
});

test('an unconfirmed sign-out does not switch accounts or report success', async () => {
  const { accounts, fake, store } = setUp({ emails: ['work@example.com'] });
  await accounts.add('claude', 'claudeai');
  fake.ops.status = async () => ({ email: '', plan: null, error: 'Keychain unavailable.' });
  await assert.rejects(accounts.remove('claude', ''), /Keychain unavailable/);
  assert.equal(store.settings.accounts.claude.inUse || '', '');
});
