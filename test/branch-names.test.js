import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  BRANCH_PREFIX_MAX,
  branchPrefix,
  branchWords,
  followedNickname,
  freeBranchName,
  madeUpNickname,
  nicknameOnService,
  prefixed,
  shortBranchWords,
  taskBranchName,
  taskWords,
  withoutPrefix,
} from '../src/shared/branch-names.js';

const HAS_GIT = spawnSync('git', ['--version']).status === 0;

const free = () => false;
const used = (...taken) => {
  return (name) => taken.includes(name);
};

test('the first branch of a project is its name and the number one', () => {
  assert.equal(freeBranchName('shop', free), 'shop-1');
});

test('the number is the lowest one nothing uses', () => {
  assert.equal(freeBranchName('shop', used('shop-1')), 'shop-2');
  assert.equal(freeBranchName('shop', used('shop-1', 'shop-2', 'shop-3')), 'shop-4');
  // A number that came free again is taken before a higher one.
  assert.equal(freeBranchName('shop', used('shop-1', 'shop-3')), 'shop-2');
  // Another project's branches do not count.
  assert.equal(freeBranchName('shop', used('api-1', 'shop')), 'shop-1');
});

test('a project name is written the way a branch can carry it', () => {
  assert.equal(freeBranchName('My Shop', free), 'my-shop-1');
  assert.equal(freeBranchName('shop.v2', free), 'shop-v2-1');
  assert.equal(freeBranchName('  --Shop & Co.~^:?*[\\]  ', free), 'shop-co-1');
  assert.equal(freeBranchName('.dotfiles', free), 'dotfiles-1');
  assert.equal(freeBranchName('a..b.lock', free), 'a-b-lock-1');
});

test('a project without a letter or number in its name still gets a branch', () => {
  assert.equal(freeBranchName('---', free), 'contact-1');
  assert.equal(freeBranchName('', used('contact-1')), 'contact-2');
  assert.equal(freeBranchName(undefined, free), 'contact-1');
  // Nor does one whose letters cannot be written plainly.
  assert.equal(freeBranchName('商店', free), 'contact-1');
});

// ---- plain letters only ---------------------------------------------------------------------------

test('a letter with a mark on it is written without the mark', () => {
  assert.equal(branchWords('Mağaza Önü'), 'magaza-onu');
  assert.equal(branchWords('Über café: naïve façade'), 'uber-cafe-naive-facade');
  assert.equal(branchWords('ÀÉÎÕÜ ñ ç š ž ý'), 'aeiou-n-c-s-z-y');
  // Turkish has an i without a dot and an I with one.
  assert.equal(branchWords('IŞIK ışık İstanbul'), 'isik-isik-istanbul');
});

test('a letter that is no plain one with a mark is written as the plain ones it stands for', () => {
  assert.equal(branchWords('Straße'), 'strasse');
  assert.equal(branchWords('Ærø smørrebrød'), 'aero-smorrebrod');
  assert.equal(branchWords('Œuvre Łódź Đorđe Þór Guð'), 'oeuvre-lodz-dorde-thor-gud');
});

test('letters written in another shape are still the letters they are', () => {
  assert.equal(branchWords('ｆｕｌｌ ｗｉｄｔｈ １２３'), 'full-width-123');
  assert.equal(branchWords('𝒳𝒴 ﬁx'), 'xy-fix');
});

test('what cannot be written plainly is left out', () => {
  assert.equal(branchWords('登录 login 重定向'), 'login');
  assert.equal(branchWords('Привет мир'), '');
  assert.equal(branchWords('🚀 launch 🚀'), 'launch');
  assert.equal(branchWords('???'), '');
  assert.equal(branchWords(null), '');
});

test('too many words are cut at a word', () => {
  assert.equal(
    shortBranchWords('Fix the login redirect when the session has expired overnight again'),
    'fix-the-login-redirect-when-the-session'
  );
  // A word that ends exactly where the room does is kept whole.
  assert.equal(shortBranchWords(`${'a'.repeat(19)} ${'b'.repeat(20)} more`), `${'a'.repeat(19)}-${'b'.repeat(20)}`);
  // One long word is cut where the room ends.
  assert.equal(shortBranchWords('x'.repeat(200)), 'x'.repeat(40));
  assert.equal(shortBranchWords('short'), 'short');
  assert.equal(shortBranchWords(''), '');
});

// ---- the user's prefix ----------------------------------------------------------------------------

test('a prefix is written the way a branch can carry it, part by part', () => {
  assert.equal(branchPrefix('safa'), 'safa');
  assert.equal(branchPrefix('safa/feature'), 'safa/feature');
  assert.equal(branchPrefix('  Safa Elmalı / Feature  '), 'safa-elmali/feature');
  // A slash too many at either end, or in the middle, is not one the branch gets.
  assert.equal(branchPrefix('/safa//feature/'), 'safa/feature');
  assert.equal(branchPrefix('safa\\feature'), 'safa-feature');
  assert.equal(branchPrefix('../.git/~x'), 'git/x');
});

test('no prefix, and one with nothing to keep, is none', () => {
  assert.equal(branchPrefix(''), '');
  assert.equal(branchPrefix('   '), '');
  assert.equal(branchPrefix('///'), '');
  assert.equal(branchPrefix('---'), '');
  assert.equal(branchPrefix(undefined), '');
  assert.equal(branchPrefix(null), '');
});

test('a prefix is no longer than its field', () => {
  const long = branchPrefix(`${'a'.repeat(BRANCH_PREFIX_MAX - 1)}/bcd`);
  assert.equal(long, 'a'.repeat(BRANCH_PREFIX_MAX - 1));
  assert.ok(branchPrefix('x'.repeat(500)).length <= BRANCH_PREFIX_MAX);
});

test('a name goes under the prefix, and comes out from under it again', () => {
  assert.equal(prefixed('safa/feature', 'shop-1'), 'safa/feature/shop-1');
  assert.equal(prefixed('', 'shop-1'), 'shop-1');
  assert.equal(withoutPrefix('safa/feature', 'safa/feature/shop-1'), 'shop-1');
  assert.equal(withoutPrefix('', 'shop-1'), 'shop-1');
  // A branch typed without the prefix, or one that only starts with the same letters, is left whole.
  assert.equal(withoutPrefix('safa', 'fix-login'), 'fix-login');
  assert.equal(withoutPrefix('safa', 'safari/fix-login'), 'safari/fix-login');
});

test("a project's branch goes under the prefix, and is numbered there", () => {
  assert.equal(freeBranchName('shop', free, 'safa/feature'), 'safa/feature/shop-1');
  assert.equal(freeBranchName('shop', used('safa/shop-1'), 'safa'), 'safa/shop-2');
  // A branch of the same name without the prefix is another branch.
  assert.equal(freeBranchName('shop', used('shop-1'), 'safa'), 'safa/shop-1');
  assert.equal(freeBranchName('', free, 'safa'), 'safa/contact-1');
});

// ---- named after the first task -------------------------------------------------------------------

test('a task is named by the words of what was asked', () => {
  assert.equal(taskWords('Fix the login redirect'), 'fix-the-login-redirect');
  assert.equal(taskWords("  Don't break /api/v2 routes!  "), 'don-t-break-api-v2-routes');
  assert.equal(taskWords('Mağaza önü sayfasını düzelt'), 'magaza-onu-sayfasini-duzelt');
});

test('a long request is cut at a word', () => {
  assert.equal(
    taskWords('Can you look into why the login redirect fails when the session has expired overnight?'),
    'can-you-look-into-why-the-login-redirect'
  );
});

test('only the first line that says something counts', () => {
  assert.equal(taskWords('Fix the login redirect\n\nIt breaks when the session expired.'), 'fix-the-login-redirect');
  assert.equal(taskWords('\n\n  \r\nAdd dark mode\r\nand a toggle'), 'add-dark-mode');
  // A line with nothing to keep is passed over for the next.
  assert.equal(taskWords('🚀🚀🚀\nShip the release notes'), 'ship-the-release-notes');
  assert.equal(taskWords('```\nconst a = 1;\n```'), 'const-a-1');
});

test('a link is not part of the name', () => {
  assert.equal(taskWords('Fix this https://github.com/acme/shop/issues/12 please'), 'fix-this-please');
  assert.equal(taskWords('https://example.com/a/b?c=d\nUpdate the footer links'), 'update-the-footer-links');
  assert.equal(taskWords('HTTP://EXAMPLE.COM/x'), '');
});

test('a command, a greeting and a message without words name nothing', () => {
  assert.equal(taskWords('/review'), '');
  assert.equal(taskWords('/code-review ultra the whole branch'), '');
  assert.equal(taskWords('/plugin:skill.name do the thing'), '');
  assert.equal(taskWords('hi'), '');
  assert.equal(taskWords('Refactor!'), '');
  assert.equal(taskWords(''), '');
  assert.equal(taskWords('   \n  '), '');
  assert.equal(taskWords('🚀'), '');
  assert.equal(taskWords('登录重定向'), '');
  assert.equal(taskWords(undefined), '');
});

test('a path at the start of a message is no command', () => {
  assert.equal(taskWords('/src/main/ipc.js has a bug in it'), 'src-main-ipc-js-has-a-bug-in-it');
  assert.equal(taskWords('/ is the root route, fix it'), 'is-the-root-route-fix-it');
});

test("a task's branch gets a number only when its name is taken", () => {
  assert.equal(taskBranchName('fix-login', free), 'fix-login');
  assert.equal(taskBranchName('fix-login', used('fix-login')), 'fix-login-2');
  assert.equal(taskBranchName('fix-login', used('fix-login', 'fix-login-2', 'fix-login-3')), 'fix-login-4');
  assert.equal(taskBranchName('fix-login', free, 'safa/feature'), 'safa/feature/fix-login');
  assert.equal(taskBranchName('fix-login', used('safa/fix-login'), 'safa'), 'safa/fix-login-2');
  // The same words without the prefix are another branch.
  assert.equal(taskBranchName('fix-login', used('fix-login'), 'safa'), 'safa/fix-login');
});

test('git accepts every name made here', { skip: !HAS_GIT }, () => {
  const texts = [
    'Fix login redirect',
    'Crash: `foo..bar` ~ ^weird? [chars] *here* \\ @{now}.lock',
    '.hidden/ file // slashes.',
    '-starts with a dash',
    'ends with a dot.',
    'x'.repeat(300),
    'control\u0001chars\u007f and a space ',
    'Über café: naïve façade',
    'HEAD is detached',
    '@ sign and a.lock',
  ];
  const prefixes = ['', 'safa', 'Safa E./feature', '-x-/.lock/..', '@{u}/~'];
  for (const text of texts) {
    for (const typed of prefixes) {
      const prefix = branchPrefix(typed);
      const task = taskBranchName(taskWords(text) || 'a-task', free, prefix);
      for (const name of [freeBranchName(text, free, prefix), task]) {
        assert.equal(spawnSync('git', ['check-ref-format', '--branch', name]).status, 0, name);
        assert.match(name, /^[a-z0-9]+(?:[-/][a-z0-9]+)*$/, name);
      }
      // A project's name is as long as its folder's. A task's is cut to fit the branch field.
      assert.ok(task.length <= 100, `${task} fits the branch field`);
    }
  }
});

// ---- the nickname made up from a branch ---------------------------------------------------------

test('a made-up nickname is the service, and what tells the contact from the others on it', () => {
  assert.equal(madeUpNickname('Claude', 'shop-2'), 'Claude (shop-2)');
  assert.equal(madeUpNickname('Claude', ''), 'Claude');
  assert.equal(madeUpNickname('Claude'), 'Claude');
});

test('a nickname made up from a service says the one another agent answers on', () => {
  assert.equal(
    nicknameOnService('Codex (finish-com-628-content-pages-resource)', 'Codex', 'Claude'),
    'Claude (finish-com-628-content-pages-resource)'
  );
  assert.equal(nicknameOnService('Codex', 'Codex', 'Claude'), 'Claude');
  // One that was typed, or says nothing of the service, is kept: so is one on the same service.
  assert.equal(nicknameOnService('Payments', 'Codex', 'Claude'), null);
  assert.equal(nicknameOnService('Codex helper', 'Codex', 'Claude'), null);
  assert.equal(nicknameOnService('Codex ()', 'Codex', 'Claude'), null);
  assert.equal(nicknameOnService('Claude (shop-2)', 'Claude', 'Claude'), null);
});

test('the nickname made up from a branch follows it to the name it is given', () => {
  const branch = { from: 'shop-2', name: 'fix-the-login-redirect' };
  assert.equal(followedNickname('Claude (shop-2)', 'Claude', branch), 'Claude (fix-the-login-redirect)');
  assert.equal(followedNickname('Codex (shop-2)', 'Codex', branch), 'Codex (fix-the-login-redirect)');
});

test('the prefix all the branches share is in neither nickname', () => {
  const branch = { from: 'safa/feature/shop-2', name: 'safa/feature/fix-the-login-redirect', prefix: 'safa/feature' };
  assert.equal(followedNickname('Claude (shop-2)', 'Claude', branch), 'Claude (fix-the-login-redirect)');
  // The prefix was changed, or taken away, between the two names.
  assert.equal(
    followedNickname('Claude (shop-2)', 'Claude', { ...branch, name: 'fix-the-login-redirect', prefix: '' }),
    'Claude (fix-the-login-redirect)'
  );
  assert.equal(
    followedNickname('Claude (shop-2)', 'Claude', {
      from: 'shop-2',
      name: 'safa/fix-the-login-redirect',
      prefix: 'safa',
    }),
    'Claude (fix-the-login-redirect)'
  );
  // Made up while there was no prefix to leave out: the whole first name is in it.
  assert.equal(
    followedNickname('Claude (wip/shop-2)', 'Claude', { from: 'wip/shop-2', name: 'fix-the-login-redirect' }),
    'Claude (fix-the-login-redirect)'
  );
});

test('it follows the contact on to a new branch too, and to the name that one is given', () => {
  // Continue, after a pull request that is merged: from the branch the work was named after to a made-up one.
  const on = { from: 'safa/fix-the-login-redirect', name: 'safa/shop-3', prefix: 'safa' };
  assert.equal(followedNickname('Claude (fix-the-login-redirect)', 'Claude', on), 'Claude (shop-3)');
  const named = { from: 'safa/shop-3', name: 'safa/speed-up-the-checkout', prefix: 'safa' };
  assert.equal(followedNickname('Claude (shop-3)', 'Claude', named), 'Claude (speed-up-the-checkout)');
  // A nickname from before nicknames followed still names the first branch: it is left as it is.
  assert.equal(followedNickname('Claude (shop-2)', 'Claude', on), null);
});

test('a nickname that says something else is the user’s own, and is kept', () => {
  const branch = { from: 'shop-2', name: 'fix-the-login-redirect' };
  assert.equal(followedNickname('Shop helper', 'Claude', branch), null, 'typed');
  assert.equal(followedNickname('Fix login redirect #123', 'Claude', branch), null, 'from an issue');
  assert.equal(followedNickname('Claude (shop-3)', 'Claude', branch), null, 'another branch’s');
  assert.equal(followedNickname('Claude (shop-2) ', 'Claude', branch), null, 'changed by hand, however little');
  assert.equal(followedNickname('Claude (shop-2)', 'Codex', branch), null, 'made up for another service');
  assert.equal(followedNickname('Claude', 'Claude', branch), null);
});

test('a branch that keeps its name leaves the nickname as it is', () => {
  assert.equal(followedNickname('Claude (shop-2)', 'Claude', { from: 'shop-2', name: 'shop-2' }), null);
  assert.equal(followedNickname('Claude (shop-2)', 'Claude', { from: '', name: 'fix-login' }), null);
});
