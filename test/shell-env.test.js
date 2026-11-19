import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLoginPath, waitingFor } from '../src/main/shell-env.js';
import { tempDir } from './fixtures/temp-dir.js';

// The stand-in shells are scripts, which Windows has no way to start. Nothing is asked there at the start anyway.
const skip = process.platform === 'win32';
const DEFAULT_PATH = '/usr/bin:/bin';

/** A program to stand in for the login shell: it does what `script` says, whatever it is asked. */
function shell(script) {
  const file = path.join(tempDir('cm-shell-'), 'shell');
  fs.writeFileSync(file, `#!/bin/sh\n${script}\n`, { mode: 0o755 });
  return file;
}

/**
 * A login shell whose start-up files put on its PATH what a file says, as a line added by an installer would: what
 * it says can change while the app is open. Each time it is asked, it writes a line to `asked`.
 */
function installingShell(said) {
  const dir = tempDir('cm-shell-');
  const file = path.join(dir, 'path');
  const asked = path.join(dir, 'asked');
  fs.writeFileSync(file, said);
  const SHELL = shell(`echo >> "${asked}"; [ -s "${file}" ] && printf "__PATH__%s__PATH__" "$(cat "${file}")"; exit 0`);
  return {
    SHELL,
    install: (now) => fs.writeFileSync(file, now),
    times: () => (fs.existsSync(asked) ? fs.readFileSync(asked, 'utf8').length : 0),
  };
}

const env = (SHELL) => ({ SHELL, PATH: DEFAULT_PATH });
const mac = { platform: 'darwin' };
const gone = (pid) => {
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
};

test('the login shell’s PATH is taken over once it answers, and nobody is kept waiting for it', { skip }, async () => {
  const own = env(shell('sleep 0.2; printf "__PATH__/opt/homebrew/bin:/usr/bin__PATH__"'));
  let answered = false;
  const loading = createLoginPath({ ...mac, env: own }).ready.then(() => {
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
  await createLoginPath({ ...mac, env: own }).ready;
  assert.equal(own.PATH, '/a b/bin:/usr/bin');
});

test('it is asked as a login shell that reads its start-up files, for nothing but its PATH', { skip }, async () => {
  const own = env(shell('printf "__PATH__%s__PATH__" "$*"'));
  await createLoginPath({ ...mac, env: own }).ready;
  assert.equal(own.PATH, '-ilc printf "__PATH__%s__PATH__" "$PATH"');
});

test('a shell that says nothing or is not there leaves the PATH as it was', { skip }, async () => {
  for (const SHELL of [
    shell('echo "no path here"'),
    shell('printf "__PATH____PATH__"'),
    shell('echo "half" ; printf "__PATH__/no/end"; exit 3'),
    path.join(os.tmpdir(), 'cm-shell-that-is-not-there'),
  ]) {
    const own = env(SHELL);
    await createLoginPath({ ...mac, env: own }).ready;
    assert.equal(own.PATH, DEFAULT_PATH);
  }
});

test('a PATH the shell printed is taken, however it leaves after', { skip }, async () => {
  for (const script of [
    // A `.zlogout` that ends with `exit 1`, or a trap on EXIT, makes the shell leave with an error after its PATH.
    'printf "__PATH__/opt/homebrew/bin:/usr/bin__PATH__"; exit 1',
    'trap "exit 4" EXIT; printf "__PATH__/opt/homebrew/bin:/usr/bin__PATH__"',
  ]) {
    const own = env(shell(script));
    await createLoginPath({ ...mac, env: own }).ready;
    assert.equal(own.PATH, '/opt/homebrew/bin:/usr/bin');
  }
});

test(
  'a PATH printed while something the shell left running holds its output open is taken at once',
  { skip },
  async () => {
    const own = env(shell('sleep 2 & printf "__PATH__/held/open:/usr/bin__PATH__"'));
    const before = Date.now();
    await createLoginPath({ ...mac, env: own, timeout: 5000 }).ready;
    assert.ok(Date.now() - before < 1500, 'the PATH was taken without waiting for the output to close');
    assert.equal(own.PATH, '/held/open:/usr/bin');
  }
);

test(
  'a shell that takes too long is not waited for, and is stopped even when it ignores SIGTERM',
  { skip },
  async () => {
    const pidFile = path.join(tempDir('cm-shell-'), 'pid');
    // An interactive zsh takes no notice of SIGTERM.
    const own = env(shell(`trap "" TERM; echo $$ > "${pidFile}"; sleep 5; printf "__PATH__/too/late__PATH__"`));
    const before = Date.now();
    await createLoginPath({ ...mac, env: own, timeout: 300 }).ready;
    assert.ok(Date.now() - before < 1500, 'the wait ended with the time it was given');
    assert.equal(own.PATH, DEFAULT_PATH);
    const pid = Number(fs.readFileSync(pidFile, 'utf8'));
    for (let i = 0; i < 50 && !gone(pid); i++) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(gone(pid), 'the shell was stopped');
  }
);

test(
  'a shell slower than the wait: what starts goes on with the PATH there was, and gets the shell’s once it answers',
  { skip },
  async () => {
    const slow = installingShell('/opt/homebrew/bin:/usr/bin');
    const own = env(shell(`sleep 0.6; exec "${slow.SHELL}"`));
    const loginPath = createLoginPath({ ...mac, env: own, wait: 100, timeout: 5000 });
    const before = Date.now();
    await loginPath.ready;
    assert.ok(Date.now() - before < 500, 'what waits for the PATH waited no longer than it was told');
    assert.equal(own.PATH, DEFAULT_PATH);
    // Check again while it is still at it hears the same answer, from the same shell.
    await loginPath.reload();
    assert.equal(own.PATH, '/opt/homebrew/bin:/usr/bin');
    assert.equal(slow.times(), 1);
  }
);

test('asking again finds what was installed after the start', { skip }, async () => {
  const installer = installingShell('/usr/bin:/bin');
  const own = env(installer.SHELL);
  const loginPath = createLoginPath({ ...mac, env: own });
  await loginPath.ready;
  assert.equal(own.PATH, '/usr/bin:/bin');

  // Node, Homebrew or Codex installed while the app was open: the start-up files say so from now on.
  installer.install('/opt/homebrew/bin:/usr/bin:/bin');
  assert.equal(own.PATH, '/usr/bin:/bin', 'nothing is asked until Check again');
  await loginPath.reload();
  assert.equal(own.PATH, '/opt/homebrew/bin:/usr/bin:/bin');

  // Asked at once from two places, the shell is started once.
  const asked = installer.times();
  installer.install('/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin');
  await Promise.all([loginPath.reload(), loginPath.reload()]);
  assert.equal(installer.times(), asked + 1);
  assert.equal(own.PATH, '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin');

  // A shell that has nothing to say this time leaves the PATH it gave last.
  installer.install('');
  await loginPath.reload();
  assert.equal(own.PATH, '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin');
});

test('Linux asks its login shell too, and Windows asks nothing at the start', { skip }, async () => {
  const linux = env(shell('printf "__PATH__/home/me/.local/bin:/usr/bin__PATH__"'));
  await createLoginPath({ platform: 'linux', env: linux }).ready;
  assert.equal(linux.PATH, '/home/me/.local/bin:/usr/bin');

  const windows = env(shell('printf "__PATH__/from/the/shell__PATH__"'));
  let asked = 0;
  await createLoginPath({
    platform: 'win32',
    env: windows,
    askWindows: async () => {
      asked++;
      return 'C:\\Windows';
    },
  }).ready;
  assert.equal(windows.PATH, DEFAULT_PATH);
  assert.equal(asked, 0);
});

test('on Windows, asking again takes the PATH the registry has now, and keeps what the app’s PATH has besides', async () => {
  const own = { Path: 'C:\\WINDOWS\\system32;C:\\Tools\\bin;', SystemRoot: 'C:\\WINDOWS' };
  const loginPath = createLoginPath({
    platform: 'win32',
    env: own,
    // The system's Path, then the user's, as PowerShell prints them: npm's folder was added since the app started.
    askWindows: async () =>
      'C:\\Windows\\system32;C:\\Windows;C:\\Program Files\\nodejs\\\r\nC:\\Users\\example\\AppData\\Roaming\\npm;\r\n',
  });
  await loginPath.ready;
  assert.equal(own.Path, 'C:\\WINDOWS\\system32;C:\\Tools\\bin;', 'nothing is asked at the start');
  await loginPath.reload();
  assert.deepEqual(own, {
    Path: 'C:\\Windows\\system32;C:\\Windows;C:\\Program Files\\nodejs\\;C:\\Users\\example\\AppData\\Roaming\\npm;C:\\Tools\\bin',
    SystemRoot: 'C:\\WINDOWS',
  });

  // PowerShell that could not be started, or said nothing, leaves the PATH as it was.
  const still = { Path: 'C:\\Tools\\bin' };
  await createLoginPath({ platform: 'win32', env: still, askWindows: async () => '' }).reload();
  assert.deepEqual(still, { Path: 'C:\\Tools\\bin' });
});

test('on Windows, the registry’s PATH is read for real', { skip: process.platform !== 'win32' }, async () => {
  const own = { Path: 'C:\\only-here', SystemRoot: process.env.SystemRoot };
  await createLoginPath({ env: own }).reload();
  const folders = own.Path.toLowerCase().split(';');
  assert.ok(
    folders.some((folder) => /\\system32\\?$/.test(folder)),
    own.Path
  );
  assert.equal(folders.at(-1), 'c:\\only-here');
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
