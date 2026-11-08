// A stand-in for GitHub made of real git repositories in temp folders, for the
// tests of worktrees on pull requests: a project's repository, a clone of it to
// work in, and pull requests the way GitHub keeps them, under refs/pull.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { tempDir } from './temp-dir.js';

export const HAS_GIT = spawnSync('git', ['--version']).status === 0;

// macOS hands out temp folders through a symlink; git answers with the real path.
export const tmp = () => fs.realpathSync(tempDir('cm-pull-'));

const AS_TEST = ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false'];

export const run = (cwd, ...args) =>
  // A plain `git push` is what an agent runs, so it is tried the way git behaves out of the box.
  execFileSync('git', [...AS_TEST, '-c', 'push.default=simple', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();

/** Whether git refuses a command, such as asking for something that is not there. */
export const fails = (cwd, ...args) => spawnSync('git', args, { cwd }).status !== 0;

export function commit(dir, file = 'a.txt', text = 'one') {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
  run(dir, 'add', '.');
  run(dir, 'commit', '--quiet', '-m', `add ${file}`);
  return run(dir, 'rev-parse', 'HEAD');
}

/**
 * The project's repository at acme/shop with one commit on `main`, and `dir`, a
 * clone of it called "shop" that contacts work in.
 */
export function hub() {
  const root = tmp();
  const origin = path.join(root, 'acme', 'shop.git');
  fs.mkdirSync(path.dirname(origin));
  run(root, 'init', '--quiet', '--bare', '-b', 'main', origin);
  const clone = (from, name) => {
    run(root, 'clone', '--quiet', from, name);
    return path.join(root, name);
  };
  // Where a colleague pushes from.
  const seed = clone(origin, 'seed');
  commit(seed);
  run(seed, 'push', '--quiet', 'origin', 'main');
  const dir = clone(origin, 'shop');

  return {
    origin,
    dir,
    seed,
    /** Opens a pull request from a branch of the repository itself. Returns its newest commit. */
    open(number, branch) {
      run(seed, 'checkout', '--quiet', '-B', branch, 'origin/main');
      const head = commit(seed, 'feature.txt', `for #${number}`);
      run(seed, 'push', '--quiet', '--force', 'origin', branch);
      run(origin, 'update-ref', `refs/pull/${number}/head`, head);
      return head;
    },
    /** Pushes one more commit to a pull request that is open. Returns it. */
    update(number, branch) {
      run(seed, 'checkout', '--quiet', branch);
      const head = commit(seed, `more-${number}.txt`, 'more');
      run(seed, 'push', '--quiet', 'origin', branch);
      run(origin, 'update-ref', `refs/pull/${number}/head`, head);
      return head;
    },
    /** Opens a pull request from a branch of octocat's fork. Returns the fork and the pull request's newest commit. */
    openFromFork(number, branch) {
      const fork = path.join(root, 'octocat', 'shop.git');
      if (!fs.existsSync(fork)) {
        fs.mkdirSync(path.dirname(fork), { recursive: true });
        run(root, 'clone', '--quiet', '--bare', origin, fork);
      }
      const theirs = clone(fork, `octocat-${number}`);
      if (branch !== 'main') run(theirs, 'checkout', '--quiet', '-b', branch);
      const head = commit(theirs, `fork-${number}.txt`, 'from the fork');
      run(theirs, 'push', '--quiet', 'origin', branch);
      // GitHub keeps a fork's pull request in the repository it was opened against.
      run(origin, 'fetch', '--quiet', fork, `${branch}:refs/pull/${number}/head`);
      return { fork, head };
    },
  };
}
