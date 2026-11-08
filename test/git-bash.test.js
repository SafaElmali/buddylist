import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { findGitBash, gitBash } from '../src/main/git-bash.js';

const HAS_GIT = spawnSync('git', ['--version']).status === 0;

// Where Git for Windows puts it, for everyone and for one user.
const PROGRAM_FILES = 'C:\\Program Files\\Git\\bin\\bash.exe';
const PER_USER = 'C:\\Users\\me\\AppData\\Local\\Programs\\Git\\bin\\bash.exe';
const WSL = 'C:\\Windows\\System32\\bash.exe';
const WINDOWS_ENV = {
  ProgramFiles: 'C:\\Program Files',
  'ProgramFiles(x86)': 'C:\\Program Files (x86)',
  LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
  PATH: 'C:\\Windows\\System32;C:\\Program Files\\Git\\cmd',
};

/** A computer with these files on it, and nothing else. */
const there =
  (...files) =>
  (file) =>
    files.includes(file);
/** What git says about where it keeps its programs; nothing, without git. */
const git = (said) => async () => said;
const noGit = git('');

test('Claude Code’s own setting wins, when the file it names is there', async () => {
  const own = 'D:\\tools\\Git\\bin\\bash.exe';
  const asked = [];
  const found = await findGitBash({
    env: { ...WINDOWS_ENV, CLAUDE_CODE_GIT_BASH_PATH: own },
    exists: there(own, PROGRAM_FILES),
    execPath: async () => {
      asked.push('git');
      return '';
    },
  });
  assert.equal(found, own);
  assert.deepEqual(asked, [], 'git is not even asked');
});

test('a setting that names a file that isn’t there is passed over', async () => {
  const found = await findGitBash({
    env: { ...WINDOWS_ENV, CLAUDE_CODE_GIT_BASH_PATH: 'D:\\gone\\bash.exe' },
    exists: there(PROGRAM_FILES),
    execPath: noGit,
  });
  assert.equal(found, PROGRAM_FILES);
});

test('else it is the bash of the Git for Windows the git on the PATH comes from', async () => {
  const scoop = 'C:\\Users\\me\\scoop\\apps\\git\\current\\bin\\bash.exe';
  const found = await findGitBash({
    env: WINDOWS_ENV,
    exists: there(scoop, PROGRAM_FILES),
    // Git for Windows answers with forward slashes.
    execPath: git('C:/Users/me/scoop/apps/git/current/mingw64/libexec/git-core'),
  });
  assert.equal(found, scoop);
});

test('else it is where Git for Windows installs itself, for everyone or for one user', async () => {
  const oldOne = 'C:\\Program Files (x86)\\Git\\bin\\bash.exe';
  for (const [files, expected] of [
    [[PROGRAM_FILES, PER_USER], PROGRAM_FILES],
    [[oldOne, PER_USER], oldOne],
    [[PER_USER], PER_USER],
  ]) {
    // A git whose folder has no bash in it, such as MinGit, leaves the usual places to look in.
    const execPath = git('C:/MinGit/mingw64/libexec/git-core');
    assert.equal(await findGitBash({ env: WINDOWS_ENV, exists: there(...files), execPath }), expected);
  }
});

test('WSL’s bash is never the one, not even when Claude Code’s setting names it', async () => {
  for (const wsl of [
    WSL,
    'C:\\WINDOWS\\system32\\bash.exe',
    'C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\bash.exe',
  ]) {
    const env = { CLAUDE_CODE_GIT_BASH_PATH: wsl, PATH: 'C:\\Windows\\System32' };
    assert.equal(await findGitBash({ env, exists: () => true, execPath: noGit }), null, wsl);
    assert.equal(
      await findGitBash({
        env: { ...WINDOWS_ENV, CLAUDE_CODE_GIT_BASH_PATH: wsl },
        exists: () => true,
        execPath: noGit,
      }),
      PROGRAM_FILES
    );
  }
  // Nor is a bash only found on the PATH: that is WSL's on most computers.
  assert.equal(await findGitBash({ env: WINDOWS_ENV, exists: there(WSL), execPath: noGit }), null);
});

test('without Git Bash anywhere there is none, and nothing goes wrong', async () => {
  assert.equal(await findGitBash({ env: WINDOWS_ENV, exists: () => false, execPath: noGit }), null);
  assert.equal(
    await findGitBash({ env: {}, exists: () => false, execPath: git('C:/Git/mingw64/libexec/git-core') }),
    null
  );
});

test('git itself is asked where it keeps its programs', { skip: !HAS_GIT }, async () => {
  const looked = [];
  const exists = (file) => {
    looked.push(file);
    return false;
  };
  await findGitBash({ env: {}, exists });
  const programs = execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim();
  assert.equal(looked[0], path.win32.join(programs, '..', '..', '..', 'bin', 'bash.exe'));
});

test('it is looked for once, by the first script, and the others are given that answer', () => {
  assert.equal(gitBash(), gitBash());
});
