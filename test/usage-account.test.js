import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Accounts } from '../src/main/accounts.js';
import { Conversations } from '../src/main/conversations.js';
import { History } from '../src/main/storage/history.js';
import { Store } from '../src/main/storage/store.js';
import { createProviders } from '../src/providers/index.js';
import { tempDir } from './fixtures/temp-dir.js';

// Two logins added for the same email: a personal Max plan, and a Team organization's. The demo's sessions stand in
// for Claude Code: each answers in the login its folder holds, as a real one does by its CLAUDE_CONFIG_DIR.
const PERSONAL = { email: 'you@example.com', orgId: 'org-personal', orgName: 'Personal', plan: 'max' };
const TEAM = { email: 'you@example.com', orgId: 'org-acme', orgName: 'Acme', plan: 'team' };
const FALLBACKS = { enabled: true, entries: [{ id: 'codex', provider: 'codex', triggers: ['session', 'weekly'] }] };
const used = (session, weekly) => [
  { kind: 'session', percent: session, resetsAt: 1_900_000_000_000 },
  { kind: 'weekly', percent: weekly, resetsAt: 1_900_500_000_000 },
];
const percents = (limits) => limits.filter(({ kind }) => kind !== 'model').map(({ kind, percent }) => [kind, percent]);

/** The app's Conversations, Accounts and providers, wired as the app wires them, with the personal account in use. */
function setup({ fallbacks = FALLBACKS } = {}) {
  const dir = tempDir('cm-usage-account-');
  const root = path.join(dir, 'accounts');
  for (const [id, who] of [
    ['personal', PERSONAL],
    ['team', TEAM],
  ]) {
    fs.mkdirSync(path.join(root, 'claude', id), { recursive: true });
    fs.writeFileSync(path.join(root, 'claude', id, 'demo-login.json'), JSON.stringify(who));
  }
  const store = new Store(dir, { defaultProvider: 'claude' });
  store.updateSettings({
    accounts: {
      claude: {
        added: [
          { id: 'personal', ...PERSONAL },
          { id: 'team', ...TEAM },
        ],
        inUse: 'personal',
        switchOnLimit: false,
      },
    },
    ...(fallbacks && { fallbacks }),
  });
  // What each said of its limits last: the personal one is nearly out for the week, the team one has hardly started.
  store.setLimits('claude', 'personal', used(9, 95));
  store.setLimits('claude', 'team', used(0, 0));
  const chats = { sent: [], send: (id, event) => chats.sent.push([id, event]), isFocused: () => false };
  const providers = createProviders({
    app: { isPackaged: false },
    demo: true,
    accounts: (id, accountId) => accounts.switchFor(id, accountId),
  });
  const accounts = new Accounts({
    store,
    ops: (id) => providers.accounts(id),
    root,
    onChange: () => conversations.tellLimits(),
    onSwitch: (id) => conversations.accountSwitched(id),
    onLimits: (id) => conversations.tellLimits(id),
  });
  const conversations = new Conversations({
    store,
    history: new History(path.join(dir, 'history')),
    providers,
    chats,
    notifier: { notify() {}, dismiss() {} },
    onContactsChanged() {},
    loginOf: (id) => accounts.loginOf(id),
  });
  const contact = store.addContact({
    provider: 'claude',
    name: 'Claude',
    cwd: dir,
    model: '',
    permissionMode: 'default',
  });
  /** What the status bar of a participant shows, as its window was last told. */
  const bar = (speaker = contact.id) => {
    const told = chats.sent.filter(
      ([id, event]) => id === contact.id && event.type === 'limits' && (event.speaker ?? contact.id) === speaker
    );
    return told.at(-1)?.[1];
  };
  return { dir, store, accounts, providers, conversations, contact, chats, bar };
}

test('with Team in use, a conversation started in the personal Max account shows Team in its popover and its bar', async () => {
  const s = setup();
  // Its agent starts in the account in use then: the personal one.
  assert.equal((await s.conversations.usage(s.contact.id)).plan, 'max');

  s.accounts.use('claude', 'team');
  const usage = await s.conversations.usage(s.contact.id);
  assert.equal(usage.plan, 'team', 'the popover is of the account in use, not the one the agent started in');
  assert.equal(usage.account, 'you@example.com (Acme · Team)', 'and names it apart from the same email’s other plan');
  assert.equal(usage.pinned, undefined);

  // The status bar is of the same account, and says which one.
  const [host] = s.conversations.participants(s.contact.id);
  assert.equal(host.account, 'team');
  assert.deepEqual(percents(host.limits), percents(usage.limits));
  assert.equal(s.bar().account, 'team');
  assert.deepEqual(percents(s.bar().limits), percents(usage.limits));
});

test('without fallback rules a conversation follows the account in use as well', async () => {
  const s = setup({ fallbacks: null });
  await s.conversations.usage(s.contact.id);
  s.accounts.use('claude', 'team');
  const usage = await s.conversations.usage(s.contact.id);
  assert.equal(usage.plan, 'team');
  assert.equal(s.conversations.participants(s.contact.id)[0].account, 'team');
});

test('another account put in use tells every bar its limits at once, by the id of the login', async () => {
  const s = setup();
  assert.equal(s.conversations.participants(s.contact.id)[0].account, 'personal');
  assert.deepEqual(percents(s.conversations.participants(s.contact.id)[0].limits), [
    ['session', 9],
    ['weekly', 95],
  ]);
  s.accounts.use('claude', 'team');
  // What the team login said last, before anything is asked of it.
  assert.deepEqual(s.bar(), { type: 'limits', limits: used(0, 0), account: 'team' });
  assert.deepEqual(s.conversations.snapshot(s.contact.id).limits, used(0, 0));
});

test('a conversation a fallback keeps in the personal account shows that account in its bar and popover, and says so', async () => {
  const s = setup();
  s.accounts.use('claude', 'team');
  s.store.updateContact(s.contact.id, { fallbackManaged: true, accountId: 'personal' });
  s.conversations.tellLimits('claude');
  assert.deepEqual(s.bar(), { type: 'limits', limits: used(9, 95), account: 'personal' });
  assert.equal(s.conversations.participants(s.contact.id)[0].account, 'personal');

  const usage = await s.conversations.usage(s.contact.id);
  assert.equal(usage.plan, 'max');
  assert.equal(usage.account, 'you@example.com (Personal · Max)');
  assert.equal(usage.pinned, true, 'it is not the account in use');
  assert.equal(s.bar().account, 'personal');
  assert.deepEqual(percents(s.bar().limits), percents(usage.limits));

  // Pinned to the account in use, it is nothing to point out.
  s.accounts.use('claude', 'personal');
  assert.equal((await s.conversations.usage(s.contact.id)).pinned, undefined);
});

test('a guest a fallback pinned has its own account’s bar, and the host the account in use', async () => {
  const s = setup();
  s.accounts.use('claude', 'team');
  const guest = s.store.addContact({
    provider: 'claude',
    name: 'Claude 2',
    cwd: s.dir,
    model: '',
    permissionMode: 'default',
    guestOf: s.contact.id,
  });
  s.store.addGuest(s.contact.id, { id: guest.id, permissionMode: 'default' });
  s.store.updateContact(guest.id, { fallbackManaged: true, accountId: 'personal' });
  const [host, pinned] = s.conversations.participants(s.contact.id);
  assert.deepEqual([host.account, pinned.account], ['team', 'personal']);
  assert.deepEqual(percents(pinned.limits), [
    ['session', 9],
    ['weekly', 95],
  ]);
  s.conversations.tellLimits('claude');
  assert.equal(s.bar(guest.id).account, 'personal');
  assert.equal(s.bar().account, 'team');
  const usage = await s.conversations.usage(s.contact.id, guest.id);
  assert.deepEqual([usage.plan, usage.pinned], ['max', true]);
  assert.equal((await s.conversations.usage(s.contact.id)).plan, 'team');
});

test('with fallback rules on, a conversation’s agent never goes on in the next account by itself', () => {
  const s = setup();
  s.accounts.setSwitchOnLimit('claude', true);
  const session = s.providers.createSession({ ...s.contact, fallbackManaged: true }, () => {});
  assert.equal(session.accounts.next(new Set()), null);
  assert.equal(session.accounts.automatic(), false);
  // Yet it is in the account in use, wherever that is put.
  s.accounts.use('claude', 'team');
  assert.equal(session.accounts.current().id, 'team');
  // A fallback's continuation stays where it was pinned.
  const pinned = s.providers.createSession({ ...s.contact, fallbackManaged: true, accountId: 'personal' }, () => {});
  assert.equal(pinned.accounts.current().id, 'personal');
  session.close();
  pinned.close();
});
