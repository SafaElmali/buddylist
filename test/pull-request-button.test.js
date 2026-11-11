import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  autoMergeNotice,
  autoMergeText,
  branchPage,
  comparePage,
  fixConflictsMessage,
  fixConflictsTip,
  pullRequestButton,
  pullRequestMenuItems,
  pullRequestMessage,
  repositoryPage,
} from '../src/shared/pull-request-button.js';
import { mentions } from '../src/shared/mentions.js';

const pr = (fields = {}) => ({
  number: 12,
  url: 'https://github.com/acme/shop/pull/12',
  title: 'Add a hover card',
  state: 'open',
  ...fields,
});
const contact = (fields = {}) => ({ status: 'online', pullRequest: null, ...fields });

// ---- the button's face ---------------------------------------------------------------------------

test('a branch without a pull request gets a button that asks for one', () => {
  const face = pullRequestButton(contact(), 'Claude');
  assert.deepEqual([face.label, face.url, face.disabled], ['Create PR', null, false]);
  assert.equal(face.title, 'Ask Claude to commit, push and open a pull request');
});

test('with a choice of agents the tooltip explains that the recipient is chosen next', () => {
  assert.equal(pullRequestButton(contact(), null).title, 'Choose an agent to commit, push and open a pull request');
});

test('before GitHub has said anything, the button asks for one too', () => {
  assert.equal(pullRequestButton({ status: 'online' }, 'Claude').label, 'Create PR');
  assert.equal(pullRequestButton(null, 'Claude').label, 'Create PR');
});

test('a branch with an open pull request gets a button that opens it', () => {
  const face = pullRequestButton(contact({ pullRequest: pr() }), 'Claude');
  assert.deepEqual(
    [face.label, face.url, face.disabled],
    ['View PR #12', 'https://github.com/acme/shop/pull/12', false]
  );
  assert.equal(face.title, 'Pull request #12\nAdd a hover card\nClick to open it on GitHub.');
});

test('a draft is a pull request to view as well, and the tooltip says how its checks stand', () => {
  const draft = pr({ state: 'draft', checks: { failing: 2, pending: 0, passed: 9 } });
  const face = pullRequestButton(contact({ pullRequest: draft }), 'Claude');
  assert.equal(face.label, 'View PR #12');
  assert.match(face.title, /^Pull request #12 \(draft\) · 2 checks failing\n/);
});

test('a pull request without a title has no empty line in its tooltip', () => {
  const face = pullRequestButton(contact({ pullRequest: pr({ title: '' }) }), 'Claude');
  assert.equal(face.title, 'Pull request #12\nClick to open it on GitHub.');
});

test('a merged or closed pull request is still the button, wearing its tag, and opens it', () => {
  const merged = pullRequestButton(contact({ pullRequest: pr({ state: 'merged' }) }), 'Claude');
  assert.deepEqual(
    [merged.label, merged.name, merged.tag, merged.url, merged.disabled],
    ['PR #12 · Merged', 'PR #12', { kind: 'merged', text: 'Merged' }, 'https://github.com/acme/shop/pull/12', false]
  );
  assert.equal(merged.title, 'Pull request #12 (merged)\nAdd a hover card\nClick to open it on GitHub.');
  assert.equal(merged.more, 'Create another pull request on this branch');
  const closed = pullRequestButton(contact({ pullRequest: pr({ state: 'closed', title: '' }) }), 'Claude');
  assert.deepEqual([closed.label, closed.tag], ['PR #12 · Closed', { kind: 'closed', text: 'Closed' }]);
  assert.equal(closed.title, 'Pull request #12 (closed)\nClick to open it on GitHub.');
});

test('only a pull request that is merged or closed wears a tag on the button', () => {
  const faces = [contact(), contact({ pullRequest: pr() }), contact({ pullRequest: pr({ state: 'draft' }) })].map(
    (who) => pullRequestButton(who, 'Claude')
  );
  assert.deepEqual(
    faces.map((face) => [face.name, face.tag, face.more]),
    [
      ['Create PR', null, 'Other ways to create a pull request'],
      ['View PR #12', null, 'Its checks, and auto-merge'],
      ['View PR #12', null, 'Its checks, and auto-merge'],
    ]
  );
});

test('once Continue puts the folder on a new branch, without a pull request, the button asks for one again', () => {
  const merged = contact({ pullRequest: pr({ state: 'merged' }) });
  assert.equal(pullRequestButton(merged, 'Claude').label, 'PR #12 · Merged');
  // startedOver: the new branch has no pull request, and the list says so at once.
  const face = pullRequestButton({ ...merged, pullRequest: null }, 'Claude');
  assert.deepEqual([face.label, face.url, face.tag], ['Create PR', null, null]);
});

test('a folder that is gone has no branch to open a pull request from', () => {
  const face = pullRequestButton(contact({ status: 'offline' }), 'Claude');
  assert.deepEqual([face.label, face.url, face.disabled], ['Create PR', null, true]);
  assert.match(face.title, /folder is gone/);
  // Nor one to view, whatever GitHub said while the folder was there.
  const stale = pullRequestButton(contact({ status: 'offline', pullRequest: pr() }), 'Claude');
  assert.deepEqual([stale.label, stale.url, stale.disabled], ['Create PR', null, true]);
});

test('a busy or waiting contact can still be asked: the message waits in line', () => {
  for (const status of ['busy', 'away']) assert.equal(pullRequestButton(contact({ status }), 'Claude').disabled, false);
});

// ---- how its checks stand, and auto-merge --------------------------------------------------------

const withChecks = (failing, pending, passed, fields) => pr({ checks: { failing, pending, passed }, ...fields });
const faceOf = (pullRequest) => pullRequestButton(contact({ pullRequest }), 'Claude');

test('the button is marked failing while one check fails, even with others still running', () => {
  const face = faceOf(withChecks(2, 3, 6));
  assert.deepEqual([face.checks, face.checksText], ['failing', '2 checks failing']);
  assert.match(face.title, /· 2 checks failing\n/);
});

test('running while any still run and none failed, and passed once they all have', () => {
  assert.deepEqual(
    [faceOf(withChecks(0, 3, 5)).checks, faceOf(withChecks(0, 3, 5)).checksText],
    ['running', 'checks running']
  );
  assert.deepEqual(
    [faceOf(withChecks(0, 0, 1)).checks, faceOf(withChecks(0, 0, 1)).checksText],
    ['passed', 'check passed']
  );
  assert.equal(faceOf(withChecks(0, 0, 9, { state: 'draft' })).checks, 'passed', 'a draft has checks too');
});

test('no checks, no pull request, or one merged or closed, is no mark at all', () => {
  assert.deepEqual([faceOf(pr()).checks, faceOf(pr()).checksText], [null, '']);
  assert.equal(pullRequestButton(contact(), 'Claude').checks, null);
  assert.equal(
    pullRequestButton(contact({ status: 'offline', pullRequest: withChecks(2, 0, 0) }), 'Claude').checks,
    null
  );
  for (const state of ['merged', 'closed']) assert.equal(faceOf(withChecks(2, 0, 3, { state })).checks, null, state);
});

test('auto-merge that is on is part of the face, and its helper line says what GitHub will do', () => {
  const face = faceOf(pr({ autoMerge: 'squash' }));
  assert.equal(face.autoMerge, 'squash');
  assert.equal(
    face.title,
    'Pull request #12\nAdd a hover card\nAuto-merge is on: GitHub will squash and merge it when its requirements are met.\nClick to open it on GitHub.'
  );
  assert.equal(faceOf(pr()).autoMerge, null);
  assert.doesNotMatch(faceOf(pr()).title, /Auto-merge/);
  assert.equal(pullRequestButton(contact(), 'Claude').autoMerge, null);
});

test("auto-merge the app does itself says so in the helper line, ticked in the menu like GitHub's", () => {
  const face = faceOf(pr({ autoMerge: 'squash', appMerges: true }));
  assert.equal(face.autoMerge, 'squash');
  assert.equal(
    face.title,
    'Pull request #12\nAdd a hover card\nAuto-merge is on: buddylist will squash and merge it once its checks pass, while it is open.\nClick to open it on GitHub.'
  );
});

test('a draft is told apart, as GitHub does not merge one', () => {
  assert.equal(faceOf(pr({ state: 'draft' })).draft, true);
  assert.equal(faceOf(pr()).draft, false);
  assert.equal(pullRequestButton(contact(), 'Claude').draft, false);
});

test('what GitHub will do, and what the conversation says once it is turned on or off', () => {
  assert.equal(autoMergeText('squash'), 'GitHub will squash and merge it when its requirements are met.');
  assert.equal(autoMergeText('merge'), 'GitHub will merge it when its requirements are met.');
  assert.equal(autoMergeText('rebase'), 'GitHub will rebase and merge it when its requirements are met.');
  assert.equal(
    autoMergeNotice(12, 'squash'),
    'Auto-merge is on for pull request #12: GitHub will squash and merge it when its requirements are met.'
  );
  assert.equal(autoMergeNotice(12, null), 'Auto-merge is off for pull request #12.');
});

test("what the app will do where GitHub won't wait, and what the conversation says of it", () => {
  assert.equal(
    autoMergeText('squash', true),
    'buddylist will squash and merge it once its checks pass, while it is open.'
  );
  assert.equal(autoMergeText('merge', true), 'buddylist will merge it once its checks pass, while it is open.');
  assert.equal(
    autoMergeNotice(12, 'rebase', { appMerges: true }),
    'Auto-merge is on for pull request #12: buddylist will rebase and merge it once its checks pass, while it ' +
      'is open. Its base branch requires nothing GitHub could wait for.'
  );
  assert.equal(autoMergeNotice(12, 'squash', { merged: true }), 'Merged pull request #12: nothing was left to pass.');
  assert.equal(autoMergeNotice(12, null, { appMerges: false }), 'Auto-merge is off for pull request #12.');
});

// ---- conflicts with the base branch --------------------------------------------------------------

test('a pull request with conflicts says so in its face, for Fix conflicts to be there', () => {
  assert.equal(faceOf(pr({ conflict: true })).conflict, true);
  assert.equal(faceOf(pr({ state: 'draft', conflict: true })).conflict, true, 'a draft can have conflicts too');
  assert.match(faceOf(pr({ conflict: true })).title, /^Pull request #12 · merge conflict\n/);
});

test('no conflicts, no pull request, one merged or closed, or a folder that is gone, is nothing to fix', () => {
  assert.equal(faceOf(pr()).conflict, false);
  assert.equal(pullRequestButton(contact(), 'Claude').conflict, false);
  for (const state of ['merged', 'closed']) assert.equal(faceOf(pr({ state, conflict: true })).conflict, false, state);
  assert.equal(
    pullRequestButton(contact({ status: 'offline', pullRequest: pr({ conflict: true }) }), 'Claude').conflict,
    false
  );
});

test('a busy or waiting contact can still be asked to fix them: the message waits in line', () => {
  for (const status of ['busy', 'away']) {
    assert.equal(pullRequestButton(contact({ status, pullRequest: pr({ conflict: true }) }), 'Claude').conflict, true);
  }
});

test('Fix conflicts says whom it asks, and for what', () => {
  assert.equal(fixConflictsTip('Claude'), 'Ask Claude to merge the base branch in and resolve the conflicts');
});

test('the message names the pull request, and asks for the base branch to be merged in and every conflict resolved', () => {
  const text = fixConflictsMessage(12);
  assert.match(text, /^Pull request #12 has merge conflicts with its base branch\./);
  assert.match(text, /Fetch the latest base branch/);
  assert.match(text, /gh pr view --json baseRefName/);
  assert.match(text, /merge it into this branch and resolve every conflict/);
  assert.match(text, /Run the tests/);
  assert.match(text, /commit the merge and push the branch/);
  assert.match(text, /tell me which files conflicted and how you resolved them\.$/);
});

test('the branch is merged into, not rebased, so nothing GitHub has of it is rewritten', () => {
  const text = fixConflictsMessage(12);
  assert.match(text, /without rewriting its history/);
  assert.doesNotMatch(text, /rebase|force/i);
});

test('the message to fix conflicts is one line, so nothing of it reads as a command or a file', () => {
  const text = fixConflictsMessage(4821);
  assert.doesNotMatch(text, /\n/);
  assert.doesNotMatch(text, /^\//);
  assert.ok(text.length < 500);
});

test('with several agents in the conversation it mentions one, so only that one fixes them', () => {
  const people = [
    { id: 'host', name: 'Claude' },
    { id: 'guest', name: 'Codex' },
  ];
  const text = fixConflictsMessage(12, { to: 'Claude' });
  assert.match(text, /^@Claude Pull request #12 has merge conflicts/);
  assert.deepEqual(mentions(text, people), ['host']);
  assert.deepEqual(mentions(fixConflictsMessage(12), people), []);
});

// ---- the message that asks for one ---------------------------------------------------------------

test('the message asks for a pull request, with everything that has to happen before one', () => {
  const text = pullRequestMessage();
  assert.match(text, /^Create a pull request for the work on this branch\./);
  assert.match(text, /Commit what is not committed yet/);
  assert.match(text, /push the branch/);
  assert.match(text, /gh pr create\)/);
  assert.doesNotMatch(text, /draft/i);
});

test('work is not piled onto the main branch, or onto a branch whose pull request is already merged', () => {
  for (const draft of [false, true]) {
    const text = pullRequestMessage({ draft });
    assert.match(text, /on the project's main branch, or on a branch whose pull request is already merged/);
    assert.match(text, /start a new branch from the latest main branch/);
  }
});

test('a draft is asked for by name, and with the flag that makes one', () => {
  const text = pullRequestMessage({ draft: true });
  assert.match(text, /^Create a draft pull request for the work on this branch\./);
  assert.match(text, /gh pr create --draft\)/);
  assert.equal(text.match(/draft pull request/g).length, 2);
});

test('it is one line, so nothing of it reads as a command or a file', () => {
  for (const draft of [false, true]) {
    const text = pullRequestMessage({ draft });
    assert.doesNotMatch(text, /\n/);
    assert.doesNotMatch(text, /^\//);
    assert.ok(text.length < 500);
  }
});

test('with several agents in the conversation it mentions one, so only that one opens a pull request', () => {
  const people = [
    { id: 'host', name: 'Claude' },
    { id: 'guest', name: 'Codex' },
  ];
  const text = pullRequestMessage({ to: 'Claude' });
  assert.match(text, /^@Claude Create a pull request/);
  assert.deepEqual(mentions(text, people), ['host']);
  // Left to itself the message names nobody, and everyone would answer in turn.
  assert.deepEqual(mentions(pullRequestMessage(), people), []);
  // A name with spaces and brackets is still that contact's mention.
  const named = [{ id: 'host', name: 'Claude (api)' }, ...people.slice(1)];
  assert.deepEqual(mentions(pullRequestMessage({ to: 'Claude (api)', draft: true }), named), ['host']);
});

// ---- the menus -----------------------------------------------------------------------------------

const actions = () => {
  const calls = [];
  return {
    calls,
    open: () => calls.push('open'),
    create: (opts) => calls.push(opts),
    manually: () => calls.push('manually'),
    checks: () => calls.push('checks'),
    autoMerge: (on) => calls.push({ autoMerge: on }),
    fixConflicts: () => calls.push('fixConflicts'),
    archiveMerged: (on) => calls.push({ archiveMerged: on }),
  };
};

/** The entry of a menu with that label. */
const entry = (items, label) => items.find((item) => item.label === label);

test('without a pull request there are three ways to one, the button’s own first', () => {
  const did = actions();
  const items = pullRequestMenuItems(pullRequestButton(contact(), 'Claude'), did);
  assert.deepEqual(
    items.map((item) => item.label),
    ['Create PR', 'Create draft PR', 'Create PR manually']
  );
  assert.ok(items.every((item) => !item.disabled));
  for (const item of items) item.action();
  assert.deepEqual(did.calls, [{ draft: false }, { draft: true }, 'manually']);
});

test('group creation menus choose one agent for either a regular or draft PR', () => {
  const did = actions();
  const people = [
    { id: 'host', name: 'Claude (add-missing-analytics)' },
    { id: 'guest', name: 'Codex' },
  ];
  const items = pullRequestMenuItems(pullRequestButton(contact(), null), did, people);
  for (const item of items.slice(0, 2)) {
    assert.equal(item.action, undefined, 'opening the menu sends nothing');
    assert.deepEqual(
      item.submenu.map(({ label }) => label),
      ['Ask Claude (add-missing-analytics)', 'Ask Codex']
    );
    item.submenu[1].action();
  }
  assert.deepEqual(did.calls, [
    { draft: false, participantId: 'guest' },
    { draft: true, participantId: 'guest' },
  ]);
  assert.equal(items[2].submenu, undefined, 'manual creation needs no agent');
});

test('a branch that has a pull request offers to view it, its checks, auto-merge, and archiving once merged', () => {
  const did = actions();
  const items = pullRequestMenuItems(faceOf(pr()), did);
  assert.deepEqual(
    items.map((item) => item.label),
    ['View PR #12', 'Show checks', 'Auto-merge', 'Archive once merged']
  );
  assert.ok(items.every((item) => !item.disabled));
  for (const item of items) item.action();
  assert.deepEqual(did.calls, ['open', 'checks', { autoMerge: true }, { archiveMerged: true }]);
});

test('open, draft, merged and closed PRs offer the read-only stack action beside their GitHub link', () => {
  for (const state of ['open', 'draft', 'merged', 'closed']) {
    const did = actions();
    const items = pullRequestMenuItems(faceOf(pr({ state })), { ...did, stack: () => did.calls.push('stack') });
    assert.equal(items[1].label, 'View PR stack...', state);
    items[1].action();
    assert.deepEqual(did.calls, ['stack'], 'viewing relationships invokes no creation or merge action');
  }
});

test('the PR menu omits stack navigation without a verified PR or when the checkout is missing', () => {
  for (const who of [contact(), contact({ status: 'offline', pullRequest: pr() })]) {
    const items = pullRequestMenuItems(pullRequestButton(who, 'Claude'), { ...actions(), stack() {} });
    assert.ok(!items.some((item) => item.label === 'View PR stack...'));
  }
});

test('a pull request with conflicts offers to have them fixed, after its checks and before auto-merge', () => {
  const did = actions();
  const items = pullRequestMenuItems(faceOf(pr({ conflict: true })), did);
  assert.deepEqual(
    items.map((item) => item.label),
    ['View PR #12', 'Show checks', 'Fix conflicts', 'Auto-merge', 'Archive once merged']
  );
  assert.ok(items.every((item) => !item.disabled));
  items[2].action();
  assert.deepEqual(did.calls, ['fixConflicts']);
  // A draft has conflicts to fix as well.
  const draft = pullRequestMenuItems(faceOf(pr({ state: 'draft', conflict: true })), actions());
  assert.ok(draft.some((item) => item.label === 'Fix conflicts'));
});

test('a merged or closed pull request offers to open it, then the ways to another on the same branch', () => {
  for (const state of ['merged', 'closed']) {
    const did = actions();
    const items = pullRequestMenuItems(faceOf(pr({ state, checks: { failing: 1, pending: 0, passed: 2 } })), did);
    assert.deepEqual(
      items.map((item) => item.label),
      [`PR #12 · ${state === 'merged' ? 'Merged' : 'Closed'}`, 'Create PR', 'Create draft PR', 'Create PR manually'],
      state
    );
    assert.ok(
      items.every((item) => !item.disabled),
      state
    );
    for (const item of items) item.action();
    assert.deepEqual(did.calls, ['open', { draft: false }, { draft: true }, 'manually'], state);
  }
});

test('with several agents, a second pull request after a merged one is asked of the one chosen', () => {
  const did = actions();
  const people = [
    { id: 'host', name: 'Claude' },
    { id: 'guest', name: 'Codex' },
  ];
  const face = pullRequestButton(contact({ pullRequest: pr({ state: 'merged' }) }), null);
  const [, create] = pullRequestMenuItems(face, did, people);
  assert.deepEqual(
    create.submenu.map(({ label }) => label),
    ['Ask Claude', 'Ask Codex']
  );
  create.submenu[0].action();
  assert.deepEqual(did.calls, [{ draft: false, participantId: 'host' }]);
});

test('without conflicts, or once the pull request is merged or closed, nothing offers to fix them', () => {
  assert.ok(!pullRequestMenuItems(faceOf(pr()), actions()).some((item) => item.label === 'Fix conflicts'));
  for (const state of ['merged', 'closed']) {
    const items = pullRequestMenuItems(faceOf(pr({ state, conflict: true })), actions());
    assert.ok(!items.some((item) => item.label === 'Fix conflicts'), state);
  }
});

test('with a check failing the menu leads to the failed ones, and says how many', () => {
  const [, checks] = pullRequestMenuItems(faceOf(withChecks(2, 1, 6)), actions());
  assert.deepEqual([checks.label, checks.hint], ['Show failed checks', '2 checks failing']);
  const [, running] = pullRequestMenuItems(faceOf(withChecks(0, 1, 6)), actions());
  assert.deepEqual([running.label, running.hint], ['Show checks', 'running']);
  const [, passed] = pullRequestMenuItems(faceOf(withChecks(0, 0, 6)), actions());
  assert.deepEqual([passed.label, passed.hint], ['Show checks', 'passed']);
  const [, none] = pullRequestMenuItems(faceOf(pr()), actions());
  assert.equal(none.hint, '');
});

test('auto-merge is ticked while it is on, says how it merges, and turns it off', () => {
  const did = actions();
  const autoMerge = entry(pullRequestMenuItems(faceOf(pr({ autoMerge: 'rebase' })), did), 'Auto-merge');
  assert.deepEqual([autoMerge.checked, autoMerge.hint, autoMerge.disabled], [true, 'rebase and merge', false]);
  autoMerge.action();
  assert.deepEqual(did.calls, [{ autoMerge: false }]);
  const off = entry(pullRequestMenuItems(faceOf(pr()), actions()), 'Auto-merge');
  assert.deepEqual([off.checked, off.hint], [false, '']);
});

test('a draft can not have auto-merge turned on, only off', () => {
  const draft = entry(pullRequestMenuItems(faceOf(pr({ state: 'draft' })), actions()), 'Auto-merge');
  assert.deepEqual([draft.checked, draft.hint, draft.disabled], [false, 'not for a draft', true]);
  const did = actions();
  const on = entry(pullRequestMenuItems(faceOf(pr({ state: 'draft', autoMerge: 'squash' })), did), 'Auto-merge');
  assert.deepEqual([on.checked, on.disabled], [true, false]);
  on.action();
  assert.deepEqual(did.calls, [{ autoMerge: false }]);
});

test('archiving once merged is ticked as Settings > Git says, unless the contact chose, and flips what it shows', () => {
  const archive = (fields, settings) =>
    entry(
      pullRequestMenuItems(pullRequestButton(contact({ pullRequest: pr(), ...fields }), 'Claude', settings), did),
      'Archive once merged'
    );
  const did = actions();
  assert.equal(archive({}).checked, false, 'off without a word from Settings');
  assert.equal(archive({}, { archiveMerged: true }).checked, true);
  assert.equal(archive({ archiveMerged: false }, { archiveMerged: true }).checked, false);
  assert.equal(archive({ archiveMerged: true }, { archiveMerged: false }).checked, true);
  archive({}, { archiveMerged: true }).action();
  archive({ archiveMerged: true }).action();
  archive({}).action();
  assert.deepEqual(did.calls, [{ archiveMerged: false }, { archiveMerged: false }, { archiveMerged: true }]);
  // A draft is merged once it is ready, so it can be ticked as well.
  const draft = entry(pullRequestMenuItems(faceOf(pr({ state: 'draft' })), actions()), 'Archive once merged');
  assert.deepEqual([draft.checked, draft.disabled], [false, undefined]);
});

test('without a pull request still to be merged nothing offers to archive once merged', () => {
  for (const pullRequest of [null, pr({ state: 'merged' }), pr({ state: 'closed' })]) {
    const face = pullRequestButton(contact({ pullRequest, archiveMerged: true }), 'Claude', { archiveMerged: true });
    assert.equal(face.archiveMerged, false, pullRequest?.state ?? 'none');
    assert.equal(entry(pullRequestMenuItems(face, actions()), 'Archive once merged'), undefined);
  }
});

test('with the folder gone every way to a pull request is greyed out', () => {
  const items = pullRequestMenuItems(pullRequestButton(contact({ status: 'offline' }), 'Claude'), actions());
  assert.equal(items.length, 3);
  assert.ok(items.every((item) => item.disabled));
});

// ---- the page on GitHub --------------------------------------------------------------------------

test('a remote is read as its page on GitHub, however it is written', () => {
  const page = 'https://github.com/acme/shop';
  for (const remote of [
    'https://github.com/acme/shop.git',
    'https://github.com/acme/shop',
    'https://github.com/acme/shop/',
    'http://github.com/acme/shop.git',
    'https://safa@github.com/acme/shop.git',
    'https://safa:token@github.com/acme/shop.git',
    'git@github.com:acme/shop.git',
    'git@github.com:acme/shop',
    'ssh://git@github.com/acme/shop.git',
    'ssh://git@github.com:22/acme/shop.git',
    'git://github.com/acme/shop.git',
    '  git@github.com:acme/shop.git\n',
  ]) {
    assert.equal(repositoryPage(remote), page, remote);
  }
});

test('a name with dots and dashes is kept whole, and only a last .git is dropped', () => {
  assert.equal(repositoryPage('git@github.com:acme-inc/shop.js.git'), 'https://github.com/acme-inc/shop.js');
  assert.equal(repositoryPage('https://github.com/acme/shop.git.git'), 'https://github.com/acme/shop.git');
});

test("a company's own GitHub has the same addresses", () => {
  assert.equal(repositoryPage('git@github.acme.com:team/shop.git'), 'https://github.acme.com/team/shop');
  assert.equal(repositoryPage('https://github.acme.com/team/shop.git'), 'https://github.acme.com/team/shop');
});

test('what is not the address of a repository on a host has no page', () => {
  for (const remote of [
    '',
    null,
    undefined,
    '/Users/me/repos/shop.git',
    '../shop',
    'file:///Users/me/repos/shop.git',
    'https://github.com/acme',
    'https://github.com/acme/shop/extra',
    // A nickname from ~/.ssh/config: there is no telling which host it stands for.
    'work:acme/shop.git',
    'C:/repos/acme/shop',
  ]) {
    assert.equal(repositoryPage(remote), null, String(remote));
  }
});

test('the page to open a pull request on compares the branch with the main line, form open', () => {
  assert.equal(
    comparePage('git@github.com:acme/shop.git', 'hover-card'),
    'https://github.com/acme/shop/compare/hover-card?expand=1'
  );
});

test('a branch keeps its slashes in the address, and whatever else it holds is escaped', () => {
  assert.equal(
    comparePage('https://github.com/acme/shop.git', 'safa/feature/hover-card'),
    'https://github.com/acme/shop/compare/safa/feature/hover-card?expand=1'
  );
  assert.equal(
    comparePage('https://github.com/acme/shop.git', 'fix/#12 what?&how'),
    'https://github.com/acme/shop/compare/fix/%2312%20what%3F%26how?expand=1'
  );
});

test('without a page for the repository, or without a branch, there is none to open', () => {
  assert.equal(comparePage('/Users/me/repos/shop.git', 'hover-card'), null);
  assert.equal(comparePage('git@github.com:acme/shop.git', ''), null);
});

test("a branch's files have a page of their own, its name kept as the compare page keeps it", () => {
  assert.equal(
    branchPage('git@github.com:acme/shop.git', 'safa/feature/hover card'),
    'https://github.com/acme/shop/tree/safa/feature/hover%20card'
  );
  assert.equal(branchPage('/Users/me/repos/shop.git', 'main'), null);
  assert.equal(branchPage('https://github.com/acme/shop.git', ''), null);
});

// ---- a pull request linked by hand ------------------------------------------------------------------------

const linking = () => {
  const did = actions();
  return {
    ...did,
    link: () => did.calls.push('link'),
    unlink: () => did.calls.push('unlink'),
    showOther: (which) => did.calls.push({ show: which }),
  };
};

test('without a pull request, the ▼ offers to link one after the ways to create one', () => {
  const did = linking();
  const items = pullRequestMenuItems(pullRequestButton(contact(), 'Claude'), did);
  assert.deepEqual(
    items.map((item) => (item.separator ? '-' : item.label)),
    ['Create PR', 'Create draft PR', 'Create PR manually', '-', 'Link pull request...']
  );
  items.at(-1).action();
  assert.deepEqual(did.calls, ['link']);
  // Without a way to link one, as in a window that has none, nothing is added.
  assert.equal(pullRequestMenuItems(pullRequestButton(contact(), 'Claude'), actions()).length, 3);
});

test('a linked pull request wears a Linked tag, says so in its helper line, and offers Unlink', () => {
  const face = faceOf(pr({ linked: true }));
  assert.equal(face.linked, true);
  assert.equal(face.number, 12);
  assert.match(face.title, /Linked to this conversation, not found by its branch\./);
  const did = linking();
  const items = pullRequestMenuItems(face, did);
  const tail = items.slice(items.findIndex((item) => item.separator) + 1);
  assert.deepEqual(
    tail.map(({ label, note }) => (note ? `(${label})` : label)),
    ['(Linked to this conversation, not found by its branch)', 'Link another pull request...', 'Unlink #12']
  );
  for (const item of tail) item.action?.();
  assert.deepEqual(did.calls, ['link', 'unlink']);
  assert.equal(faceOf(pr()).linked, false, 'one found by the branch is not linked');
});

test('where the branch has its own too, the ▼ says which is shown and switches to the other', () => {
  const did = linking();
  const linkedShown = pullRequestMenuItems(faceOf(pr({ linked: true, other: { number: 48 } })), did);
  assert.ok(entry(linkedShown, 'Showing #12, linked here. This branch has #48.').note);
  entry(linkedShown, 'Show #48 of this branch instead').action();
  const branchShown = pullRequestMenuItems(faceOf(pr({ number: 48, other: { number: 12, linked: true } })), did);
  assert.ok(entry(branchShown, 'Showing #48 of this branch. #12 is linked here.').note);
  entry(branchShown, 'Show linked #12 instead').action();
  entry(branchShown, 'Unlink #12').action();
  assert.deepEqual(did.calls, [{ show: 'branch' }, { show: 'linked' }, 'unlink']);
});

test('a merged linked pull request keeps its link items after the ways to another', () => {
  const items = pullRequestMenuItems(faceOf(pr({ state: 'merged', linked: true })), linking());
  assert.deepEqual(items.map((item) => (item.separator ? '-' : item.label)).slice(-4), [
    '-',
    'Linked to this conversation, not found by its branch',
    'Link another pull request...',
    'Unlink #12',
  ]);
});

test('a branch’s own pull request can still have another linked in its place', () => {
  const items = pullRequestMenuItems(faceOf(pr()), linking());
  assert.equal(items.at(-1).label, 'Link another pull request...');
  assert.equal(entry(items, 'Unlink #12'), undefined);
});
