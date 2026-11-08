import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  branchCheckedOut,
  branchStart,
  contactCard,
  costToday,
  forgetPullRequest,
  lastActivity,
  parseGitStatus,
  parsePullRequest,
  pullRequest,
  pullRequestAt,
} from '../src/main/contact-card.js';
import { plural, timeAgo } from '../src/renderer/lib/format.js';
import { tempDir } from './fixtures/temp-dir.js';

const tmp = () => tempDir('cm-card-');
const HAS_GIT = spawnSync('git', ['--version']).status === 0;

// ---- reading `git status --porcelain=v2 --branch` -----------------------------------------------

const OID = '08562ba3ce0152d593bd5217a89029fab3ca0d06';
const CHANGED = `1 .M N... 100644 100644 100644 ${OID} ${OID} src/main/ipc.js`;
const STAGED = `1 A. N... 000000 100644 100644 ${'0'.repeat(40)} ${OID} src/new.js`;
const RENAMED = `2 R. N... 100644 100644 100644 ${OID} ${OID} R100 src/after.js\tsrc/before.js`;
const UNMERGED = `u UU N... 100644 100644 100644 100644 ${OID} ${OID} ${OID} README.md`;

test('a clean branch that follows a remote', () => {
  const output = [
    `# branch.oid ${OID}`,
    '# branch.head main',
    '# branch.upstream origin/main',
    '# branch.ab +0 -0',
    '',
  ];
  assert.deepEqual(parseGitStatus(output.join('\n')), { branch: 'main', changes: 0 });
});

test('a branch with no upstream, and a slash in its name', () => {
  const output = `# branch.oid ${OID}\n# branch.head safa/feature/hover-card\n`;
  assert.deepEqual(parseGitStatus(output), { branch: 'safa/feature/hover-card', changes: 0 });
});

test('changed, staged, renamed, unmerged and untracked files all count, once each', () => {
  const output = [
    `# branch.oid ${OID}`,
    '# branch.head main',
    '# branch.upstream origin/main',
    '# branch.ab +2 -1',
    CHANGED,
    STAGED,
    RENAMED,
    UNMERGED,
    '? notes.txt',
    '? a folder with spaces/',
    '',
  ];
  assert.deepEqual(parseGitStatus(output.join('\n')), { branch: 'main', changes: 6 });
});

test('ignored files and blank lines are not changes', () => {
  const output = `# branch.oid ${OID}\n# branch.head main\n! node_modules/\n\n`;
  assert.deepEqual(parseGitStatus(output), { branch: 'main', changes: 0 });
});

test('a detached HEAD is named by its short commit', () => {
  const output = `# branch.oid ${OID}\n# branch.head (detached)\n? notes.txt\n`;
  assert.deepEqual(parseGitStatus(output), { branch: '08562ba (detached)', changes: 1 });
});

test('a repository with no commits yet still has a branch', () => {
  const output = '# branch.oid (initial)\n# branch.head main\n? README.md\n';
  assert.deepEqual(parseGitStatus(output), { branch: 'main', changes: 1 });
});

test('Windows line endings', () => {
  const output = `# branch.oid ${OID}\r\n# branch.head main\r\n${CHANGED}\r\n`;
  assert.deepEqual(parseGitStatus(output), { branch: 'main', changes: 1 });
});

test('output that says nothing gives no branch', () => {
  assert.deepEqual(parseGitStatus(''), { branch: null, changes: 0 });
});

// ---- cost today -------------------------------------------------------------------------------

// Noon on a fixed day, in whatever time zone the tests run in.
const NOON = new Date(2026, 9, 6, 12, 0, 0).getTime();
const MIDNIGHT = new Date(2026, 9, 6, 0, 0, 0).getTime();
const HOUR = 60 * 60 * 1000;
const result = (time, costUsd) => ({ id: `r${time}`, kind: 'result', time, costUsd });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);

test('no history costs nothing', () => {
  assert.equal(costToday([], NOON), null);
});

test('each result carries a running total, so today is how far it moved', () => {
  // Three turns in one session: $0.10, then $0.25 more, then one that spent nothing.
  const entries = [result(NOON - 3 * HOUR, 0.1), result(NOON - 2 * HOUR, 0.35), result(NOON - HOUR, 0.35)];
  near(costToday(entries, NOON), 0.35);
});

test('what was spent before midnight is not counted', () => {
  const entries = [
    result(MIDNIGHT - 2 * HOUR, 1.0),
    result(MIDNIGHT - 1, 1.5),
    result(MIDNIGHT, 1.75), // midnight itself is today
    result(NOON - HOUR, 2.0),
  ];
  near(costToday(entries, NOON), 0.5);
});

test('only yesterday: nothing today', () => {
  assert.equal(costToday([result(MIDNIGHT - HOUR, 4.2)], NOON), null);
});

test('a total that drops is a new session starting from zero', () => {
  const entries = [result(NOON - 3 * HOUR, 0.6), result(NOON - 2 * HOUR, 0.05), result(NOON - HOUR, 0.2)];
  near(costToday(entries, NOON), 0.8);
});

test('a new session today after an old one yesterday', () => {
  const entries = [result(MIDNIGHT - HOUR, 3.0), result(NOON - HOUR, 0.4)];
  near(costToday(entries, NOON), 0.4);
});

test('a result without a cost does not reset the total', () => {
  // A crashed turn reports 0; the session's total carries on after it.
  const entries = [result(NOON - 3 * HOUR, 0.5), result(NOON - 2 * HOUR, 0), result(NOON - HOUR, 0.7)];
  near(costToday(entries, NOON), 0.7);
});

test('Codex reports no cost, which is not the same as $0.00', () => {
  const entries = [result(NOON - 2 * HOUR, 0), result(NOON - HOUR, 0), { ...result(NOON, 0), costUsd: undefined }];
  assert.equal(costToday(entries, NOON), null);
});

test('with guests in the conversation, each one’s total is its own', () => {
  const by = (speaker, time, costUsd) => ({ ...result(time, costUsd), speaker, speakerName: speaker });
  const entries = [
    result(MIDNIGHT - HOUR, 2.0), // the host, yesterday
    by('opus', NOON - 5 * HOUR, 0.3),
    result(NOON - 4 * HOUR, 2.5), // the host again: $0.50 more, not $2.20 more than Opus
    by('opus', NOON - 3 * HOUR, 0.4), // $0.10 more, not a new session after the host's $2.50
    by('codex', NOON - 2 * HOUR, 0), // a guest that doesn't say
    by('opencode', NOON - HOUR, 0.05),
  ];
  near(costToday(entries, NOON), 0.5 + 0.3 + 0.1 + 0.05);
  // On its own, each of them adds up as before.
  near(
    costToday(
      entries.filter((entry) => entry.speaker === 'opus'),
      NOON
    ),
    0.4
  );
});

test('only results count, whatever else the history holds', () => {
  const entries = [
    { id: 'u', kind: 'user', time: NOON - 2 * HOUR, text: 'hi', costUsd: 9 },
    { id: 't', kind: 'tool', time: NOON - 2 * HOUR },
    result(NOON - HOUR, 0.42),
    { id: 'a', kind: 'assistant', time: NOON - HOUR, text: 'done' },
  ];
  near(costToday(entries, NOON), 0.42);
});

// ---- last activity ----------------------------------------------------------------------------

test('last activity is the newest entry, of any kind', () => {
  assert.equal(lastActivity([]), null);
  const entries = [result(NOON - HOUR, 0.1), { id: 'u', kind: 'user', time: NOON, text: 'hi' }];
  assert.equal(lastActivity(entries), NOON);
  assert.equal(lastActivity([...entries].reverse()), NOON);
});

// ---- the whole card ---------------------------------------------------------------------------

test('a folder that is not a repository has no branch and no changes', async () => {
  const entries = [result(NOON - HOUR, 0.42)];
  const card = await contactCard({ cwd: tmp() }, entries, NOON);
  assert.deepEqual(card, { branch: null, changes: null, worktree: false, costToday: 0.42, lastActivity: NOON - HOUR });
});

test('a folder that is gone gives an empty card instead of an error', async () => {
  const card = await contactCard({ cwd: path.join(tmp(), 'deleted') }, [], NOON);
  assert.deepEqual(card, { branch: null, changes: null, worktree: false, costToday: null, lastActivity: null });
});

test('a contact without a usable folder gives an empty card too', async () => {
  for (const cwd of [undefined, null, '', 42]) {
    const card = await contactCard({ cwd }, [], NOON);
    assert.deepEqual(card, { branch: null, changes: null, worktree: false, costToday: null, lastActivity: null });
  }
});

test('a real repository: its branch, then its untracked and changed files', { skip: !HAS_GIT }, async () => {
  const dir = tmp();
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  git('init', '--quiet');
  git('checkout', '--quiet', '-b', 'feature/hover-card');
  assert.deepEqual(await contactCard({ cwd: dir }, [], NOON), {
    branch: 'feature/hover-card',
    changes: 0,
    worktree: false,
    costToday: null,
    lastActivity: null,
  });

  fs.writeFileSync(path.join(dir, 'a.txt'), 'one');
  fs.writeFileSync(path.join(dir, 'b.txt'), 'two');
  git('add', 'a.txt');
  const card = await contactCard({ cwd: path.join(dir) }, [], NOON);
  assert.equal(card.branch, 'feature/hover-card');
  assert.equal(card.changes, 2);
});

test('a worktree made here says so, and the checkout it was made from does not', { skip: !HAS_GIT }, async () => {
  const repo = tmp();
  const home = tmp();
  const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
  git('init', '--quiet');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '--allow-empty', '-m', 'start');
  const worktree = path.join(home, 'shop', 'fix-login');
  git('worktree', 'add', '--quiet', '-b', 'fix-login', worktree);

  const card = await contactCard({ cwd: worktree }, [], NOON, { home });
  assert.equal(card.branch, 'fix-login');
  assert.equal(card.worktree, true);
  assert.equal((await contactCard({ cwd: repo }, [], NOON, { home })).worktree, false);
  // One somewhere else than where the app makes them is not one of its own.
  assert.equal((await contactCard({ cwd: worktree }, [], NOON, { home: tmp() })).worktree, false);
});

// ---- the words the card uses ------------------------------------------------------------------

test('how long ago, in words', () => {
  const MINUTE = 60 * 1000;
  const ago = (ms) => timeAgo(NOON - ms, NOON);
  assert.equal(ago(0), 'just now');
  assert.equal(ago(59 * 1000), 'just now');
  assert.equal(ago(MINUTE), '1 minute ago');
  assert.equal(ago(5 * MINUTE), '5 minutes ago');
  assert.equal(ago(59 * MINUTE), '59 minutes ago');
  assert.equal(ago(HOUR), '1 hour ago');
  assert.equal(ago(23 * HOUR), '23 hours ago');
  assert.equal(ago(24 * HOUR), 'yesterday');
  assert.equal(ago(3 * 24 * HOUR), '3 days ago');
  assert.equal(ago(7 * 24 * HOUR), `on ${new Date(NOON - 7 * 24 * HOUR).toLocaleDateString()}`);
  // A clock that is a little off never says "-1 minutes ago".
  assert.equal(timeAgo(NOON + 5000, NOON), 'just now');
});

test('one change, several changes', () => {
  assert.equal(plural(1, 'change'), 'change');
  assert.equal(plural(0, 'change'), 'changes');
  assert.equal(plural(3, 'pull request'), 'pull requests');
});

// ---- the lines of the card --------------------------------------------------------------------

/** card.js is window code: give it the two globals it touches as it loads. */
async function loadCardLines() {
  globalThis.window ??= { messenger: {} };
  globalThis.document ??= { addEventListener() {} };
  const { cardLines } = await import('../src/renderer/contacts/card.js');
  return (card) => cardLines(card, NOON).map((line) => line.text);
}

test('a full card reads like sentences', async () => {
  const lines = await loadCardLines();
  assert.deepEqual(lines({ branch: 'main', changes: 3, costToday: 0.42, lastActivity: NOON - 5 * 60 * 1000 }), [
    'main',
    '3 uncommitted changes',
    '$0.42 today',
    'Last active 5 minutes ago',
  ]);
});

test('one change, no changes, and a cost too small to round', async () => {
  const lines = await loadCardLines();
  const card = { branch: '08562ba (detached)', lastActivity: NOON };
  assert.deepEqual(lines({ ...card, changes: 1, costToday: 0.004 }), [
    '08562ba (detached)',
    '1 uncommitted change',
    'Less than $0.01 today',
    'Last active just now',
  ]);
  assert.deepEqual(lines({ ...card, changes: 0, costToday: 12.5 }).slice(1, 3), [
    'No uncommitted changes',
    '$12.50 today',
  ]);
});

test('what the main process could not tell is left out', async () => {
  const lines = await loadCardLines();
  // Not a repository, a provider that reports no cost.
  assert.deepEqual(lines({ branch: null, changes: null, costToday: null, lastActivity: NOON - HOUR }), [
    'Last active 1 hour ago',
  ]);
  assert.deepEqual(lines({ branch: null, changes: null, costToday: null, lastActivity: null }), []);
  // The contact was deleted while the mouse was on it.
  assert.deepEqual(lines(null), []);
});

test('a contact with guests in its conversation says who it is with', async () => {
  await loadCardLines();
  const { companyOf } = await import('../src/renderer/contacts/card.js');
  assert.equal(companyOf({ guests: [{ id: 'g1', name: 'Codex' }] }), 'with Codex');
  assert.equal(
    companyOf({ guests: [{ name: 'Codex' }, { name: 'Gemini' }, { name: 'OpenCode' }] }),
    'with Codex, Gemini and OpenCode'
  );
  assert.equal(companyOf({ guests: [] }), '');
  assert.equal(companyOf({}), '', 'a contact on its own says nothing');
});

test('a branch with a pull request gets a line that is a link, under the branch', async () => {
  await loadCardLines();
  const { cardLines } = await import('../src/renderer/contacts/card.js');
  const pr = {
    number: 128,
    url: 'https://github.com/you/project/pull/128',
    title: 'Add a hover card',
    state: 'draft',
  };
  const lines = cardLines({ branch: 'feature/hover-card', changes: 0, costToday: null, lastActivity: null, pr }, NOON);
  assert.deepEqual(lines, [
    { icon: 'branch', text: 'feature/hover-card' },
    { icon: 'pr', text: 'Pull request #128 (draft)', url: pr.url, title: 'Add a hover card' },
    { icon: 'clean', text: 'No uncommitted changes' },
  ]);
  const text = (state) => cardLines({ branch: 'b', pr: { ...pr, state } }, NOON)[1].text;
  assert.equal(text('open'), 'Pull request #128');
  assert.equal(text('merged'), 'Pull request #128 (merged)');
  assert.equal(text('closed'), 'Pull request #128 (closed)');
  assert.equal(cardLines({ branch: 'b', pr: null }, NOON).length, 1, 'no pull request, no line');
});

test('the pull request line says how its checks stand, and is still the link', async () => {
  await loadCardLines();
  const { cardLines } = await import('../src/renderer/contacts/card.js');
  const pr = { number: 12, url: 'https://github.com/you/project/pull/12', title: 'Add a hover card', state: 'open' };
  const line = (checks, state = 'open') => cardLines({ branch: 'b', pr: { ...pr, state, checks } }, NOON)[1];
  assert.deepEqual(line({ failing: 2, pending: 1, passed: 7 }), {
    icon: 'pr',
    text: 'Pull request #12 · 2 checks failing',
    url: pr.url,
    title: 'Add a hover card',
  });
  assert.equal(line({ failing: 1, pending: 0, passed: 7 }).text, 'Pull request #12 · 1 check failing');
  assert.equal(line({ failing: 0, pending: 3, passed: 7 }).text, 'Pull request #12 · checks running');
  assert.equal(line({ failing: 0, pending: 0, passed: 7 }).text, 'Pull request #12 · checks passed');
  assert.equal(line({ failing: 0, pending: 2, passed: 0 }, 'draft').text, 'Pull request #12 (draft) · checks running');
  assert.equal(line(undefined).text, 'Pull request #12', 'no checks, nothing extra');
});

// ---- the branch's pull request ----------------------------------------------------------------

const GH = (fields = {}) =>
  JSON.stringify({
    isDraft: false,
    number: 12,
    state: 'OPEN',
    title: 'Add a hover card',
    url: 'https://github.com/you/project/pull/12',
    ...fields,
  });

test('what gh prints becomes a pull request: its number, address, title and state', () => {
  assert.deepEqual(parsePullRequest(GH()), {
    number: 12,
    url: 'https://github.com/you/project/pull/12',
    title: 'Add a hover card',
    state: 'open',
  });
  assert.equal(parsePullRequest(GH({ isDraft: true })).state, 'draft');
  assert.equal(parsePullRequest(GH({ state: 'MERGED' })).state, 'merged');
  assert.equal(parsePullRequest(GH({ state: 'CLOSED', isDraft: true })).state, 'closed', 'closed wins over draft');
  assert.equal(parsePullRequest(GH({ title: undefined })).title, '');
});

test('a pull request with conflicts says so; one that merges cleanly, or is still being worked out, does not', () => {
  assert.equal(parsePullRequest(GH({ mergeable: 'CONFLICTING' })).conflict, true);
  assert.equal(parsePullRequest(GH({ mergeable: 'CONFLICTING', isDraft: true })).conflict, true);
  for (const mergeable of ['MERGEABLE', 'UNKNOWN', undefined, 'conflicting', 42]) {
    assert.equal('conflict' in parsePullRequest(GH({ mergeable })), false, String(mergeable));
  }
});

test('a merged or closed pull request has no conflicts to resolve', () => {
  assert.equal('conflict' in parsePullRequest(GH({ state: 'MERGED', mergeable: 'CONFLICTING' })), false);
  assert.equal('conflict' in parsePullRequest(GH({ state: 'CLOSED', mergeable: 'CONFLICTING' })), false);
});

test('one GitHub is to merge by itself says how', () => {
  const merged = (mergeMethod, fields) => parsePullRequest(GH({ autoMergeRequest: { mergeMethod }, ...fields }));
  assert.equal(merged('SQUASH').autoMerge, 'squash');
  assert.equal(merged('MERGE').autoMerge, 'merge');
  assert.equal(merged('REBASE').autoMerge, 'rebase');
  assert.equal(merged('SQUASH', { isDraft: true }).autoMerge, 'squash');
});

test('with auto-merge off, or a way GitHub has no name for, it says nothing of it', () => {
  assert.equal('autoMerge' in parsePullRequest(GH()), false, 'gh was not asked for it');
  for (const autoMergeRequest of [null, {}, 'SQUASH', { mergeMethod: 'squash' }, { mergeMethod: 'constructor' }]) {
    assert.equal('autoMerge' in parsePullRequest(GH({ autoMergeRequest })), false, JSON.stringify(autoMergeRequest));
  }
});

test('a merged or closed pull request is not waiting to be merged', () => {
  for (const state of ['MERGED', 'CLOSED']) {
    assert.equal('autoMerge' in parsePullRequest(GH({ state, autoMergeRequest: { mergeMethod: 'SQUASH' } })), false);
  }
});

test('how many lines it adds and removes comes along, merged or not', () => {
  assert.deepEqual(parsePullRequest(GH({ additions: 2173, deletions: 54 })).lines, { added: 2173, removed: 54 });
  assert.deepEqual(parsePullRequest(GH({ additions: 0, deletions: 0 })).lines, { added: 0, removed: 0 });
  assert.deepEqual(parsePullRequest(GH({ state: 'MERGED', additions: 3, deletions: 1 })).lines, {
    added: 3,
    removed: 1,
  });
});

test('without both counts, or with counts that are not whole numbers, it says nothing of its size', () => {
  assert.equal('lines' in parsePullRequest(GH()), false, 'gh was not asked for them');
  for (const [additions, deletions] of [
    [12, undefined],
    [undefined, 3],
    ['12', 3],
    [12, null],
    [1.5, 2],
  ]) {
    const pr = parsePullRequest(GH({ additions, deletions }));
    assert.equal('lines' in pr, false, `${additions} / ${deletions}`);
  }
});

test('anything else gh might print is no pull request', () => {
  for (const output of ['', 'no pull requests found for branch "main"', '[]', 'null', '{}', '42']) {
    assert.equal(parsePullRequest(output), null, output);
  }
  assert.equal(parsePullRequest(GH({ number: '12' })), null, 'a number that is not one');
  assert.equal(parsePullRequest(GH({ url: undefined })), null);
});

test('only a web address is ever handed to the windows as a link', () => {
  for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'http://github.com/you/project/pull/12', 12]) {
    assert.equal(parsePullRequest(GH({ url })), null, String(url));
  }
});

test('the pull request of a folder is asked of gh, there', async () => {
  const asked = [];
  const run = async (cwd) => (asked.push(cwd), GH({ isDraft: true }));
  const pr = await pullRequest('/projects/asked-there', { run, now: () => 0 });
  assert.deepEqual(asked, ['/projects/asked-there']);
  assert.equal(pr.number, 12);
  assert.equal(pr.state, 'draft');
});

test('no pull request, and anything gh prints that is not one, come back as nothing', async () => {
  assert.equal(await pullRequest('/projects/none', { run: async () => null, now: () => 0 }), null);
  assert.equal(await pullRequest('/projects/garbage', { run: async () => 'oops', now: () => 0 }), null);
  assert.equal(await pullRequest('', { run: async () => GH() }), null, 'nor is gh asked without a folder');
  assert.equal(await pullRequest(undefined, { run: async () => GH() }), null);
});

test('hovering again within half a minute does not ask GitHub again, and later it does', async () => {
  let asks = 0;
  let time = 1000;
  const answers = [GH({ isDraft: true }), GH()];
  const opts = { run: async () => answers[asks++], now: () => time };
  assert.equal((await pullRequest('/projects/cached', opts)).state, 'draft');
  time += 29_000;
  assert.equal((await pullRequest('/projects/cached', opts)).state, 'draft');
  assert.equal(asks, 1);
  time += 2_000;
  assert.equal((await pullRequest('/projects/cached', opts)).state, 'open', 'marked ready in the meantime');
  assert.equal(asks, 2);
  // Each folder has its own answer.
  await pullRequest('/projects/another', { run: async () => (asks++, null), now: () => time });
  assert.equal(asks, 3);
});

test('"there is none" is remembered for that half minute too', async () => {
  let asks = 0;
  const opts = { run: async () => (asks++, null), now: () => 5000 };
  assert.equal(await pullRequest('/projects/none-yet', opts), null);
  assert.equal(await pullRequest('/projects/none-yet', opts), null);
  assert.equal(asks, 1);
});

test('when gh cannot tell, the caller hears of it, and gh is left alone for that half minute too', async () => {
  let asks = 0;
  const signedOut = Object.assign(new Error('Command failed: gh pr view'), { code: 4 });
  const answers = [signedOut, GH()];
  const run = async () => {
    const answer = answers[asks++];
    if (answer instanceof Error) throw answer;
    return answer;
  };
  await assert.rejects(pullRequest('/projects/no-telling', { run, now: () => 0 }), signedOut);
  // Not the same as "there is none": the caller can tell the two apart.
  await assert.rejects(pullRequest('/projects/no-telling', { run, now: () => 29_000 }), signedOut);
  assert.equal(asks, 1);
  assert.equal((await pullRequest('/projects/no-telling', { run, now: () => 30_000 })).number, 12);
  assert.equal(asks, 2);
});

test('two looks at the same folder at once are one question to gh', async () => {
  let asks = 0;
  let finish;
  const run = () => {
    asks += 1;
    return new Promise((resolve) => {
      finish = () => resolve(GH({ isDraft: true }));
    });
  };
  const first = pullRequest('/projects/asked-twice-at-once', { run, now: () => 0 });
  const second = pullRequest('/projects/asked-twice-at-once', { run, now: () => 5 });
  finish();
  assert.deepEqual(await first, await second);
  assert.equal((await first).state, 'draft');
  assert.equal(asks, 1);
});

test('a folder put on another branch is asked about anew, half a minute or not', async () => {
  let asks = 0;
  const answers = [GH({ state: 'MERGED' }), null, null];
  const opts = { run: async () => answers[asks++], now: () => 1000 };
  assert.equal((await pullRequest('/projects/moved', opts)).state, 'merged');
  forgetPullRequest('/projects/moved');
  assert.equal(await pullRequest('/projects/moved', opts), null, 'the new branch has none');
  assert.equal(asks, 2);
  // That answer is remembered as any other is.
  assert.equal(await pullRequest('/projects/moved', opts), null);
  assert.equal(asks, 2);
  // A folder nobody asked about has nothing to forget.
  forgetPullRequest('/projects/never-asked');
});

test('an answer still on its way when the folder changes branch is not handed to the next to ask', async () => {
  const finish = [];
  const run = () => new Promise((resolve) => finish.push(resolve));
  const before = pullRequest('/projects/moved-meanwhile', { run, now: () => 0 });
  forgetPullRequest('/projects/moved-meanwhile');
  const after = pullRequest('/projects/moved-meanwhile', { run, now: () => 5 });
  finish[0](GH({ state: 'MERGED' }));
  finish[1](null);
  assert.equal((await before).state, 'merged');
  assert.equal(await after, null);
});

// ---- a branch named as one whose pull request is over -------------------------------------------

const MERGED_AT = '2026-10-20T14:16:00Z';
const PR_HEAD = 'd7a1e1955efe5bf1fd0d602e81876f9965c750cb';
const MAIN = '9b2aa4174c2f8aaafa7082d2b0cdbdab4c586a10';
const ENDED = (fields) => GH({ state: 'MERGED', closedAt: MERGED_AT, headRefOid: PR_HEAD, ...fields });

test('a branch made after a pull request of its name was merged has none: that one was an earlier branch’s', async () => {
  const made = { at: Date.parse('2026-10-24T09:00:00Z'), commit: MAIN };
  const looked = [];
  const started = async (cwd) => (looked.push(cwd), made);
  assert.equal(await pullRequest('/projects/name-again', { run: async () => ENDED(), started, now: () => 0 }), null);
  assert.deepEqual(looked, ['/projects/name-again']);
  const closed = ENDED({ state: 'CLOSED' });
  assert.equal(
    await pullRequest('/projects/name-again-closed', { run: async () => closed, started, now: () => 0 }),
    null
  );
});

test('a pull request merged or closed after its branch was made here is still its own', async () => {
  const started = async () => ({ at: Date.parse('2026-10-19T09:00:00Z'), commit: MAIN });
  const merged = await pullRequest('/projects/merged-later', { run: async () => ENDED(), started, now: () => 0 });
  assert.equal(merged.state, 'merged');
  const closed = ENDED({ state: 'CLOSED' });
  assert.equal(
    (await pullRequest('/projects/closed-later', { run: async () => closed, started, now: () => 0 })).state,
    'closed'
  );
});

test('a branch made on the last commit of a merged pull request is its own, as one started from it is', async () => {
  const started = async () => ({ at: Date.parse('2026-10-24T09:00:00Z'), commit: PR_HEAD });
  const pr = await pullRequest('/projects/started-from-it', { run: async () => ENDED(), started, now: () => 0 });
  assert.equal(pr.state, 'merged');
});

test('when git cannot say when the branch was made, a merged pull request stands', async () => {
  const pr = await pullRequest('/projects/no-reflog', {
    run: async () => ENDED(),
    started: async () => null,
    now: () => 0,
  });
  assert.equal(pr.state, 'merged');
});

test('git is only asked about a pull request that is over, and gh says when', async () => {
  let looks = 0;
  const started = async () => (looks++, { at: Date.parse('2026-10-24T09:00:00Z'), commit: MAIN });
  for (const [cwd, output] of [
    ['/projects/open', GH({ closedAt: null, headRefOid: PR_HEAD })],
    ['/projects/draft', GH({ isDraft: true })],
    ['/projects/merged-no-date', GH({ state: 'MERGED', headRefOid: PR_HEAD })],
    ['/projects/none-at-all', null],
  ]) {
    await pullRequest(cwd, { run: async () => output, started, now: () => 0 });
  }
  assert.equal(looks, 0);
});

test('a folder on no branch keeps the merged pull request it had, by its page', async () => {
  const gh = ghOf({ page: () => ENDED() });
  const started = async () => ({ at: Date.parse('2026-10-24T09:00:00Z'), commit: MAIN });
  const known = { number: 12, url: 'https://github.com/you/project/pull/12', title: '', state: 'open' };
  const pr = await pullRequest('/projects/left-on-main-later', { ...gh, known, started, now: () => 0 });
  assert.equal(pr.state, 'merged');
});

test(
  'a real branch: when and on which commit it was made, kept through a rename, new once made again',
  { skip: !HAS_GIT },
  async () => {
    const dir = tmp();
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
    git('init', '--quiet');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '--allow-empty', '-m', 'start');
    const first = git('rev-parse', 'HEAD');
    const before = Math.floor(Date.now() / 1000) * 1000;
    git('checkout', '--quiet', '-b', 'shop-8');
    const made = await branchStart(dir);
    assert.equal(made.commit, first);
    assert.ok(made.at >= before && made.at <= Date.now(), 'now, to the second');

    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '--allow-empty', '-m', 'work');
    git('branch', '-m', 'shop-8', 'fix-the-login');
    assert.deepEqual(await branchStart(dir), made, 'a commit and a rename later, it was still made then');

    // Deleted, and a branch of the same name made again elsewhere: that one starts anew.
    git('checkout', '--quiet', '--detach');
    assert.equal(await branchStart(dir), null, 'on no branch');
    git('branch', '--quiet', '-D', 'fix-the-login');
    git('checkout', '--quiet', '-b', 'fix-the-login', first);
    const again = await branchStart(dir);
    assert.equal(again.commit, first);
    assert.ok(again.at >= made.at);
    // The reflog of a branch made again has nothing of the one deleted.
    assert.equal(git('reflog', 'show', '--format=%H', 'refs/heads/fix-the-login', '--').split('\n').length, 1);

    assert.equal(await branchStart(tmp()), null, 'no repository');
    assert.equal(await branchStart(''), null, 'no folder');
  }
);

// ---- a folder with no branch checked out --------------------------------------------------------

const notOnABranch = () =>
  Object.assign(new Error('Command failed: gh pr view'), {
    stderr: 'could not determine current branch: failed to run git: not on any branch',
  });

/**
 * A gh that answers for a folder's branch while it has one, and can't tell which branch otherwise,
 * and for the page of a pull request whatever the folder is on. It notes what it was asked.
 */
function ghOf({ branch = () => GH(), page = () => GH({ state: 'MERGED' }), onBranch = false } = {}) {
  const asked = [];
  return {
    asked,
    onBranch: async () => onBranch,
    run: async (cwd, at) => {
      asked.push(at ? [cwd, at] : cwd);
      if (!at && onBranch === false) throw notOnABranch();
      const answer = at ? page() : branch();
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
}

test('a folder on no branch is asked about by the page of the pull request it had, there', async () => {
  const gh = ghOf();
  const known = { number: 12, url: 'https://github.com/you/project/pull/12/checks', title: '', state: 'open' };
  const pr = await pullRequest('/projects/left-on-main', { ...gh, known, now: () => 0 });
  assert.equal(pr.state, 'merged');
  assert.equal(pr.number, 12);
  assert.deepEqual(gh.asked, [
    '/projects/left-on-main',
    ['/projects/left-on-main', 'https://github.com/you/project/pull/12'],
  ]);
});

test('a folder on no branch, with no pull request known, has none: gh is not asked about any page', async () => {
  const gh = ghOf();
  assert.equal(await pullRequest('/projects/on-main-from-the-start', { ...gh, now: () => 0 }), null);
  const none = { known: null, now: () => 0 };
  assert.equal(await pullRequest('/projects/on-main-with-none', { ...gh, ...none }), null);
  // Nor is anything that is not the page of a pull request handed to gh.
  const odd = { known: { number: 12, url: '--web', state: 'open' }, now: () => 0 };
  assert.equal(await pullRequest('/projects/on-main-with-an-odd-one', { ...gh, ...odd }), null);
  assert.deepEqual(gh.asked, [
    '/projects/on-main-from-the-start',
    '/projects/on-main-with-none',
    '/projects/on-main-with-an-odd-one',
  ]);
});

test('gh failing on a folder that has a branch, or where git cannot tell, is still no answer', async () => {
  const known = { number: 12, url: 'https://github.com/you/project/pull/12', state: 'open' };
  const offline = Object.assign(new Error('Command failed: gh pr view'), {
    stderr: 'error connecting to api.github.com',
  });
  for (const onBranch of [true, null]) {
    const gh = ghOf({ branch: () => offline, onBranch });
    const cwd = `/projects/offline-${onBranch}`;
    await assert.rejects(pullRequest(cwd, { ...gh, known, now: () => 0 }), offline);
    assert.deepEqual(gh.asked, [cwd], 'its page is not asked about instead');
  }
});

test('a folder on no branch while GitHub cannot be reached is no answer either', async () => {
  const offline = new Error('error connecting to api.github.com');
  const gh = ghOf({ page: () => offline });
  const known = { number: 12, url: 'https://github.com/you/project/pull/12', state: 'open' };
  await assert.rejects(pullRequest('/projects/on-main-offline', { ...gh, known, now: () => 0 }), offline);
});

test('what gh said of a folder on no branch is remembered for half a minute, and forgotten with it', async () => {
  const gh = ghOf();
  const known = { number: 12, url: 'https://github.com/you/project/pull/12', state: 'open' };
  const opts = { ...gh, known, now: () => 0 };
  await pullRequest('/projects/on-main-twice', opts);
  assert.equal((await pullRequest('/projects/on-main-twice', opts)).state, 'merged');
  assert.equal(gh.asked.length, 2, 'the folder, then the page: once');
  forgetPullRequest('/projects/on-main-twice');
  await pullRequest('/projects/on-main-twice', opts);
  assert.equal(gh.asked.length, 4);
});

test(
  'git tells a folder on a branch from one on none, and from one it cannot tell of',
  { skip: !HAS_GIT },
  async () => {
    const dir = tmp();
    const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
    git('init', '--quiet', '-b', 'main');
    // A repository with no commit yet is on its branch all the same.
    assert.equal(await branchCheckedOut(dir), true);
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '--allow-empty', '-m', 'start');
    assert.equal(await branchCheckedOut(dir), true);
    git('checkout', '--quiet', '--detach');
    assert.equal(await branchCheckedOut(dir), false);
    git('checkout', '--quiet', 'main');
    assert.equal(await branchCheckedOut(dir), true);
    assert.equal(await branchCheckedOut(tmp()), null, 'no repository');
    assert.equal(await branchCheckedOut(path.join(tmp(), 'deleted')), null, 'no folder');
    assert.equal(await branchCheckedOut(''), null);
  }
);

// ---- a pull request shared in a conversation, by its page --------------------------------------

test('a pull request linked in a conversation is asked of gh by its page, whichever of its tabs was linked', async () => {
  const asked = [];
  const run = async (page) => (asked.push(page), GH({ state: 'MERGED' }));
  const links = [
    'https://github.com/o/r/pull/12',
    'https://github.com/o/r/pull/13/files#diff-1',
    'https://github.com/o/r/pull/14#issuecomment-9',
    'https://github.com/o/r/pull/15?w=1',
    'https://git.example.com/team/app.v2/pull/16/',
  ];
  for (const link of links) assert.equal((await pullRequestAt(link, { run, now: () => 0 })).state, 'merged');
  assert.deepEqual(asked, [
    'https://github.com/o/r/pull/12',
    'https://github.com/o/r/pull/13',
    'https://github.com/o/r/pull/14',
    'https://github.com/o/r/pull/15',
    'https://git.example.com/team/app.v2/pull/16',
  ]);
});

test('gh is handed nothing that is not the page of a pull request', async () => {
  const run = async () => assert.fail('gh was asked');
  const notPages = [
    'https://github.com/o/r/issues/12',
    'https://github.com/o/r/pull/',
    'http://github.com/o/r/pull/12',
    '--web https://github.com/o/r/pull/12',
    'https://github.com/o/r/pull/12 --web',
    'https://github.com/o/r/pull/12abc',
    'file:///o/r/pull/12',
    '',
    undefined,
    12,
  ];
  for (const url of notPages) assert.equal(await pullRequestAt(url, { run, now: () => 0 }), null, String(url));
});

test('the same pull request linked again within half a minute is one question to gh, from any of its tabs', async () => {
  let asks = 0;
  let time = 0;
  const answers = [GH(), GH({ state: 'MERGED' })];
  const opts = { run: async () => answers[asks++], now: () => time };
  assert.equal((await pullRequestAt('https://github.com/o/r/pull/77', opts)).state, 'open');
  time += 29_000;
  assert.equal((await pullRequestAt('https://github.com/o/r/pull/77/checks', opts)).state, 'open');
  assert.equal(asks, 1);
  time += 2_000;
  assert.equal((await pullRequestAt('https://github.com/o/r/pull/77', opts)).state, 'merged');
  assert.equal(asks, 2);
});

test('when gh cannot tell about a shared pull request, the caller hears of it', async () => {
  const offline = Object.assign(new Error('Command failed: gh pr view'), {
    stderr: 'error connecting to api.github.com',
  });
  const run = async () => {
    throw offline;
  };
  await assert.rejects(pullRequestAt('https://github.com/o/r/pull/78', { run, now: () => 0 }), offline);
});

// ---- how the pull request's checks stand ------------------------------------------------------

// As `gh pr view --json statusCheckRollup` prints them: check runs carry a status and,
// once done, a conclusion; commit statuses carry only a state. Each is another check
// unless it is given the name of one already made.
let checksMade = 0;
const checkRun = (status, conclusion = '', fields = {}) => ({
  __typename: 'CheckRun',
  completedAt: status === 'COMPLETED' ? '2026-10-06T16:04:24Z' : '0001-01-01T00:00:00Z',
  conclusion,
  detailsUrl: 'https://github.com/you/project/actions/runs/1/job/2',
  name: `test ${++checksMade}`,
  startedAt: '2026-10-06T16:04:20Z',
  status,
  workflowName: 'CI',
  ...fields,
});
const finished = (conclusion, fields) => checkRun('COMPLETED', conclusion, fields);
const commitStatus = (state, fields = {}) => ({
  __typename: 'StatusContext',
  context: `ci/deploy-preview-${++checksMade}`,
  startedAt: '2026-10-06T16:04:20Z',
  state,
  targetUrl: 'https://example.com/build/1',
  ...fields,
});
const checksOf = (rollup) => parsePullRequest(GH({ statusCheckRollup: rollup }))?.checks;

test('a pull request without checks says nothing about them', () => {
  assert.equal('checks' in parsePullRequest(GH()), false, 'gh was not asked for them');
  assert.equal('checks' in parsePullRequest(GH({ statusCheckRollup: [] })), false);
  assert.equal('checks' in parsePullRequest(GH({ statusCheckRollup: null })), false);
});

test('check runs and commit statuses are counted together', () => {
  const rollup = [
    finished('SUCCESS'),
    finished('SUCCESS'),
    finished('FAILURE'),
    checkRun('IN_PROGRESS'),
    commitStatus('SUCCESS'),
    commitStatus('FAILURE'),
    commitStatus('PENDING'),
    finished('SKIPPED'),
  ];
  assert.deepEqual(checksOf(rollup), { failing: 2, pending: 2, passed: 3 });
  assert.deepEqual(parsePullRequest(GH({ isDraft: true, statusCheckRollup: rollup })), {
    number: 12,
    url: 'https://github.com/you/project/pull/12',
    title: 'Add a hover card',
    state: 'draft',
    checks: { failing: 2, pending: 2, passed: 3 },
  });
});

test('skipped and neutral checks are neither failures nor pending', () => {
  assert.deepEqual(checksOf([finished('SUCCESS'), finished('SKIPPED'), finished('NEUTRAL')]), {
    failing: 0,
    pending: 0,
    passed: 1,
  });
  assert.equal(
    checksOf([finished('SKIPPED'), finished('NEUTRAL'), finished('SKIPPED')]),
    undefined,
    'nothing left to say'
  );
});

test('timed out, waiting for someone to act and never started all count as failing', () => {
  for (const conclusion of ['FAILURE', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE']) {
    assert.deepEqual(checksOf([finished(conclusion)]), { failing: 1, pending: 0, passed: 0 }, conclusion);
  }
  // A commit status has no conclusion: its state says it.
  for (const state of ['FAILURE', 'ERROR']) {
    assert.deepEqual(checksOf([commitStatus(state)]), { failing: 1, pending: 0, passed: 0 }, state);
  }
});

test('a cancelled check is not counted, as the Checks tab says nothing of it either', () => {
  assert.deepEqual(checksOf([finished('SUCCESS'), finished('CANCELLED')]), { failing: 0, pending: 0, passed: 1 });
  assert.equal(checksOf([finished('CANCELLED')]), undefined, 'nothing left to say');
});

// When each run of a check started.
const FIRST = '2026-10-06T16:04:20Z';
const LATER = '2026-10-06T16:09:00Z';

test('a check run again counts as its latest run left it, whichever order GitHub lists them in', () => {
  const rerun = (first, then) => [
    finished(first, { name: 'rspec', startedAt: FIRST }),
    finished(then, { name: 'rspec', startedAt: LATER }),
  ];
  assert.deepEqual(checksOf(rerun('FAILURE', 'SUCCESS')), { failing: 0, pending: 0, passed: 1 }, 'fixed by a re-run');
  assert.deepEqual(checksOf(rerun('SUCCESS', 'FAILURE')), { failing: 1, pending: 0, passed: 0 }, 'broken by one');
  assert.deepEqual(checksOf(rerun('SUCCESS', 'FAILURE').reverse()), { failing: 1, pending: 0, passed: 0 });
  assert.deepEqual(
    checksOf([
      finished('FAILURE', { name: 'rspec', startedAt: FIRST }),
      checkRun('IN_PROGRESS', '', { name: 'rspec', startedAt: LATER }),
    ]),
    { failing: 0, pending: 1, passed: 0 },
    'running again'
  );
  // Started at the same moment, the one listed last is taken as the latest.
  assert.deepEqual(checksOf(rerun('FAILURE', 'SUCCESS').map((run) => ({ ...run, startedAt: FIRST }))), {
    failing: 0,
    pending: 0,
    passed: 1,
  });
});

test('a commit status reported again counts as it was last reported', () => {
  const rollup = [
    commitStatus('FAILURE', { context: 'ci/deploy-preview', startedAt: FIRST }),
    commitStatus('SUCCESS', { context: 'ci/deploy-preview', startedAt: LATER }),
  ];
  assert.deepEqual(checksOf(rollup), { failing: 0, pending: 0, passed: 1 });
});

test('checks of the same name in other workflows, or a commit status named like one, are checks of their own', () => {
  const rollup = [
    finished('SUCCESS', { name: 'lint', workflowName: 'Ruby' }),
    finished('FAILURE', { name: 'lint', workflowName: 'JavaScript' }),
    commitStatus('PENDING', { context: 'lint' }),
  ];
  assert.deepEqual(checksOf(rollup), { failing: 1, pending: 1, passed: 1 });
});

test('the runs a newer event cancelled leave no failures behind', () => {
  // A label added just after a push starts the workflows over, and the first runs are cancelled.
  const rollup = ['changes', 'pr-ci-bootstrap', 'labeler'].flatMap((name) => [
    finished('CANCELLED', { name, startedAt: FIRST }),
    finished('SUCCESS', { name, startedAt: LATER }),
  ]);
  rollup.push(finished('SKIPPED', { name: 'storybook', startedAt: FIRST }));
  rollup.push(finished('SKIPPED', { name: 'storybook', startedAt: LATER }));
  assert.deepEqual(checksOf(rollup), { failing: 0, pending: 0, passed: 3 });
});

test('a check that is not done yet is pending, whatever it is waiting for', () => {
  for (const waiting of ['QUEUED', 'IN_PROGRESS', 'WAITING', 'PENDING', 'REQUESTED']) {
    assert.deepEqual(checksOf([checkRun(waiting)]), { failing: 0, pending: 1, passed: 0 }, waiting);
  }
  for (const state of ['PENDING', 'EXPECTED']) {
    assert.deepEqual(checksOf([commitStatus(state)]), { failing: 0, pending: 1, passed: 0 }, state);
  }
  // GitHub gave up waiting for it; gh counts it as pending too.
  assert.deepEqual(checksOf([finished('STALE')]), { failing: 0, pending: 1, passed: 0 });
});

test('only a finished check run is judged by its conclusion', () => {
  assert.deepEqual(checksOf([checkRun('IN_PROGRESS', 'FAILURE')]), { failing: 0, pending: 1, passed: 0 });
  assert.deepEqual(checksOf([checkRun('QUEUED', 'SUCCESS')]), { failing: 0, pending: 1, passed: 0 });
});

test('a rollup that is not the list we asked for counts no checks', () => {
  for (const rollup of ['oops', 42, {}, { nodes: [finished('FAILURE')] }]) {
    assert.equal(checksOf(rollup), undefined, JSON.stringify(rollup));
  }
  // What isn't a check in the list is passed over; the rest still counts.
  assert.deepEqual(checksOf([null, 7, 'x', {}, { status: 42 }, finished('FAILURE')]), {
    failing: 1,
    pending: 0,
    passed: 0,
  });
  assert.equal(parsePullRequest(GH({ statusCheckRollup: 'oops' })).number, 12, 'and it is still a pull request');
});

// ---- the real gh, stood in for by a script ----------------------------------------------------

/** A folder holding a `gh` that notes what it was asked, then does what `script` says. */
function fakeGh(script) {
  const bin = tmp();
  fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/sh\nprintf '%s' "$*" > '${bin}/asked'\n${script}\n`, { mode: 0o755 });
  return bin;
}

/** Runs `fn` with only `bin` to find programs in. */
async function withPath(bin, fn) {
  const before = process.env.PATH;
  process.env.PATH = bin;
  try {
    return await fn();
  } finally {
    process.env.PATH = before;
  }
}

const NO_SHELL = process.platform === 'win32';

test(
  'gh is asked for the pull request, its checks, its conflicts, its auto-merge and its size in one call, and only to look',
  { skip: NO_SHELL },
  async () => {
    const answer = GH({
      statusCheckRollup: [finished('SUCCESS'), commitStatus('FAILURE')],
      mergeable: 'CONFLICTING',
      autoMergeRequest: { mergeMethod: 'SQUASH' },
      additions: 2173,
      deletions: 54,
    });
    const bin = fakeGh(`printf '%s' '${answer}'`);
    const pr = await withPath(bin, () => pullRequest(tmp()));
    assert.equal(pr.number, 12);
    assert.deepEqual(pr.checks, { failing: 1, pending: 0, passed: 1 });
    assert.equal(pr.conflict, true);
    assert.equal(pr.autoMerge, 'squash');
    assert.deepEqual(pr.lines, { added: 2173, removed: 54 });
    assert.equal(
      fs.readFileSync(path.join(bin, 'asked'), 'utf8'),
      'pr view --json number,url,title,state,isDraft,statusCheckRollup,mergeable,autoMergeRequest,additions,deletions,headRefOid,headRefName,headRepository,headRepositoryOwner,isCrossRepository,closedAt'
    );
  }
);

test('a branch without a pull request is an answer: there is none', { skip: NO_SHELL }, async () => {
  const bin = fakeGh(`echo 'no pull requests found for branch "main"' >&2\nexit 1`);
  assert.equal(await withPath(bin, () => pullRequest(tmp())), null);
});

test('signed out, offline or anything else gh fails on is no answer at all', { skip: NO_SHELL }, async () => {
  const signedOut = fakeGh(`echo 'To get started with GitHub CLI, please run:  gh auth login' >&2\nexit 4`);
  await assert.rejects(withPath(signedOut, () => pullRequest(tmp())));
  const offline = fakeGh(`echo 'error connecting to api.github.com' >&2\nexit 1`);
  await assert.rejects(withPath(offline, () => pullRequest(tmp())));
});

test('with gh missing there is no answer either', { skip: NO_SHELL }, async () => {
  // A folder with nothing in it is all there is to look for programs in.
  await assert.rejects(
    withPath(tmp(), () => pullRequest(tmp())),
    { code: 'ENOENT' }
  );
});

test(
  'a real folder left on no branch has gh asked about the pull request it had, by its page',
  { skip: NO_SHELL || !HAS_GIT },
  async () => {
    const dir = tmp();
    const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
    git('init', '--quiet', '-b', 'feature/hover-card');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '--allow-empty', '-m', 'start');
    git('checkout', '--quiet', '--detach');
    // As gh answers: about a page whatever the folder is on, and about the branch of a folder on none, not at all.
    const bin = fakeGh(
      `case "$3" in https://*) printf '%s' '${GH({ state: 'MERGED' })}' ;; *) ` +
        `echo 'could not determine current branch: failed to run git: not on any branch' >&2; exit 1 ;; esac`
    );
    const known = { number: 12, url: 'https://github.com/you/project/pull/12', title: '', state: 'open' };
    // git is found where it always is, after this gh.
    const pr = await withPath(`${bin}${path.delimiter}${process.env.PATH}`, () => pullRequest(dir, { known }));
    assert.equal(pr.state, 'merged');
    assert.equal(
      fs.readFileSync(path.join(bin, 'asked'), 'utf8'),
      'pr view https://github.com/you/project/pull/12 --json number,url,title,state,isDraft,statusCheckRollup,mergeable,autoMergeRequest,additions,deletions,headRefOid,headRefName,headRepository,headRepositoryOwner,isCrossRepository,closedAt'
    );
  }
);

test(
  'a real worktree made on a name whose pull request was merged days ago has none, until it opens its own',
  { skip: NO_SHELL || !HAS_GIT },
  async () => {
    const repo = tmp();
    const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
    git('init', '--quiet', '-b', 'main');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '--allow-empty', '-m', 'start');
    const worktree = path.join(tmp(), 'shop-8');
    git('worktree', 'add', '--quiet', '-b', 'shop-8', worktree);
    // gh finds pull requests by the branch's name: the merged one of the shop-8 made before, then a new one.
    const answers = path.join(tmp(), 'answers');
    fs.writeFileSync(answers, ENDED());
    const bin = fakeGh(`cat '${answers}'`);
    const withGh = (fn) => withPath(`${bin}${path.delimiter}${process.env.PATH}`, fn);
    assert.equal(await withGh(() => pullRequest(worktree)), null);

    forgetPullRequest(worktree);
    fs.writeFileSync(answers, GH({ number: 13, closedAt: null, headRefOid: PR_HEAD }));
    assert.equal((await withGh(() => pullRequest(worktree))).number, 13);
  }
);
