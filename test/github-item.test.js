import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { freeBranchName } from '../src/shared/branch-names.js';
import {
  branchFor,
  cleanDraft,
  describeItem,
  DRAFT_LIMIT,
  draftFor,
  listedHint,
  listMatching,
  nicknameFor,
  parseReference,
  repositoryOf,
  sameRepository,
  withFound,
} from '../src/shared/github-item.js';

const HAS_GIT = spawnSync('git', ['--version']).status === 0;

const issue = (fields = {}) => ({
  kind: 'issue',
  number: 123,
  title: 'Fix login redirect',
  body: 'After signing in you land on /home instead of the page you came from.',
  url: 'https://github.com/acme/shop/issues/123',
  state: 'open',
  ...fields,
});

const pull = (fields = {}) => ({
  kind: 'pull',
  number: 45,
  title: 'Add a hover card',
  body: 'Shows the branch and the cost.',
  url: 'https://github.com/acme/shop/pull/45',
  state: 'open',
  branch: 'feature/hover-card',
  fork: null,
  ...fields,
});

// ---- what the user typed -------------------------------------------------------------------------

test('a number, with or without its #, is a reference to this project', () => {
  assert.deepEqual(parseReference('123'), { number: 123, repo: null });
  assert.deepEqual(parseReference('#123'), { number: 123, repo: null });
  assert.deepEqual(parseReference('  #7  '), { number: 7, repo: null });
  assert.deepEqual(parseReference('007'), { number: 7, repo: null });
});

test('a link says which repository it is for, whether it is an issue or a pull request', () => {
  assert.deepEqual(parseReference('https://github.com/acme/shop/issues/123'), { number: 123, repo: 'acme/shop' });
  assert.deepEqual(parseReference('https://github.com/acme/shop/pull/45'), { number: 45, repo: 'acme/shop' });
  assert.deepEqual(parseReference('http://github.com/acme/shop/pull/45'), { number: 45, repo: 'acme/shop' });
  assert.deepEqual(parseReference('github.com/Acme/Shop.js/issues/9'), { number: 9, repo: 'Acme/Shop.js' });
  assert.deepEqual(parseReference('https://www.github.com/acme/shop/issues/9'), { number: 9, repo: 'acme/shop' });
  // A company's own GitHub.
  assert.deepEqual(parseReference('https://github.acme.dev/team/api/pull/3'), { number: 3, repo: 'team/api' });
});

test('a link copied from further down the page still names the same thing', () => {
  for (const tail of ['/files', '/commits/08562ba', '#issuecomment-99', '?notification_referrer_id=NT_x', '/']) {
    assert.deepEqual(
      parseReference(`https://github.com/acme/shop/pull/45${tail}`),
      { number: 45, repo: 'acme/shop' },
      tail
    );
  }
});

test('anything else is not a reference', () => {
  const not = [
    '',
    '   ',
    '#',
    '0',
    '#0',
    '-5',
    '12a',
    'fix login',
    '12 13',
    'acme/shop',
    'https://github.com/acme/shop',
    'https://github.com/acme/shop/issues',
    'https://github.com/acme/shop/issues/abc',
    'https://github.com/acme/shop/commit/08562ba',
    'https://github.com/acme/shop/pulls/45',
    'acme/shop/x/issues/3',
    '99999999999999999999',
    undefined,
    null,
  ];
  for (const text of not) assert.equal(parseReference(text), null, String(text));
});

test('the repository of a link is compared whatever its capitals', () => {
  assert.equal(repositoryOf('https://github.com/acme/shop/issues/123'), 'acme/shop');
  assert.equal(repositoryOf('not a link'), null);
  assert.equal(sameRepository('Acme/Shop', 'acme/shop'), true);
  assert.equal(sameRepository('acme/shop', 'acme/shop-api'), false);
});

// ---- the nickname ---------------------------------------------------------------------------------

test('a title that fits is the nickname as it is', () => {
  assert.equal(nicknameFor(issue()), 'Fix login redirect');
  assert.equal(nicknameFor(issue({ title: '  Fix   login\tredirect \n' })), 'Fix login redirect');
  const exactly = 'x'.repeat(40);
  assert.equal(nicknameFor(issue({ title: exactly })), exactly);
});

test('a long title is cut at a word, with an ellipsis, to fit the 40 characters of the field', () => {
  const name = nicknameFor(issue({ title: 'Fix the login redirect when the session has expired overnight' }));
  assert.equal(name, 'Fix the login redirect when the session…');
  assert.ok(name.length <= 40);
  // Nothing is left dangling in front of the ellipsis.
  assert.equal(
    nicknameFor(issue({ title: 'Login: the redirect is wrong, sometimes, - and nobody knows why it is' })),
    'Login: the redirect is wrong…'
  );
});

test('a title that is one long word is cut where the field ends', () => {
  const name = nicknameFor(issue({ title: 'a'.repeat(90) }));
  assert.equal(name, `${'a'.repeat(39)}…`);
  const mostly = nicknameFor(issue({ title: `Fix ${'b'.repeat(90)}` }));
  assert.equal(mostly, `Fix ${'b'.repeat(35)}…`);
  assert.equal(mostly.length, 40);
});

test('without a title, the nickname says what it is', () => {
  assert.equal(nicknameFor(issue({ title: '' })), 'Issue #123');
  assert.equal(nicknameFor(pull({ title: '   ' })), 'Pull request #45');
});

// ---- the branch -----------------------------------------------------------------------------------

test('an issue suggests a branch named after its number and its title', () => {
  assert.equal(branchFor(issue()), '123-fix-login-redirect');
});

test("an issue's branch goes under the user's prefix", () => {
  assert.equal(branchFor(issue(), 'safa/feature'), 'safa/feature/123-fix-login-redirect');
  assert.equal(branchFor(issue({ title: '' }), 'safa'), 'safa/issue-123');
  assert.equal(branchFor(issue(), ''), '123-fix-login-redirect');
});

test('whatever a branch name cannot hold becomes a dash', () => {
  assert.equal(
    branchFor(issue({ title: 'Crash: `foo..bar` ~ ^weird? [chars] *here* \\ @{now}.lock' })),
    '123-crash-foo-bar-weird-chars-here-now-lock'
  );
  assert.equal(branchFor(issue({ title: "Don't break /api/v2 routes" })), '123-don-t-break-api-v2-routes');
  assert.equal(branchFor(issue({ title: '  --Shop & Co.~^:?*[\\]  ' })), '123-shop-co');
});

test('a title is written into a branch the way a project name is', () => {
  // The words are the ones src/shared/branch-names.js makes of a project: "my-shop-v2-1" there.
  assert.equal(
    branchFor(issue({ title: 'My Shop.v2' })),
    `123-${freeBranchName('My Shop.v2', () => false).slice(0, -2)}`
  );
  // Only plain letters are kept, as they are there.
  assert.equal(branchFor(issue({ title: '  --Über café: naïve façade!!  ' })), '123-uber-cafe-naive-facade');
  assert.equal(branchFor(issue({ title: 'Mağaza Önü' })), '123-magaza-onu');
  assert.equal(branchFor(issue({ title: '登录 login 重定向' })), '123-login');
});

test('a very long title is cut at a word, and a title with nothing to keep leaves the number', () => {
  const branch = branchFor(issue({ title: 'Fix the login redirect when the session has expired overnight again' }));
  assert.equal(branch, '123-fix-the-login-redirect-when-the-session');
  assert.equal(branchFor(issue({ title: 'x'.repeat(200) })), `123-${'x'.repeat(40)}`);
  // The word that stands in for a project without a name is not borrowed for a title without one,
  // and a number alone is not a name: it says what the number is of.
  assert.equal(branchFor(issue({ title: '???' })), 'issue-123');
  assert.equal(branchFor(issue({ title: '🚀' })), 'issue-123');
  assert.equal(branchFor(issue({ title: '登录重定向' })), 'issue-123');
  assert.equal(branchFor(issue({ title: '' })), 'issue-123');
});

test('git accepts every branch name that is suggested', { skip: !HAS_GIT }, () => {
  const titles = [
    'Fix login redirect',
    'Crash: `foo..bar` ~ ^weird? [chars] *here* \\ @{now}.lock',
    '.hidden/ file // slashes.',
    '-starts with a dash',
    'ends with a dot.',
    '登录重定向',
    'x'.repeat(300),
    'emoji 🚀 in the title',
    'control\u0001chars\u007f and a space ',
    'Über café: naïve façade',
    '𝒳'.repeat(60),
  ];
  for (const title of titles) {
    for (const prefix of ['', 'safa', 'safa/feature']) {
      const branch = branchFor(issue({ title }), prefix);
      assert.equal(spawnSync('git', ['check-ref-format', '--branch', branch]).status, 0, branch);
      assert.match(branch, /^(?:[a-z]+\/)*(?:issue-123|123(?:-[a-z0-9]+)+)$/, branch);
      assert.ok(branch.length <= 100, 'it fits the branch field');
    }
  }
});

// ---- the first message ----------------------------------------------------------------------------

test('the draft holds the title, the link and the body, and leaves a line to write on', () => {
  assert.equal(
    draftFor(issue()),
    [
      'Issue #123: Fix login redirect',
      'https://github.com/acme/shop/issues/123',
      '',
      'After signing in you land on /home instead of the page you came from.',
      '',
      '',
    ].join('\n')
  );
  assert.match(draftFor(pull()), /^Pull request #45: Add a hover card\nhttps:\/\/github\.com\/acme\/shop\/pull\/45\n/);
});

test('an empty body leaves just the title and the link', () => {
  const expected = 'Issue #123: Fix login redirect\nhttps://github.com/acme/shop/issues/123\n\n';
  assert.equal(draftFor(issue({ body: '' })), expected);
  assert.equal(draftFor(issue({ body: ' \r\n\n ' })), expected);
});

test('the body keeps its own lines, without the carriage returns GitHub stores', () => {
  const draft = draftFor(issue({ body: '## Steps\r\n\r\n1. Sign in\r\n2. Look at the address bar\r\n' }));
  assert.equal(draft.includes('\r'), false);
  assert.match(draft, /\n\n## Steps\n\n1\. Sign in\n2\. Look at the address bar\n\n$/);
});

test('a very long body is cut short, and says where the rest is', () => {
  const draft = draftFor(issue({ body: 'word '.repeat(5000) }));
  assert.ok(draft.length < DRAFT_LIMIT);
  assert.match(draft, /word\n\n\[Cut short here: the rest is at the link above\.\]\n\n$/);
  // What was kept is the start.
  assert.ok(draft.startsWith('Issue #123: Fix login redirect\nhttps://github.com/acme/shop/issues/123\n\nword word'));
});

test('a draft is text of a sensible size, or there is none', () => {
  assert.equal(cleanDraft('Issue #1: x\n'), 'Issue #1: x\n');
  assert.equal(cleanDraft('x'.repeat(DRAFT_LIMIT + 50)).length, DRAFT_LIMIT);
  for (const not of [undefined, null, '', '   \n', 12, {}, ['a']]) assert.equal(cleanDraft(not), '', String(not));
});

// ---- the line under the field ---------------------------------------------------------------------

test('what was found is named, and a closed or merged one says so', () => {
  assert.equal(describeItem(issue()), 'Issue #123: Fix login redirect');
  assert.equal(describeItem(issue({ state: 'closed' })), 'Issue #123 (closed): Fix login redirect');
  assert.equal(describeItem(pull()), 'Pull request #45: Add a hover card');
  assert.equal(describeItem(pull({ state: 'draft' })), 'Pull request #45 (draft): Add a hover card');
  assert.equal(describeItem(pull({ state: 'merged' })), 'Pull request #45 (merged): Add a hover card');
  assert.equal(describeItem(pull({ state: 'closed' })), 'Pull request #45 (closed): Add a hover card');
  assert.equal(describeItem(issue({ title: '' })), 'Issue #123');
});

// ---- the list to choose from ------------------------------------------------------------------

const listed = (kind, number, title, fields = {}) => ({
  kind,
  number,
  title,
  url: `https://github.com/acme/shop/${kind === 'pull' ? 'pull' : 'issues'}/${number}`,
  draft: false,
  mine: false,
  ...fields,
});
const LIST = {
  pulls: [listed('pull', 128, 'Fix the cart total'), listed('pull', 12, 'Login page polish')],
  issues: [listed('issue', 131, 'Fix the login redirect'), listed('issue', 120, 'Cart is slow')],
};
const numbers = ({ pulls, issues }) => [...pulls, ...issues].map((item) => item.number);

test('an empty field lists them all', () => {
  assert.deepEqual(listMatching(LIST, ''), LIST);
  assert.deepEqual(listMatching(LIST, '   '), LIST);
  assert.deepEqual(listMatching(LIST, undefined), LIST);
});

test('words are found in the title, in any order and whatever their capitals, and every one has to be there', () => {
  assert.deepEqual(numbers(listMatching(LIST, 'login')), [12, 131]);
  assert.deepEqual(numbers(listMatching(LIST, 'REDIRECT login')), [131]);
  assert.deepEqual(numbers(listMatching(LIST, 'cart')), [128, 120]);
  assert.deepEqual(numbers(listMatching(LIST, 'cart total')), [128]);
  assert.deepEqual(numbers(listMatching(LIST, 'checkout')), []);
});

test('a number names that one only, not every one it is part of or a title it is in', () => {
  assert.deepEqual(numbers(listMatching(LIST, '12')), [12]);
  assert.deepEqual(numbers(listMatching(LIST, '#131')), [131]);
  assert.deepEqual(numbers(listMatching(LIST, '13')), []);
  // Typed with a word, it is looked for as part of the number and the title.
  assert.deepEqual(numbers(listMatching(LIST, '#12 login')), [12]);
});

test("a link names that one in this project only: another project's same number is another one", () => {
  assert.deepEqual(numbers(listMatching(LIST, 'https://github.com/acme/shop/pull/128')), [128]);
  assert.deepEqual(numbers(listMatching(LIST, 'github.com/ACME/Shop/issues/131#issuecomment-1')), [131]);
  assert.deepEqual(numbers(listMatching(LIST, 'https://github.com/other/shop/issues/131')), []);
});

test('what a search found is added to the list once, after what is already there', () => {
  const found = { pulls: [listed('pull', 128, 'Fix the cart total')], issues: [listed('issue', 40, 'Old login bug')] };
  const both = withFound(LIST, found);
  assert.deepEqual(numbers(both), [128, 12, 131, 120, 40]);
  assert.deepEqual(withFound(LIST, { pulls: [], issues: [] }), LIST);
});

test('a row says whose it is and whether it is a draft, and nothing else', () => {
  assert.equal(listedHint(listed('pull', 1, 'x')), '');
  assert.equal(listedHint(listed('pull', 1, 'x', { mine: true })), 'yours');
  assert.equal(listedHint(listed('pull', 1, 'x', { draft: true })), 'draft');
  assert.equal(listedHint(listed('pull', 1, 'x', { mine: true, draft: true })), 'yours, draft');
  assert.equal(listedHint(listed('issue', 1, 'x', { mine: true })), 'assigned to you');
  assert.equal(listedHint(listed('issue', 1, 'x')), '');
});
