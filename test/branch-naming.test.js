import { test } from 'node:test';
import assert from 'node:assert/strict';
import { branchNamer } from '../src/main/branch-naming.js';

/** A store with one contact in a worktree whose branch still has its made-up name. */
function fixture({ contact = {}, settings = {}, nameBranch, onNamed, nameTask } = {}) {
  const contacts = [{ id: 'c1', cwd: '/worktrees/shop/shop-1', placeholderBranch: 'shop-1', ...contact }];
  const store = {
    settings: { branchPrefix: '', ...settings },
    getContact: (id) => contacts.find((c) => c.id === id),
    updateContact: (id, patch) => Object.assign(store.getContact(id), patch),
  };
  const asked = [];
  const namer = branchNamer({
    store,
    home: '/worktrees',
    onNamed,
    nameTask,
    nameBranch:
      nameBranch ||
      (async (cwd, opts) => {
        asked.push({ cwd, ...opts });
        return opts.words;
      }),
  });
  return { store, namer, asked, contact: contacts[0] };
}

/** A promise and the way to settle it from outside. */
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("the first thing a contact is asked names its worktree's branch", async () => {
  const { namer, asked, contact } = fixture();
  await namer('c1', 'Fix the login redirect');
  assert.deepEqual(asked, [
    { cwd: '/worktrees/shop/shop-1', from: 'shop-1', words: 'fix-the-login-redirect', prefix: '', home: '/worktrees' },
  ]);
  assert.equal(contact.placeholderBranch, null);
});

test('the branch is named once: what is said afterwards names nothing', async () => {
  const { namer, asked } = fixture();
  await namer('c1', 'Fix the login redirect');
  await namer('c1', 'Now add a test for it');
  await namer('c1', 'And update the docs');
  assert.equal(asked.length, 1);
});

test("the name goes under the user's prefix, as it is set when the message is sent", async () => {
  const { namer, asked, store } = fixture({ settings: { branchPrefix: 'safa/feature' } });
  // Changed since the contact was added: the new one counts.
  store.settings.branchPrefix = ' Safa / Fix ';
  await namer('c1', 'Fix the login redirect');
  assert.equal(asked[0].prefix, 'safa/fix');
});

test('settings saved before there was a prefix have none', async () => {
  const { namer, asked, store } = fixture();
  delete store.settings.branchPrefix;
  await namer('c1', 'Fix the login redirect');
  assert.equal(asked[0].prefix, '');
});

test('a message that names no task leaves the branch for the next one to name', async () => {
  const { namer, asked, contact } = fixture();
  for (const message of ['/model', 'hi', '', '🚀', 'https://example.com/x']) await namer('c1', message);
  assert.deepEqual(asked, []);
  assert.equal(contact.placeholderBranch, 'shop-1');
  await namer('c1', 'Fix the login redirect');
  assert.equal(asked.length, 1);
  assert.equal(asked[0].words, 'fix-the-login-redirect');
});

test('a contact whose branch was typed, or that has no worktree, is not asked about', async () => {
  for (const contact of [{ placeholderBranch: undefined }, { placeholderBranch: null }, { placeholderBranch: '' }]) {
    const { namer, asked } = fixture({ contact });
    await namer('c1', 'Fix the login redirect');
    assert.deepEqual(asked, []);
  }
});

test('an archived contact is sent nothing, so its branch keeps waiting for a name', async () => {
  const { namer, asked, contact } = fixture({ contact: { archived: true } });
  await namer('c1', 'Fix the login redirect');
  assert.deepEqual(asked, []);
  assert.equal(contact.placeholderBranch, 'shop-1');
});

test('a contact that is gone is passed over', async () => {
  const { namer, asked } = fixture();
  await namer('nobody', 'Fix the login redirect');
  assert.deepEqual(asked, []);
});

test('a branch that cannot be renamed never keeps a message from being sent', async () => {
  const { namer, contact } = fixture({
    nameBranch: async () => {
      throw new Error('git is not installed');
    },
  });
  await namer('c1', 'Fix the login redirect');
  // It is not tried again with every message either.
  assert.equal(contact.placeholderBranch, null);
});

test('nor does a store that cannot be written to', async () => {
  const { namer, store } = fixture();
  store.updateContact = () => {
    throw new Error('disk full');
  };
  await namer('c1', 'Fix the login redirect');
});

test('what is sent while the branch is being named waits its turn behind the first message', async () => {
  const renaming = deferred();
  const { namer } = fixture({ nameBranch: () => renaming.promise });
  const sent = [];
  const send = (text) => namer('c1', text).then(() => sent.push(text));
  const all = Promise.all([send('Fix the login redirect'), send('and add a test'), send('/model')]);
  // Git has not answered yet: nothing has gone out, not even what names nothing.
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(sent, []);
  renaming.resolve('fix-the-login-redirect');
  await all;
  assert.deepEqual(sent, ['Fix the login redirect', 'and add a test', '/model']);
});

test('one contact waiting for git does not hold up another', async () => {
  const renaming = deferred();
  const { namer, store } = fixture({ nameBranch: () => renaming.promise });
  const other = { id: 'c2', cwd: '/projects/api' };
  const known = store.getContact;
  store.getContact = (id) => (id === 'c2' ? other : known(id));
  const sent = [];
  const first = namer('c1', 'Fix the login redirect').then(() => sent.push('c1'));
  await namer('c2', 'Speed up the api').then(() => sent.push('c2'));
  assert.deepEqual(sent, ['c2']);
  renaming.resolve(null);
  await first;
  assert.deepEqual(sent, ['c2', 'c1']);
});

// ---- the task in the provider's words ----------------------------------------------------------

const FIRST = 'can you work on this i have this pr we need to fix the review comments';

test("the contact's provider puts the task in a few words, and the branch is named after them", async () => {
  const told = [];
  const { namer, asked } = fixture({
    nameTask: async (contact, message) => {
      told.push([contact.id, message]);
      return 'fix-pr-review-comments';
    },
  });
  await namer('c1', FIRST);
  assert.deepEqual(told, [['c1', FIRST]], 'with the whole message');
  assert.equal(asked[0].words, 'fix-pr-review-comments');
});

test('what the provider says is made into words a branch can carry', async () => {
  for (const [said, words] of [
    ['`Fix-PR-Review-Comments`', 'fix-pr-review-comments'],
    ['  Fix PR review comments\n\nThat names the task.', 'fix-pr-review-comments'],
    ['Mağaza önü düzeltmesi', 'magaza-onu-duzeltmesi'],
    ['update-the-onboarding-checklist-and-its-welcome-emails-too', 'update-the-onboarding-checklist-and-its'],
  ]) {
    const { namer, asked } = fixture({ nameTask: async () => said });
    await namer('c1', FIRST);
    assert.equal(asked[0].words, words, said);
  }
});

test("the message's own words stand in when the provider can't say", async () => {
  const cannot = [
    async () => '',
    async () => '🚀',
    async () => '/review',
    async () => 'refactor',
    async () => {
      throw new Error('Claude Code took too long to answer.');
    },
    () => {
      throw new Error('not even a promise');
    },
  ];
  for (const nameTask of cannot) {
    const { namer, asked, contact } = fixture({ nameTask });
    await namer('c1', 'Fix the login redirect');
    assert.equal(asked[0].words, 'fix-the-login-redirect', String(nameTask));
    assert.equal(contact.placeholderBranch, null, 'asked once all the same');
  }
});

test('only the message that names the branch is put to the provider', async () => {
  const told = [];
  const { namer } = fixture({ nameTask: async (_contact, message) => (told.push(message), 'fix-login-redirect') });
  await namer('c1', 'hi');
  await namer('c1', '/model');
  await namer('c1', 'Fix the login redirect');
  await namer('c1', 'And add a test for it');
  assert.deepEqual(told, ['Fix the login redirect']);
});

test('a provider that fails is not asked again with the next message', async () => {
  let asks = 0;
  const { namer } = fixture({
    nameTask: async () => {
      asks += 1;
      throw new Error('not signed in');
    },
  });
  await namer('c1', 'Fix the login redirect');
  await namer('c1', 'And add a test for it');
  assert.equal(asks, 1);
});

test('what is sent while the provider thinks of a name waits its turn too', async () => {
  const thinking = deferred();
  const { namer, asked } = fixture({ nameTask: () => thinking.promise });
  const sent = [];
  const send = (text) => namer('c1', text).then(() => sent.push(text));
  const all = Promise.all([send(FIRST), send('and add a test')]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(sent, []);
  assert.deepEqual(asked, [], 'git is not asked before the name is known');
  thinking.resolve('fix-pr-review-comments');
  await all;
  assert.deepEqual(sent, [FIRST, 'and add a test']);
  assert.equal(asked[0].words, 'fix-pr-review-comments');
});

// ---- telling what a branch was named: its nickname follows -------------------------------------

test('a branch that was named is told of, with the name made up for it and its prefix', async () => {
  const told = [];
  const { namer } = fixture({
    settings: { branchPrefix: 'Safa/Feature' },
    onNamed: (contact, branch) => told.push([contact.id, branch]),
    nameBranch: async (_cwd, { words, prefix }) => `${prefix}/${words}`,
  });
  await namer('c1', 'Fix the login redirect');
  assert.deepEqual(told, [
    ['c1', { from: 'shop-1', name: 'safa/feature/fix-the-login-redirect', prefix: 'safa/feature' }],
  ]);
  await namer('c1', 'And now the logout');
  assert.equal(told.length, 1, 'once: the branch has the name it keeps');
});

test('a branch that keeps the name it has is not told of', async () => {
  const told = [];
  const onNamed = () => told.push('named');
  // Switched away from, or pushed already.
  await fixture({ onNamed, nameBranch: async () => null }).namer('c1', 'Fix the login redirect');
  // Git would not have it.
  const failing = async () => {
    throw new Error('fatal: not a git repository');
  };
  await fixture({ onNamed, nameBranch: failing }).namer('c1', 'Fix the login redirect');
  // And nothing was said that names a task.
  await fixture({ onNamed }).namer('c1', '/review');
  assert.deepEqual(told, []);
});

test('whoever is told cannot keep the message from being sent either', async () => {
  const { namer, contact } = fixture({
    onNamed: () => {
      throw new Error('Codex is in a conversation with this contact, so that name is taken there.');
    },
  });
  await assert.doesNotReject(namer('c1', 'Fix the login redirect'));
  assert.equal(contact.placeholderBranch, null);
});

// ---- a contact on This computer ---------------------------------------------------------------------

test('a contact on This computer has its nickname follow the work, with no branch to rename', async () => {
  const named = [];
  const { namer, asked, contact } = fixture({
    contact: { cwd: '/this-computer/chat-4', placeholderBranch: undefined, placeholderName: 'chat-4' },
    onNamed: (who, branch) => named.push([who.id, branch]),
    nameTask: async () => 'Porto weekend plan',
  });
  await namer('c1', 'Plan a weekend in Porto with good coffee');
  assert.deepEqual(asked, [], 'there is no branch to rename');
  assert.deepEqual(named, [['c1', { from: 'chat-4', name: 'porto-weekend-plan', prefix: '' }]]);
  assert.equal(contact.placeholderName, null, 'asked once');
  // The next message names nothing more.
  await namer('c1', 'And a day trip to Braga');
  assert.equal(named.length, 1);
});

test('a contact on This computer is named after the words of the message when its provider can’t say', async () => {
  const named = [];
  const { namer } = fixture({
    contact: { placeholderBranch: undefined, placeholderName: 'chat-1' },
    onNamed: (_who, branch) => named.push(branch.name),
  });
  // A greeting names nothing: the name it has waits for the next message.
  await namer('c1', 'hi');
  assert.deepEqual(named, []);
  await namer('c1', 'Explain Rust lifetimes');
  assert.deepEqual(named, ['explain-rust-lifetimes']);
});

test('an archived contact on This computer is sent nothing, so nothing names it', async () => {
  const named = [];
  const { namer, contact } = fixture({
    contact: { placeholderBranch: undefined, placeholderName: 'chat-1', archived: true },
    onNamed: () => named.push(true),
  });
  await namer('c1', 'Explain Rust lifetimes');
  assert.deepEqual(named, []);
  assert.equal(contact.placeholderName, 'chat-1');
});
