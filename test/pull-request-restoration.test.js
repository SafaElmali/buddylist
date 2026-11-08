import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ArchiveMerged } from '../src/main/archive-merged.js';
import { associatedPullRequest, forgetPullRequestAssociation } from '../src/main/pull-request-association.js';
import { PullRequests } from '../src/main/pull-requests.js';

// Real resolver, watcher and archive queue; only checkout/remote IO and persistence are synthetic.
function setup(t, { state = 'merged', saved = true, detached = false } = {}) {
  const cwd = `/synthetic/${encodeURIComponent(t.name)}`;
  const head = 'a'.repeat(40);
  const start = { at: 1000, commit: 'b'.repeat(40), born: 2, inode: 3 };
  const scope = { dir: `${cwd}/.git`, born: 1, inode: 2, repositories: ['github.com/acme/shop'] };
  const pr = {
    number: 7,
    url: 'https://github.com/acme/shop/pull/7',
    title: 'The worker’s PR',
    state,
    checks: { failing: 0, pending: 0, passed: 1 },
  };
  let record = saved ? { scope, branch: 'feature', start, head, headRefOid: head, pr } : null;
  const initialRecord = structuredClone(record);
  const current = {
    scope,
    branch: detached ? null : 'feature',
    start: detached ? null : start,
    head: detached ? 'c'.repeat(40) : head,
    departure: detached ? { branch: 'feature', head } : null,
    tracking: null,
    sourceStart: start,
  };
  const remote = {
    ...pr,
    state: state === 'draft' ? 'OPEN' : state.toUpperCase(),
    isDraft: state === 'draft',
    headRefName: 'feature',
    headRefOid: head,
    closedAt: '2100-01-01T00:00:00Z',
    statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }],
  };
  const local = { available: true, offline: false, now: 0, status: 'online' };
  const worker = { id: 'worker', cwd, archived: false };
  const merged = [];
  const notes = [];
  const archived = [];
  const prs = new PullRequests({
    contacts: () => [worker],
    exists: () => true,
    now: () => local.now,
    load: () => structuredClone(record),
    save: (_cwd, value) => {
      record = structuredClone(value);
    },
    resolve: (dir, value) =>
      associatedPullRequest(dir, value, {
        now: () => local.now,
        context: async () => {
          if (!local.available) throw new Error('Drive temporarily unavailable');
          return current;
        },
        run: async () => {
          if (local.offline) throw new Error('GitHub offline');
          return JSON.stringify(remote);
        },
      }),
    onChange: () => auto.settle(),
    notify: (_contact, note) => notes.push(note),
    onMerged: (dir) => {
      merged.push(dir);
      auto.merged(dir);
    },
  });
  const auto = new ArchiveMerged({
    enabled: () => true,
    contacts: () => [worker],
    view: () => ({ status: local.status, pullRequest: prs.of(worker) }),
    archive: (id) => {
      archived.push(id);
      worker.archived = true;
      auto.settle();
    },
  });
  t.after(() => forgetPullRequestAssociation(cwd));
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  const look = async () => {
    const answer = await prs.look(cwd);
    await settle();
    return answer;
  };
  const next = async () => {
    local.now += 31_000; // Let the real resolver's cache expire, without wall-clock waits.
    return look();
  };
  const effects = () => ({ merged: merged.length, notifications: notes.length, archived: archived.length });
  return { cwd, prs, auto, local, remote, worker, initialRecord, record: () => record, look, next, settle, effects };
}

const QUIET = { merged: 0, notifications: 0, archived: 0 };
const ARCHIVED = { merged: 1, notifications: 0, archived: 1 };

test('restoring a saved merged badge after checkout failure never announces or archives', async (t) => {
  for (const detached of [false, true]) {
    for (const shown of [false, true]) {
      for (const offline of [false, true]) {
        await t.test(
          `${detached ? 'detached' : 'branch'}, ${shown ? 'shown before' : 'startup'}, ${offline ? 'offline' : 'online'}`,
          async (t) => {
            const app = setup(t, { detached });
            if (shown) {
              assert.equal((await app.look()).state, 'merged');
              assert.deepEqual(app.effects(), QUIET);
              app.local.now += 31_000;
            }
            app.local.available = false;
            assert.equal(await app.look(), null);
            assert.equal(app.prs.of(app.worker), null, 'unverified checkout hides the badge');
            assert.deepEqual(app.record(), app.initialRecord, 'durable evidence survives');
            app.local.available = true;
            app.local.offline = offline;
            assert.equal((await app.next()).state, 'merged');
            assert.equal(app.record().pr.state, 'merged');
            assert.deepEqual(app.effects(), QUIET, 'restoration must not queue an idle worker for archive');
            assert.equal(app.worker.archived, false);
            await app.next();
            assert.deepEqual(app.effects(), QUIET, 'later polls remain quiet');
          }
        );
      }
    }
  }
});

test('an open or draft PR newly merged after checkout failure still archives exactly once', async (t) => {
  for (const state of ['open', 'draft']) {
    for (const shown of [false, true]) {
      await t.test(`${state}, ${shown ? 'shown before' : 'saved at startup'}`, async (t) => {
        const app = setup(t, { state });
        if (shown) {
          assert.equal((await app.look()).state, state);
          app.local.now += 31_000;
        }
        app.local.available = false;
        assert.equal(await app.look(), null);
        app.local.available = true;
        app.remote.state = 'MERGED';
        assert.equal((await app.next()).state, 'merged');
        assert.deepEqual(app.effects(), ARCHIVED);
        await app.next();
        assert.deepEqual(app.effects(), ARCHIVED);
      });
    }
  }
});

test('a genuine merge still waits for the worker to finish before archiving', async (t) => {
  const app = setup(t, { state: 'open', detached: true });
  app.local.status = 'busy';
  await app.look();
  app.remote.state = 'MERGED';
  await app.next();
  assert.deepEqual(app.effects(), { merged: 1, notifications: 0, archived: 0 });
  app.local.status = 'online';
  app.auto.settle();
  await app.settle();
  assert.deepEqual(app.effects(), ARCHIVED);
});

test('an explicit verified merge action still announces and archives exactly once', async (t) => {
  const app = setup(t, { state: 'open' });
  await app.look();
  app.prs.changed(app.cwd, { state: 'merged' });
  await app.settle();
  assert.deepEqual(app.effects(), ARCHIVED);
  assert.equal(app.record().pr.state, 'merged');
  app.prs.changed(app.cwd, { state: 'merged' });
  await app.settle();
  assert.deepEqual(app.effects(), ARCHIVED);
});

test('a different PR with the same number is not suppressed by an old merged record', async (t) => {
  const app = setup(t);
  app.local.available = false;
  assert.equal(await app.look(), null);
  app.local.available = true;
  app.remote.url = 'https://github.com/acme/upstream/pull/7';
  app.remote.headRepository = { nameWithOwner: 'acme/shop' };
  await app.next();
  assert.deepEqual(app.effects(), ARCHIVED);
});

test('first valid startup answers remain quiet, with or without saved evidence', async (t) => {
  for (const saved of [false, true]) {
    await t.test(`saved: ${saved}`, async (t) => {
      const app = setup(t, { saved, state: 'open' });
      app.remote.state = 'MERGED';
      assert.equal((await app.look()).state, 'merged');
      assert.deepEqual(app.effects(), QUIET);
    });
  }
});
