import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { savedSettings, Store } from '../src/main/storage/store.js';
import { History, WRITE_EVERY_MS } from '../src/main/storage/history.js';
import { DEFAULT_QUICK_MESSAGES } from '../src/shared/quick-messages.js';
import { DEFAULT_INSTRUCTION_PRESETS } from '../src/shared/instruction-presets.js';
import { DEFAULT_ROLES, DEFAULT_TEAMS } from '../src/shared/teams.js';
import { voiceSettings } from '../src/shared/voice-settings.js';
import { MemoryHistory, MemoryStore } from '../preview/memory-storage.js';
import { tempDir } from './fixtures/temp-dir.js';

const tmp = () => tempDir('cm-store-');
const defaults = { defaultProvider: 'claude' };
const contactFields = { provider: 'claude', cwd: '/tmp', model: '', permissionMode: 'default' };

test('first run creates a profile and settings, and nobody to talk to yet', () => {
  const store = new Store(tmp(), defaults);
  // The welcome wizard ends in the first contact: none is made up for a folder nobody picked.
  assert.deepEqual(store.contacts, []);
  assert.equal(store.settings.sounds, true);
  assert.equal(store.settings.showActivity, true);
  assert.equal(store.settings.openWindowsMaximized, false);
  // Usage counts are anonymous, and on until the user turns them off.
  assert.equal(store.settings.shareUsage, true);
  // A worktree is only removed with its contact once the user says so.
  assert.equal(store.settings.removeWorktrees, false);
  assert.ok(store.profile.name);
});

test('opening windows maximized is an opt-in kept across restarts', () => {
  const dir = tmp();
  const store = new Store(dir, defaults);
  assert.equal(store.settings.openWindowsMaximized, false);
  for (const openWindowsMaximized of [true, false]) {
    store.updateSettings({ openWindowsMaximized });
    assert.equal(new Store(dir, defaults).settings.openWindowsMaximized, openWindowsMaximized);
  }
});

test('only a new install is still to be shown the welcome wizard, until it was seen', () => {
  const dir = tmp();
  const store = new Store(dir, defaults);
  assert.equal(store.onboarding, true);
  // Quitting before it was seen changes nothing, whatever else was saved by then.
  store.updateSettings({ sounds: false });
  assert.equal(new Store(dir, defaults).onboarding, true);

  store.finishOnboarding();
  assert.equal(store.onboarding, false);
  assert.equal(new Store(dir, defaults).onboarding, false);
  assert.equal('onboarding' in JSON.parse(fs.readFileSync(path.join(dir, 'messenger.json'), 'utf8')), false);
  // Seen once is seen: asking again saves nothing.
  const saved = fs.statSync(path.join(dir, 'messenger.json')).mtimeMs;
  store.finishOnboarding();
  assert.equal(fs.statSync(path.join(dir, 'messenger.json')).mtimeMs, saved);
});

test('someone who already used the app is not shown the welcome wizard', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'messenger.json'), JSON.stringify({ version: 4, contacts: [] }));
  const store = new Store(dir, defaults);
  assert.equal(store.onboarding, false);
  store.finishOnboarding();
  assert.equal(store.onboarding, false);
});

test('contacts and settings persist across restarts', () => {
  const dir = tmp();
  const store = new Store(dir, defaults);
  const added = store.addContact({
    provider: 'claude',
    name: 'Claude (api)',
    cwd: '/tmp',
    model: '',
    permissionMode: 'acceptEdits',
  });
  store.updateContact(added.id, { sessionId: 'abc' });
  store.updateSettings({ sounds: false, showActivity: false, shareUsage: false, removeWorktrees: true });
  const reloaded = new Store(dir, defaults);
  assert.deepEqual(reloaded.getContact(added.id), { ...added, sessionId: 'abc' });
  assert.equal(reloaded.settings.sounds, false);
  assert.equal(reloaded.settings.showActivity, false);
  assert.equal(reloaded.settings.shareUsage, false);
  assert.equal(reloaded.settings.removeWorktrees, true);
  reloaded.removeContact(added.id);
  assert.equal(new Store(dir, defaults).getContact(added.id), undefined);
});

test('Codex keeps an explicit Fast mode off choice distinct from the unchanged default across disk restarts', (t) => {
  const dir = tmp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let store = new Store(dir, defaults);
  const contact = store.addContact({ ...contactFields, provider: 'codex', permissionMode: 'ask' });
  const reload = () => {
    store = new Store(dir, defaults);
    return store.getContact(contact.id);
  };
  assert.equal(Object.hasOwn(reload(), 'fastMode'), false, 'new contacts leave Codex settings unchanged');
  store.updateContact(contact.id, { fastMode: true });
  assert.equal(reload().fastMode, true);
  store.updateContact(contact.id, { fastMode: false });
  assert.equal(reload().fastMode, false, 'off must not fall back to a globally enabled speed tier');
  store.updateContact(contact.id, { sessionId: 'resumed-thread', name: 'Codex renamed' });
  assert.equal(reload().fastMode, false, 'unrelated contact updates preserve the deliberate off choice');
  store.updateContact(contact.id, { fastMode: true });
  assert.equal(reload().fastMode, true, 'it can be enabled again after restarting');
});

test('Claude keeps its sparse Fast mode flag when saved and restarted', (t) => {
  const dir = tmp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new Store(dir, defaults);
  const contact = store.addContact(contactFields);
  store.updateContact(contact.id, { fastMode: true });
  assert.equal(new Store(dir, defaults).getContact(contact.id).fastMode, true);
  store.updateContact(contact.id, { fastMode: false });
  assert.equal(Object.hasOwn(new Store(dir, defaults).getContact(contact.id), 'fastMode'), false);
});

test('the conversation viewed last is kept, but never an archived one, which is only read', () => {
  const dir = tmp();
  const store = new Store(dir, defaults);
  const live = store.addContact({ ...contactFields, name: 'Live' });
  const put = store.addContact({ ...contactFields, name: 'Put away' });
  store.rememberContact(live.id);
  assert.equal(new Store(dir, defaults).lastContactId, live.id, 'also after a restart');

  store.updateContact(put.id, { archived: true });
  const before = fs.readFileSync(store.file, 'utf8');
  store.rememberContact(put.id);
  assert.equal(store.lastContactId, live.id);
  assert.equal(fs.readFileSync(store.file, 'utf8'), before, 'nothing is written for it');

  // Once restored, it is a conversation like any.
  store.updateContact(put.id, { archived: false });
  store.rememberContact(put.id);
  assert.equal(store.lastContactId, put.id);
  // And one that is gone is never remembered.
  store.rememberContact('nobody');
  assert.equal(store.lastContactId, put.id);
});

test('data saved by version 0.1 is migrated', () => {
  const dir = tmp();
  fs.writeFileSync(
    path.join(dir, 'messenger.json'),
    JSON.stringify({
      profile: { name: 'Safa', status: 'online', personalMessage: '', picture: null },
      contacts: [{ id: 'x', name: 'Claude', cwd: '/tmp', model: '', permissionMode: 'default', sessionId: 's1' }],
    })
  );
  const store = new Store(dir, defaults);
  assert.equal(store.getContact('x').provider, 'claude');
  assert.equal(store.getContact('x').sessionId, 's1');
  assert.deepEqual(store.settings, {
    sounds: true,
    theme: 'light',
    look: 'messenger',
    showActivity: true,
    autoAway: true,
    showListening: false,
    shareUsage: true,
    removeWorktrees: false,
    errorReports: true,
    deleteBranches: false,
    archiveMerged: false,
    renameBranches: true,
    linksBeside: false,
    openWindowsMaximized: false,
    suggestReplies: true,
    startConversations: false,
    quickMessages: [...DEFAULT_QUICK_MESSAGES],
    instructions: { general: '', pullRequest: '', review: '' },
    instructionPresets: [...DEFAULT_INSTRUCTION_PRESETS],
    roles: [...DEFAULT_ROLES],
    teams: [...DEFAULT_TEAMS],
    schedules: [],
    turnLimit: 6,
    limitFallbacks: {},
    branchPrefix: '',
    models: {},
    contactDefaults: {},
    projectsFolder: os.homedir(),
    env: [],
    envFiles: [],
    agents: {},
    accounts: {},
    shortcuts: {},
    voiceMode: 'hold',
    voiceSend: false,
  });
});

test('a setting added later starts at its default, next to what was already chosen', () => {
  const dir = tmp();
  fs.writeFileSync(
    path.join(dir, 'messenger.json'),
    JSON.stringify({
      version: 3,
      profile: { name: 'Safa', status: 'busy', personalMessage: '', picture: null },
      settings: { sounds: false },
      groups: [],
      contacts: [],
    })
  );
  const store = new Store(dir, defaults);
  assert.deepEqual(store.settings, {
    sounds: false,
    theme: 'light',
    look: 'messenger',
    showActivity: true,
    autoAway: true,
    showListening: false,
    shareUsage: true,
    removeWorktrees: false,
    errorReports: true,
    deleteBranches: false,
    archiveMerged: false,
    renameBranches: true,
    linksBeside: false,
    openWindowsMaximized: false,
    suggestReplies: true,
    startConversations: false,
    quickMessages: [...DEFAULT_QUICK_MESSAGES],
    instructions: { general: '', pullRequest: '', review: '' },
    instructionPresets: [...DEFAULT_INSTRUCTION_PRESETS],
    roles: [...DEFAULT_ROLES],
    teams: [...DEFAULT_TEAMS],
    schedules: [],
    turnLimit: 6,
    limitFallbacks: {},
    branchPrefix: '',
    models: {},
    contactDefaults: {},
    projectsFolder: os.homedir(),
    env: [],
    envFiles: [],
    agents: {},
    accounts: {},
    shortcuts: {},
    voiceMode: 'hold',
    voiceSend: false,
  });
  assert.equal(store.profile.status, 'busy');

  store.updateSettings({ autoAway: false, voiceMode: 'press' });
  assert.deepEqual(new Store(dir, defaults).settings, {
    sounds: false,
    theme: 'light',
    look: 'messenger',
    showActivity: true,
    autoAway: false,
    showListening: false,
    shareUsage: true,
    removeWorktrees: false,
    errorReports: true,
    deleteBranches: false,
    archiveMerged: false,
    renameBranches: true,
    linksBeside: false,
    openWindowsMaximized: false,
    suggestReplies: true,
    startConversations: false,
    quickMessages: [...DEFAULT_QUICK_MESSAGES],
    instructions: { general: '', pullRequest: '', review: '' },
    instructionPresets: [...DEFAULT_INSTRUCTION_PRESETS],
    roles: [...DEFAULT_ROLES],
    teams: [...DEFAULT_TEAMS],
    schedules: [],
    turnLimit: 6,
    limitFallbacks: {},
    branchPrefix: '',
    models: {},
    contactDefaults: {},
    projectsFolder: os.homedir(),
    env: [],
    envFiles: [],
    agents: {},
    accounts: {},
    shortcuts: {},
    voiceMode: 'press',
    voiceSend: false,
  });
});

test('a voice clip shortcut saved before is kept with the other shortcuts, and F2 is no shortcut of your own', () => {
  const saved = (settings) => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'messenger.json'), JSON.stringify({ version: 5, settings, contacts: [] }));
    const store = new Store(dir, defaults);
    assert.equal('voiceKey' in store.settings, false);
    return { store, dir };
  };
  const { store, dir } = saved({ voiceKey: 'Control+Alt+KeyV', voiceMode: 'press' });
  assert.deepEqual(store.settings.shortcuts, { voice: 'Control+Alt+KeyV' });
  assert.equal(store.settings.voiceMode, 'press');
  assert.equal(voiceSettings(store.settings).voiceKey, 'Control+Alt+KeyV');
  // Moved once: the file says so from then on.
  store.save();
  const file = JSON.parse(fs.readFileSync(path.join(dir, 'messenger.json'), 'utf8'));
  assert.equal(file.version, 7);
  assert.equal('voiceKey' in file.settings, false);
  assert.deepEqual(new Store(dir, defaults).settings.shortcuts, { voice: 'Control+Alt+KeyV' });

  assert.deepEqual(saved({ voiceKey: 'F2' }).store.settings.shortcuts, {});
  // One that another shortcut had, or that can't be one, never recorded: F2 does from now on.
  assert.deepEqual(saved({ voiceKey: 'Alt+KeyC' }).store.settings.shortcuts, {});
  assert.deepEqual(saved({ voiceKey: 'KeyV' }).store.settings.shortcuts, {});
  // The shortcuts other keys were chosen for stay, and one chosen for voice clips there wins.
  assert.deepEqual(saved({ voiceKey: 'F6', shortcuts: { changes: 'F8' } }).store.settings.shortcuts, {
    changes: 'F8',
    voice: 'F6',
  });
  assert.deepEqual(saved({ voiceKey: 'F6', shortcuts: { voice: 'F9' } }).store.settings.shortcuts, { voice: 'F9' });
  assert.deepEqual(saved({ voiceKey: 'F8', shortcuts: { changes: 'F8' } }).store.settings.shortcuts, {
    changes: 'F8',
  });
});

test('the quick messages start as the app’s own, and the ones you keep are read back, none too', () => {
  const dir = tmp();
  const store = new Store(dir, defaults);
  assert.deepEqual(store.settings.quickMessages, [...DEFAULT_QUICK_MESSAGES]);
  // Each install has a copy of its own: changing it leaves the app's starters as they are.
  assert.notEqual(store.settings.quickMessages[0], DEFAULT_QUICK_MESSAGES[0]);

  const mine = [{ name: 'Lint', text: 'Run the linter and fix what it finds.' }];
  store.updateSettings({ quickMessages: mine });
  assert.deepEqual(new Store(dir, defaults).settings.quickMessages, mine);
  // Taking them all out leaves none: the starters do not come back.
  store.updateSettings({ quickMessages: [] });
  assert.deepEqual(new Store(dir, defaults).settings.quickMessages, []);
});

test('the instruction presets start as the app’s own, and the ones you keep are read back, none too', () => {
  const dir = tmp();
  const store = new Store(dir, defaults);
  assert.deepEqual(store.settings.instructionPresets, [...DEFAULT_INSTRUCTION_PRESETS]);
  // Each install has a copy of its own: changing it leaves the app's starters as they are.
  assert.notEqual(store.settings.instructionPresets[0], DEFAULT_INSTRUCTION_PRESETS[0]);

  const mine = [{ name: 'Screenshots', text: 'Add screenshots after you validate.' }];
  store.updateSettings({ instructionPresets: mine });
  assert.deepEqual(new Store(dir, defaults).settings.instructionPresets, mine);
  store.updateSettings({ instructionPresets: [] });
  assert.deepEqual(new Store(dir, defaults).settings.instructionPresets, []);
});

test('the roles and teams start as the app’s own, and the ones you keep are read back, none too', () => {
  const dir = tmp();
  const store = new Store(dir, defaults);
  assert.deepEqual(store.settings.roles, [...DEFAULT_ROLES]);
  assert.deepEqual(store.settings.teams, [...DEFAULT_TEAMS]);
  // Each install has a copy of its own: changing it leaves the app's starters as they are.
  store.settings.teams[0].roles.push('tester');
  assert.deepEqual(DEFAULT_TEAMS[0].roles, ['reviewer']);
  assert.notEqual(store.settings.roles[0], DEFAULT_ROLES[0]);

  store.updateSettings({ roles: [], teams: [] });
  assert.deepEqual(new Store(dir, defaults).settings.roles, []);
  assert.deepEqual(new Store(dir, defaults).settings.teams, []);
});

test('a role kept before a mode could be picked starts in the default one, as it did', () => {
  const dir = tmp();
  const store = new Store(dir, defaults);
  const { permissionMode, ...before } = DEFAULT_ROLES[0];
  assert.equal(permissionMode, '');
  store.data.settings.roles = [before, { ...before, id: 'mine', name: 'Mine', permissionMode: 'acceptEdits' }];
  store.save();
  assert.deepEqual(
    new Store(dir, defaults).settings.roles.map((role) => [role.id, role.permissionMode]),
    [
      ['reviewer', ''],
      ['mine', 'acceptEdits'],
    ]
  );
});

test('a contact keeps the team that joined it, and a guest the role it was made from', () => {
  const store = new Store(tmp(), defaults);
  const host = store.addContact({
    provider: 'claude',
    name: 'Claude',
    cwd: '/p',
    permissionMode: 'default',
    team: 'reviewed',
  });
  const guest = store.addContact({
    provider: 'claude',
    name: 'Reviewer',
    cwd: '/p',
    permissionMode: 'default',
    guestOf: host.id,
    role: 'reviewer',
  });
  assert.equal(host.team, 'reviewed');
  assert.equal(guest.role, 'reviewer');
  // One added without either is stored as it always was.
  const plain = store.addContact({ provider: 'claude', name: 'Plain', cwd: '/p', permissionMode: 'default' });
  assert.ok(!('team' in plain) && !('role' in plain));
});

test('an install has no name until it is asked for one, and then keeps it', () => {
  const dir = tmp();
  const store = new Store(dir, defaults);
  store.updateSettings({ sounds: false });
  const saved = () => JSON.parse(fs.readFileSync(path.join(dir, 'messenger.json'), 'utf8'));
  assert.equal('installId' in saved(), false);
  // Asking whether it has one does not make one up.
  assert.equal(store.hasInstallId, false);
  assert.equal('installId' in saved(), false);

  const id = store.installId;
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(store.hasInstallId, true);
  assert.equal(store.installId, id);
  assert.equal(saved().installId, id);
  assert.equal(new Store(dir, defaults).installId, id);
  assert.equal(new Store(dir, defaults).hasInstallId, true);
  // Another install is another name.
  assert.notEqual(new Store(tmp(), defaults).installId, id);
});

const USED = [
  { kind: 'session', percent: 6, resetsAt: 1_900_000_000_000 },
  { kind: 'weekly', percent: 23, resetsAt: 1_900_500_000_000 },
];

test('how much of its plan each login has used is kept for it, also after a restart', () => {
  const dir = tmp();
  const store = new Store(dir, defaults);
  assert.deepEqual(store.limitsOf('claude', ''), [], 'none until a session has said');

  store.setLimits('claude', '', USED);
  store.setLimits('claude', 'acc-1', [USED[0]]);
  store.setLimits('codex', '', []);
  const again = new Store(dir, defaults);
  assert.deepEqual(again.limitsOf('claude', ''), USED);
  assert.deepEqual(again.limitsOf('claude', 'acc-1'), [USED[0]]);
  // A login without a plan has none, as one nobody has heard from.
  assert.deepEqual(again.limitsOf('codex', ''), []);
  assert.deepEqual(again.limitsOf('codex', 'acc-1'), []);

  // A login that was removed is forgotten, and the others stay.
  again.setLimits('claude', 'acc-1', null);
  assert.deepEqual(new Store(dir, defaults).data.limits.claude, { '': USED });
});

test('limits said again as they were are not written again', () => {
  const store = new Store(tmp(), defaults);
  let saves = 0;
  const save = store.save.bind(store);
  store.save = () => {
    saves += 1;
    save();
  };
  store.setLimits('claude', '', USED);
  store.setLimits('claude', '', structuredClone(USED));
  assert.equal(saves, 1);
  store.setLimits('claude', '', [{ ...USED[0], percent: 7 }, USED[1]]);
  assert.equal(saves, 2);
  // Nor is forgetting a login nobody heard from.
  store.setLimits('claude', 'acc-1', null);
  assert.equal(saves, 2);
});

test('the browser preview’s in-memory store keeps each login’s limits the same way', () => {
  const store = new MemoryStore();
  assert.deepEqual(store.limitsOf('claude', ''), []);
  store.setLimits('claude', '', USED);
  store.setLimits('claude', 'acc-1', [USED[0]]);
  assert.deepEqual(store.limitsOf('claude', ''), USED);
  store.setLimits('claude', 'acc-1', null);
  assert.deepEqual(store.limitsOf('claude', 'acc-1'), []);
  assert.deepEqual(store.limitsOf('claude', ''), USED);
});

test('the saved settings can be read before there is a store', () => {
  const dir = tmp();
  // Nothing saved yet, on a first run: everything is at its default, error reports on.
  assert.equal(savedSettings(dir).errorReports, true);
  assert.deepEqual(savedSettings(dir), new Store(tmp(), defaults).settings);

  const store = new Store(dir, defaults);
  store.updateSettings({ errorReports: false, sounds: false });
  assert.deepEqual(savedSettings(dir), store.settings);
  assert.equal(savedSettings(dir).errorReports, false);

  // A file that can't be read leaves everything at its default too. It is only read here, and is
  // left where it is: putting it aside is the store's to do.
  fs.writeFileSync(path.join(dir, 'messenger.json'), '{ not json');
  assert.equal(savedSettings(dir).errorReports, true);
  fs.writeFileSync(path.join(dir, 'messenger.json'), 'null');
  assert.equal(savedSettings(dir).errorReports, true);
  assert.deepEqual(fs.readdirSync(dir), ['messenger.json']);
});

test('a contact keeps the name made up for its branch until the branch is named', () => {
  const dir = tmp();
  const store = new Store(dir, defaults);
  const fields = { provider: 'claude', name: 'Claude', cwd: '/tmp', permissionMode: 'default' };
  const waiting = store.addContact({ ...fields, placeholderBranch: 'safa/shop-1' });
  const typed = store.addContact(fields);
  assert.equal(new Store(dir, defaults).getContact(waiting.id).placeholderBranch, 'safa/shop-1');
  // A branch that was typed, and a folder without a worktree, have nothing to wait for.
  assert.equal('placeholderBranch' in new Store(dir, defaults).getContact(typed.id), false);
  store.updateContact(waiting.id, { placeholderBranch: null });
  assert.equal(new Store(dir, defaults).getContact(waiting.id).placeholderBranch, null);
});

test('a contact started from a pull request keeps that its setup script waits for the user', () => {
  const dir = tmp();
  const store = new Store(dir, defaults);
  const fields = { provider: 'claude', name: 'Claude', cwd: '/tmp', permissionMode: 'default' };
  const pull = store.addContact({ ...fields, setupWaits: true });
  const branch = store.addContact(fields);
  assert.equal(new Store(dir, defaults).getContact(pull.id).setupWaits, true);
  // A new branch from the main line is set up right away: nothing waits.
  assert.equal('setupWaits' in new Store(dir, defaults).getContact(branch.id), false);
  store.updateContact(pull.id, { setupWaits: null });
  assert.equal(new Store(dir, defaults).getContact(pull.id).setupWaits, null);
  // One an agent drafted keeps that it is set up once it starts.
  const drafted = store.addContact({ ...fields, setupOnStart: true });
  assert.equal(new Store(dir, defaults).getContact(drafted.id).setupOnStart, true);
  assert.equal('setupOnStart' in new Store(dir, defaults).getContact(branch.id), false);
});

test('history appends, updates entries, and clears', () => {
  const history = new History(tmp());
  const first = history.append('c1', { kind: 'tool', toolId: 't1' });
  history.append('c1', { kind: 'assistant', text: 'hi' });
  history.update('c1', first.id, { output: 'done' });
  assert.ok(first.id && first.time);
  assert.deepEqual(
    history.read('c1').map((e) => [e.kind, e.output]),
    [
      ['tool', 'done'],
      ['assistant', undefined],
    ]
  );
  history.clear('c1');
  assert.deepEqual(history.read('c1'), []);
});

test('going back to before an entry drops it and every one after it, also after a restart', () => {
  const dir = tmp();
  const history = new History(dir);
  history.append('c1', { kind: 'user', text: 'fix the cart' });
  history.append('c1', { kind: 'assistant', text: 'Fixed.' });
  const typo = history.append('c1', { kind: 'user', text: 'now the tsets' });
  history.append('c1', { kind: 'assistant', text: 'Which tsets?' });
  history.append('c2', { kind: 'user', text: 'hi' });

  assert.equal(history.rewind('c1', 'gone'), false);
  assert.equal(history.read('c1').length, 4, 'an entry it doesn’t have changes nothing');
  assert.equal(history.rewind('c1', typo.id), true);
  const kept = ['fix the cart', 'Fixed.'];
  assert.deepEqual(
    history.read('c1').map((e) => e.text),
    kept
  );
  history.flush();
  assert.deepEqual(
    new History(dir).read('c1').map((e) => e.text),
    kept
  );
  assert.equal(history.read('c2').length, 1, 'another conversation is left alone');
});

test('an entry taken out leaves the rest as they were, also after a restart', () => {
  const dir = tmp();
  const history = new History(dir);
  history.append('c1', { kind: 'user', text: 'fix the cart' });
  const queued = history.append('c1', { kind: 'user', text: 'and the docs' });
  history.append('c1', { kind: 'assistant', text: 'Fixed.' });
  history.flush();
  const active = history.lastActive('c1');

  assert.equal(history.remove('c1', 'gone'), false);
  assert.equal(history.read('c1').length, 3, 'an entry it doesn’t have changes nothing');
  assert.equal(history.remove('c1', queued.id), true);
  const kept = ['fix the cart', 'Fixed.'];
  assert.deepEqual(
    history.read('c1').map((e) => e.text),
    kept
  );
  assert.equal(history.lastActive('c1'), active, 'nobody was heard from');
  history.flush();
  assert.deepEqual(
    new History(dir).read('c1').map((e) => e.text),
    kept
  );
});

test('entries moved to the end keep their order and everything else its own, also after a restart', () => {
  const dir = tmp();
  const history = new History(dir);
  history.append('c1', { kind: 'user', text: 'fix the cart' });
  const first = history.append('c1', { kind: 'user', text: 'and the docs' });
  const second = history.append('c1', { kind: 'user', text: 'and the tests' });
  history.append('c1', { kind: 'tool', text: 'ran npm test' });
  history.append('c1', { kind: 'assistant', text: 'Fixed.' });
  history.append('c2', { kind: 'user', text: 'hi' });
  history.flush();
  const active = history.lastActive('c1');

  history.moveToEnd('c1', ['gone']);
  assert.equal(history.read('c1')[1].id, first.id, 'an entry it doesn’t have changes nothing');
  history.moveToEnd('c1', [second.id, first.id]);
  const moved = ['fix the cart', 'ran npm test', 'Fixed.', 'and the docs', 'and the tests'];
  assert.deepEqual(
    history.read('c1').map((e) => e.text),
    moved
  );
  assert.equal(history.read('c1').at(-1).time, second.time, 'each keeps when it was said');
  assert.equal(history.lastActive('c1'), active, 'nobody was heard from');
  history.flush();
  assert.deepEqual(
    new History(dir).read('c1').map((e) => e.text),
    moved
  );
  assert.equal(history.read('c2').length, 1, 'another conversation is left alone');
});

test('a pinned entry stays pinned after a restart, and one unpinned is stored as it always was', () => {
  const dir = tmp();
  const history = new History(dir);
  history.append('c1', { kind: 'user', text: 'use the v2 API' });
  const reply = history.append('c1', { kind: 'assistant', text: 'Done.' });
  history.flush();
  const before = fs.readFileSync(path.join(dir, 'c1.json'), 'utf8');

  assert.equal(history.pin('c1', 'gone', true), false, 'an entry it doesn’t have changes nothing');
  assert.equal(history.pin('c1', reply.id, true), true);
  history.flush();
  assert.deepEqual(
    new History(dir).read('c1').map((e) => e.pinned),
    [undefined, true]
  );

  assert.equal(history.pin('c1', reply.id, false), true);
  history.flush();
  assert.equal(fs.readFileSync(path.join(dir, 'c1.json'), 'utf8'), before);
});

test('pinning is not hearing from anyone: the conversation was last active when it was, also after a restart', async () => {
  const dir = tmp();
  const history = new History(dir);
  const reply = history.append('c1', { kind: 'assistant', text: 'Done.' });
  history.flush();
  const active = history.lastActive('c1');
  await new Promise((resolve) => setTimeout(resolve, 30));

  history.pin('c1', reply.id, true);
  history.flush();
  assert.equal(history.lastActive('c1'), active);
  assert.equal(new History(dir).lastActive('c1'), active, 'its file says so too');

  // A conversation pinned in before anything is added to it after a restart.
  const reopened = new History(dir);
  reopened.pin('c1', reply.id, false);
  reopened.flush();
  assert.equal(reopened.lastActive('c1'), active);
  assert.equal(new History(dir).lastActive('c1'), active);

  // What is said after that is heard.
  reopened.append('c1', { kind: 'user', text: 'thanks' });
  assert.ok(reopened.lastActive('c1') > active);
});

test('a change nobody said anything new in, as what was offered after a reply, leaves when it was last active', async () => {
  const dir = tmp();
  const history = new History(dir);
  const result = history.append('c1', { kind: 'result', isError: false });
  history.flush();
  const active = history.lastActive('c1');
  await new Promise((resolve) => setTimeout(resolve, 30));

  const suggested = { replies: [], nextMessage: 'commit it' };
  history.update('c1', result.id, { suggested }, { heard: false });
  history.flush();
  assert.equal(history.lastActive('c1'), active);
  const reopened = new History(dir);
  assert.equal(reopened.lastActive('c1'), active, 'its file says so too');
  assert.deepEqual(reopened.read('c1')[0].suggested, suggested);

  // Also when it is the first change after a restart.
  reopened.update('c1', result.id, { suggested: { replies: [], nextMessage: 'open a pr' } }, { heard: false });
  reopened.flush();
  assert.equal(new History(dir).lastActive('c1'), active);
  // Any other change is heard.
  reopened.update('c1', result.id, { durationMs: 900 });
  assert.ok(reopened.lastActive('c1') > active);
});

test('a conversation read again after a restart was last active at the millisecond it was written', () => {
  const dir = tmp();
  const history = new History(dir);
  history.append('c1', { kind: 'assistant', text: 'Done.' });
  history.flush();
  const active = history.lastActive('c1');
  // The time goes to the file in seconds, and some file systems hand it back a hair under: …703.999 for …704.
  fs.utimesSync(path.join(dir, 'c1.json'), new Date(), (active - 0.001) / 1000);
  assert.equal(new History(dir).lastActive('c1'), active);
});

test('the browser preview’s history pins and unpins the same way', () => {
  const history = new MemoryHistory();
  const reply = history.append('c1', { kind: 'assistant', text: 'Done.' });
  const active = history.lastActive('c1');
  assert.equal(history.pin('c1', 'gone', true), false);
  assert.equal(history.pin('c1', reply.id, true), true);
  assert.equal(history.read('c1')[0].pinned, true);
  assert.equal(history.lastActive('c1'), active);
  history.pin('c1', reply.id, false);
  assert.equal('pinned' in history.read('c1')[0], false);
});

// ---- how often a conversation's file is written --------------------------------------------------

const onDisk = (dir, contactId) => JSON.parse(fs.readFileSync(path.join(dir, `${contactId}.json`), 'utf8'));
const kinds = (entries) => entries.map((e) => e.kind);

test('the first thing said is written at once, and a burst after it in one go', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const dir = tmp();
  const history = new History(dir);
  history.append('c1', { kind: 'user', text: 'go' });
  assert.deepEqual(kinds(onDisk(dir, 'c1')), ['user'], 'nothing waits when nothing was just written');

  // An agent at work: tool call after tool call, each with its result.
  const writes = t.mock.method(fs, 'writeFileSync');
  for (let i = 0; i < 20; i += 1) {
    const tool = history.append('c1', { kind: 'tool', toolId: `t${i}` });
    history.update('c1', tool.id, { output: `done ${i}` });
  }
  assert.equal(writes.mock.callCount(), 0, 'the file was written a moment ago');
  assert.equal(history.read('c1').length, 21, 'whoever reads meanwhile gets all of it');
  assert.equal(history.read('c1').at(-1).output, 'done 19');
  assert.deepEqual(kinds(onDisk(dir, 'c1')), ['user']);

  t.mock.timers.tick(WRITE_EVERY_MS);
  assert.equal(writes.mock.callCount(), 1, 'forty changes, one write');
  assert.equal(onDisk(dir, 'c1').length, 21);
  assert.equal(onDisk(dir, 'c1').at(-1).output, 'done 19');

  // With nothing new, nothing is written again.
  t.mock.timers.tick(10 * WRITE_EVERY_MS);
  assert.equal(writes.mock.callCount(), 1);
  // And after a pause, the next thing is written at once again.
  history.append('c1', { kind: 'result' });
  assert.equal(writes.mock.callCount(), 2);
  assert.equal(onDisk(dir, 'c1').length, 22);
});

test('an agent that keeps going is written every so often, not only when it stops', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const dir = tmp();
  const history = new History(dir);
  history.append('c1', { kind: 'user', text: 'go' });
  const writes = t.mock.method(fs, 'writeFileSync');
  // A change every 50 ms, for two seconds.
  for (let i = 0; i < 40; i += 1) {
    t.mock.timers.tick(50);
    history.append('c1', { kind: 'tool', toolId: `t${i}` });
  }
  assert.equal(writes.mock.callCount(), 2000 / WRITE_EVERY_MS);
  assert.equal(history.read('c1').length, 41);
  assert.equal(onDisk(dir, 'c1').length, 40, 'what is on disk is never far behind');
});

test('quitting writes what was still waiting, and it is all there after a restart', () => {
  const dir = tmp();
  const history = new History(dir);
  history.append('c1', { kind: 'user', text: 'go' });
  const tool = history.append('c1', { kind: 'tool', toolId: 't1' });
  history.update('c1', tool.id, { output: 'done' });
  history.append('c2', { kind: 'user', text: 'hi' });
  history.append('c2', { kind: 'assistant', text: 'hello' });
  assert.equal(new History(dir).read('c1').length, 1, 'not written yet');

  history.flush();

  const restarted = new History(dir);
  assert.deepEqual(
    restarted.read('c1').map((e) => [e.kind, e.output]),
    [
      ['user', undefined],
      ['tool', 'done'],
    ]
  );
  assert.deepEqual(kinds(restarted.read('c2')), ['user', 'assistant']);
  // Nothing is left to write, so nothing is written twice.
  const before = fs.statSync(path.join(dir, 'c1.json')).mtimeMs;
  history.flush();
  assert.equal(fs.statSync(path.join(dir, 'c1.json')).mtimeMs, before);
});

test('a conversation that is cleared or archived is not written back afterwards', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const dir = tmp();
  const history = new History(dir);
  for (const text of ['one', 'two']) history.append('c1', { kind: 'user', text });
  history.clear('c1');
  for (const text of ['one', 'two']) history.append('c2', { kind: 'user', text });
  const summary = history.archive('c2', { cwd: '/work' });
  assert.equal(summary.messages, 2, 'what was still waiting is archived with the rest');
  assert.equal(history.readArchived('c2', summary.id).entries.length, 2);

  t.mock.timers.tick(WRITE_EVERY_MS);
  history.flush();
  assert.equal(fs.existsSync(path.join(dir, 'c1.json')), false);
  assert.equal(fs.existsSync(path.join(dir, 'c2.json')), false);
  assert.deepEqual(history.read('c1'), []);
  assert.equal(history.lastActive('c2'), null);

  // The conversation after it starts from nothing.
  history.append('c1', { kind: 'user', text: 'three' });
  assert.deepEqual(
    onDisk(dir, 'c1').map((e) => e.text),
    ['three']
  );
});

test('a conversation is picked up from its file, and is last heard from when it was added to', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const dir = tmp();
  const earlier = new History(dir);
  earlier.append('c1', { kind: 'user', text: 'before the restart' });
  const written = earlier.lastActive('c1');

  const history = new History(dir);
  // In whole milliseconds, as lastActive reads it: the file system hands back a fraction, such as …066.999.
  const modified = () => Math.round(fs.statSync(path.join(dir, 'c1.json')).mtimeMs);
  assert.equal(history.lastActive('c1'), modified());
  // A result for a tool call nobody has a line for changes nothing, and writes nothing.
  const writes = t.mock.method(fs, 'writeFileSync');
  history.update('c1', 'no-such-entry', { output: 'late' });
  assert.equal(writes.mock.callCount(), 0);
  assert.equal(history.lastActive('c1'), modified());

  history.append('c1', { kind: 'assistant', text: 'after it' });
  const { time } = history.append('c1', { kind: 'result' });
  assert.deepEqual(kinds(history.read('c1')), ['user', 'assistant', 'result']);
  // Also while the last of it is still to be written.
  assert.equal(onDisk(dir, 'c1').length, 2);
  assert.ok(history.lastActive('c1') >= time);
  assert.ok(history.lastActive('c1') >= written);
});

test('what is read from a conversation is the reader’s own', () => {
  const history = new History(tmp());
  const added = history.append('c1', { kind: 'tool', toolId: 't1' });
  added.kind = 'changed';
  const entries = history.read('c1');
  entries[0].output = 'changed';
  entries.push({ kind: 'extra' });
  history.update('c1', added.id, { isError: false });
  assert.deepEqual(history.read('c1'), [
    { id: added.id, time: added.time, kind: 'tool', toolId: 't1', isError: false },
  ]);
  assert.equal(added.isError, undefined, 'and what was handed out earlier stays as it was');
});

test('an entry is read back the way its file has it, also before it is written', () => {
  const dir = tmp();
  const history = new History(dir);
  history.append('c1', { kind: 'user', text: 'go' });
  // Still waiting to be written.
  const result = history.append('c1', { kind: 'result', isError: false, stopped: undefined, errorText: undefined });
  const tool = history.append('c1', { kind: 'tool', toolId: 't1', activity: { kind: 'read', path: undefined } });
  history.update('c1', tool.id, { output: 'done', declined: undefined, toolId: undefined });
  const [, readResult, readTool] = history.read('c1');
  assert.deepEqual(readResult, { id: result.id, time: result.time, kind: 'result', isError: false });
  assert.deepEqual(readTool, {
    id: tool.id,
    time: tool.time,
    kind: 'tool',
    activity: { kind: 'read' },
    output: 'done',
  });
  history.flush();
  assert.deepEqual(new History(dir).read('c1'), history.read('c1'));
});

test('a conversation keeps its newest 600 entries', () => {
  const dir = tmp();
  const history = new History(dir);
  for (let i = 0; i < 605; i += 1) history.append('c1', { kind: 'notice', text: String(i) });
  assert.equal(history.read('c1').length, 600);
  assert.equal(history.read('c1')[0].text, '5');
  history.flush();
  assert.deepEqual(
    [onDisk(dir, 'c1').length, onDisk(dir, 'c1')[0].text, onDisk(dir, 'c1').at(-1).text],
    [600, '5', '604']
  );
});

test('manager history retains a complete transcript when appended, restarted or resumed', (t) => {
  const dir = tmp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const options = { retainAll: (id) => id === 'manager' };
  const history = new History(dir, options);
  for (let i = 0; i < 620; i++) history.append('manager', { kind: 'user', text: String(i) });
  history.flush();
  const original = history.read('manager');
  assert.equal(original.length, 620);
  const restarted = new History(dir, options);
  assert.deepEqual(restarted.read('manager'), original);
  restarted.begin('manager', original);
  assert.deepEqual(restarted.read('manager'), original);
  restarted.begin('worker', original);
  assert.equal(restarted.read('worker').length, 600, 'ordinary contacts keep the existing limit');
  restarted.flush();
});

test('a file that can’t be written later is tried again with the next change, and never stops the app', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const dir = tmp();
  const history = new History(dir);
  history.append('c1', { kind: 'user', text: 'one' });
  history.append('c1', { kind: 'user', text: 'two' });
  fs.rmSync(dir, { recursive: true });
  // Its folder is gone when the time to write comes.
  t.mock.timers.tick(WRITE_EVERY_MS);
  assert.doesNotThrow(() => history.flush());
  assert.equal(history.read('c1').length, 2);

  fs.mkdirSync(dir);
  history.append('c1', { kind: 'user', text: 'three' });
  assert.equal(onDisk(dir, 'c1').length, 3);
});

test('a change whose file can’t be written at once is kept all the same, and written with the next one', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const dir = tmp();
  const history = new History(dir);
  fs.rmSync(dir, { recursive: true });
  // Nothing was written a moment ago, so it is written at once: the disk is full, or its folder is gone.
  const said = history.append('c1', { kind: 'user', text: 'one' });
  assert.equal(said.text, 'one');
  history.update('c1', said.id, { pinned: true });
  assert.deepEqual(
    history.read('c1').map((e) => [e.text, e.pinned]),
    [['one', true]]
  );

  fs.mkdirSync(dir);
  history.append('c1', { kind: 'user', text: 'two' });
  assert.deepEqual(
    onDisk(dir, 'c1').map((e) => e.text),
    ['one', 'two']
  );
});

test('a fresh store has no groups', () => {
  assert.deepEqual(new Store(tmp(), defaults).groups, []);
});

test('groups keep their order and persist across restarts', () => {
  const dir = tmp();
  const store = new Store(dir, defaults);
  const work = store.addGroup('Work');
  const side = store.addGroup('Side projects');
  assert.ok(work.id && work.id !== side.id);
  assert.deepEqual(store.renameGroup(side.id, 'Games'), { id: side.id, name: 'Games' });
  assert.deepEqual(new Store(dir, defaults).groups, [
    { id: work.id, name: 'Work' },
    { id: side.id, name: 'Games' },
  ]);
});

test('renaming a group that does not exist changes nothing', () => {
  const store = new Store(tmp(), defaults);
  store.addGroup('Work');
  assert.equal(store.renameGroup('nope', 'Play'), null);
  assert.deepEqual(
    store.groups.map((g) => g.name),
    ['Work']
  );
});

test('a contact remembers its group across restarts', () => {
  const dir = tmp();
  const store = new Store(dir, defaults);
  const work = store.addGroup('Work');
  const contact = store.addContact({ ...contactFields, name: 'Claude' });
  store.updateContact(contact.id, { groupId: work.id });
  assert.equal(new Store(dir, defaults).getContact(contact.id).groupId, work.id);
});

test('a contact remembers its output style across restarts, and having none', () => {
  const dir = tmp();
  const store = new Store(dir, defaults);
  const contact = store.addContact({ ...contactFields, name: 'Claude' });
  assert.equal(contact.outputStyle, undefined, 'a new contact follows the user’s own default');
  store.updateContact(contact.id, { outputStyle: 'Explanatory' });
  assert.equal(new Store(dir, defaults).getContact(contact.id).outputStyle, 'Explanatory');
  store.updateContact(contact.id, { outputStyle: null });
  assert.equal(new Store(dir, defaults).getContact(contact.id).outputStyle, null);
});

test('deleting a group keeps its contacts and takes them out of the group', () => {
  const dir = tmp();
  const store = new Store(dir, defaults);
  const work = store.addGroup('Work');
  const side = store.addGroup('Side projects');
  const inWork = store.addContact({ ...contactFields, name: 'A' });
  const inSide = store.addContact({ provider: 'claude', name: 'B', cwd: '/tmp', model: '', permissionMode: 'default' });
  store.updateContact(inWork.id, { groupId: work.id });
  store.updateContact(inSide.id, { groupId: side.id });

  store.removeGroup(work.id);

  const reloaded = new Store(dir, defaults);
  assert.deepEqual(reloaded.groups, [{ id: side.id, name: 'Side projects' }]);
  assert.equal(reloaded.contacts.length, 2);
  assert.equal(reloaded.getContact(inWork.id).groupId, null);
  assert.equal(reloaded.getContact(inSide.id).groupId, side.id);
});

test('data saved before groups existed is migrated', () => {
  const dir = tmp();
  fs.writeFileSync(
    path.join(dir, 'messenger.json'),
    JSON.stringify({
      version: 2,
      profile: { name: 'Safa', status: 'online', personalMessage: '', picture: null },
      settings: { sounds: false },
      contacts: [
        {
          id: 'x',
          provider: 'claude',
          name: 'Claude',
          cwd: '/tmp',
          model: '',
          permissionMode: 'default',
          sessionId: 's1',
        },
      ],
    })
  );
  const store = new Store(dir, defaults);
  assert.deepEqual(store.groups, []);
  assert.equal(store.getContact('x').sessionId, 's1');
  assert.equal(store.settings.sounds, false);
  // A setting newer than the file starts out at its default.
  assert.equal(store.settings.removeWorktrees, false);
  assert.equal(store.addGroup('Work').name, 'Work');
});

test('a new contact keeps the group and display picture it was added with', () => {
  const dir = tmp();
  const store = new Store(dir, defaults);
  const work = store.addGroup('Work');
  const fields = { provider: 'claude', name: 'A', cwd: '/tmp', model: '', permissionMode: 'default' };
  const added = store.addContact({ ...fields, groupId: work.id, avatar: 'claude-code' });
  const reloaded = new Store(dir, defaults).getContact(added.id);
  assert.equal(reloaded.groupId, work.id);
  assert.equal(reloaded.avatar, 'claude-code');
  const plain = store.addContact({ ...fields, groupId: null });
  assert.equal('groupId' in plain, false);
  assert.equal('avatar' in plain, false);
});

// ---- favorites and archived contacts --------------------------------------------------------------

test('a favorite and an archived contact are remembered across restarts', () => {
  const dir = tmp();
  const store = new Store(dir, defaults);
  const contact = store.addContact({ ...contactFields, name: 'Claude' });
  assert.equal('favorite' in contact, false);
  assert.equal('archived' in contact, false);

  assert.equal(store.updateContact(contact.id, { favorite: true }).favorite, true);
  assert.equal(new Store(dir, defaults).getContact(contact.id).favorite, true);
  assert.equal('archived' in new Store(dir, defaults).getContact(contact.id), false);

  store.updateContact(contact.id, { archived: true });
  assert.deepEqual(new Store(dir, defaults).getContact(contact.id), { ...contact, favorite: true, archived: true });

  // Other changes leave both alone.
  store.updateContact(contact.id, { name: 'Renamed', sessionId: 's-1' });
  const reloaded = new Store(dir, defaults).getContact(contact.id);
  assert.deepEqual([reloaded.favorite, reloaded.archived, reloaded.name], [true, true, 'Renamed']);
});

test('a pinned contact is remembered across restarts, and stored only while it is pinned', () => {
  const dir = tmp();
  const store = new Store(dir, defaults);
  const contact = store.addContact({ ...contactFields, name: 'Claude' });
  assert.equal('pinned' in contact, false);
  const file = () => fs.readFileSync(path.join(dir, 'messenger.json'), 'utf8');
  store.save();
  const before = file();

  store.updateContact(contact.id, { pinned: 'yes' });
  assert.equal(new Store(dir, defaults).getContact(contact.id).pinned, true);
  assert.match(file(), /"pinned": true/);
  // Pinned and a favorite are kept apart.
  assert.equal('favorite' in new Store(dir, defaults).getContact(contact.id), false);

  store.updateContact(contact.id, { pinned: false });
  assert.equal('pinned' in new Store(dir, defaults).getContact(contact.id), false);
  assert.equal(file(), before, 'a contact that was unpinned is stored exactly as it always was');
});

test('favorite and archived are stored only while they are true', () => {
  const dir = tmp();
  const store = new Store(dir, defaults);
  const contact = store.addContact({ ...contactFields, name: 'Claude' });
  const file = () => fs.readFileSync(path.join(dir, 'messenger.json'), 'utf8');
  store.save();
  const before = file();
  assert.doesNotMatch(before, /favorite|archived/);

  // Whatever is handed in, what is kept is `true` or nothing.
  store.updateContact(contact.id, { favorite: 1, archived: 'yes' });
  assert.deepEqual([store.getContact(contact.id).favorite, store.getContact(contact.id).archived], [true, true]);
  assert.match(file(), /"favorite": true/);
  assert.match(file(), /"archived": true/);

  for (const off of [false, null, undefined, 0, '']) {
    store.updateContact(contact.id, { favorite: true, archived: true });
    const stored = store.updateContact(contact.id, { favorite: off, archived: off });
    assert.equal('favorite' in stored, false, String(off));
    assert.equal('archived' in stored, false, String(off));
    assert.equal(file(), before, 'a contact that is neither is stored exactly as it always was');
  }

  // One can go while the other stays.
  store.updateContact(contact.id, { favorite: true, archived: true });
  store.updateContact(contact.id, { archived: false });
  assert.deepEqual(new Store(dir, defaults).getContact(contact.id), { ...contact, favorite: true });
  assert.equal(store.updateContact('nope', { favorite: true }), null);
});

test("the browser preview's in-memory store keeps favorite and archived the same way", () => {
  const story = (store) => {
    const { id } = store.addContact({
      provider: 'claude',
      name: 'A',
      cwd: '/tmp',
      model: '',
      permissionMode: 'default',
    });
    const flags = () => {
      const { favorite, archived, ...rest } = store.getContact(id);
      return [favorite, archived, 'favorite' in store.getContact(id), 'archived' in store.getContact(id), rest.name];
    };
    const told = [flags()];
    for (const patch of [
      { favorite: true },
      { archived: 1 },
      { name: 'B' },
      { favorite: false },
      { archived: null },
      { favorite: 'yes', archived: true },
      { favorite: undefined, archived: 0 },
    ]) {
      store.updateContact(id, patch);
      told.push(flags());
    }
    told.push(store.updateContact('nope', { archived: true }));
    return told;
  };
  const onDisk = story(new Store(tmp(), defaults));
  assert.deepEqual(story(new MemoryStore()), onDisk);
  assert.deepEqual(onDisk, [
    [undefined, undefined, false, false, 'A'],
    [true, undefined, true, false, 'A'],
    [true, true, true, true, 'A'],
    [true, true, true, true, 'B'],
    [undefined, true, false, true, 'B'],
    [undefined, undefined, false, false, 'B'],
    [true, true, true, true, 'B'],
    [undefined, undefined, false, false, 'B'],
    null,
  ]);
});

// ---- guests in a contact's conversation -----------------------------------------------------------

test('the guests of a conversation are kept with its contact, in the order they joined', () => {
  const dir = tmp();
  const store = new Store(dir, defaults);
  const host = store.addContact({ ...contactFields, name: 'Claude' });
  const codex = store.addContact({ ...contactFields, name: 'Codex' });
  const opus = store.addContact({ ...contactFields, name: 'Opus' });

  assert.deepEqual(store.addGuest(host.id, { id: codex.id, permissionMode: 'ask' }), {
    id: codex.id,
    permissionMode: 'ask',
    sessionId: null,
  });
  store.addGuest(host.id, { id: opus.id, permissionMode: 'plan' });
  assert.deepEqual(store.updateGuest(host.id, codex.id, { sessionId: 'th-1', permissionMode: 'auto' }), {
    id: codex.id,
    permissionMode: 'auto',
    sessionId: 'th-1',
  });

  const reloaded = new Store(dir, defaults);
  assert.deepEqual(reloaded.getContact(host.id).guests, [
    { id: codex.id, permissionMode: 'auto', sessionId: 'th-1' },
    { id: opus.id, permissionMode: 'plan', sessionId: null },
  ]);
  assert.equal(reloaded.getContact(codex.id).permissionMode, 'default', 'the guest’s own mode is its own');
  assert.equal(reloaded.getContact(codex.id).sessionId, null);
  assert.equal('guests' in reloaded.getContact(codex.id), false);

  reloaded.removeGuest(host.id, codex.id);
  assert.deepEqual(new Store(dir, defaults).getContact(host.id).guests, [
    { id: opus.id, permissionMode: 'plan', sessionId: null },
  ]);
});

test('who answers first is kept with the host, and loses each guest that leaves', () => {
  const dir = tmp();
  const store = new Store(dir, defaults);
  const host = store.addContact({ ...contactFields, name: 'Claude' });
  const codex = store.addContact({ ...contactFields, name: 'Codex' });
  const opus = store.addContact({ ...contactFields, name: 'Opus' });
  const alone = structuredClone(store.getContact(host.id));
  store.addGuest(host.id, { id: codex.id, permissionMode: 'ask' });
  store.addGuest(host.id, { id: opus.id, permissionMode: 'ask' });
  store.updateContact(host.id, { answerOrder: [opus.id, host.id, codex.id] });
  assert.deepEqual(new Store(dir, defaults).getContact(host.id).answerOrder, [opus.id, host.id, codex.id]);

  store.removeGuest(host.id, opus.id);
  assert.deepEqual(store.getContact(host.id).answerOrder, [host.id, codex.id]);
  store.removeContact(codex.id);
  assert.deepEqual(new Store(dir, defaults).getContact(host.id), alone, 'alone again, it is stored as it always was');
});

test('a contact without guests is stored exactly as it always was', () => {
  const dir = tmp();
  const store = new Store(dir, defaults);
  const host = store.addContact({ ...contactFields, name: 'Claude' });
  const guest = store.addContact({ ...contactFields, name: 'Codex' });
  const file = () => fs.readFileSync(path.join(dir, 'messenger.json'), 'utf8');
  const before = file();
  assert.doesNotMatch(before, /guests/);

  store.addGuest(host.id, { id: guest.id, permissionMode: 'ask' });
  assert.match(file(), /"guests"/);
  store.removeGuest(host.id, guest.id);
  assert.equal(file(), before, 'once the last guest has left, too');
  assert.equal('guests' in store.getContact(host.id), false);
});

test('guests of a contact that does not exist, or that are not there, change nothing', () => {
  const dir = tmp();
  const store = new Store(dir, defaults);
  const host = store.addContact({ ...contactFields, name: 'Claude' });
  const file = () => fs.readFileSync(path.join(dir, 'messenger.json'), 'utf8');
  store.save();
  const before = file();
  assert.equal(store.addGuest('nope', { id: host.id, permissionMode: 'ask' }), null);
  assert.equal(store.updateGuest(host.id, 'nope', { sessionId: 'x' }), null);
  assert.equal(store.updateGuest('nope', host.id, { sessionId: 'x' }), null);
  store.removeGuest(host.id, 'nope');
  store.removeGuest('nope', host.id);
  assert.equal(file(), before);
});

test('deleting a contact takes it out of the conversations it was invited to', () => {
  const dir = tmp();
  const store = new Store(dir, defaults);
  const host = store.addContact({ ...contactFields, name: 'Claude' });
  const codex = store.addContact({ ...contactFields, name: 'Codex' });
  const opus = store.addContact({ ...contactFields, name: 'Opus' });
  store.addGuest(host.id, { id: codex.id, permissionMode: 'ask' });
  store.addGuest(host.id, { id: opus.id, permissionMode: 'plan' });
  store.addGuest(opus.id, { id: codex.id, permissionMode: 'ask' });

  store.removeContact(codex.id);

  const reloaded = new Store(dir, defaults);
  assert.deepEqual(reloaded.getContact(host.id).guests, [{ id: opus.id, permissionMode: 'plan', sessionId: null }]);
  assert.equal('guests' in reloaded.getContact(opus.id), false);
});

test('a guest made for one conversation alone is kept off the contact list, and is deleted with its host', () => {
  const dir = tmp();
  for (const store of [new Store(dir, defaults), new MemoryStore()]) {
    const listed = store.contacts.map((c) => c.name);
    const host = store.addContact({ ...contactFields, name: 'Host' });
    const other = store.addContact({ ...contactFields, name: 'Other' });
    const own = store.addContact({ ...contactFields, name: 'Guest', guestOf: host.id });
    store.addGuest(host.id, { id: own.id, permissionMode: 'ask' });

    assert.deepEqual(
      store.contacts.map((c) => c.name),
      [...listed, 'Host', 'Other'],
      'it is not on the contact list'
    );
    assert.equal(store.getContact(own.id).guestOf, host.id, 'and is found by its id');
    assert.equal('guestOf' in store.getContact(other.id), false, 'a contact is kept as it always was');

    store.removeContact(other.id);
    assert.equal(store.getContact(own.id).name, 'Guest', 'another contact going is nothing to it');
    store.removeContact(host.id);
    assert.equal(store.getContact(own.id), undefined);
    assert.deepEqual(
      store.contacts.map((c) => c.name),
      listed
    );
  }
});

test('a guest made for one conversation alone is still there, and still off the list, after a restart', () => {
  const dir = tmp();
  const store = new Store(dir, defaults);
  const host = store.addContact({ ...contactFields, name: 'Claude' });
  const own = store.addContact({ ...contactFields, name: 'Guest', guestOf: host.id });
  store.addGuest(host.id, { id: own.id, permissionMode: 'ask' });

  const reloaded = new Store(dir, defaults);
  assert.deepEqual(
    reloaded.contacts.map((c) => c.id),
    [host.id]
  );
  assert.deepEqual(reloaded.getContact(own.id), own);
  assert.deepEqual(reloaded.getContact(host.id).guests, [{ id: own.id, permissionMode: 'ask', sessionId: null }]);
  reloaded.removeContact(host.id);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'messenger.json'), 'utf8')).contacts, []);
});

test('deleting the first of the chat tabs leaves the others tabs of one another, in both stores', () => {
  const dir = tmp();
  for (const store of [new Store(dir, defaults), new MemoryStore()]) {
    const first = store.addContact({ ...contactFields, name: 'Claude' });
    const second = store.addContact({ ...contactFields, name: 'Claude 2', tabOf: first.id });
    const third = store.addContact({ ...contactFields, name: 'Codex', tabOf: first.id });
    assert.equal(store.getContact(second.id).tabOf, first.id);
    store.removeContact(first.id);
    assert.equal('tabOf' in store.getContact(second.id), false, 'the next one is the first now');
    assert.equal(store.getContact(third.id).tabOf, second.id);
  }
  const reloaded = new Store(dir, defaults);
  assert.deepEqual(
    reloaded.contacts.map((c) => [c.name, c.tabOf && reloaded.getContact(c.tabOf).name]),
    [
      ['Claude 2', undefined],
      ['Codex', 'Claude 2'],
    ],
    'and it is saved'
  );
});

test("the browser preview's in-memory store keeps guests the same way", () => {
  // Everything Conversations asks of a store about guests, with the ids left out.
  const story = (store) => {
    const [host, codex, opus] = ['Claude', 'Codex', 'Opus'].map((name) => store.addContact({ ...contactFields, name }));
    const names = new Map([host, codex, opus].map((contact) => [contact.id, contact.name]));
    const named = (guest) => guest && { ...guest, id: names.get(guest.id) };
    const told = [];
    /** What a step returned, and the host's guests after it. */
    const say = (step, result) => {
      const stored = store.getContact(host.id);
      told.push([step, named(result), stored.guests?.map(named), 'guests' in stored]);
    };
    say('nobody invited');
    say('invite', store.addGuest(host.id, { id: codex.id, permissionMode: 'ask' }));
    say('invite another', store.addGuest(host.id, { id: opus.id, permissionMode: 'plan' }));
    say('its session', store.updateGuest(host.id, codex.id, { sessionId: 'th-1' }));
    say('its mode', store.updateGuest(host.id, opus.id, { permissionMode: 'default' }));
    say('no such guest', store.updateGuest(host.id, 'nope', { sessionId: 'x' }));
    say('no such host', store.addGuest('nope', { id: codex.id, permissionMode: 'ask' }));
    say('no such host to update', store.updateGuest('nope', codex.id, { sessionId: 'x' }));
    say('remove nobody', store.removeGuest(host.id, 'nope'));
    say('remove from nobody', store.removeGuest('nope', codex.id));
    say('remove', store.removeGuest(host.id, codex.id));
    say('invite again', store.addGuest(host.id, { id: codex.id, permissionMode: 'ask' }));
    say('contact deleted', store.removeContact(opus.id));
    say('last one leaves', store.removeGuest(host.id, codex.id));
    told.push(['own modes', store.getContact(codex.id).permissionMode, store.getContact(codex.id).sessionId]);
    return told;
  };

  const onDisk = story(new Store(tmp(), defaults));
  assert.deepEqual(story(new MemoryStore()), onDisk);
  assert.deepEqual(
    onDisk.map(([step, , guests, has]) => [step, guests?.map((guest) => guest.id).join('+') ?? has]),
    [
      ['nobody invited', false],
      ['invite', 'Codex'],
      ['invite another', 'Codex+Opus'],
      ['its session', 'Codex+Opus'],
      ['its mode', 'Codex+Opus'],
      ['no such guest', 'Codex+Opus'],
      ['no such host', 'Codex+Opus'],
      ['no such host to update', 'Codex+Opus'],
      ['remove nobody', 'Codex+Opus'],
      ['remove from nobody', 'Codex+Opus'],
      ['remove', 'Opus'],
      ['invite again', 'Opus+Codex'],
      ['contact deleted', 'Codex'],
      ['last one leaves', false],
      ['own modes', undefined],
    ],
    'and the story is the one we meant to tell'
  );
});

// ---- a saved file that can't be read --------------------------------------------------------------

const readIn = (dir, name) => fs.readFileSync(path.join(dir, name), 'utf8');

test('a file cut short is put aside, and the store that starts over never saves over it', () => {
  const dir = tmp();
  const store = new Store(dir, defaults);
  store.addContact({ ...contactFields, name: 'Claude' });
  store.finishOnboarding();
  // The computer lost power while it was being written.
  const cut = readIn(dir, 'messenger.json').slice(0, 200);
  fs.writeFileSync(path.join(dir, 'messenger.json'), cut);

  const fresh = new Store(dir, defaults);
  assert.deepEqual(fresh.contacts, []);
  assert.equal(fresh.onboarding, true);
  assert.deepEqual(fs.readdirSync(dir), ['messenger.json.broken'], 'moved out of the way, not copied');
  assert.equal(readIn(dir, 'messenger.json.broken'), cut);

  fresh.addContact({ ...contactFields, name: 'Codex' });
  assert.equal(readIn(dir, 'messenger.json.broken'), cut, 'and what was kept stays as it was');
  assert.deepEqual(
    new Store(dir, defaults).contacts.map((c) => c.name),
    ['Codex']
  );
});

test('a file put aside before is not saved over by the next one', () => {
  const dir = tmp();
  // Cut short at different points, and an empty one.
  const broken = ['{ "version": 5, "contacts": [', '', '{ "version": 5, "contacts": [{ "id": "x"'];
  for (const text of broken) {
    fs.writeFileSync(path.join(dir, 'messenger.json'), text);
    new Store(dir, defaults).save();
  }
  assert.deepEqual(
    ['messenger.json.broken', 'messenger.json.broken-2', 'messenger.json.broken-3'].map((name) => readIn(dir, name)),
    broken
  );
});

test('a file that is JSON, but not what the app saves, is put aside too', () => {
  for (const text of ['null', '[]', '"messenger"', '{ "profile": { "name": "Safa" } }']) {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'messenger.json'), text);
    assert.deepEqual(new Store(dir, defaults).contacts, [], text);
    assert.equal(readIn(dir, 'messenger.json.broken'), text);
  }
});

test('nothing saved yet is a first run, with nothing to put aside', () => {
  const dir = tmp();
  const store = new Store(dir, defaults);
  assert.equal(store.onboarding, true);
  assert.deepEqual(fs.readdirSync(dir), []);
  store.save();
  assert.deepEqual(fs.readdirSync(dir), ['messenger.json']);
});

test('a file that is there but can’t be read is left as it is, and no store starts without it', (t) => {
  const dir = tmp();
  const store = new Store(dir, defaults);
  store.addContact({ ...contactFields, name: 'Claude' });
  store.updateSettings({ errorReports: false });
  const file = path.join(dir, 'messenger.json');
  const before = readIn(dir, 'messenger.json');
  const readFileSync = fs.readFileSync;
  // Another program has it open, as a virus scanner may on Windows, or it isn't the user's to read.
  for (const code of ['EBUSY', 'EPERM', 'EACCES']) {
    const locked = t.mock.method(fs, 'readFileSync', (at, ...rest) => {
      if (at === file) throw Object.assign(new Error(`${code}: can't read it, open '${at}'`), { code });
      return readFileSync(at, ...rest);
    });
    assert.throws(() => new Store(dir, defaults), { code });
    // What has to be known before the app is ready is at its default meanwhile.
    assert.deepEqual(savedSettings(dir), new Store(tmp(), defaults).settings);
    locked.mock.restore();
    assert.deepEqual(fs.readdirSync(dir), ['messenger.json'], code);
    assert.equal(readIn(dir, 'messenger.json'), before, code);
  }
  // Once it can be read again, everything is there.
  const reopened = new Store(dir, defaults);
  assert.deepEqual(
    reopened.contacts.map((c) => c.name),
    ['Claude']
  );
  assert.equal(reopened.settings.errorReports, false);
});

test('what is saved is on the disk before it takes the place of what was there', (t) => {
  const store = new Store(tmp(), defaults);
  const flushed = t.mock.method(fs, 'fsyncSync');
  const renameSync = fs.renameSync;
  const flushedBeforeRename = [];
  t.mock.method(fs, 'renameSync', (...args) => {
    flushedBeforeRename.push(flushed.mock.callCount());
    return renameSync(...args);
  });
  store.updateSettings({ sounds: false });
  store.updateSettings({ sounds: true });
  assert.deepEqual(flushedBeforeRename, [1, 2]);
});

test('answering all at once is stored only while it is true', () => {
  const dir = tmp();
  const store = new Store(dir, defaults);
  const contact = store.addContact({ ...contactFields, name: 'Claude' });
  assert.equal(store.updateContact(contact.id, { atOnce: 'yes' }).atOnce, true);
  assert.equal(new Store(dir, defaults).getContact(contact.id).atOnce, true, 'it is remembered across restarts');
  assert.equal('atOnce' in store.updateContact(contact.id, { atOnce: false }), false);
  assert.equal('atOnce' in new Store(dir, defaults).getContact(contact.id), false);
});

// ---- the managers' conversations ---------------------------------------------------------------

test('a pause left on a contact on its own is dropped when the app starts, and one with guests keeps its own', () => {
  const dir = tmp();
  fs.writeFileSync(
    path.join(dir, 'messenger.json'),
    JSON.stringify({
      version: 7,
      settings: {},
      projects: {},
      contacts: [
        // Recovery from a failed turn paused it, with nobody else there to answer and no Resume to undo it.
        { ...contactFields, id: 'alone', name: 'Claude (tags)', paused: true },
        { ...contactFields, id: 'host', name: 'Claude', paused: true, guests: [{ id: 'guest', paused: true }] },
        { ...contactFields, id: 'guest', name: 'Codex', provider: 'codex' },
      ],
    })
  );
  const store = new Store(dir, defaults);
  assert.equal('paused' in store.getContact('alone'), false);
  assert.equal(store.getContact('host').paused, true);
  assert.equal(store.getContact('host').guests[0].paused, true);
  store.save();
  const file = JSON.parse(fs.readFileSync(path.join(dir, 'messenger.json'), 'utf8'));
  assert.equal('paused' in file.contacts.find((one) => one.id === 'alone'), false, 'and it is saved so');
});

test('from v7 a project’s manager is named by its contact, and its project’s conversations are to go under it', () => {
  const dir = tmp();
  const shop = 'git:/w/shop/.git';
  const blog = 'git:/w/blog/.git';
  const api = 'git:/w/api/.git';
  const saved = (projects, contacts, version = 6) =>
    fs.writeFileSync(path.join(dir, 'messenger.json'), JSON.stringify({ version, settings: {}, projects, contacts }));
  saved(
    {
      [shop]: { manager: { on: true, brief: 'Goals' } },
      [blog]: { manager: { on: false, rules: 'Be brief.' } },
      // Its manager was deleted: what it was set up with waits for the next one.
      [api]: { manager: { on: false, brief: 'Old goals' } },
      'dir:/w/notes': { setup: 'make' },
    },
    [
      { ...contactFields, id: 'm1', name: 'shop manager', manages: shop },
      { ...contactFields, id: 'w1', name: 'Claude (tags)' },
      { ...contactFields, id: 'm2', name: 'blog manager', manages: blog },
    ]
  );
  const store = new Store(dir, defaults);
  assert.deepEqual(store.getProject(shop).manager, { id: 'm1', on: true, brief: 'Goals' });
  assert.equal(store.getProject(blog).manager.id, 'm2', 'turned off, it is named all the same');
  assert.equal('id' in store.getProject(api).manager, false);
  assert.deepEqual(store.toAdopt, [shop, blog], 'which conversations are whose takes git, so it waits for the app');
  assert.equal(store.getContact('w1').managedBy, undefined);

  store.adopted(shop);
  assert.deepEqual(store.toAdopt, [blog]);
  store.adopted(blog);
  assert.deepEqual(store.toAdopt, []);
  const file = JSON.parse(fs.readFileSync(path.join(dir, 'messenger.json'), 'utf8'));
  assert.equal(file.version, 7);
  assert.equal('toAdopt' in file, false, 'done with, it leaves nothing behind');
  assert.deepEqual(new Store(dir, defaults).toAdopt, [], 'once');

  // A version from before that saved it again kept no name: its conversations go under the manager again.
  saved({ [shop]: { manager: { on: true } } }, [{ ...contactFields, id: 'm1', name: 'shop manager', manages: shop }]);
  const again = new Store(dir, defaults);
  assert.equal(again.getProject(shop).manager.id, 'm1');
  assert.deepEqual(again.toAdopt, [shop]);
});

test('the chat tabs a project’s manager had are contacts of their own once the app starts', () => {
  const dir = tmp();
  const shop = 'git:/w/shop/.git';
  fs.writeFileSync(
    path.join(dir, 'messenger.json'),
    JSON.stringify({
      version: 7,
      settings: {},
      projects: { [shop]: { manager: { id: 'm1', on: true } } },
      contacts: [
        { ...contactFields, id: 'm1', name: 'shop manager', manages: shop },
        { ...contactFields, id: 'm1-codex', name: 'Codex', provider: 'codex', tabOf: 'm1' },
        { ...contactFields, id: 'm1-claude', name: 'Claude 2', tabOf: 'm1', groupId: 'g1' },
        { ...contactFields, id: 'w1', name: 'Claude (tags)', managedBy: 'm1' },
        { ...contactFields, id: 'w1-tab', name: 'Claude 2', tabOf: 'w1' },
      ],
    })
  );
  const store = new Store(dir, defaults);
  for (const id of ['m1-codex', 'm1-claude']) {
    const contact = store.getContact(id);
    assert.equal('tabOf' in contact, false, `${contact.name} is no tab of the manager`);
    assert.equal(contact.managedBy, undefined, `${contact.name} is not put under it either`);
  }
  assert.equal(store.getContact('m1-claude').groupId, 'g1', 'nothing else about it changes');
  assert.equal(store.getContact('w1-tab').tabOf, 'w1', 'a tab of any other contact stays one');
  assert.equal(store.contacts.length, 5, 'nothing is deleted');
  store.save();
  const file = JSON.parse(fs.readFileSync(path.join(dir, 'messenger.json'), 'utf8'));
  assert.equal(file.contacts.find((one) => one.id === 'm1-codex').tabOf, undefined, 'it is saved so');
});

test('a manager that is deleted leaves the ones it had under none, and tabs keep the manager their first had', () => {
  const store = new Store(tmp(), defaults);
  const manager = store.addContact({ ...contactFields, name: 'shop manager', manages: 'git:/w/shop/.git' });
  const other = store.addContact({ ...contactFields, name: 'blog manager', manages: 'git:/w/blog/.git' });
  const tags = store.addContact({ ...contactFields, name: 'Claude (tags)', managedBy: manager.id });
  const post = store.addContact({ ...contactFields, name: 'Claude (post)', managedBy: other.id });
  assert.equal(tags.managedBy, manager.id, 'kept as it was added');
  store.removeContact(manager.id);
  assert.equal(store.getContact(tags.id).managedBy, undefined);
  assert.equal(store.getContact(post.id).managedBy, other.id);

  const first = store.addContact({ ...contactFields, name: 'Claude (cart)', managedBy: other.id });
  const second = store.addContact({ ...contactFields, name: 'Claude', tabOf: first.id });
  const third = store.addContact({ ...contactFields, name: 'Claude 2', tabOf: first.id });
  store.removeContact(first.id);
  assert.equal(store.getContact(second.id).managedBy, other.id, 'the first of them from now on');
  assert.equal(store.getContact(third.id).tabOf, second.id);
  assert.equal(store.getContact(third.id).managedBy, undefined, 'a tab is under whatever its first is under');
});

test('deleted session ids persist without transcripts, deduplicate and retry a failed save', () => {
  const dir = tmp();
  const store = new Store(dir, defaults);
  assert.deepEqual(store.deletedSessions, []);
  store.rememberDeletedSessions(['s1', null, 's1', '', undefined]);
  assert.deepEqual(new Store(dir, defaults).deletedSessions, ['s1']);
  const save = store.save.bind(store);
  store.save = () => {
    throw new Error('disk full');
  };
  assert.throws(() => store.rememberDeletedSessions(['s2']), /disk full/);
  assert.deepEqual(store.deletedSessions, ['s1']);
  store.save = save;
  store.rememberDeletedSessions(['s2']);
  assert.deepEqual(new Store(dir, defaults).deletedSessions, ['s1', 's2']);
  const preview = new MemoryStore();
  preview.rememberDeletedSessions(['s1', null, 's1']);
  assert.deepEqual(preview.deletedSessions, ['s1']);
});
