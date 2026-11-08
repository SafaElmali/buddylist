import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pullRequestPage } from '../src/main/pull-request-page.js';
import { tempDir } from './fixtures/temp-dir.js';

// The page is asked for in the contact's folder, so it wants one that exists.
const FOLDER = tempDir('cm-pr-page-');

/**
 * A stand-in for git: what each command prints, by its first words. A command that is
 * not listed prints nothing, as git does when it leaves with one of the `ok` codes.
 * @param {Record<string, string | Error>} answers
 */
function fakeGit(answers = {}) {
  const asked = [];
  const run = async (cwd, args) => {
    asked.push({ cwd, args });
    const key = Object.keys(answers).find((words) => args.join(' ').startsWith(words));
    const answer = key === undefined ? '' : answers[key];
    if (answer instanceof Error) throw answer;
    return { stdout: answer, cut: false };
  };
  return { run, asked };
}

/** A folder on `hover-card`, pushed to acme/shop. */
const pushed = (answers = {}) =>
  fakeGit({
    'symbolic-ref --quiet --short HEAD': 'hover-card\n',
    'remote get-url origin': 'git@github.com:acme/shop.git\n',
    'rev-parse --verify --quiet refs/remotes/origin/hover-card': '0a1b2c3\n',
    ...answers,
  });

/** The page for FOLDER as a stand-in git tells it, in a project whose main line is `mainLine`. */
const pageOf = ({ run }, mainLine = 'origin/main', folder = FOLDER) =>
  pullRequestPage(folder, { run, mainLine: async () => mainLine });

test('a pushed branch has a page that compares it with the main line', async () => {
  const git = pushed();
  assert.equal(await pageOf(git), 'https://github.com/acme/shop/compare/hover-card?expand=1');
  // Every question is asked in the contact's folder.
  assert.ok(git.asked.length && git.asked.every(({ cwd }) => cwd === FOLDER));
});

test('it only ever reads: nothing is pushed, fetched or written', async () => {
  const git = pushed();
  await pageOf(git);
  assert.deepEqual(
    git.asked.map(({ args }) => args),
    [
      ['symbolic-ref', '--quiet', '--short', 'HEAD'],
      ['remote', 'get-url', 'origin'],
      ['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/hover-card'],
    ]
  );
});

test('a branch with slashes in its name is looked for, and linked to, as it is called', async () => {
  const git = fakeGit({
    'symbolic-ref --quiet --short HEAD': 'safa/feature/hover-card\n',
    'remote get-url origin': 'https://github.com/acme/shop.git\n',
    'rev-parse --verify --quiet refs/remotes/origin/safa/feature/hover-card': '0a1b2c3\n',
  });
  assert.equal(await pageOf(git), 'https://github.com/acme/shop/compare/safa/feature/hover-card?expand=1');
});

test('a folder that is gone says so, and git is not asked', async () => {
  const git = pushed();
  await assert.rejects(pageOf(git, 'origin/main', path.join(FOLDER, 'gone')), {
    message: 'This folder is no longer there.',
  });
  await assert.rejects(pageOf(git, 'origin/main', ''), { message: 'This folder is no longer there.' });
  assert.equal(git.asked.length, 0);
});

test('a folder outside a repository has nothing to open a pull request from', async () => {
  const git = fakeGit({
    'symbolic-ref': new Error('not a git repository (or any of the parent directories): .git'),
  });
  await assert.rejects(pageOf(git), {
    message: 'This folder is not a git repository, so there is no pull request to open from it.',
  });
});

test('what else went wrong with git is said as git said it', async () => {
  const git = fakeGit({ 'symbolic-ref': new Error('Git was not found on this computer.') });
  await assert.rejects(pageOf(git), { message: 'Git was not found on this computer.' });
});

test('with no branch checked out there is nothing to compare', async () => {
  const git = pushed({ 'symbolic-ref --quiet --short HEAD': '' });
  await assert.rejects(pageOf(git), {
    message: 'This folder is not on a branch, so there is nothing to open a pull request from.',
  });
  assert.equal(git.asked.length, 1);
});

test('a project without the remote has no page to go to', async () => {
  await assert.rejects(pageOf(pushed({ 'remote get-url origin': '' })), {
    message: 'This project has no remote called origin, so there is no page on GitHub to open.',
  });
});

test('a remote that is not an address on GitHub is named, not guessed at', async () => {
  await assert.rejects(pageOf(pushed({ 'remote get-url origin': '/Users/me/repos/shop.git\n' })), {
    message: 'The remote of this project, /Users/me/repos/shop.git, is not an address on GitHub.',
  });
});

test('the main line itself is not something to open a pull request from', async () => {
  const onMain = () =>
    pushed({
      'symbolic-ref --quiet --short HEAD': 'main\n',
      'rev-parse --verify --quiet refs/remotes/origin/main': '0a1b2c3\n',
    });
  await assert.rejects(pageOf(onMain()), {
    message: "This folder is on main, the project's main branch. A pull request needs a branch of its own.",
  });
  // Where the main line has another name, a branch called main is a branch like any other.
  assert.equal(await pageOf(onMain(), 'origin/trunk'), 'https://github.com/acme/shop/compare/main?expand=1');
  // And so is every branch of a project whose main line nobody can tell.
  assert.equal(await pageOf(onMain(), null), 'https://github.com/acme/shop/compare/main?expand=1');
});

test('a branch that only starts like the main line is not taken for it', async () => {
  const git = pushed({
    'symbolic-ref --quiet --short HEAD': 'main-menu\n',
    'rev-parse --verify --quiet refs/remotes/origin/main-menu': '0a1b2c3\n',
  });
  assert.equal(await pageOf(git), 'https://github.com/acme/shop/compare/main-menu?expand=1');
});

test('a branch that was never pushed says to push it, or to have it done', async () => {
  await assert.rejects(pageOf(pushed({ 'rev-parse --verify --quiet refs/remotes/origin/hover-card': '' })), {
    message:
      'The branch hover-card is not on GitHub yet. Push it first, or click Create PR to have it pushed and the pull request opened for you.',
  });
});

// ---- with git itself -----------------------------------------------------------------------------

const hasGit = (() => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

/** A repository with one commit on main, and nothing else. */
function repository() {
  const dir = tempDir('cm-pr-page-repo-');
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: os.devNull,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_AUTHOR_NAME: 'T',
        GIT_AUTHOR_EMAIL: 't@example.com',
        GIT_COMMITTER_NAME: 'T',
        GIT_COMMITTER_EMAIL: 't@example.com',
      },
    })
      .toString()
      .trim();
  git('init', '--quiet', '--initial-branch=main');
  fs.writeFileSync(path.join(dir, 'README.md'), '# shop\n');
  git('add', '.');
  git('commit', '--quiet', '-m', 'Start');
  return { dir, git };
}

test('git itself answers the way the page expects, step by step', { skip: !hasGit }, async () => {
  const { dir, git } = repository();

  // No remote yet.
  await assert.rejects(pullRequestPage(dir), /no remote called origin/);

  git('remote', 'add', 'origin', 'git@github.com:acme/shop.git');
  // As after a fetch: the remote has main. Git was not told that is its main line, and the name says so.
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  await assert.rejects(pullRequestPage(dir), /on main, the project's main branch/);
  // As after a clone: now it was told.
  git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  await assert.rejects(pullRequestPage(dir), /on main, the project's main branch/);
  // As after the remote renamed master to main, and a prune left origin/HEAD pointing at nothing.
  git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/master');
  await assert.rejects(pullRequestPage(dir), /on main, the project's main branch/);

  git('checkout', '--quiet', '-b', 'safa/feature/hover-card');
  await assert.rejects(pullRequestPage(dir), /The branch safa\/feature\/hover-card is not on GitHub yet/);

  // As after a push.
  git('update-ref', 'refs/remotes/origin/safa/feature/hover-card', 'HEAD');
  assert.equal(await pullRequestPage(dir), 'https://github.com/acme/shop/compare/safa/feature/hover-card?expand=1');

  // A subfolder of the repository is in the same branch.
  fs.mkdirSync(path.join(dir, 'src'));
  assert.match(await pullRequestPage(path.join(dir, 'src')), /\/compare\/safa\/feature\/hover-card\?expand=1$/);

  git('checkout', '--quiet', '--detach');
  await assert.rejects(pullRequestPage(dir), /not on a branch/);
});

test('git itself says when a folder is in no repository', { skip: !hasGit }, async () => {
  const dir = tempDir('cm-pr-page-plain-');
  await assert.rejects(pullRequestPage(dir), /This folder is not a git repository/);
});
