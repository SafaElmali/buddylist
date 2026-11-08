import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { forgetPullRequest, pullRequest } from '../src/main/contact-card.js';
import { Conversations } from '../src/main/conversations.js';
import { PullRequests } from '../src/main/pull-requests.js';
import { pullRequestSize, pullRequestTags } from '../src/shared/pull-request-text.js';
import { Store } from '../src/main/storage/store.js';
import { History } from '../src/main/storage/history.js';
import { contactLabel } from '../src/main/tray.js';
import { descriptor as claude } from '../src/providers/claude/index.js';
import { associatedPullRequest, forgetPullRequestAssociation } from '../src/main/pull-request-association.js';
import { commit, HAS_GIT, run as gitRun, tmp as gitTmp } from './fixtures/pull-requests.js';
import { tempDir } from './fixtures/temp-dir.js';

const MINUTE = 60 * 1000;

test(
  'verified association survives Store reload, detached cleanup and offline restart; Continue clears it durably',
  { skip: !HAS_GIT },
  async (t) => {
    const root = gitTmp();
    const cwd = path.join(root, 'repo');
    const profile = path.join(root, 'profile');
    fs.mkdirSync(cwd);
    t.after(() => {
      forgetPullRequestAssociation(cwd);
      fs.rmSync(root, { recursive: true, force: true });
    });
    gitRun(cwd, 'init', '--quiet', '-b', 'feature');
    const head = commit(cwd);
    gitRun(cwd, 'remote', 'add', 'origin', 'https://github.com/you/project.git');
    let store = new Store(profile, { defaultProvider: 'claude' });
    const worker = store.addContact({ provider: 'claude', name: 'worker', cwd, model: '', permissionMode: 'default' });
    let state = 'OPEN';
    let offline = false;
    const make = () =>
      new PullRequests({
        contacts: () => store.contacts,
        load: () => store.getContact(worker.id).pullRequestAssociation,
        save: (_cwd, record) => store.updateContact(worker.id, { pullRequestAssociation: record }),
        resolve: (dir, record) =>
          associatedPullRequest(dir, record, {
            run: async () => {
              if (offline) throw new Error('offline');
              return JSON.stringify({
                number: 12,
                url: 'https://github.com/you/project/pull/12',
                state,
                headRefName: 'feature',
                headRefOid: head,
                closedAt: state === 'MERGED' ? '2100-01-01T00:00:00Z' : null,
              });
            },
          }),
        onChange() {},
        notify() {},
        onMerged: () => assert.fail('restoring a status must not archive a contact'),
      });
    let prs = make();
    await prs.look(cwd);
    assert.equal(prs.of(worker).state, 'open');
    gitRun(cwd, 'checkout', '--quiet', '--detach', head);
    gitRun(cwd, 'branch', '-D', 'feature');
    state = 'MERGED';
    forgetPullRequestAssociation(cwd);
    store = new Store(profile, { defaultProvider: 'claude' });
    prs = make();
    assert.equal(prs.of(worker), null, 'saved evidence waits for checkout validation');
    await prs.look(cwd);
    assert.equal(prs.of(worker).state, 'merged');
    assert.equal(store.getContact(worker.id).pullRequestAssociation.pr.state, 'merged');
    offline = true;
    forgetPullRequestAssociation(cwd);
    store = new Store(profile, { defaultProvider: 'claude' });
    prs = make();
    await prs.look(cwd);
    assert.equal(prs.of(worker).state, 'merged', 'verified snapshot survives a temporary GitHub failure');
    gitRun(cwd, 'checkout', '--quiet', '-b', 'next-task');
    prs.startedOver(cwd);
    assert.equal(prs.of(worker), null);
    store = new Store(profile, { defaultProvider: 'claude' });
    assert.equal(store.getContact(worker.id).pullRequestAssociation.reset, true);
    prs = make();
    await prs.look(cwd);
    assert.equal(prs.of(worker), null, 'Continue cannot recover the old badge offline after restart');
  }
);

test('an uncertain checkout hides the badge without erasing durable evidence', async () => {
  const record = { scope: { dir: '/p/a' }, pr: pr({ state: 'merged' }) };
  let saved;
  const prs = new PullRequests({
    contacts: () => [contact('worker', '/p/a')],
    load: () => record,
    save: (_cwd, value) => {
      saved = value;
    },
    resolve: async () => ({ pr: null, record }),
    onChange() {},
    notify() {},
  });
  assert.equal(await prs.look('/p/a'), null);
  assert.deepEqual(saved, record);
});

test('recovering an already-merged PR updates the row without archiving the worker', async () => {
  let answer = { pr: null, record: null };
  const prs = new PullRequests({
    contacts: () => [contact('worker', '/p/a')],
    resolve: async () => answer,
    onChange() {},
    notify() {
      assert.fail('historical recovery is not news');
    },
    onMerged() {
      assert.fail('historical recovery must not archive');
    },
  });
  await prs.look('/p/a');
  answer = { pr: pr({ state: 'merged' }), record: { pr: pr({ state: 'merged' }) }, recovered: true };
  assert.equal((await prs.look('/p/a')).state, 'merged');
});

test('a late resolver answer cannot persist over Continue or an authoritative merge', async () => {
  const answers = [];
  let saved;
  const prs = new PullRequests({
    contacts: () => [contact('worker', '/p/a')],
    save: (_cwd, record) => {
      saved = record;
    },
    resolve: () => new Promise((resolve) => answers.push(resolve)),
    onChange() {},
    notify() {},
  });
  const looking = prs.look('/p/a');
  prs.startedOver('/p/a');
  answers.shift()({ pr: pr({ state: 'merged' }), record: { pr: pr({ state: 'merged' }) } });
  assert.equal(await looking, null);
  assert.equal(saved.reset, true);
  const fresh = prs.look('/p/a');
  answers.shift()({ pr: pr(), record: { pr: pr() } });
  await fresh;
  const stale = prs.look('/p/a');
  prs.changed('/p/a', { state: 'merged' });
  answers.shift()({ pr: pr(), record: { pr: pr() } });
  assert.equal((await stale).state, 'merged');
  assert.equal(saved.pr.state, 'merged');
});

test('out-of-order looks persist only the newest accepted answer', async () => {
  const answers = [];
  const saved = [];
  const prs = new PullRequests({
    contacts: () => [contact('worker', '/p/a')],
    save: (_cwd, record) => saved.push(record),
    resolve: () => new Promise((resolve) => answers.push(resolve)),
    onChange() {},
    notify() {},
  });
  const first = prs.look('/p/a');
  const second = prs.look('/p/a');
  answers[1]({ pr: pr({ state: 'merged' }), record: { pr: pr({ state: 'merged' }) } });
  await second;
  answers[0]({ pr: pr(), record: { pr: pr() } });
  assert.equal((await first).state, 'merged');
  assert.equal(saved.length, 1);
  assert.equal(saved[0].pr.state, 'merged');
});

const pr = (fields = {}) => ({
  number: 12,
  url: 'https://github.com/you/project/pull/12',
  title: 'Add a hover card',
  state: 'open',
  ...fields,
});
const failing = (count = 2, fields = {}) => pr({ checks: { failing: count, pending: 0, passed: 7 }, ...fields });
const running = (fields = {}) => pr({ checks: { failing: 0, pending: 4, passed: 3 }, ...fields });
const passed = (fields = {}) => pr({ checks: { failing: 0, pending: 0, passed: 9 }, ...fields });
const signedOut = () => Object.assign(new Error('Command failed: gh pr view'), { code: 4 });

const contact = (name, cwd, fields = {}) => ({ id: name, name, cwd, provider: 'claude', ...fields });

/**
 * A PullRequests whose GitHub gives each folder its queued answers in turn, and the last
 * one again after that. An Error is gh failing. `round()` is the timer firing a minute on.
 */
function setup(answers = {}, { contacts = [contact('Claude', '/p/a')], gone = [], ...opts } = {}) {
  const asked = [];
  const notes = [];
  const clock = { time: 1_000_000 };
  let changes = 0;
  const prs = new PullRequests({
    contacts: () => contacts,
    exists: (cwd) => !gone.includes(cwd),
    now: () => clock.time,
    ask: async (cwd) => {
      asked.push(cwd);
      const queue = answers[cwd] || [null];
      const answer = queue.length > 1 ? queue.shift() : queue[0];
      if (answer instanceof Error) throw answer;
      return answer;
    },
    onChange: () => {
      changes += 1;
    },
    notify: (who, note) => notes.push([who.name, note]),
    ...opts,
  });
  const round = async (ms = MINUTE) => {
    clock.time += ms;
    await prs.check();
  };
  return { prs, asked, notes, contacts, gone, clock, round, changes: () => changes };
}

/** Everything a test started that is still on its way. */
const settled = () => new Promise((resolve) => setImmediate(resolve));

// ---- who is asked about -----------------------------------------------------------------------

test('what GitHub says about a contact is there to read, without waiting, once it has answered', async () => {
  const claudeA = contact('Claude', '/p/a');
  const { prs, round, asked } = setup({ '/p/a': [failing()] }, { contacts: [claudeA] });
  assert.equal(prs.of(claudeA), null, 'nothing is known before the first look');
  await round();
  assert.deepEqual(asked, ['/p/a']);
  assert.deepEqual(prs.of(claudeA), failing());
});

test('two contacts in one folder: GitHub is asked once, and both read the answer', async () => {
  const contacts = [contact('Claude', '/p/api'), contact('Codex', '/p/api'), contact('Opus', '/p/site')];
  const { prs, round, asked } = setup({ '/p/api': [running()], '/p/site': [null] }, { contacts });
  await round();
  assert.deepEqual(asked, ['/p/api', '/p/site']);
  assert.deepEqual(prs.of(contacts[0]), running());
  assert.deepEqual(prs.of(contacts[1]), running());
  assert.equal(prs.of(contacts[2]), null);
});

test('a contact whose folder is gone is not asked about', async () => {
  const contacts = [contact('Claude', '/p/a'), contact('Old', '/p/deleted')];
  const { prs, round, asked } = setup({ '/p/deleted': [failing()] }, { contacts, gone: ['/p/deleted'] });
  await round();
  assert.deepEqual(asked, ['/p/a']);
  assert.equal(prs.of(contacts[1]), null);
});

test('an archived contact is not asked about, unless someone else still works in its folder', async () => {
  const contacts = [
    contact('Put away', '/p/old', { archived: true }),
    contact('Also put away', '/p/shared', { archived: true }),
    contact('Claude', '/p/shared'),
  ];
  const { round, asked } = setup({}, { contacts });
  await round();
  assert.deepEqual(asked, ['/p/shared']);
});

test('a contact without a folder is passed over', async () => {
  const contacts = [contact('Nowhere', ''), contact('Nowhere either', undefined), contact('Claude', '/p/a')];
  const { round, asked } = setup({}, { contacts });
  await round();
  assert.deepEqual(asked, ['/p/a']);
});

test('a folder nobody works in any more is forgotten', async () => {
  const claudeA = contact('Claude', '/p/a');
  const app = setup({ '/p/a': [failing()] }, { contacts: [claudeA] });
  await app.round();
  assert.deepEqual(app.prs.of(claudeA), failing());
  app.gone.push('/p/a');
  await app.round();
  assert.equal(app.prs.of(claudeA), null, 'its folder went away');
  app.gone.pop();
  app.contacts.pop();
  await app.round();
  assert.equal(app.prs.of(claudeA), null, 'the contact was deleted');
  assert.deepEqual(app.notes, []);
});

// ---- telling the windows ----------------------------------------------------------------------

test('the windows are told when what a contact shows has changed, and only then', async () => {
  const { round, changes } = setup({ '/p/a': [null, running(), running(), passed(), null] });
  await round();
  assert.equal(changes(), 0, 'no pull request is what the list showed already');
  await round(15 * MINUTE);
  assert.equal(changes(), 1, 'a pull request turned up');
  await round();
  assert.equal(changes(), 1);
  await round();
  assert.equal(changes(), 2, 'its checks passed');
  await round(5 * MINUTE);
  assert.equal(changes(), 3, 'the branch has none any more');
});

// ---- telling the user -------------------------------------------------------------------------

test('the first look raises no toast, whatever it finds', async () => {
  const contacts = [contact('Claude', '/p/a'), contact('Codex', '/p/b'), contact('Opus', '/p/c')];
  const { round, notes, changes } = setup(
    { '/p/a': [failing()], '/p/b': [passed()], '/p/c': [running()] },
    { contacts }
  );
  await round();
  assert.deepEqual(notes, [], 'no burst of toasts when the app starts');
  assert.equal(changes(), 3, 'the list still shows them');
});

test('checks that start failing raise one toast, for the contact, and no more while they keep failing', async () => {
  const { round, notes } = setup({ '/p/a': [running(), failing(2), failing(2), failing(3)] });
  await round();
  assert.deepEqual(notes, []);
  await round();
  assert.deepEqual(notes, [['Claude', { title: 'Pull request #12', body: '2 checks failing on pull request #12' }]]);
  await round(5 * MINUTE);
  await round(5 * MINUTE);
  assert.equal(notes.length, 1, 'still failing, and one more failing, are the same news');
});

test('one failing check is worded as one', async () => {
  const { round, notes } = setup({ '/p/a': [passed(), failing(1)] });
  await round();
  await round(5 * MINUTE);
  assert.equal(notes[0][1].body, '1 check failing on pull request #12');
});

test('failing, then passed: one more toast', async () => {
  const { round, notes } = setup({ '/p/a': [running(), failing(), passed(), passed()] });
  await round();
  await round();
  await round(5 * MINUTE);
  await round(5 * MINUTE);
  assert.deepEqual(
    notes.map(([, note]) => note.body),
    ['2 checks failing on pull request #12', 'All 9 checks passed on pull request #12']
  );
});

test('running, then passed: a toast; passed at first sight: none', async () => {
  const contacts = [contact('Claude', '/p/a'), contact('Codex', '/p/b')];
  const { round, notes } = setup({ '/p/a': [running(), passed()], '/p/b': [null, passed()] }, { contacts });
  await round();
  await round(15 * MINUTE);
  assert.deepEqual(notes, [['Claude', { title: 'Pull request #12', body: 'All 9 checks passed on pull request #12' }]]);
});

test('a pull request opened since the last look, already failing, is news', async () => {
  const { round, notes } = setup({ '/p/a': [null, failing(3)] });
  await round();
  await round(15 * MINUTE);
  assert.equal(notes.length, 1);
  assert.equal(notes[0][1].body, '3 checks failing on pull request #12');
});

test('a run that fails again after a new push is news again', async () => {
  const { round, notes } = setup({ '/p/a': [failing(), running(), failing(), running(), passed()] });
  await round();
  assert.deepEqual(notes, [], 'failing when the app started');
  await round(5 * MINUTE);
  await round();
  assert.equal(notes.length, 1);
  await round(5 * MINUTE);
  await round();
  assert.deepEqual(
    notes.map(([, note]) => note.body),
    ['2 checks failing on pull request #12', 'All 9 checks passed on pull request #12']
  );
});

test('merging or closing a pull request raises no toast, whatever its checks said', async () => {
  const contacts = [contact('Claude', '/p/a'), contact('Codex', '/p/b')];
  const answers = {
    '/p/a': [running(), passed({ state: 'merged' })],
    '/p/b': [passed(), failing(2, { state: 'closed' })],
  };
  const { round, notes } = setup(answers, { contacts });
  await round();
  await round(5 * MINUTE);
  assert.deepEqual(notes, []);
});

test('a pull request seen being merged is told, once, for its folder', async () => {
  const merged = [];
  const contacts = [contact('Claude', '/p/a'), contact('Codex', '/p/b')];
  const answers = { '/p/a': [running(), passed({ state: 'merged' })], '/p/b': [passed()] };
  const { round } = setup(answers, { contacts, onMerged: (cwd) => merged.push(cwd) });
  await round();
  assert.deepEqual(merged, [], 'open at the first look');
  await round();
  assert.deepEqual(merged, ['/p/a']);
  await round(15 * MINUTE);
  assert.deepEqual(merged, ['/p/a'], 'still merged is no news');
});

test('a pull request opened and merged between two looks is told too', async () => {
  const merged = [];
  const { round } = setup({ '/p/a': [null, pr({ state: 'merged' })] }, { onMerged: (cwd) => merged.push(cwd) });
  await round();
  await round(15 * MINUTE);
  assert.deepEqual(merged, ['/p/a']);
});

test('merged at the first look is how things were, not a merge; closed is no merge', async () => {
  const merged = [];
  const contacts = [contact('Claude', '/p/a'), contact('Codex', '/p/b')];
  const answers = { '/p/a': [pr({ state: 'merged' })], '/p/b': [pr(), pr({ state: 'closed' })] };
  const { round } = setup(answers, { contacts, onMerged: (cwd) => merged.push(cwd) });
  await round();
  await round(15 * MINUTE);
  assert.deepEqual(merged, []);
});

test('a contact brought back from the archive is not told of the merge again', async () => {
  const merged = [];
  const contacts = [contact('Claude', '/p/a')];
  const { round } = setup(
    { '/p/a': [pr(), pr({ state: 'merged' })] },
    { contacts, onMerged: (cwd) => merged.push(cwd) }
  );
  await round();
  await round(5 * MINUTE);
  assert.deepEqual(merged, ['/p/a']);
  contacts[0].archived = true;
  await round();
  // Restored: its folder is looked at afresh, and merged at the first look is how things are.
  contacts[0].archived = false;
  await round();
  await round(15 * MINUTE);
  assert.deepEqual(merged, ['/p/a']);
});

test('the toast is for the first contact in the folder that is not archived', async () => {
  const contacts = [
    contact('Put away', '/p/api', { archived: true }),
    contact('Claude', '/p/api'),
    contact('Codex', '/p/api'),
  ];
  const { round, notes } = setup({ '/p/api': [running(), failing()] }, { contacts });
  await round();
  await round();
  assert.deepEqual(
    notes.map(([name]) => name),
    ['Claude'],
    'one pull request, one toast'
  );
});

test('group check alerts name the pull request and still open the host conversation', async () => {
  const codex = contact('Codex', '/p/elsewhere', { provider: 'codex' });
  const host = contact('Claude (global-hotkey)', '/p/api', { guests: [{ id: codex.id }] });
  const notes = [];
  const { round } = setup(
    { '/p/api': [running(), failing(1), passed()] },
    {
      contacts: [host, codex],
      notify: (who, note) => notes.push({ ...note, opens: who.id }),
    }
  );
  await round();
  await round();
  await round();
  assert.deepEqual(notes, [
    { title: 'Pull request #12', body: '1 check failing on pull request #12', opens: host.id },
    { title: 'Pull request #12', body: 'All 9 checks passed on pull request #12', opens: host.id },
  ]);
});

// ---- when gh cannot tell ----------------------------------------------------------------------

test('with gh missing or signed out nothing is shown, nothing is said and nothing breaks', async () => {
  const missing = Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' });
  const contacts = [contact('Claude', '/p/a'), contact('Codex', '/p/b')];
  const { prs, round, notes, changes, asked } = setup({ '/p/a': [missing], '/p/b': [signedOut()] }, { contacts });
  await round();
  await round();
  assert.equal(prs.of(contacts[0]), null);
  assert.equal(prs.of(contacts[1]), null);
  assert.deepEqual(notes, []);
  assert.equal(changes(), 0);
  assert.deepEqual(asked, ['/p/a', '/p/b'], 'and it is not asked over and over');
});

test('a look that times out leaves what was known standing, so nothing is said twice', async () => {
  const timedOut = Object.assign(new Error('Command failed: gh pr view'), { killed: true, signal: 'SIGTERM' });
  const claudeA = contact('Claude', '/p/a');
  const { prs, round, notes, changes } = setup(
    { '/p/a': [running(), failing(), timedOut, failing(), timedOut, passed()] },
    { contacts: [claudeA] }
  );
  await round();
  await round();
  assert.equal(notes.length, 1);
  await round(5 * MINUTE);
  assert.deepEqual(prs.of(claudeA), failing(), 'the line does not flicker over a hiccup');
  await round(5 * MINUTE);
  assert.equal(notes.length, 1, 'failing before the hiccup and after it: not news');
  await round(5 * MINUTE);
  await round(5 * MINUTE);
  assert.deepEqual(
    notes.map(([, note]) => note.body),
    ['2 checks failing on pull request #12', 'All 9 checks passed on pull request #12']
  );
  assert.equal(changes(), 3, 'found, failing, passed');
});

test('when gh works again, the first answer is a first look: no toast', async () => {
  const { round, notes } = setup({ '/p/a': [signedOut(), signedOut(), failing()] });
  await round();
  await round(15 * MINUTE);
  await round(15 * MINUTE);
  assert.deepEqual(notes, []);
});

// ---- how often --------------------------------------------------------------------------------

test('once GitHub can be asked, as after signing in, every folder is asked again without waiting its turn', async () => {
  const contacts = [contact('Claude', '/p/a'), contact('Codex', '/p/b')];
  const { prs, round, asked, notes } = setup(
    { '/p/a': [signedOut(), failing()], '/p/b': [signedOut(), null] },
    { contacts }
  );
  await round();
  await round();
  assert.deepEqual(asked, ['/p/a', '/p/b'], 'an answer that never came is not asked for again every minute');
  await prs.lookAgain();
  assert.deepEqual(asked, ['/p/a', '/p/b', '/p/a', '/p/b']);
  assert.deepEqual(prs.of(contacts[0]), failing());
  assert.deepEqual(notes, [], 'the first answer is how things are, not something that happened');
});

test('while checks run, every round asks', async () => {
  const { round, asked } = setup({ '/p/a': [running()] });
  for (let i = 0; i < 4; i += 1) await round();
  assert.equal(asked.length, 4);
});

test('a pull request still to be merged is asked about on every round, with nothing running too', async () => {
  for (const answer of [passed(), failing(), pr(), failing(1, { state: 'draft' }), pr({ state: 'draft' })]) {
    const { round, asked } = setup({ '/p/a': [answer] });
    for (let i = 0; i < 4; i += 1) await round();
    assert.equal(asked.length, 4, answer.state);
  }
});

test('a pull request merged on GitHub after its checks passed shows as merged on the next round', async () => {
  const merged = [];
  const claudeA = contact('Claude', '/p/a');
  const { prs, round, changes } = setup(
    { '/p/a': [passed(), passed({ state: 'merged' })] },
    { contacts: [claudeA], onMerged: (cwd) => merged.push(cwd) }
  );
  await round();
  assert.equal(prs.of(claudeA).state, 'open');
  await round();
  assert.equal(prs.of(claudeA).state, 'merged', 'a minute on, not five');
  assert.deepEqual(merged, ['/p/a']);
  assert.equal(changes(), 2, 'and the list hears of it');
});

test('no pull request, or one that is merged or closed, is asked about every quarter of an hour', async () => {
  for (const answer of [null, passed({ state: 'merged' }), running({ state: 'closed' })]) {
    const { round, asked } = setup({ '/p/a': [answer] });
    await round();
    for (let i = 0; i < 14; i += 1) await round();
    assert.equal(asked.length, 1, 'fourteen minutes on');
    await round();
    assert.equal(asked.length, 2, 'fifteen minutes on');
  }
});

test('twenty contacts with nothing going on cost twenty looks at the start and none for minutes after', async () => {
  const contacts = Array.from({ length: 20 }, (_, i) => contact(`Agent ${i}`, `/p/${i}`));
  const { round, asked } = setup({}, { contacts });
  await round();
  assert.equal(asked.length, 20);
  for (let i = 0; i < 14; i += 1) await round();
  assert.equal(asked.length, 20);
});

test('a pull request opened in a turn is known as the turn ends, though gh said "none" a moment before', async () => {
  const dir = '/projects/opened-in-a-turn';
  const claudeA = contact('Claude', dir);
  const clock = { time: 0 };
  let opened = null;
  let changes = 0;
  const prs = new PullRequests({
    contacts: () => [claudeA],
    exists: () => true,
    now: () => clock.time,
    // As the app asks: through the card's pullRequest, which remembers an answer for half a minute.
    ask: (cwd) => pullRequest(cwd, { now: () => clock.time, run: async () => opened }),
    forget: forgetPullRequest,
    onChange: () => {
      changes += 1;
    },
    notify() {},
  });
  await prs.check();
  assert.equal(prs.of(claudeA), null);
  // The agent opens one, and its turn ends seconds later: no round comes for up to a minute.
  opened = JSON.stringify({ number: 12, url: 'https://github.com/you/project/pull/12', state: 'OPEN', title: '' });
  clock.time += 5 * 1000;
  await prs.lookSoon(dir);
  assert.equal(prs.of(claudeA)?.number, 12, 'not the "none" gh said before the turn');
  assert.equal(changes, 1, 'and the list, with the button, hears of it');
});

test('an answer on its way as a turn ends is from before it, and does not undo the newer one', async () => {
  const claudeA = contact('Claude', '/p/a');
  const answers = [];
  const prs = new PullRequests({
    contacts: () => [claudeA],
    exists: () => true,
    ask: () => new Promise((resolve) => answers.push(resolve)),
    forget: () => {},
    onChange() {},
    notify() {},
  });
  const round = prs.check();
  const turn = prs.lookSoon('/p/a');
  answers[1](pr());
  await turn;
  answers[0](null);
  await round;
  assert.deepEqual(prs.of(claudeA), pr());
});

test('after a turn the folder is looked at at once, and on the next rounds whatever its pace was', async () => {
  const { prs, round, asked } = setup({ '/p/a': [null, null, null, running()] });
  await round();
  assert.equal(asked.length, 1);
  await prs.lookSoon('/p/a');
  assert.equal(asked.length, 2, 'at once, not on the next round');
  await round(20 * 1000);
  assert.equal(asked.length, 3, 'the push may not have reached GitHub yet');
  await round();
  assert.equal(asked.length, 4, 'so it is looked at once more');
  assert.deepEqual(prs.of({ cwd: '/p/a' }), running());
});

test('a while after the turn, a folder without a pull request is back to its own pace', async () => {
  const { prs, round, asked } = setup({ '/p/a': [null] });
  await round();
  await prs.lookSoon('/p/a');
  await round();
  assert.equal(asked.length, 3);
  await round();
  await round();
  assert.equal(asked.length, 3, 'a minute and a half after the turn, no more');
});

test('a turn in a folder that was never looked at makes its first look no less of a first look', async () => {
  const contacts = [];
  const { prs, round, asked, notes } = setup({ '/p/new': [failing()] }, { contacts });
  await round();
  contacts.push(contact('Newcomer', '/p/new'));
  await prs.lookSoon('/p/new');
  assert.deepEqual(asked, ['/p/new']);
  assert.deepEqual(notes, [], 'still a first look');
  await round();
  assert.deepEqual(notes, [], 'and the round after it has nothing to add');
});

// ---- never two rounds at once -----------------------------------------------------------------

test('a round that takes longer than the interval is left to finish, and no folder is asked twice', async () => {
  const asked = [];
  const waiting = [];
  const contacts = [contact('Claude', '/p/a'), contact('Codex', '/p/b')];
  const prs = new PullRequests({
    contacts: () => contacts,
    exists: () => true,
    ask: (cwd) => {
      asked.push(cwd);
      return new Promise((resolve) => waiting.push(resolve));
    },
    onChange() {},
    notify() {},
  });
  const first = prs.check();
  const second = prs.check(); // the interval came round again
  await settled();
  assert.deepEqual(asked, ['/p/a'], 'one folder at a time, in one round');
  waiting.shift()(running());
  await settled();
  assert.deepEqual(asked, ['/p/a', '/p/b']);
  prs.check();
  waiting.shift()(null);
  await Promise.all([first, second]);
  assert.deepEqual(asked, ['/p/a', '/p/b']);
  // With that round over, the next one starts as usual.
  const third = prs.check();
  await settled();
  waiting.shift()(running());
  await settled();
  assert.deepEqual(asked, ['/p/a', '/p/b', '/p/a'], 'only the folder whose checks are running was due again');
  await third;
});

test('start looks at once and then on every interval, until stopped', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const { prs, asked } = setup({ '/p/a': [running()] }, { intervalMs: 1000 });
  prs.start();
  prs.start(); // a second start doesn't double the looking
  assert.equal(asked.length, 1);
  await settled();
  t.mock.timers.tick(1000);
  assert.equal(asked.length, 2);
  await settled();
  t.mock.timers.tick(1000);
  assert.equal(asked.length, 3);
  await settled();
  prs.stop();
  t.mock.timers.tick(5000);
  assert.equal(asked.length, 3);
});

test('the timer does not keep the process alive', async () => {
  const { prs } = setup({}, { intervalMs: 60000 });
  const before = process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
  prs.start();
  // An unref'd timer isn't listed among what the process is waiting for.
  assert.equal(process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length, before);
  prs.stop();
  await settled();
});

// ---- the hover card asks through the same door ------------------------------------------------

test('a hover asks about that folder now, and the list hears what it found', async () => {
  const claudeA = contact('Claude', '/p/a');
  const { prs, asked, changes } = setup({ '/p/a': [failing()] }, { contacts: [claudeA] });
  assert.deepEqual(await prs.look('/p/a'), failing());
  assert.deepEqual(asked, ['/p/a']);
  assert.deepEqual(prs.of(claudeA), failing());
  assert.equal(changes(), 1);
});

test('a hover that finds checks failing since the last round says so like a round would', async () => {
  const { prs, round, notes } = setup({ '/p/a': [running(), failing(), failing()] });
  await round();
  await prs.look('/p/a');
  assert.equal(notes.length, 1);
  await round();
  assert.equal(notes.length, 1, 'and the round after it has nothing to add');
});

test('a hover while a round is asking about the same folder waits for that answer: gh runs once', async () => {
  const dir = '/projects/hovered-during-a-round';
  const claudeA = contact('Claude', dir);
  const answer = JSON.stringify({ number: 12, url: 'https://github.com/you/project/pull/12', state: 'OPEN' });
  let runs = 0;
  let changes = 0;
  let finish;
  const prs = new PullRequests({
    contacts: () => [claudeA],
    exists: () => true,
    // As the app asks: through the card's pullRequest, here with a gh that takes its time.
    ask: (cwd) =>
      pullRequest(cwd, {
        run: () => {
          runs += 1;
          return new Promise((resolve) => {
            finish = () => resolve(answer);
          });
        },
      }),
    onChange: () => {
      changes += 1;
    },
    notify() {},
  });
  const round = prs.check();
  const hover = prs.look(dir);
  await settled();
  assert.equal(runs, 1);
  finish();
  assert.equal((await hover).number, 12);
  await round;
  assert.equal(prs.of(claudeA).number, 12);
  assert.equal(changes, 1, 'one answer is one change');
});

test('a hover when gh cannot tell gets what is known, or nothing', async () => {
  const { prs, round } = setup({ '/p/a': [failing(), signedOut()], '/p/b': [signedOut()] });
  await round();
  assert.deepEqual(await prs.look('/p/a'), failing());
  assert.equal(await prs.look('/p/b'), null);
});

test('a hover on a contact without a folder asks nobody', async () => {
  const { prs, asked } = setup();
  assert.equal(await prs.look(''), null);
  assert.equal(await prs.look(undefined), null);
  assert.deepEqual(asked, []);
});

test('a hover right after a round is answered from what GitHub just said', async () => {
  const dir = '/projects/hovered-after-a-round';
  const clock = { time: 0 };
  let runs = 0;
  const answer = JSON.stringify({
    number: 12,
    url: 'https://github.com/you/project/pull/12',
    state: 'OPEN',
    title: '',
  });
  const prs = new PullRequests({
    contacts: () => [contact('Claude', dir)],
    exists: () => true,
    now: () => clock.time,
    // The card's own way of asking: it remembers each folder's answer for half a minute.
    ask: (cwd) => pullRequest(cwd, { now: () => clock.time, run: async () => (runs++, answer) }),
    onChange() {},
    notify() {},
  });
  await prs.check();
  clock.time += 10 * 1000;
  assert.equal((await prs.look(dir)).number, 12);
  assert.equal(runs, 1);
  clock.time += 30 * 1000;
  await prs.look(dir);
  assert.equal(runs, 2);
});

// ---- a folder put on a new branch -------------------------------------------------------------

test('a folder put on a new branch has no pull request any more, at once and without asking', async () => {
  const claudeA = contact('Claude', '/p/a');
  const forgotten = [];
  const { prs, round, asked, changes } = setup(
    { '/p/a': [passed({ state: 'merged' })] },
    { contacts: [claudeA], forget: (cwd) => forgotten.push(cwd) }
  );
  await round();
  assert.deepEqual(pullRequestTags(prs.of(claudeA)), [{ kind: 'merged', text: 'Merged' }]);
  const before = changes();
  prs.startedOver('/p/a');
  assert.equal(prs.of(claudeA), null);
  assert.equal(changes(), before + 1, 'the list hears of it');
  assert.deepEqual(asked, ['/p/a'], 'a branch made just now has none: GitHub is not asked');
  assert.deepEqual(forgotten, ['/p/a'], 'and what gh said a moment ago is not said of this branch');
});

test('from then on it is asked about as any branch without a pull request is', async () => {
  const { prs, round, asked } = setup({ '/p/a': [passed({ state: 'merged' }), running()] }, { forget: () => {} });
  await round();
  prs.startedOver('/p/a');
  await round(14 * MINUTE);
  assert.equal(asked.length, 1);
  await round(MINUTE);
  assert.equal(asked.length, 2);
  assert.deepEqual(prs.of(contact('Claude', '/p/a')), running(), 'the pull request the new branch got since');
});

test('a turn that ends on the new branch has GitHub asked at once, as after any turn', async () => {
  const { prs, round, asked } = setup({ '/p/a': [passed({ state: 'merged' }), pr()] }, { forget: () => {} });
  await round();
  prs.startedOver('/p/a');
  await prs.lookSoon('/p/a');
  assert.equal(asked.length, 2);
  assert.deepEqual(prs.of(contact('Claude', '/p/a')), pr());
});

test('an answer that was on its way is about the branch the folder left, and is dropped', async () => {
  const claudeA = contact('Claude', '/p/a');
  const answers = [];
  let changes = 0;
  const prs = new PullRequests({
    contacts: () => [claudeA],
    exists: () => true,
    ask: () => new Promise((resolve) => answers.push(resolve)),
    onChange: () => (changes += 1),
    notify: () => assert.fail('nothing here is news'),
    forget: () => {},
  });
  const looking = prs.look('/p/a');
  prs.startedOver('/p/a');
  answers[0](failing(2, { state: 'open' }));
  assert.equal(await looking, null);
  assert.equal(prs.of(claudeA), null);
  assert.equal(changes, 1, 'only the new branch was news');
  // The next answer is about the branch it is on now.
  const again = prs.look('/p/a');
  answers[1](pr({ number: 13 }));
  assert.equal((await again).number, 13);
  assert.equal(prs.of(claudeA).number, 13);
});

// ---- a folder with no branch checked out ---------------------------------------------------------

const GH = (fields = {}) =>
  JSON.stringify({ number: 12, url: 'https://github.com/you/project/pull/12', title: '', state: 'OPEN', ...fields });
const RUNNING = GH({ additions: 609, deletions: 96, statusCheckRollup: [{ status: 'IN_PROGRESS', name: 'test' }] });
const MERGED = GH({ state: 'MERGED', additions: 609, deletions: 96 });

/**
 * A PullRequests that asks as the app does, through the card's pullRequest, about a folder an agent can
 * take off its branch, as `git checkout origin/main` does once its pull request is merged. gh answers
 * for the branch while the folder has one, and can't tell which branch otherwise. GitHub says
 * `github.branch` of the branch and `github.page` of the pull request's page: an Error is gh failing.
 */
function detachable(dir, opts = {}) {
  const clock = { time: 0 };
  const github = { onBranch: true, branch: RUNNING, page: MERGED };
  const asked = [];
  const merged = [];
  let changes = 0;
  const answer = (said) => {
    if (said instanceof Error) throw said;
    return said;
  };
  const prs = new PullRequests({
    contacts: () => [contact('Claude', dir)],
    exists: () => true,
    now: () => clock.time,
    ask: (cwd, known) =>
      pullRequest(cwd, {
        known,
        now: () => clock.time,
        onBranch: async () => github.onBranch,
        run: async (_cwd, page) => {
          asked.push(page ? 'page' : 'branch');
          if (page) return answer(github.page);
          if (!github.onBranch)
            throw new Error('could not determine current branch: failed to run git: not on any branch');
          return answer(github.branch);
        },
      }),
    forget: forgetPullRequest,
    onChange: () => (changes += 1),
    onMerged: (cwd) => merged.push(cwd),
    notify() {},
    ...opts,
  });
  const round = async (ms = MINUTE) => {
    clock.time += ms;
    await prs.check();
  };
  // What the contact's row says of it: how big it is, then its tags.
  const row = () => ({ size: pullRequestSize(prs.of({ cwd: dir })), tags: pullRequestTags(prs.of({ cwd: dir })) });
  return { prs, github, asked, merged, round, row, changes: () => changes };
}

test('a folder left on no branch once its pull request was merged shows it merged, and the merge is told', async () => {
  const app = detachable('/projects/detached-after-merge');
  await app.round();
  assert.deepEqual(app.row(), {
    size: { added: '+609', removed: '−96' },
    tags: [{ kind: 'running', text: 'Running' }],
  });
  // The agent merges it and runs `git checkout origin/main`: gh has no branch to find it by any more.
  app.github.onBranch = false;
  await app.round();
  assert.deepEqual(
    app.row(),
    { size: null, tags: [{ kind: 'merged', text: 'Merged' }] },
    'not as it was before the merge'
  );
  assert.deepEqual(app.merged, ['/projects/detached-after-merge'], 'so it can be archived once merged');
  assert.deepEqual(app.asked, ['branch', 'branch', 'page']);
  // A hover and the next rounds say the same.
  assert.equal((await app.prs.look('/projects/detached-after-merge')).state, 'merged');
  await app.round(15 * MINUTE);
  assert.equal(app.prs.of({ cwd: '/projects/detached-after-merge' }).state, 'merged');
  assert.deepEqual(app.merged, ['/projects/detached-after-merge'], 'still merged is no news');
});

test('a turn that ends with the folder on no branch has the pull request asked about at once', async () => {
  const app = detachable('/projects/detached-in-a-turn');
  await app.round();
  app.github.onBranch = false;
  await app.prs.lookSoon('/projects/detached-in-a-turn');
  assert.equal(app.prs.of({ cwd: '/projects/detached-in-a-turn' }).state, 'merged');
  assert.equal(app.changes(), 2, 'found, then merged');
});

test('a folder on no branch with no pull request known has none, and no page is asked about', async () => {
  const app = detachable('/projects/detached-from-the-start');
  app.github.onBranch = false;
  await app.round();
  assert.equal(app.prs.of({ cwd: '/projects/detached-from-the-start' }), null);
  assert.equal(await app.prs.look('/projects/detached-from-the-start'), null);
  assert.deepEqual(app.asked, ['branch'], 'the hover was answered from the round a moment ago');
  assert.equal(app.changes(), 0);
});

test('a folder on no branch whose branch had none still has none', async () => {
  const app = detachable('/projects/detached-without-one');
  app.github.branch = null;
  await app.round();
  app.github.onBranch = false;
  await app.round(15 * MINUTE);
  assert.equal(app.prs.of({ cwd: '/projects/detached-without-one' }), null);
  assert.deepEqual(app.asked, ['branch', 'branch']);
});

test('when GitHub cannot be reached, a folder on no branch keeps what was known, as any folder does', async () => {
  const app = detachable('/projects/detached-offline');
  await app.round();
  app.github.onBranch = false;
  app.github.page = new Error('error connecting to api.github.com');
  await app.round();
  assert.deepEqual(app.row(), {
    size: { added: '+609', removed: '−96' },
    tags: [{ kind: 'running', text: 'Running' }],
  });
  assert.deepEqual(app.merged, []);
  assert.equal(app.changes(), 1);
  // Back online, the pull request it had is still the one asked about.
  app.github.page = MERGED;
  await app.round();
  assert.equal(app.prs.of({ cwd: '/projects/detached-offline' }).state, 'merged');
  assert.deepEqual(app.merged, ['/projects/detached-offline']);
});

test('a folder back on a branch is asked about by its branch again', async () => {
  const app = detachable('/projects/back-on-a-branch');
  await app.round();
  app.github.onBranch = false;
  await app.round();
  assert.equal(app.prs.of({ cwd: '/projects/back-on-a-branch' }).state, 'merged');
  // The agent checks out a branch again, with a pull request of its own, and its turn ends.
  app.github.onBranch = true;
  app.github.branch = GH({ number: 13, url: 'https://github.com/you/project/pull/13' });
  await app.prs.lookSoon('/projects/back-on-a-branch');
  assert.equal(app.prs.of({ cwd: '/projects/back-on-a-branch' }).number, 13);
  // One with none has none.
  app.github.branch = null;
  await app.prs.lookSoon('/projects/back-on-a-branch');
  assert.equal(app.prs.of({ cwd: '/projects/back-on-a-branch' }), null);
  assert.deepEqual(app.asked, ['branch', 'branch', 'page', 'branch', 'branch']);
});

// ---- what the app changed on GitHub itself ------------------------------------------------------------

test('a change the app made is heard at once, and the next to ask gets a fresh answer', async () => {
  const claudeA = contact('Claude', '/p/a');
  const forgotten = [];
  const { prs, round, asked, notes, changes } = setup(
    { '/p/a': [running()] },
    { contacts: [claudeA], forget: (cwd) => forgotten.push(cwd) }
  );
  await round();
  const before = changes();
  prs.changed('/p/a', { autoMerge: 'squash' });
  assert.deepEqual(prs.of(claudeA), running({ autoMerge: 'squash' }));
  assert.equal(changes(), before + 1, 'the list hears of it');
  assert.deepEqual(forgotten, ['/p/a'], 'what gh said a moment ago is from before the change');
  assert.deepEqual(asked, ['/p/a'], 'GitHub already said how it stands: nobody is asked');
  assert.deepEqual(notes, [], 'nothing about its checks is news');
  // Turned off again, it is gone from the pull request.
  prs.changed('/p/a', { autoMerge: undefined });
  assert.deepEqual(prs.of(claudeA), running());
  assert.equal('autoMerge' in prs.of(claudeA), false);
});

test('a folder GitHub said nothing of yet has nothing to change, nor has the demo', async () => {
  const { prs, changes } = setup({}, { forget: () => assert.fail('nothing to forget') });
  prs.changed('/p/a', { autoMerge: 'squash' });
  await prs.check();
  prs.changed('/p/a', { autoMerge: 'squash' });
  assert.equal(prs.of(contact('Claude', '/p/a')), null, 'there is no pull request to change');
  assert.equal(changes(), 0);
  const demo = setup({}, { demo: true, forget: () => assert.fail('the demo forgets nothing') });
  demo.prs.changed('/p/a', { autoMerge: undefined });
  assert.equal(demo.changes(), 0);
});

// ---- the pull requests the app merges itself -----------------------------------------------------------

/**
 * A stand-in for AppMerges: the app merges every folder's pull request in `method` while it is set, and each
 * answer heard gets the next of `patches` back, or null. Merged or given up, as one does, it waits no more.
 */
function appMergesStub({ method = null, patches = [] } = {}) {
  const stub = { method, heard: [] };
  const appMerges = {
    of: (_cwd, pr) => (pr ? stub.method : null),
    heard: async (cwd, pr) => {
      stub.heard.push([cwd, pr]);
      const patch = patches.shift() ?? null;
      if (patch) stub.method = null;
      return patch;
    },
  };
  return { stub, appMerges };
}

test("a pull request the app merges itself says so, and how, while GitHub's own auto-merge is off", async () => {
  const claudeA = contact('Claude', '/p/a');
  const { stub, appMerges } = appMergesStub({ method: 'squash' });
  const { prs, round } = setup({ '/p/a': [running()] }, { contacts: [claudeA], appMerges });
  await round();
  assert.deepEqual(prs.of(claudeA), running({ autoMerge: 'squash', appMerges: true }));
  assert.deepEqual(await prs.look('/p/a'), running({ autoMerge: 'squash', appMerges: true }), 'a hover sees it too');
  // Turned off, the next it hears of the folder has it gone, whatever was said before.
  stub.method = null;
  prs.changed('/p/a', {});
  assert.deepEqual(prs.of(claudeA), running());
});

test("GitHub's own auto-merge, a draft, and a pull request that is merged, are not the app's", async () => {
  const contacts = [contact('Claude', '/p/a'), contact('Codex', '/p/b'), contact('Opus', '/p/c')];
  const { appMerges } = appMergesStub({ method: 'squash' });
  const { prs, round } = setup(
    {
      '/p/a': [running({ autoMerge: 'rebase' })],
      '/p/b': [passed({ state: 'merged' })],
      '/p/c': [running({ state: 'draft' })],
    },
    { contacts, appMerges }
  );
  await round();
  assert.deepEqual(prs.of(contacts[0]), running({ autoMerge: 'rebase' }));
  assert.deepEqual(prs.of(contacts[1]), passed({ state: 'merged' }));
  assert.deepEqual(prs.of(contacts[2]), running({ state: 'draft' }));
});

test('every answer is heard by the app, the same one again too, and none at all', async () => {
  const { stub, appMerges } = appMergesStub();
  const { round } = setup({ '/p/a': [running(), running(), null] }, { appMerges });
  await round();
  await round();
  await round(15 * MINUTE);
  await settled();
  assert.deepEqual(
    stub.heard.map(([cwd, heard]) => [cwd, heard?.checks?.pending ?? null]),
    [
      ['/p/a', 4],
      ['/p/a', 4],
      ['/p/a', null],
    ]
  );
});

test('once the app has merged it, the list says it is merged at once', async () => {
  const claudeA = contact('Claude', '/p/a');
  const { appMerges } = appMergesStub({ method: 'squash', patches: [{ state: 'merged', conflict: undefined }] });
  const { prs, round, changes } = setup({ '/p/a': [passed()] }, { contacts: [claudeA], appMerges });
  await round();
  await settled();
  assert.deepEqual(prs.of(claudeA), passed({ state: 'merged' }));
  assert.equal(changes(), 2, 'the first answer, then merged');
});

test('a pull request the app merged itself is told as merged, as one GitHub merged is', async () => {
  const merged = [];
  const { appMerges } = appMergesStub({ method: 'squash', patches: [{ state: 'merged', conflict: undefined }] });
  const { round } = setup({ '/p/a': [passed()] }, { appMerges, onMerged: (cwd) => merged.push(cwd) });
  await round();
  await settled();
  assert.deepEqual(merged, ['/p/a']);
});

test('once the app has given up on it, the list says auto-merge is off at once', async () => {
  const claudeA = contact('Claude', '/p/a');
  const { appMerges } = appMergesStub({ method: 'squash', patches: [{}] });
  const { prs, round, changes } = setup({ '/p/a': [passed()] }, { contacts: [claudeA], appMerges });
  await round();
  await settled();
  assert.deepEqual(prs.of(claudeA), passed());
  assert.equal(changes(), 2, 'the first answer, then off');
});

test('no folder is no folder to forget', () => {
  const { prs, changes } = setup({}, { forget: () => assert.fail('nothing to forget') });
  prs.startedOver('');
  prs.startedOver(undefined);
  assert.equal(changes(), 0);
});

test('in demo mode the made-up pull request goes with the branch too', () => {
  const contacts = [contact('Claude', '/p/a'), contact('Gemini', '/p/b'), contact('Opus', '/p/c')];
  const { prs, asked, changes } = setup({}, { contacts, demo: true, forget: () => assert.fail('gh was never asked') });
  const tags = (c) => pullRequestTags(prs.of(c)).map((tag) => tag.kind);
  assert.deepEqual(contacts.map(tags), [['failing'], ['merged'], ['conflict', 'passed']]);
  prs.startedOver('/p/b');
  assert.deepEqual(contacts.map(tags), [['failing'], [], ['conflict', 'passed']], 'the others keep theirs');
  assert.equal(changes(), 1);
  assert.deepEqual(asked, []);
});

// ---- demo mode --------------------------------------------------------------------------------

test('demo mode shows made-up pull requests for the first folders and never asks gh', async () => {
  const contacts = [contact('Claude', '/p/a'), contact('Codex', '/p/b'), contact('Opus', '/p/a')];
  const { prs, asked, notes, changes } = setup({ '/p/a': [failing(9)] }, { contacts, demo: true });
  const made = prs.of(contacts[0]);
  assert.ok(made.number > 0);
  assert.match(made.url, /^https:\/\//);
  assert.ok(made.checks.failing + made.checks.pending + made.checks.passed > 0, 'with checks to show');
  assert.deepEqual(prs.of(contacts[2]), made, 'its folder is what has the pull request');
  assert.notEqual(prs.of(contacts[1]).number, made.number, 'the next folder has one of its own');
  prs.start();
  await prs.check();
  prs.lookSoon('/p/a');
  assert.deepEqual(await prs.look('/p/a'), made);
  assert.equal(await prs.look('/p/nobody-works-here'), null);
  prs.stop();
  assert.deepEqual(asked, []);
  assert.deepEqual(notes, []);
  assert.equal(changes(), 0);
});

test('in demo mode the first folders show one of each kind of tag, and an archived contact takes none', () => {
  const contacts = [
    contact('Archived', '/p/old', { archived: true }),
    contact('Claude', '/p/a'),
    contact('Codex', '/p/a'),
    contact('Gemini', '/p/b'),
    contact('Opus', '/p/c'),
    contact('Sonnet', '/p/d'),
    contact('Haiku', '/p/e'),
  ];
  const { prs } = setup({}, { contacts, demo: true });
  const tags = (c) => pullRequestTags(prs.of(c)).map((tag) => tag.kind);
  assert.deepEqual(contacts.map(tags), [
    [],
    ['failing'],
    ['failing'],
    ['merged'],
    ['conflict', 'passed'],
    ['running'],
    [],
  ]);
});

// ---- the contact list line --------------------------------------------------------------------

/** A real Conversations with one contact in a folder that exists, told about pull requests by `pullRequests`. */
function listWith(pullRequests) {
  const dir = tempDir('cm-prs-');
  const store = new Store(dir, { defaultProvider: 'claude' });
  const sessions = [];
  const providers = {
    descriptor: () => claude,
    upgradeHistory: (_id, entries) => entries,
    createSession: (_contact, emit) => {
      const session = { emit, waiting: 0, send() {}, respond() {}, close() {}, interrupt: async () => {} };
      sessions.push(session);
      return session;
    },
  };
  const conversations = new Conversations({
    store,
    history: new History(path.join(dir, 'history')),
    providers,
    chats: { send() {}, isFocused: () => false },
    notifier: { notify() {}, setBadge() {} },
    onContactsChanged() {},
    ...(pullRequests && { pullRequests }),
  });
  const host = store.addContact({ provider: 'claude', name: 'Claude', cwd: dir, model: '', permissionMode: 'default' });
  const view = () => conversations.view(store.getContact(host.id));
  const line = () => view().personalMessage;
  const location = () => view().location;
  return { conversations, store, host, sessions, dir, view, line, location };
}

const telling = (answer) => ({ of: () => answer, lookSoon() {} });

test('an idle contact with a pull request shows it, and how its checks stand, instead of its folder', () => {
  // The row is narrow, so what the checks say comes before which pull request it is.
  assert.equal(listWith(telling(failing())).line(), '2 checks failing on pull request #12');
  assert.equal(listWith(telling(failing(1))).line(), '1 check failing on pull request #12');
  assert.equal(listWith(telling(running())).line(), 'Checks running on pull request #12');
  assert.equal(listWith(telling(passed())).line(), 'Checks passed on pull request #12');
  assert.equal(listWith(telling(running({ state: 'draft' }))).line(), 'Checks running on pull request #12 (draft)');
  assert.equal(listWith(telling(pr())).line(), 'Pull request #12', 'no checks, nothing extra');
});

test('a merged or closed pull request says so briefly', () => {
  assert.equal(listWith(telling(passed({ state: 'merged' }))).line(), 'Pull request #12 (merged)');
  assert.equal(listWith(telling(failing(2, { state: 'closed' }))).line(), 'Pull request #12 (closed)');
});

test('without a pull request the line is the folder, as it always was', () => {
  const none = listWith(telling(null));
  assert.equal(none.line(), none.location());
  const unasked = listWith();
  assert.equal(unasked.line(), unasked.location(), 'nor when nobody watches pull requests at all');
});

test('where the contact works stays its location, whatever the line says', () => {
  const app = listWith(telling(failing()));
  assert.notEqual(app.line(), app.location());
  assert.match(app.location(), /cm-prs-/);
});

test('a working contact says what it is doing, and a waiting one that it waits for you', () => {
  const app = listWith(telling(failing()));
  app.conversations.send(app.host.id, { text: 'run the tests', images: [] });
  const { emit } = app.sessions[0];
  emit({ type: 'state', state: 'connecting' });
  assert.equal(app.line(), app.location(), 'busy with nothing to report yet: its own line, not the pull request');
  emit({ type: 'state', state: 'working' });
  assert.equal(app.line(), 'Thinking', 'at work, and between its tool calls');
  emit({ type: 'tool', toolId: 't1', activity: { kind: 'command', command: 'npm test' }, sub: false });
  assert.equal(app.line(), 'Running npm test');
  emit({ type: 'permission', requestId: 'r1', kind: 'tool', activity: { kind: 'command', command: 'rm x' } });
  emit({ type: 'state', state: 'waiting' });
  assert.equal(app.line(), 'Waiting for you to approve something');
  emit({ type: 'permission-resolved', requestId: 'r1', decision: 'allow' });
  emit({ type: 'result', isError: false, stopped: false, errorText: '', durationMs: 1, costUsd: 0 });
  emit({ type: 'state', state: 'idle' });
  assert.equal(app.line(), '2 checks failing on pull request #12', 'idle again');
});

test('a contact whose folder is gone shows the folder, not a pull request remembered from before', () => {
  const app = listWith(telling(failing()));
  fs.rmSync(app.dir, { recursive: true });
  assert.equal(app.view().status, 'offline');
  assert.equal(app.line(), app.location());
});

test('a finished turn asks for another look at the folder it worked in', () => {
  const looks = [];
  const app = listWith({ of: () => null, lookSoon: (cwd) => looks.push(cwd) });
  app.conversations.send(app.host.id, { text: 'push it', images: [] });
  const { emit } = app.sessions[0];
  emit({ type: 'state', state: 'working' });
  emit({ type: 'tool', toolId: 't1', activity: { kind: 'command', command: 'git push' }, sub: false });
  assert.deepEqual(looks, [], 'not while it works');
  emit({ type: 'result', isError: false, stopped: false, errorText: '', durationMs: 1, costUsd: 0 });
  assert.deepEqual(looks, [app.dir]);
});

test('the watcher and the list together: a round changes the line, a turn looks at once', async () => {
  const asked = [];
  const answers = [null, running(), failing()];
  const clock = { time: 0 };
  let changes = 0;
  const notes = [];
  const prs = new PullRequests({
    // A new store comes with a contact in the home folder; this is about the one made here.
    contacts: () => app.store.contacts.filter((c) => c.id === app.host.id),
    now: () => clock.time,
    ask: async (cwd) => {
      asked.push(cwd);
      return answers.shift();
    },
    onChange: () => {
      changes += 1;
    },
    notify: (who, note) => notes.push([who.id, note.body]),
  });
  const app = listWith(prs);
  await prs.check();
  assert.equal(app.line(), app.location());

  // The agent pushes and opens a pull request, and its turn ends.
  app.conversations.send(app.host.id, { text: 'open a pull request', images: [] });
  app.sessions[0].emit({ type: 'result', isError: false, stopped: false, errorText: '', durationMs: 1, costUsd: 0 });
  await settled();
  assert.deepEqual(asked, [app.dir, app.dir], 'as the turn ends, not on a round a quarter of an hour later');
  assert.equal(app.line(), 'Checks running on pull request #12');
  assert.equal(changes, 1);

  clock.time += MINUTE;
  await prs.check();
  assert.equal(app.line(), '2 checks failing on pull request #12');
  assert.deepEqual(notes, [[app.host.id, '2 checks failing on pull request #12']]);
});

// ---- the tray menu prints the same line -------------------------------------------------------

test('the menu-bar menu shows the pull request line for an idle contact', () => {
  const app = listWith(telling(failing()));
  assert.equal(contactLabel(app.view()), '🟢 Claude - 2 checks failing on pull request #12');
});

test('the longest line a pull request is likely to make still fits in the menu', () => {
  const long = pr({ number: 12345, state: 'draft', checks: { failing: 12, pending: 0, passed: 30 } });
  assert.equal(
    contactLabel(listWith(telling(long)).view()),
    '🟢 Claude - 12 checks failing on pull request #12345 (draft)'
  );
});
