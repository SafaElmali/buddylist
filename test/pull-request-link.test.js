// Linking a pull request to a conversation by hand: which ones can be linked, and how a linked one is shown, kept
// across restarts, switched with the branch's own and taken away. GitHub is a stand-in everywhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pullRequestToLink, LINK_HELP } from '../src/main/pull-request-link.js';
import { PullRequests } from '../src/main/pull-requests.js';
import { Store } from '../src/main/storage/store.js';
import { tempDir } from './fixtures/temp-dir.js';

const SHOP = 'https://github.com/example/shop';
const gh = (number, fields = {}) =>
  JSON.stringify({
    number,
    url: `${SHOP}/pull/${number}`,
    title: `Pull request ${number}`,
    state: 'OPEN',
    isDraft: false,
    headRefName: `branch-${number}`,
    headRepository: { name: 'shop', nameWithOwner: 'example/shop' },
    headRepositoryOwner: { login: 'example' },
    isCrossRepository: false,
    ...fields,
  });
const failed = (stderr, fields = {}) => Object.assign(new Error('Command failed: gh pr view'), { stderr, ...fields });

// ---- which pull request can be linked ---------------------------------------------------------------------

function folder(t) {
  const cwd = tempDir('link-pr-');
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  return cwd;
}
const context =
  (repositories = ['github.com/example/shop']) =>
  async () => ({ scope: { repositories } });

test('a number, #number or a link to any tab of its page names the pull request to link', async (t) => {
  const cwd = folder(t);
  const asked = [];
  const run = async (_cwd, ref) => {
    asked.push(ref);
    return gh(45);
  };
  for (const text of ['45', '#45', `${SHOP}/pull/45/files`, 'github.com/example/shop/pull/45', `${SHOP}/issues/45`]) {
    const pr = await pullRequestToLink(cwd, text, { run, context: context() });
    assert.equal(pr.number, 45);
    assert.equal(pr.url, `${SHOP}/pull/45`);
  }
  assert.deepEqual(asked, ['45', '45', `${SHOP}/pull/45`, `${SHOP}/pull/45`, `${SHOP}/pull/45`]);
});

test('anything else is refused with what to give instead', async (t) => {
  const cwd = folder(t);
  for (const text of ['', 'the cart one', '#0', 'https://example.com/']) {
    await assert.rejects(pullRequestToLink(cwd, text, { run: async () => gh(1), context: context() }), {
      message: LINK_HELP,
    });
  }
});

test('only a pull request of the conversation’s repository, or of a fork among its remotes, is linked', async (t) => {
  const cwd = folder(t);
  const other = gh(9, {
    url: 'https://github.com/someone/else/pull/9',
    headRepository: { name: 'else', nameWithOwner: 'someone/else' },
    headRepositoryOwner: { login: 'someone' },
  });
  await assert.rejects(
    pullRequestToLink(cwd, 'https://github.com/someone/else/pull/9', { run: async () => other, context: context() }),
    { message: '#9 is a pull request of someone/else, but this conversation works on example/shop.' }
  );
  // A fork's checkout: the pull request is the upstream's, its branch is in the fork the checkout pushes to.
  const fromFork = gh(12, {
    url: 'https://github.com/upstream/shop/pull/12',
    headRepository: { name: 'shop', nameWithOwner: 'example/shop' },
    headRepositoryOwner: { login: 'example' },
    isCrossRepository: true,
  });
  const pr = await pullRequestToLink(cwd, 'https://github.com/upstream/shop/pull/12', {
    run: async () => fromFork,
    context: context(),
  });
  assert.equal(pr.url, 'https://github.com/upstream/shop/pull/12');
  // The upstream itself among the remotes is enough too.
  const upstream = await pullRequestToLink(cwd, '#12', {
    run: async () => fromFork,
    context: context(['github.com/upstream/shop']),
  });
  assert.equal(upstream.number, 12);
});

test('an issue, a missing number, a folder without git and a gh that can’t answer each say why', async (t) => {
  const cwd = folder(t);
  const missing = failed('GraphQL: Could not resolve to a PullRequest with the number of 3. (repository.pullRequest)');
  await assert.rejects(
    pullRequestToLink(cwd, '#3', {
      run: async () => {
        throw missing;
      },
      context: context(),
    }),
    { message: 'There is no pull request #3 in example/shop.' }
  );
  await assert.rejects(pullRequestToLink(cwd, '#3', { run: async () => null, context: context() }), {
    message: 'There is no pull request #3 in example/shop.',
  });
  await assert.rejects(
    pullRequestToLink(cwd, '#3', {
      run: async () => {
        throw failed('', { code: 4 });
      },
      context: context(),
    }),
    /not signed in/
  );
  await assert.rejects(
    pullRequestToLink(cwd, '#3', {
      run: async () => gh(3),
      context: async () => {
        throw new Error('fatal: not a git repository');
      },
    }),
    { message: 'This conversation’s folder is not a git repository, so it has no pull request.' }
  );
  await assert.rejects(pullRequestToLink(cwd, '#3', { run: async () => gh(3), context: context([]) }), {
    message: 'This conversation’s folder has no remote on GitHub.',
  });
  await assert.rejects(
    pullRequestToLink(path.join(cwd, 'gone'), '#3', { run: async () => gh(3), context: context() }),
    {
      message: 'The folder of this conversation is gone.',
    }
  );
});

// ---- how a linked pull request is shown -------------------------------------------------------------------

const pr = (number, fields = {}) => ({
  number,
  url: `${SHOP}/pull/${number}`,
  title: `Pull request ${number}`,
  state: 'open',
  ...fields,
});
const worker = { id: 'worker', name: 'Claude (cart-total)', cwd: '/p/cart', provider: 'claude' };

/** A PullRequests whose branch answers and linked answers are set by the test; `kept` is what is saved. */
function watcher({ branch = null, linked = {}, kept = null, ...opts } = {}) {
  const state = { branch, linked, kept, merged: [], notes: [], asked: [] };
  const prs = new PullRequests({
    contacts: () => [worker],
    exists: () => true,
    ask: async () => {
      if (state.branch instanceof Error) throw state.branch;
      return state.branch;
    },
    askLink: async (_cwd, url) => {
      state.asked.push(url);
      const answer = state.linked[url];
      if (answer instanceof Error || answer === undefined) throw answer ?? new Error('offline');
      return answer;
    },
    loadLink: () => state.kept,
    saveLink: (_cwd, link) => {
      state.kept = link;
    },
    onChange() {},
    notify: (_contact, note) => state.notes.push(note),
    onMerged: (cwd) => state.merged.push(cwd),
    ...opts,
  });
  return { prs, state };
}

test('a linked pull request is shown as the branch’s would be, marked as linked, and kept', async () => {
  const { prs, state } = watcher();
  await prs.look(worker.cwd);
  assert.equal(prs.of(worker), null, 'no branch PR: nothing shown');
  const shown = prs.link(worker.cwd, pr(45, { checks: { failing: 1, pending: 0, passed: 8 } }));
  assert.equal(shown.number, 45);
  assert.equal(shown.linked, true);
  assert.deepEqual(state.kept, { pr: pr(45, { checks: { failing: 1, pending: 0, passed: 8 } }) });
  // The next look asks GitHub about it by its page, and keeps how it stands now.
  state.linked[`${SHOP}/pull/45`] = pr(45, { checks: { failing: 0, pending: 0, passed: 9 } });
  await prs.look(worker.cwd);
  assert.deepEqual(prs.of(worker).checks, { failing: 0, pending: 0, passed: 9 });
  assert.deepEqual(state.kept.pr.checks, { failing: 0, pending: 0, passed: 9 });
  assert.deepEqual(state.asked, [`${SHOP}/pull/45`]);
});

test('a link survives a restart, and shows how it last stood while GitHub is out of reach', async () => {
  const kept = { pr: pr(45, { state: 'draft' }) };
  const { prs } = watcher({ kept });
  assert.equal(prs.of(worker), null, 'nothing until the first look');
  await prs.look(worker.cwd);
  assert.equal(prs.of(worker).number, 45);
  assert.equal(prs.of(worker).state, 'draft');
  assert.equal(prs.of(worker).linked, true);
});

test('where the branch has a pull request of its own, the linked one is shown and says so, until switched', async () => {
  const { prs, state } = watcher({ branch: pr(48), kept: { pr: pr(45) } });
  state.linked[`${SHOP}/pull/45`] = pr(45);
  await prs.look(worker.cwd);
  assert.equal(prs.of(worker).number, 45);
  assert.deepEqual(prs.of(worker).other, { number: 48 });
  prs.show(worker.cwd, 'branch');
  assert.equal(prs.of(worker).number, 48);
  assert.equal(prs.of(worker).linked, undefined);
  assert.deepEqual(prs.of(worker).other, { number: 45, linked: true });
  assert.equal(state.kept.show, 'branch', 'the choice is kept');
  prs.show(worker.cwd, 'linked');
  assert.equal(prs.of(worker).number, 45);
  assert.equal(state.kept.show, undefined);
});

test('linking the pull request the branch found already shows it once, as linked', async () => {
  const { prs, state } = watcher({ branch: pr(45) });
  await prs.look(worker.cwd);
  prs.link(worker.cwd, pr(45));
  state.linked[`${SHOP}/pull/45`] = pr(45);
  await prs.look(worker.cwd);
  assert.equal(prs.of(worker).linked, true);
  assert.equal(prs.of(worker).other, undefined);
});

test('unlinking shows the branch’s own again, or nothing, and forgets the link', async () => {
  const { prs, state } = watcher({ branch: pr(48), kept: { pr: pr(45) } });
  state.linked[`${SHOP}/pull/45`] = pr(45);
  await prs.look(worker.cwd);
  assert.equal(prs.unlink(worker.cwd).number, 48);
  assert.equal(state.kept, null);
  state.branch = null;
  await prs.look(worker.cwd);
  assert.equal(prs.of(worker), null);
});

test('showing a linked pull request that is merged already is no news: nobody is archived', async () => {
  const { prs, state } = watcher({ branch: pr(48) });
  await prs.look(worker.cwd);
  prs.link(worker.cwd, pr(45, { state: 'merged' }));
  state.linked[`${SHOP}/pull/45`] = pr(45, { state: 'merged' });
  await prs.look(worker.cwd);
  prs.unlink(worker.cwd);
  prs.link(worker.cwd, pr(45, { state: 'merged' }));
  await prs.look(worker.cwd);
  assert.deepEqual(state.merged, []);
  assert.deepEqual(state.notes, []);
});

test('a linked pull request merged while it is shown archives as a branch’s would, once', async () => {
  const { prs, state } = watcher();
  await prs.look(worker.cwd);
  prs.link(worker.cwd, pr(45, { checks: { failing: 0, pending: 2, passed: 7 } }));
  state.linked[`${SHOP}/pull/45`] = pr(45, { checks: { failing: 1, pending: 0, passed: 8 } });
  await prs.look(worker.cwd);
  assert.deepEqual(
    state.notes.map((note) => note.title),
    ['Pull request #45'],
    'its checks are news'
  );
  state.linked[`${SHOP}/pull/45`] = pr(45, { state: 'merged' });
  await prs.look(worker.cwd);
  await prs.look(worker.cwd);
  assert.deepEqual(state.merged, [worker.cwd]);
});

test('a branch pull request turning up beside the linked one switches nothing and announces nothing', async () => {
  const { prs, state } = watcher({ kept: { pr: pr(45), show: 'branch' } });
  state.linked[`${SHOP}/pull/45`] = pr(45);
  await prs.look(worker.cwd);
  assert.equal(prs.of(worker).number, 45, 'with no branch PR, the linked one is shown');
  state.branch = pr(48, { state: 'merged' });
  await prs.look(worker.cwd);
  assert.equal(prs.of(worker).number, 48);
  assert.deepEqual(state.merged, [], 'another one shown is not a merge of the one before');
});

test('Continue to a new branch takes the link away with the branch’s pull request', async () => {
  const { prs, state } = watcher({ kept: { pr: pr(45, { state: 'merged' }) } });
  state.linked[`${SHOP}/pull/45`] = pr(45, { state: 'merged' });
  await prs.look(worker.cwd);
  prs.startedOver(worker.cwd);
  assert.equal(prs.of(worker), null);
  assert.equal(state.kept, null);
});

test('what the app changes on a linked pull request, as auto-merge, is shown at once and kept', async () => {
  const { prs, state } = watcher({ kept: { pr: pr(45) } });
  state.linked[`${SHOP}/pull/45`] = pr(45);
  await prs.look(worker.cwd);
  prs.changed(worker.cwd, { autoMerge: 'squash' });
  assert.equal(prs.of(worker).autoMerge, 'squash');
  assert.equal(prs.of(worker).linked, true);
  assert.equal(state.kept.pr.autoMerge, 'squash');
  assert.equal(state.kept.pr.linked, undefined, 'what is worked out each time is not kept');
});

test('a link is kept with every contact of the folder in the store, and read back after a restart', async (t) => {
  const profile = tempDir('link-pr-store-');
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
  let store = new Store(profile, { defaultProvider: 'claude' });
  const fields = { provider: 'claude', cwd: '/p/cart', model: '', permissionMode: 'default' };
  const one = store.addContact({ ...fields, name: 'one' });
  const two = store.addContact({ ...fields, name: 'two' });
  const make = () =>
    new PullRequests({
      contacts: () => store.contacts,
      exists: () => true,
      ask: async () => null,
      askLink: async () => {
        throw new Error('offline');
      },
      loadLink: (cwd) => store.contacts.find((c) => c.cwd === cwd && c.pullRequestLink)?.pullRequestLink ?? null,
      saveLink: (cwd, link) => {
        for (const c of store.contacts)
          if (c.cwd === cwd) store.updateContact(c.id, { pullRequestLink: link ?? undefined });
      },
      onChange() {},
      notify() {},
    });
  make().link('/p/cart', pr(45));
  store.flush?.();
  store = new Store(profile, { defaultProvider: 'claude' });
  assert.equal(store.getContact(one.id).pullRequestLink.pr.number, 45);
  assert.equal(store.getContact(two.id).pullRequestLink.pr.number, 45);
  const prs = make();
  await prs.look('/p/cart');
  assert.equal(prs.of(store.getContact(two.id)).number, 45);
  prs.unlink('/p/cart');
  store.flush?.();
  store = new Store(profile, { defaultProvider: 'claude' });
  assert.equal(store.getContact(one.id).pullRequestLink, undefined);
});

test('a linked folder’s rounds ask about the linked one each round, and about its branch at the branch’s pace', async () => {
  let time = 1_000_000;
  let branchAsks = 0;
  const { prs, state } = watcher({
    kept: { pr: pr(45) },
    now: () => time,
    ask: async () => {
      branchAsks += 1;
      return null;
    },
  });
  state.linked[`${SHOP}/pull/45`] = pr(45);
  await prs.check();
  time += 60 * 1000;
  await prs.check();
  assert.equal(state.asked.length, 2, 'the linked one, still open, every round');
  assert.equal(branchAsks, 1, 'a branch with no pull request of its own waits out its quiet pace');
  time += 15 * 60 * 1000;
  await prs.check();
  assert.equal(branchAsks, 2);
  // Someone looking, as the hover card does, asks about both at once.
  await prs.look(worker.cwd);
  assert.equal(branchAsks, 3);
});
