import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppMerges } from '../src/main/app-merges.js';
import { Store } from '../src/main/storage/store.js';
import { tempDir } from './fixtures/temp-dir.js';

const DEFAULTS = { defaultProvider: 'claude' };
const URL = 'https://github.com/acme/shop/pull/12';

const pr = (fields = {}) => ({ number: 12, url: URL, title: 'Add a hover card', state: 'open', ...fields });
const running = (fields = {}) => pr({ checks: { failing: 0, pending: 2, passed: 3 }, ...fields });
const failing = (fields = {}) => pr({ checks: { failing: 1, pending: 0, passed: 4 }, ...fields });
const passed = (fields = {}) => pr({ checks: { failing: 0, pending: 0, passed: 5 }, ...fields });

const tmp = () => tempDir('cm-app-merges-');

/**
 * AppMerges over a real store in `dir`, with a GitHub that answers each merge in turn: true is merged,
 * false is something still to wait for, an Error a refusal.
 */
function setup({ dir = tmp(), answers = [true], folders = ['/p/shop'] } = {}) {
  const store = new Store(dir, DEFAULTS);
  const contacts = folders.map((cwd, i) =>
    store.addContact({ provider: 'claude', name: `Claude ${i + 1}`, cwd, model: '', permissionMode: 'default' })
  );
  const merges = [];
  const notes = [];
  const appMerges = new AppMerges({
    store,
    notify: (contact, note) => notes.push([contact.name, note]),
    merge: async (cwd, asked, method) => {
      merges.push({ cwd, number: asked.number, method });
      const answer = answers.length > 1 ? answers.shift() : answers[0];
      if (answer instanceof Error) throw answer;
      return answer;
    },
  });
  return { dir, store, contacts, appMerges, merges, notes };
}

// ---- turning it on and off ---------------------------------------------------------------------------

test('turned on with its checks passed, it is merged at once and nothing is left waiting', async () => {
  const { appMerges, contacts, store, merges } = setup({ answers: [true] });
  assert.equal(await appMerges.start(contacts[0].id, passed(), 'squash'), true);
  assert.deepEqual(merges, [{ cwd: '/p/shop', number: 12, method: 'squash' }]);
  assert.equal(store.getContact(contacts[0].id).mergeWhenPassed, undefined);
  assert.equal(appMerges.of('/p/shop', passed()), null);
});

test('turned on with something still to pass, it is kept with the contact and waits', async () => {
  const { appMerges, contacts, store } = setup({ answers: [false] });
  assert.equal(await appMerges.start(contacts[0].id, running(), 'merge'), false);
  assert.deepEqual(store.getContact(contacts[0].id).mergeWhenPassed, { url: URL, method: 'merge' });
  assert.equal(appMerges.of('/p/shop', running()), 'merge');
});

test('it is still waiting after a restart', async () => {
  const first = setup({ answers: [false] });
  await first.appMerges.start(first.contacts[0].id, running(), 'squash');
  const reloaded = new AppMerges({ store: new Store(first.dir, DEFAULTS), notify() {}, merge: async () => true });
  assert.equal(reloaded.of('/p/shop', running()), 'squash');
});

test('GitHub refusing it at once keeps nothing, and the refusal is for the window to say', async () => {
  const { appMerges, contacts, store, notes } = setup({ answers: [new Error('Your GitHub account may not merge')] });
  await assert.rejects(appMerges.start(contacts[0].id, passed(), 'squash'), /may not merge/);
  assert.equal(store.getContact(contacts[0].id).mergeWhenPassed, undefined);
  assert.deepEqual(notes, [], 'the conversation says it, not a toast');
});

test('turned off, it is not merged when its checks pass', async () => {
  const { appMerges, contacts, merges } = setup({ answers: [false] });
  await appMerges.start(contacts[0].id, running(), 'squash');
  appMerges.stop('/p/shop', running());
  assert.equal(appMerges.of('/p/shop', running()), null);
  assert.equal(await appMerges.heard('/p/shop', passed()), null);
  assert.equal(merges.length, 1, 'only the try when it was turned on');
});

test("only the pull request it was turned on for is the app's to merge", async () => {
  const { appMerges, contacts } = setup({ answers: [false] });
  await appMerges.start(contacts[0].id, running(), 'squash');
  assert.equal(appMerges.of('/p/shop', pr({ number: 13, url: 'https://github.com/acme/shop/pull/13' })), null);
  assert.equal(appMerges.of('/p/other', running()), null);
  assert.equal(appMerges.of('/p/shop', null), null);
});

// ---- what the list hears ------------------------------------------------------------------------------

test('checks that run or fail, or a conflict, ask GitHub nothing', async () => {
  const { appMerges, contacts, merges, notes } = setup({ answers: [false] });
  await appMerges.start(contacts[0].id, running(), 'squash');
  for (const heard of [running(), failing(), passed({ conflict: true })]) {
    assert.equal(await appMerges.heard('/p/shop', heard), null);
  }
  assert.equal(merges.length, 1);
  assert.deepEqual(notes, []);
  assert.equal(appMerges.of('/p/shop', running()), 'squash', 'failing checks keep it waiting for the next push');
});

test('once its checks have all passed it is merged, with a toast, and the list hears it is merged', async () => {
  const { appMerges, contacts, merges, notes } = setup({ answers: [false, true] });
  await appMerges.start(contacts[0].id, running(), 'rebase');
  assert.deepEqual(await appMerges.heard('/p/shop', passed()), { state: 'merged', conflict: undefined });
  assert.deepEqual(merges.at(-1), { cwd: '/p/shop', number: 12, method: 'rebase' });
  assert.deepEqual(notes, [
    ['Claude 1', { title: 'Pull request #12', body: 'Merged pull request #12 now that its checks have passed.' }],
  ]);
  assert.equal(appMerges.of('/p/shop', passed()), null);
});

test('one without any checks is merged on the first look', async () => {
  const { appMerges, contacts, notes } = setup({ answers: [false, true] });
  await appMerges.start(contacts[0].id, pr(), 'squash');
  assert.deepEqual(await appMerges.heard('/p/shop', pr()), { state: 'merged', conflict: undefined });
  assert.equal(notes[0][1].body, 'Merged pull request #12.');
});

test('GitHub still having something to wait for leaves it waiting, without a word', async () => {
  const { appMerges, contacts, notes } = setup({ answers: [false, false] });
  await appMerges.start(contacts[0].id, running(), 'squash');
  assert.equal(await appMerges.heard('/p/shop', passed()), null);
  assert.equal(appMerges.of('/p/shop', passed()), 'squash');
  assert.deepEqual(notes, []);
});

test('GitHub refusing to merge it turns it off, says why in a toast, and the list hears it is off', async () => {
  const { appMerges, contacts, notes } = setup({ answers: [false, new Error('Your GitHub account may not merge.')] });
  await appMerges.start(contacts[0].id, running(), 'squash');
  assert.deepEqual(await appMerges.heard('/p/shop', passed()), {});
  assert.equal(appMerges.of('/p/shop', passed()), null);
  assert.equal(
    notes[0][1].body,
    'Pull request #12 was not merged, so auto-merge is off for it. Your GitHub account may not merge.'
  );
  assert.equal(notes[0][1].title, 'Pull request #12');
});

test('merged or closed elsewhere, a draft again, another one, or none: it is not waited for any more', async () => {
  for (const heard of [
    pr({ state: 'merged' }),
    pr({ state: 'closed' }),
    pr({ state: 'draft' }),
    pr({ number: 13, url: 'https://github.com/acme/shop/pull/13' }),
    null,
  ]) {
    const { appMerges, contacts, merges, notes, store } = setup({ answers: [false] });
    await appMerges.start(contacts[0].id, running(), 'squash');
    assert.equal(await appMerges.heard('/p/shop', heard), null, JSON.stringify(heard));
    assert.equal(store.getContact(contacts[0].id).mergeWhenPassed, undefined, JSON.stringify(heard));
    assert.equal(merges.length, 1, 'nothing more is merged');
    assert.deepEqual(notes, []);
  }
});

test('a folder nobody waits in asks GitHub nothing, and another folder is left alone', async () => {
  const { appMerges, contacts, merges, store } = setup({ answers: [false], folders: ['/p/shop', '/p/site'] });
  await appMerges.start(contacts[0].id, running(), 'squash');
  assert.equal(await appMerges.heard('/p/site', null), null);
  assert.equal(merges.length, 1);
  assert.deepEqual(store.getContact(contacts[0].id).mergeWhenPassed, { url: URL, method: 'squash' });
});

test('two contacts in one folder: it is merged once, and neither waits after', async () => {
  const { appMerges, contacts, merges, store } = setup({
    answers: [false, false, true],
    folders: ['/p/shop', '/p/shop'],
  });
  await appMerges.start(contacts[0].id, running(), 'squash');
  await appMerges.start(contacts[1].id, running(), 'squash');
  assert.deepEqual(await appMerges.heard('/p/shop', passed()), { state: 'merged', conflict: undefined });
  assert.equal(merges.length, 3, 'one try for each turning on, and one merge');
  for (const contact of contacts) assert.equal(store.getContact(contact.id).mergeWhenPassed, undefined);
});

test('heard again while it is being merged, it is not merged twice', async () => {
  let finish;
  const { store, contacts } = setup();
  let calls = 0;
  const appMerges = new AppMerges({
    store,
    notify() {},
    merge: () => {
      calls += 1;
      return calls === 1 ? Promise.resolve(false) : new Promise((resolve) => (finish = resolve));
    },
  });
  await appMerges.start(contacts[0].id, running(), 'squash');
  const first = appMerges.heard('/p/shop', passed());
  assert.equal(await appMerges.heard('/p/shop', passed()), null, 'the second waits for nothing');
  finish(true);
  assert.deepEqual(await first, { state: 'merged', conflict: undefined });
  assert.equal(calls, 2);
});
