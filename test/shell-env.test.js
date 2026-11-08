import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadLoginShellPath, waitingFor } from '../src/main/shell-env.js';
import { tempDir } from './fixtures/temp-dir.js';

// The stand-in shells are scripts, which Windows has no way to start. Nothing is asked there anyway.
const skip = process.platform === 'win32';
const DEFAULT_PATH = '/usr/bin:/bin';

/** A program to stand in for the login shell: it does what `script` says, whatever it is asked. */
function shell(script) {
  const file = path.join(tempDir('cm-shell-'), 'shell');
  fs.writeFileSync(file, `#!/bin/sh\n${script}\n`, { mode: 0o755 });
  return file;
}

const env = (SHELL) => ({ SHELL, PATH: DEFAULT_PATH });
const mac = { platform: 'darwin' };

test('the login shell’s PATH is taken over once it answers, and nobody is kept waiting for it', { skip }, async () => {
  const own = env(shell('sleep 0.2; printf "__PATH__/opt/homebrew/bin:/usr/bin__PATH__"'));
  let answered = false;
  const loading = loadLoginShellPath({ ...mac, env: own }).then(() => {
    answered = true;
  });
  // The shell is still starting: whoever called goes on with the PATH there was.
  assert.equal(answered, false);
  assert.equal(own.PATH, DEFAULT_PATH);
  await loading;
  assert.equal(own.PATH, '/opt/homebrew/bin:/usr/bin');
});

test('what the shell’s start-up files print around its PATH is left out', { skip }, async () => {
  const own = env(shell('echo "Welcome back!"; printf "__PATH__/a b/bin:/usr/bin__PATH__"; echo; echo "bye"'));
  await loadLoginShellPath({ ...mac, env: own });
  assert.equal(own.PATH, '/a b/bin:/usr/bin');
});

test('it is asked as a login shell that reads its start-up files, for nothing but its PATH', { skip }, async () => {
  const own = env(shell('printf "__PATH__%s__PATH__" "$*"'));
  await loadLoginShellPath({ ...mac, env: own });
  assert.equal(own.PATH, '-ilc printf "__PATH__%s__PATH__" "$PATH"');
});

test('a shell that fails, says nothing or is not there leaves the PATH as it was', { skip }, async () => {
  for (const SHELL of [
    shell('printf "__PATH__/half/done__PATH__"; exit 3'),
    shell('echo "no path here"'),
    shell('printf "__PATH____PATH__"'),
    path.join(os.tmpdir(), 'cm-shell-that-is-not-there'),
  ]) {
    const own = env(SHELL);
    await loadLoginShellPath({ ...mac, env: own });
    assert.equal(own.PATH, DEFAULT_PATH);
  }
});

test('a shell that takes too long is not waited for, also when it leaves something running', { skip }, async () => {
  for (const script of [
    'sleep 2; printf "__PATH__/too/late__PATH__"',
    // Its own work is done at once, but what it left behind keeps its output open.
    'sleep 2 & printf "__PATH__/held/open__PATH__"',
  ]) {
    const own = env(shell(script));
    const before = Date.now();
    await loadLoginShellPath({ ...mac, env: own, timeout: 150 });
    assert.ok(Date.now() - before < 1500, 'the wait ended with the time it was given');
    assert.equal(own.PATH, DEFAULT_PATH);
  }
});

test('Linux asks its login shell too, and Windows asks nothing', { skip }, async () => {
  const linux = env(shell('printf "__PATH__/home/me/.local/bin:/usr/bin__PATH__"'));
  await loadLoginShellPath({ platform: 'linux', env: linux });
  assert.equal(linux.PATH, '/home/me/.local/bin:/usr/bin');

  const windows = env(shell('printf "__PATH__/from/the/shell__PATH__"'));
  await loadLoginShellPath({ platform: 'win32', env: windows });
  assert.equal(windows.PATH, DEFAULT_PATH);
});

test('what starts a program waits for the PATH, and then runs as it always did', async () => {
  let ready;
  const pathReady = new Promise((resolve) => {
    ready = resolve;
  });
  const started = [];
  const start = waitingFor(pathReady, (program, where) => {
    started.push(program);
    if (program === 'nope') throw new Error(`${program} is not installed.`);
    return `${program} in ${where}`;
  });

  const first = start('git', '/work');
  const second = start('gh', '/work');
  const failing = start('nope', '/work');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, [], 'nothing is started before the PATH is there');

  ready();
  assert.equal(await first, 'git in /work');
  assert.equal(await second, 'gh in /work');
  await assert.rejects(failing, /nope is not installed/);
  assert.deepEqual(started, ['git', 'gh', 'nope'], 'in the order they were asked for');

  // From then on there is nothing to wait for.
  assert.equal(await start('codex', '/home'), 'codex in /home');
});
