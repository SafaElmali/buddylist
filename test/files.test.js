import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { failureReason, parseChecks, pullRequestChecks, rerunFailedChecks } from '../src/main/checks.js';
import {
  LISTED_AT_MOST,
  listFolder,
  placeIn,
  placeToOpen,
  readText,
  SHOWN_AT_MOST,
  toSend,
} from '../src/main/files.js';
import { LONGEST_COLOURED } from '../src/renderer/lib/syntax.js';
import { runsGoing } from '../src/shared/checks.js';
import { MAX_PICTURE_BYTES } from '../src/shared/pictures.js';
import { page } from './fixtures/dom.js';
import { tempDir } from './fixtures/temp-dir.js';

// The tabs are the conversation window's: nothing in them reaches for the page as they load.
const { codeLines, Files, fileNote, fileTitle, foundCount, foundNotes, pathFrom, pathIn } =
  await import('../src/renderer/chat/files.js');
const { checkMessage, checksMessage, checksSummary, rerunWaits, standingCounts } =
  await import('../src/renderer/chat/checks.js');
const { revealLabel } = await import('../src/renderer/chat/changes-view.js');

const tmp = () => fs.realpathSync(tempDir('cm-files-'));

/** A folder with these files in it: a path ending in "/" is a folder. */
function folder(files) {
  const dir = tmp();
  for (const [name, content] of Object.entries(files)) {
    if (name.endsWith('/')) fs.mkdirSync(path.join(dir, name), { recursive: true });
    else {
      fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      fs.writeFileSync(path.join(dir, name), content);
    }
  }
  return dir;
}

// ---- the All files tab: what a folder holds ------------------------------------------------------------

test('a folder is listed with its folders first, then its files, each by name', async () => {
  const dir = folder({ 'src/app.js': '', 'README.md': '', '.env': '', 'apps/': '', 'package.json': '{}' });
  assert.deepEqual(await listFolder(dir), {
    entries: [
      { name: 'apps', folder: true },
      { name: 'src', folder: true },
      { name: '.env', folder: false },
      { name: 'package.json', folder: false },
      { name: 'README.md', folder: false },
    ],
    more: 0,
  });
  assert.deepEqual((await listFolder(dir, 'src')).entries, [{ name: 'app.js', folder: false }]);
  assert.deepEqual(await listFolder(dir, 'apps'), { entries: [], more: 0 });
});

test('what git keeps for itself is not listed, and a folder that is linked in opens like one', async () => {
  const dir = folder({ '.git/HEAD': 'ref', '.DS_Store': '', 'a.txt': '' });
  const elsewhere = folder({ 'left-pad/index.js': '' });
  fs.symlinkSync(elsewhere, path.join(dir, 'node_modules'));
  fs.symlinkSync(path.join(dir, 'gone'), path.join(dir, 'broken'));
  assert.deepEqual((await listFolder(dir)).entries, [
    { name: 'node_modules', folder: true },
    { name: 'a.txt', folder: false },
    // A link that leads nowhere is a file nobody can read, not a folder that can't be opened.
    { name: 'broken', folder: false },
  ]);
  assert.deepEqual((await listFolder(dir, 'node_modules')).entries, [{ name: 'left-pad', folder: true }]);
});

test('a folder of thousands is listed up to a point, and the rest is counted', async () => {
  const dir = tmp();
  for (let i = 0; i < LISTED_AT_MOST + 7; i++) fs.writeFileSync(path.join(dir, `f${String(i).padStart(4, '0')}`), '');
  const { entries, more } = await listFolder(dir);
  assert.deepEqual([entries.length, more], [LISTED_AT_MOST, 7]);
  assert.equal(entries[0].name, 'f0000');
});

test('only what is in the contact’s folder is listed or read', async () => {
  const dir = folder({ 'a.txt': 'inside' });
  for (const outside of ['..', '../other', 'src/../../x', '/etc']) {
    assert.throws(() => placeIn(dir, outside), /not in this contact’s folder/, outside);
    await assert.rejects(listFolder(dir, outside), /not in this contact’s folder/);
    await assert.rejects(readText(dir, outside), /not in this contact’s folder/);
  }
  assert.equal(placeIn(dir, ''), dir);
  assert.equal(placeIn(dir, 'src/../a.txt'), path.join(dir, 'a.txt'), 'a way round that ends inside is inside');
});

test('a folder or a file that is gone says so', async () => {
  const dir = tmp();
  await assert.rejects(listFolder(dir, 'gone'), /The folder gone can’t be read/);
  await assert.rejects(readText(dir, 'gone.txt'), /gone.txt can’t be read/);
});

test('a file or folder the tab lists is opened where it is, and only while it is still there', async () => {
  const dir = folder({ 'src/app.js': '', 'docs/': '' });
  assert.equal(await placeToOpen(dir, 'src/app.js'), path.join(dir, 'src/app.js'));
  assert.equal(await placeToOpen(dir, 'docs/'), path.join(dir, 'docs'));
  await assert.rejects(placeToOpen(dir, 'gone.txt'), /gone.txt is not in the folder any more/);
  for (const outside of ['..', '../other', 'src/../../x']) {
    await assert.rejects(placeToOpen(dir, outside), /not in this contact’s folder/, outside);
  }
});

test('a file a link names from the top of the disk is opened wherever it is, while it is there', async () => {
  const dir = folder({ 'a.txt': '' });
  const proof = folder({ 'proof/video.mp4': '', 'proof/shots/': '' });
  assert.equal(await placeToOpen(dir, path.join(proof, 'proof/video.mp4')), path.join(proof, 'proof/video.mp4'));
  assert.equal(await placeToOpen(dir, `${proof}/proof/shots/`), path.join(proof, 'proof/shots'), 'a folder too');
  assert.equal(await placeToOpen(dir, `${proof}/proof/../proof/video.mp4`), path.join(proof, 'proof/video.mp4'));
  await assert.rejects(placeToOpen(dir, `${proof}/gone.mp4`), { message: `${proof}/gone.mp4 is not there any more.` });
});

test('a link outside the folder never opens what runs code, as it does inside the folder', async () => {
  const dir = folder({ 'run.command': '' });
  const away = folder({
    'run.command': '',
    'Setup.PKG': '',
    'install.sh': '',
    'Tool.app/Contents/Info.plist': '',
    'shots/': '',
  });
  fs.writeFileSync(path.join(away, 'tool'), '#!/bin/sh\n', { mode: 0o755 });
  fs.symlinkSync(path.join(away, 'run.command'), path.join(away, 'video.mp4'));
  for (const name of ['run.command', 'Setup.PKG', 'install.sh', 'Tool.app/', 'tool', 'video.mp4']) {
    const link = path.join(away, name);
    await assert.rejects(
      placeToOpen(dir, link),
      { message: `${link} can run code, so a link outside this contact’s folder doesn’t open it.` },
      name
    );
  }
  assert.equal(await placeToOpen(dir, path.join(away, 'shots')), path.join(away, 'shots'), 'a folder is no program');
  // The contact's folder is the agent's own: what is in it opens as it always has.
  assert.equal(await placeToOpen(dir, 'run.command'), path.join(dir, 'run.command'));
  assert.equal(await placeToOpen(dir, path.join(dir, 'run.command')), path.join(dir, 'run.command'));
});

// ---- what a file says -------------------------------------------------------------------------------------

test('a file is read as text, and a long one up to a point', async () => {
  const long = 'x'.repeat(SHOWN_AT_MOST + 100);
  const dir = folder({ 'a.txt': 'héllo\n', 'empty.txt': '', 'long.log': long });
  assert.deepEqual(await readText(dir, 'a.txt'), { text: 'héllo\n', binary: false, cut: false, size: 7 });
  assert.deepEqual(await readText(dir, 'empty.txt'), { text: '', binary: false, cut: false, size: 0 });
  const read = await readText(dir, 'long.log');
  assert.deepEqual([read.text.length, read.cut, read.size], [SHOWN_AT_MOST, true, long.length]);
});

test('a file that is not text is not shown as text', async () => {
  const dir = folder({ 'logo.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 1]) });
  assert.deepEqual(await readText(dir, 'logo.png'), { text: '', binary: true, cut: false, size: 8 });
});

test('a file’s tab is called after the file, and says when not all of it is there', () => {
  assert.equal(pathIn('', 'package.json'), 'package.json');
  assert.equal(pathIn('src/lib', 'util.js'), 'src/lib/util.js');
  assert.equal(fileTitle('src/lib/util.js'), 'util.js');
  assert.equal(fileTitle('README.md'), 'README.md');
  assert.equal(fileNote({ binary: false, cut: false, size: 10 }), '');
  assert.equal(fileNote({ binary: true, cut: false, size: 2048 }), 'This is not a text file (2 KB).');
  assert.equal(
    fileNote({ binary: false, cut: true, size: 400 * 1024 }),
    'Only its beginning is shown: the file is 400 KB.'
  );
  assert.match(fileNote({ binary: true, cut: false, size: 8 }), /1 KB/);
});

test('a file is drawn line by line, in the colours of the language its name tells', () => {
  const text = 'const a = 1; // one\r\n\n/* two\nlines */\n';
  const lines = codeLines('src/a.js', { text, cut: false });
  assert.deepEqual(
    lines.map((parts) => parts.map(({ text }) => text).join('')),
    ['const a = 1; // one', '', '/* two', 'lines */'],
    'no line after the newline that ends the last, and no Windows line ending'
  );
  assert.deepEqual(lines[0][0], { text: 'const', scope: 'hljs-keyword' });
  assert.deepEqual(lines[0].at(-1), { text: '// one', scope: 'hljs-comment' });
  assert.deepEqual(lines[3], [{ text: 'lines */', scope: 'hljs-comment' }], 'a comment of two lines is one on each');
});

test('a file whose language is not known, or too long to colour, is drawn as it is, line by line', () => {
  const plain = (lines) => lines.map((text) => [{ text, scope: null }]);
  assert.deepEqual(codeLines('LICENSE', { text: 'MIT\nCopyright\n', cut: false }), plain(['MIT', 'Copyright']));
  assert.deepEqual(codeLines('notes.unknown', { text: 'if (x) {}', cut: false }), plain(['if (x) {}']));
  const long = `const a = '${'x'.repeat(LONGEST_COLOURED)}';`;
  assert.deepEqual(codeLines('min.js', { text: long, cut: false }), plain([long]));
  assert.deepEqual(codeLines('src/a.js', { text: '', cut: false }), [], 'an empty file has no lines');
  // A file cut short may end in the middle of a line: only its whole lines are drawn.
  assert.deepEqual(codeLines('a.txt', { text: 'one\ntwo\nthr', cut: true }), plain(['one', 'two']));
});

// ---- a file a reply links to ------------------------------------------------------------------------------

test('a linked file is named from the top of the folder, also when written from the top of the disk', () => {
  assert.equal(pathFrom('/me/app', '/me/app/src/a.js'), 'src/a.js');
  assert.equal(pathFrom('/me/app/', '/me/app/src/a.js'), 'src/a.js', 'a folder written with its slash');
  assert.equal(pathFrom('/me/app', 'src/a.js'), 'src/a.js');
  assert.equal(pathFrom('/me/app', './src/a.js'), 'src/a.js');
  assert.equal(pathFrom('/me/app', '/me/app-two/a.js'), '/me/app-two/a.js', 'a folder named like it is another');
  assert.equal(pathFrom('/me/app', '/tmp/proof.mp4'), '/tmp/proof.mp4');
  assert.equal(pathFrom('/me/app', '../notes/plan.md'), '../notes/plan.md');
});

/**
 * The All files tab of a contact working in `dir`, on a page that only builds what it is asked to: the tabs
 * it opened beside the conversation, and what it handed to the app the computer opens a file with.
 */
function filesTab(t, dir) {
  page(t);
  const tabs = [];
  const opened = [];
  const tab = new Files(
    { open: ({ id, body }) => tabs.push({ id, body }) },
    { contactId: 'c1', contact: { cwd: dir } },
    {
      list: () => listFolder(dir),
      read: (_contactId, file) => readText(dir, file),
      open: async (_contactId, file, opts) => void opened.push([file, opts]),
    },
    { attach() {} }
  );
  return { tab, tabs, opened };
}

test('a text file a reply links to is read in a tab beside the conversation, as one clicked in All files is', async (t) => {
  const dir = folder({ 'app/services/create.rb': 'class Create; end\n' });
  const { tab, tabs, opened } = filesTab(t, dir);
  for (const link of [path.join(dir, 'app/services/create.rb'), 'app/services/create.rb', './app/services/create.rb']) {
    await tab.openLinked(link);
  }
  assert.deepEqual(
    tabs.map(({ id }) => id),
    Array(3).fill('file:app/services/create.rb'),
    'one tab, however the link wrote it'
  );
  const code = tabs[0].body.querySelector('.file-code');
  assert.equal(code.textContent, '1class Create; end', 'its line, with its number');
  assert.equal(code.querySelector('.hljs-keyword').textContent, 'class', 'in the colours of Ruby');
  assert.deepEqual(opened, [], 'nothing went to another app');
});

test('a video, a folder, or a file that is gone or outside the folder opens as Open file opens it', async (t) => {
  const dir = folder({ 'tmp/proof.mp4': Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]), 'docs/': '' });
  const { tab, tabs, opened } = filesTab(t, dir);
  for (const link of [path.join(dir, 'tmp/proof.mp4'), 'docs/', 'gone.rb', '/etc/hosts']) await tab.openLinked(link);
  // Open file opens one outside the folder by its whole path, and says itself why one can't be opened.
  assert.deepEqual(opened, [
    ['tmp/proof.mp4', { inFolder: false }],
    ['docs/', { inFolder: false }],
    ['gone.rb', { inFolder: false }],
    ['/etc/hosts', { inFolder: false }],
  ]);
  assert.deepEqual(tabs, [], 'no tab that only says it can’t show it');
});

test('a right-click on a link to a file of the folder offers what one on the file in All files does', async (t) => {
  const dir = folder({ 'src/app.js': '' });
  const { tab, opened } = filesTab(t, dir);
  const items = tab.linkMenu(path.join(dir, 'src/app.js'));
  assert.deepEqual(
    items.map((item) => item.label ?? '—'),
    ['Add to message', 'Copy', '—', 'Open file', revealLabel(navigator.platform)],
    'Show in Finder on a Mac, as the tree has it'
  );
  // Opening it in its app, as a click on the link did before, is still there.
  for (const item of items.slice(3)) await item.action();
  assert.deepEqual(opened, [
    ['src/app.js', { inFolder: false }],
    ['src/app.js', { inFolder: true }],
  ]);
  assert.equal(tab.linkMenu('src/').at(-2).label, 'Open folder');
  for (const outside of ['/etc/hosts', '../notes/plan.md']) assert.equal(tab.linkMenu(outside), null, outside);
});

test('a right-click on a link to a picture or a video offers to download it, also outside the folder', async (t) => {
  const dir = folder({ 'shots/home.png': '' });
  const { tab } = filesTab(t, dir);
  const labels = (items) => items.map((item) => item.label ?? '—');
  // In the folder, after what the file offers in All files.
  assert.deepEqual(labels(tab.linkMenu('shots/home.png')).slice(-3), ['—', 'Copy image', 'Download image...']);
  // Outside it, as a proof video in /tmp, that is all there is.
  assert.deepEqual(labels(tab.linkMenu('/tmp/proof.mp4')), ['Download video...']);
  assert.deepEqual(labels(tab.linkMenu('../shots/home.png')), ['Copy image', 'Download image...']);
});

// ---- Send Files: what you picked ---------------------------------------------------------------------------

test('a picked picture goes in as a picture, and a file or folder as a path, each in the order picked', async () => {
  const dir = folder({ 'shot.png': 'png!', 'notes.txt': 'hi', 'src/': '', 'Photo.JPG': 'jpg!', 'wave.webp': 'webp' });
  const at = (name) => path.join(dir, name);
  const picked = await toSend(['shot.png', 'notes.txt', 'src', 'Photo.JPG', 'wave.webp'].map(at));
  assert.deepEqual(picked.pictures, [
    { mediaType: 'image/png', data: Buffer.from('png!').toString('base64') },
    { mediaType: 'image/jpeg', data: Buffer.from('jpg!').toString('base64') },
    { mediaType: 'image/webp', data: Buffer.from('webp').toString('base64') },
  ]);
  assert.deepEqual(picked.paths, [at('notes.txt'), `${at('src')}/`], "a folder's path ends in a slash");
});

test('a picture as big as a message takes goes in, and a bigger one is a path for the agent to read', async () => {
  const dir = folder({ 'fits.gif': Buffer.alloc(MAX_PICTURE_BYTES), 'huge.png': Buffer.alloc(MAX_PICTURE_BYTES + 1) });
  const picked = await toSend([path.join(dir, 'fits.gif'), path.join(dir, 'huge.png')]);
  assert.deepEqual(
    picked.pictures.map((p) => p.mediaType),
    ['image/gif']
  );
  assert.deepEqual(picked.paths, [path.join(dir, 'huge.png')]);
});

test('a kind of picture agents don’t take, a folder named like a picture, or one that is gone, is a path', async () => {
  const dir = folder({ 'logo.svg': '<svg/>', 'spin.apng': 'apng', 'shots.png/': '' });
  const names = ['logo.svg', 'spin.apng', 'shots.png', 'gone.png'].map((name) => path.join(dir, name));
  const [svg, apng, shots, gone] = names;
  assert.deepEqual(await toSend(names), { pictures: [], paths: [svg, apng, `${shots}/`, gone] });
});

test('nothing picked sends nothing', async () => {
  assert.deepEqual(await toSend([]), { pictures: [], paths: [] });
});

// ---- the Checks tab ---------------------------------------------------------------------------------------

const PRINTED = JSON.stringify([
  { name: 'test', workflow: 'Build macOS app', bucket: 'pass', link: 'https://github.com/o/r/actions/runs/1' },
  { name: 'mac', workflow: 'Build macOS app', bucket: 'skipping', link: '' },
  { name: 'lint', workflow: '', bucket: 'fail', link: 'https://github.com/o/r/actions/runs/2' },
  { name: 'deploy', bucket: 'pending', link: 'javascript:alert(1)' },
  { nonsense: true },
]);

test('checks are listed with what needs you first: failing, then running, then the rest', () => {
  assert.deepEqual(parseChecks(PRINTED), [
    {
      name: 'lint',
      workflow: '',
      standing: 'fail',
      url: 'https://github.com/o/r/actions/runs/2',
      run: 'github.com/o/r/2',
    },
    // A link that is no page on the web is not one to open.
    { name: 'deploy', workflow: '', standing: 'pending', url: '', run: '' },
    {
      name: 'test',
      workflow: 'Build macOS app',
      standing: 'pass',
      url: 'https://github.com/o/r/actions/runs/1',
      run: 'github.com/o/r/1',
    },
    { name: 'mac', workflow: 'Build macOS app', standing: 'skipping', url: '', run: '' },
  ]);
  for (const nothing of ['', 'not json', '{}', 'null']) assert.deepEqual(parseChecks(nothing), []);
});

test('each check knows the GitHub Actions run it is part of: its jobs share it, a check run elsewhere has none', () => {
  const runs = parseChecks(
    JSON.stringify([
      { name: 'a', bucket: 'fail', link: 'https://github.com/o/r/actions/runs/7/job/70' },
      { name: 'b', bucket: 'pending', link: 'https://github.com/o/r/actions/runs/7/job/71?pr=3' },
      { name: 'c', bucket: 'pass', link: 'https://git.acme.dev/team/shop/actions/runs/8/job/80' },
      { name: 'd', bucket: 'pass', link: 'https://vercel.com/o/r/abc' },
    ])
  ).map(({ name, run }) => [name, run]);
  assert.deepEqual(runs, [
    ['a', 'github.com/o/r/7'],
    ['b', 'github.com/o/r/7'],
    ['c', 'git.acme.dev/team/shop/8'],
    ['d', ''],
  ]);
});

test('the checks are asked of gh for the folder’s branch, and are there also when gh leaves with an error', async () => {
  const asked = [];
  const passing = await pullRequestChecks('/work/shop', {
    run: async (cwd, args) => {
      asked.push([cwd, args]);
      return PRINTED;
    },
  });
  assert.deepEqual(asked, [['/work/shop', ['pr', 'checks', '--json', 'name,workflow,bucket,link']]]);
  assert.deepEqual([passing.pullRequest, passing.checks.length], [true, 4]);
  // gh leaves with 1 when a check fails and 8 while one runs, and prints them all the same.
  const failing = await pullRequestChecks('/work/shop', {
    run: async () => {
      throw Object.assign(new Error('Command failed'), { code: 1, stdout: PRINTED, stderr: '' });
    },
  });
  assert.equal(failing.checks[0].standing, 'fail');
});

test('a branch without a pull request, or without checks, is not an error', async () => {
  const saying = (stderr, code = 1) => ({
    run: async () => {
      throw Object.assign(new Error('Command failed'), { code, stdout: '', stderr });
    },
  });
  for (const stderr of ['no pull requests found for branch "shop-2"', 'no git remotes found']) {
    assert.deepEqual(await pullRequestChecks('/x', saying(stderr)), { pullRequest: false, checks: [] }, stderr);
  }
  assert.deepEqual(await pullRequestChecks('/x', saying("no checks reported on the 'shop-2' branch")), {
    pullRequest: true,
    checks: [],
  });
});

test('when GitHub can’t be asked, the tab is told why in words for the user', async () => {
  const missing = { run: async () => Promise.reject(Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' })) };
  await assert.rejects(pullRequestChecks('/x', missing), /GitHub CLI is not installed/);
  const signedOut = {
    run: async () => Promise.reject(Object.assign(new Error('x'), { code: 4, stderr: 'gh auth login' })),
  };
  await assert.rejects(pullRequestChecks('/x', signedOut), /not signed in/);
  const other = {
    run: async () => Promise.reject(Object.assign(new Error('x'), { code: 1, stderr: 'GraphQL: boom' })),
  };
  await assert.rejects(pullRequestChecks('/x', other), /GraphQL: boom/);
});

test('the tab sums the checks up in a line', () => {
  const checks = (...standings) => standings.map((standing) => ({ standing }));
  assert.equal(checksSummary({ pullRequest: false, checks: [] }), 'This branch has no pull request yet.');
  assert.equal(checksSummary({ pullRequest: true, checks: [] }), 'This pull request has no checks.');
  assert.equal(
    checksSummary({ pullRequest: true, checks: checks('pass', 'fail', 'pass', 'pending', 'skipping') }),
    '1 failed, 1 running, 2 passed'
  );
  assert.equal(checksSummary({ pullRequest: true, checks: checks('pass', 'pass') }), '2 passed');
  assert.equal(checksSummary({ pullRequest: true, checks: checks('skipping', 'cancel') }), 'Nothing ran.');
});

test('the bar over the checks has a part for each way some stand, failed first and what did not run last', () => {
  const checks = (...standings) => standings.map((standing) => ({ standing }));
  assert.deepEqual(standingCounts(checks('pass', 'cancel', 'fail', 'pass', 'pending', 'skipping', 'pass')), [
    ['fail', 1],
    ['pending', 1],
    ['pass', 3],
    ['skipping', 1],
    ['cancel', 1],
  ]);
  assert.deepEqual(standingCounts(checks('pass', 'pass')), [['pass', 2]]);
  assert.deepEqual(standingCounts([]), []);
});

test('the workflow runs still going are the ones with a check running on GitHub Actions', () => {
  const going = runsGoing([
    { standing: 'pending', run: 'github.com/o/r/7' },
    { standing: 'pending', run: '' },
    { standing: 'fail', run: 'github.com/o/r/8' },
    { standing: 'pass', run: 'github.com/o/r/9' },
  ]);
  assert.deepEqual([...going], ['github.com/o/r/7']);
});

test('Re-run failed waits while every failed check is in a workflow run that still has one going', () => {
  const check = (name, standing, run, workflow = 'PR CI') => ({ name, workflow, standing, url: '', run });
  // The run a failed job is in goes on: GitHub won't start it over yet.
  assert.equal(
    rerunWaits([check('test-features (2)', 'fail', 'gh/7'), check('coverage-report', 'pending', 'gh/7')]),
    'Re-run failed waits for PR CI to finish.'
  );
  assert.equal(
    rerunWaits([
      check('a', 'fail', 'gh/7'),
      check('b', 'fail', 'gh/8', 'Deploy'),
      check('c', 'pending', 'gh/7'),
      check('d', 'pending', 'gh/8', 'Deploy'),
    ]),
    'Re-run failed waits for PR CI and Deploy to finish.'
  );
  assert.equal(
    rerunWaits([check('a', 'fail', 'gh/7', ''), check('b', 'pending', 'gh/7', '')]),
    'Re-run failed waits for their workflow to finish.'
  );
  // One failed run is done: there is something to start over now.
  assert.equal(rerunWaits([check('a', 'fail', 'gh/7'), check('b', 'fail', 'gh/8'), check('c', 'pending', 'gh/7')]), '');
  // What runs in another run, or elsewhere than on GitHub Actions, is waited on by nobody.
  assert.equal(rerunWaits([check('a', 'fail', 'gh/7'), check('b', 'pending', 'gh/9')]), '');
  assert.equal(rerunWaits([check('a', 'fail', ''), check('b', 'pending', '')]), '');
  assert.equal(rerunWaits([check('a', 'pass', 'gh/7'), check('b', 'pending', 'gh/7')]), '');
  assert.equal(rerunWaits([]), '');
});

test('a failed check is handed to the conversation with why it failed and its page', () => {
  const check = {
    name: 'lint',
    workflow: 'CI',
    standing: 'fail',
    url: 'https://github.com/acme/shop/actions/runs/7/job/42',
    reason: ["Run eslint: src/cart.js:12: 'total' is never used", 'and 2 more on GitHub'],
  };
  assert.equal(
    checkMessage(check),
    [
      "A check failed on this branch's pull request: CI / lint",
      '',
      "Run eslint: src/cart.js:12: 'total' is never used",
      'and 2 more on GitHub',
      '',
      'https://github.com/acme/shop/actions/runs/7/job/42',
      '',
      'Find out why it failed, and fix it.',
    ].join('\n')
  );
});

test('a failed check GitHub says nothing about, or with no page, leaves those out', () => {
  assert.equal(
    checkMessage({ name: 'vercel', workflow: '', standing: 'fail', url: '', reason: [] }),
    "A check failed on this branch's pull request: vercel\n\nFind out why it failed, and fix it."
  );
  // A check from gh alone, before why it failed was asked, has no reason at all.
  assert.match(
    checkMessage({ name: 'build', workflow: 'CI', standing: 'fail', url: 'https://ci.example/1' }),
    /: CI \/ build\n\nhttps:\/\/ci\.example\/1\n\nFind out/
  );
});

test('among several agents a failed check mentions the one it is handed to', () => {
  const message = checkMessage(
    { name: 'test', workflow: 'CI', standing: 'fail', url: '', reason: [] },
    { to: 'Claude' }
  );
  assert.match(message, /^@Claude A check failed on this branch's pull request: CI \/ test\n/);
});

test('Send all to chat hands every failed check over in one message, each with why and its page', () => {
  const lint = {
    name: 'lint',
    workflow: 'CI',
    standing: 'fail',
    url: 'https://github.com/acme/shop/actions/runs/7/job/42',
    reason: ["Run eslint: src/cart.js:12: 'total' is never used"],
  };
  const vercel = { name: 'vercel', workflow: '', standing: 'fail', url: '', reason: [] };
  assert.equal(
    checksMessage([lint, vercel]),
    [
      "2 checks failed on this branch's pull request:",
      '',
      'CI / lint',
      "Run eslint: src/cart.js:12: 'total' is never used",
      'https://github.com/acme/shop/actions/runs/7/job/42',
      '',
      'vercel',
      '',
      'Find out why they failed, and fix them.',
    ].join('\n')
  );
  assert.match(checksMessage([lint, vercel], { to: 'Claude' }), /^@Claude 2 checks failed/);
  // A check from gh alone, before why it failed was asked, has no reason at all.
  assert.match(
    checksMessage([{ name: 'build', workflow: 'CI', standing: 'fail' }, vercel]),
    /\nCI \/ build\n\nvercel\n/
  );
});

test('one failed check sent with Send all reads as its own Send to chat does', () => {
  const check = { name: 'test', workflow: 'CI', standing: 'fail', url: 'https://ci.example/1', reason: ['boom'] };
  assert.equal(checksMessage([check]), checkMessage(check));
  assert.equal(checksMessage([check], { to: 'Claude' }), checkMessage(check, { to: 'Claude' }));
});

// ---- why a check failed, and running it again ---------------------------------------------------------

const JOB = (...steps) => JSON.stringify({ steps: steps.map(([name, conclusion]) => ({ name, conclusion })) });
const NOTES = (...notes) =>
  JSON.stringify(
    notes.map(([annotation_level, message, path = '.github', start_line = 1]) => ({
      annotation_level,
      message,
      path,
      start_line,
    }))
  );

test('a failed check says why in GitHub’s words: the step that failed and the error it reported', () => {
  assert.deepEqual(
    failureReason(
      JOB(['Set up job', 'success'], ['Run npm test', 'failure'], ['Post checkout', 'skipped']),
      NOTES(['warning', 'Node.js 20 is deprecated.'], ['failure', 'Process completed with exit code 1.'])
    ),
    ['Run npm test: Process completed with exit code 1.']
  );
  // A job GitHub never started has no steps: what it said is all there is.
  assert.deepEqual(
    failureReason(
      JOB(),
      NOTES(['failure', 'The job was not started because an Actions budget is preventing further use.'])
    ),
    ['The job was not started because an Actions budget is preventing further use.']
  );
  // A failed step that reported nothing is named all the same.
  assert.deepEqual(failureReason(JOB(['Build', 'failure']), NOTES()), ['Build failed']);
});

test('an error about a line of a file says which, and only the first few are shown', () => {
  assert.deepEqual(
    failureReason(
      JOB(['Lint', 'failure']),
      NOTES(
        ['failure', "'a' is never used.", 'src/a.js', 3],
        ['failure', "'b' is never used.", 'src/b.js', 0],
        ['notice', 'Unrelated.', 'src/c.js', 9],
        ['failure', "'d' is never used.", 'src/d.js', 7],
        ['failure', "'e' is never used.", 'src/e.js', 8],
        ['failure', "'f' is never used.", 'src/f.js', 9]
      )
    ),
    [
      "Lint: src/a.js:3: 'a' is never used.",
      // No line: the file alone.
      "src/b.js: 'b' is never used.",
      "src/d.js:7: 'd' is never used.",
      'and 2 more on GitHub',
    ]
  );
  const long = 'x'.repeat(1000);
  const [shown] = failureReason(JOB(), NOTES(['failure', long]));
  assert.ok(shown.length < 400 && shown.endsWith('…'), 'a long error is cut short');
  for (const nothing of ['', 'not json', '{}', 'null', '[{"nonsense":true}]']) {
    assert.deepEqual(failureReason(nothing, nothing), [], nothing);
  }
});

// What gh prints for a pull request with checks run by GitHub Actions, and one run elsewhere.
const ACTIONS = 'https://github.com/o/r/actions/runs';
const PRINTED_FAILING = JSON.stringify([
  { name: 'test', workflow: 'Build macOS app', bucket: 'fail', link: `${ACTIONS}/10/job/100` },
  { name: 'lint', workflow: 'Build macOS app', bucket: 'fail', link: `${ACTIONS}/10/job/101` },
  { name: 'site', workflow: 'Deploy site', bucket: 'fail', link: `${ACTIONS}/20/job/200` },
  { name: 'mac', workflow: 'Build macOS app', bucket: 'skipping', link: `${ACTIONS}/10/job/102` },
  { name: 'pages', workflow: 'Pages', bucket: 'pass', link: `${ACTIONS}/30/job/300` },
  { name: 'vercel', workflow: '', bucket: 'fail', link: 'https://vercel.com/o/r/abc' },
]);

/** A stand-in for gh that answers from `answers` by what it was asked, and keeps a list of that. */
function fakeGh(answers) {
  const asked = [];
  const run = async (cwd, args) => {
    asked.push(args.join(' '));
    const answer = answers[args.join(' ')];
    if (answer instanceof Error) throw answer;
    if (answer === undefined) throw Object.assign(new Error('Command failed'), { code: 1, stderr: 'HTTP 404' });
    return answer;
  };
  return { asked, run };
}

test('each failed check run by GitHub Actions comes with why it failed; the others are not asked about', async () => {
  const { asked, run } = fakeGh({
    'pr checks --json name,workflow,bucket,link': PRINTED_FAILING,
    'api --hostname github.com repos/o/r/actions/jobs/100': JOB(['Run npm test', 'failure']),
    'api --hostname github.com repos/o/r/check-runs/100/annotations': NOTES(['failure', 'Process completed.']),
    'api --hostname github.com repos/o/r/actions/jobs/101': JOB(['Run lint', 'failure']),
    // The errors of job 101, and everything about job 200, can't be had: what can be is shown.
    'api --hostname github.com repos/o/r/check-runs/101/annotations': Object.assign(new Error('x'), { code: 1 }),
  });
  const { checks } = await pullRequestChecks('/work/shop', { run });
  const reasons = Object.fromEntries(checks.map((check) => [check.name, check.reason]));
  assert.deepEqual(reasons, {
    lint: ['Run lint failed'],
    site: [],
    test: ['Run npm test: Process completed.'],
    vercel: [],
    pages: undefined,
    mac: undefined,
  });
  assert.equal(asked.filter((args) => args.startsWith('api')).length, 6, 'two questions for each failed job');
  assert.ok(!asked.some((args) => /\b(102|300)\b/.test(args)), 'nothing is asked about a check that did not fail');
});

test('a company’s own GitHub is asked about its own checks', async () => {
  const { asked, run } = fakeGh({
    'pr checks --json name,workflow,bucket,link': JSON.stringify([
      { name: 'test', bucket: 'fail', link: 'https://git.acme.dev/team/shop/actions/runs/7/job/70' },
    ]),
  });
  await pullRequestChecks('/work/shop', { run });
  assert.ok(asked.includes('api --hostname git.acme.dev repos/team/shop/actions/jobs/70'), asked.join('\n'));
});

test('Re-run failed starts each workflow run with a failed check over once, as GitHub’s own button does', async () => {
  const { asked, run } = fakeGh({
    'pr checks --json name,workflow,bucket,link': PRINTED_FAILING,
    'run rerun 10 --failed -R github.com/o/r': '',
    'run rerun 20 --failed -R github.com/o/r': '',
  });
  assert.equal(await rerunFailedChecks('/work/shop', { run }), 2);
  assert.deepEqual(asked.filter((args) => args.startsWith('run')).sort(), [
    'run rerun 10 --failed -R github.com/o/r',
    'run rerun 20 --failed -R github.com/o/r',
  ]);
  // Only gh's own list of the folder's checks is read: not why they failed.
  assert.ok(!asked.some((args) => args.startsWith('api')));
});

test('Re-run failed says so when there is nothing it can start over, or GitHub refuses', async () => {
  const listing = (printed, more = {}) =>
    fakeGh({ 'pr checks --json name,workflow,bucket,link': printed, ...more }).run;
  const passing = JSON.stringify([{ name: 'test', bucket: 'pass', link: `${ACTIONS}/10/job/100` }]);
  await assert.rejects(rerunFailedChecks('/x', { run: listing(passing) }), /No check here has failed/);
  const elsewhere = JSON.stringify([{ name: 'vercel', bucket: 'fail', link: 'https://vercel.com/o/r/abc' }]);
  await assert.rejects(rerunFailedChecks('/x', { run: listing(elsewhere) }), /not run by GitHub Actions/);
  const busy = Object.assign(new Error('x'), {
    code: 1,
    stderr: 'run 20 cannot be rerun; This workflow is already running',
  });
  // One run is started over and the other is refused: what GitHub said about that one is shown.
  await assert.rejects(
    rerunFailedChecks('/x', {
      run: listing(PRINTED_FAILING, {
        'run rerun 10 --failed -R github.com/o/r': '',
        'run rerun 20 --failed -R github.com/o/r': busy,
      }),
    }),
    /GitHub did not re-run them: run 20 cannot be rerun; This workflow is already running/
  );
  const signedOut = Object.assign(new Error('x'), { code: 4, stderr: 'gh auth login' });
  await assert.rejects(rerunFailedChecks('/x', { run: listing(signedOut) }), /not signed in/);
});

test('Re-run failed leaves a workflow run that still has a check going, and starts the done ones over', async () => {
  const still = (...more) => JSON.stringify([...JSON.parse(PRINTED_FAILING), ...more]);
  // Run 20 still has a job going: only run 10 is started over.
  const { asked, run } = fakeGh({
    'pr checks --json name,workflow,bucket,link': still({
      name: 'coverage',
      workflow: 'Deploy site',
      bucket: 'pending',
      link: `${ACTIONS}/20/job/201`,
    }),
    'run rerun 10 --failed -R github.com/o/r': '',
  });
  assert.equal(await rerunFailedChecks('/work/shop', { run }), 1);
  assert.deepEqual(
    asked.filter((args) => args.startsWith('run')),
    ['run rerun 10 --failed -R github.com/o/r']
  );
  // Every failed run goes on: nothing is asked of GitHub, and the tab says why.
  const busy = fakeGh({
    'pr checks --json name,workflow,bucket,link': JSON.stringify([
      { name: 'test-features (2)', workflow: 'PR CI', bucket: 'fail', link: `${ACTIONS}/30/job/300` },
      { name: 'coverage-report', workflow: 'PR CI', bucket: 'pending', link: `${ACTIONS}/30/job/301` },
      { name: 'vercel', workflow: '', bucket: 'fail', link: 'https://vercel.com/o/r/abc' },
    ]),
  });
  await assert.rejects(rerunFailedChecks('/x', { run: busy.run }), /Their workflow is still running/);
  assert.ok(!busy.asked.some((args) => args.startsWith('run')));
});

// ---- what the All files tab had open, open again ----------------------------------------------------

/** Every file of the made-up folder, as Git lists them for a search. */
const EVERY_FILE = async () => ({ paths: ['README.md', 'src/app.js', 'src/lib/util.js'], limited: false });

/**
 * The All files tab in a page, over a made-up folder: what each folder holds, and what was read. `all`: every
 * file of the folder, as a search lists them; `searched` counts how often they were listed.
 */
function filesInPage(t, { all = EVERY_FILE } = {}) {
  const document = page(t);
  const tree = { '': ['src/', 'README.md'], src: ['lib/', 'app.js'], 'src/lib': ['util.js'] };
  const listed = [];
  const opened = [];
  const tab = new Files(
    /** @type {any} */ ({ open: (one) => opened.push(one) }),
    { contactId: 'alice', contact: { cwd: '/repo' } },
    {
      list: async (_id, folder) => {
        listed.push(folder);
        const names = tree[folder] ?? [];
        return {
          entries: names.map((name) => ({ name: name.replace(/\/$/, ''), folder: name.endsWith('/') })),
          more: 0,
        };
      },
      all: (...args) => {
        searched.count += 1;
        return all(...args);
      },
      read: async () => ({ text: 'one\ntwo\nthree', binary: false, cut: false, size: 13 }),
      open: async () => {},
    },
    { attach() {} }
  );
  const searched = { count: 0 };
  const folder = (path) => tab.body.querySelector(`.files-row[data-folder="${path}"]`);
  const box = tab.body.querySelector('.pane-search input');
  /** Types in the search box, as a key at a time does: the box says what it holds now. */
  const type = async (text) => {
    box.value = text;
    box.fire('input');
    await new Promise((resolve) => setImmediate(resolve));
  };
  const press = async (key) => {
    const event = box.fire('keydown', { key });
    await new Promise((resolve) => setImmediate(resolve));
    return event;
  };
  const found = () => tab.found.querySelectorAll('.found-row');
  return { document, tab, listed, opened, folder, box, type, press, found, searched };
}

test('the All files tab has the folders it had open open again, and is scrolled as far', async (t) => {
  const left = filesInPage(t);
  left.tab.show();
  await left.tab.refresh();
  left.folder('src').click();
  await new Promise((resolve) => setImmediate(resolve));
  left.folder('src/lib').click();
  await new Promise((resolve) => setImmediate(resolve));
  left.tab.tree.scrollTop = 120;
  left.tab.tree.fire('scroll');
  // Behind another tab it can't say how far it is scrolled: what it last said is kept.
  left.tab.tree.scrollTop = 0;
  const kept = JSON.parse(JSON.stringify(left.tab.state));
  assert.deepEqual(kept, { open: ['src', 'src/lib'], top: 120 });

  const back = filesInPage(t);
  back.tab.restore(kept);
  back.tab.show();
  await back.tab.refresh();
  assert.deepEqual([...new Set(back.listed)].sort(), ['', 'src', 'src/lib'], 'each open folder is listed');
  assert.equal(back.folder('src').getAttribute('aria-expanded'), 'true');
  assert.equal(back.folder('src/lib').getAttribute('aria-expanded'), 'true');
  assert.notEqual(back.tab.tree.scrollTop, 120, 'not laid out yet, behind another tab: not scrolled');
  assert.deepEqual(back.tab.state, kept, 'and still to be scrolled there');
  back.tab.tree.clientHeight = 300;
  await back.tab.refresh();
  assert.equal(back.tab.tree.scrollTop, 120, 'once it is on show');
});

test('what was kept of the All files tab that is none of it opens it with the top folder only', async (t) => {
  for (const kept of [null, undefined, 'wide', { open: 'src', top: -4 }, { open: [3, null] }]) {
    const { tab, listed } = filesInPage(t);
    tab.restore(kept);
    await tab.refresh();
    assert.deepEqual(listed, [''], JSON.stringify(kept));
    assert.deepEqual(tab.state, { open: [], top: 0 });
  }
});

test('a file’s tab is scrolled back as far as it was, once it is on show', async (t) => {
  const { tab, opened } = filesInPage(t);
  await tab.showFile('src/app.js', { top: 64 });
  const [fileTab] = opened;
  assert.deepEqual(fileTab.again(), { file: 'src/app.js', top: 64 }, 'not on show yet: still to be scrolled there');
  const view = fileTab.body.querySelector('.file-view');
  view.clientHeight = 200;
  await fileTab.onSelect();
  assert.equal(view.scrollTop, 64);
  view.scrollTop = 30;
  view.fire('scroll');
  assert.deepEqual(fileTab.again(), { file: 'src/app.js', top: 30 });
});

test('a Markdown file shown as its text is shown so again', async (t) => {
  const { tab, opened } = filesInPage(t);
  await tab.showFile('README.md', { plain: true });
  const [fileTab] = opened;
  assert.equal(fileTab.body.querySelector('.preview-toggle input').checked, false);
  assert.equal(fileTab.body.querySelector('.file-view').hidden, false);
  assert.equal(fileTab.body.querySelector('.file-doc').hidden, true);
  assert.deepEqual(fileTab.again(), { file: 'README.md', top: 0, plain: true });
  const shown = filesInPage(t);
  await shown.tab.showFile('README.md');
  assert.deepEqual(shown.opened[0].again(), { file: 'README.md', top: 0 }, 'as a document, it says nothing of it');
});

// ---- searching All files ------------------------------------------------------------------------------

test('All files search and open-file Find keep separate focus handlers', async (t) => {
  const { document, tab, box, opened } = filesInPage(t);
  let selected = 'files';
  tab.pane.shows = (id) => id === selected;
  tab.pane.tabs = opened;
  document.body.append(tab.body);
  box.select = () => {};
  assert.equal(tab.findList(), true);
  assert.equal(document.activeElement, box);

  await tab.showFile('src/app.js');
  const file = opened.at(-1);
  document.body.append(file.body);
  selected = file.id;
  tab.body.hidden = true;
  const view = file.body.querySelector('.file-view');
  file.body.querySelector('.file-find input').select = () => {};
  tab.rememberFindTarget(view);
  assert.equal(tab.findList(), false, 'the hidden list does not claim Find');
  assert.equal(tab.ownsFind(view), true);
  assert.equal(tab.find(view), true);
  assert.equal(document.activeElement, file.body.querySelector('.file-find input'));

  selected = 'files';
  file.body.hidden = true;
  tab.body.hidden = false;
  tab.rememberFindTarget(tab.tree);
  assert.equal(tab.ownsFind(tab.tree), false);
  assert.equal(tab.findList(), true);
  assert.equal(document.activeElement, box);
});

test('a search finds a file in a folder never opened, marks what it found, and Enter opens it as a click does', async (t) => {
  const { tab, listed, opened, type, press, found, box } = filesInPage(t);
  tab.show();
  await tab.refresh();
  await type('utl');
  assert.equal(tab.tree.hidden, true, 'the files found stand in place of the tree');
  assert.equal(tab.found.hidden, false);
  assert.deepEqual(
    found().map((row) => row.dataset.file),
    ['src/lib/util.js']
  );
  const [row] = found();
  assert.equal(row.querySelector('b').textContent, 'util.js', 'its name in bold');
  assert.equal(row.querySelector('.change-folder').textContent, 'src/lib', 'then its folder');
  assert.deepEqual(
    row.querySelectorAll('mark').map((mark) => mark.textContent),
    ['ut', 'l'],
    'the letters found, marked'
  );
  assert.ok(row.classList.contains('active'), 'Enter is for the first one');
  assert.equal(tab.body.querySelector('.pane-search-count').textContent, '1 file');
  assert.ok(!listed.includes('src/lib'), 'its folder was never opened');
  const event = await press('Enter');
  assert.equal(event.defaultPrevented, true);
  assert.equal(opened.at(-1).id, 'file:src/lib/util.js', 'read in a tab of its own');
  assert.equal(box.value, 'utl', 'and the search is still there to go on with');
});

test('↓ and ↑ go through the files found, round from the last to the first, and a click on one opens it', async (t) => {
  const { tab, opened, type, press, found } = filesInPage(t);
  tab.show();
  await type('.');
  const paths = found().map((row) => row.dataset.file);
  assert.deepEqual([...paths].sort(), ['README.md', 'src/app.js', 'src/lib/util.js']);
  const active = () => found().findIndex((row) => row.classList.contains('active'));
  assert.equal(active(), 0);
  await press('ArrowDown');
  assert.equal(active(), 1);
  assert.equal(found()[1].getAttribute('aria-selected'), 'true');
  assert.equal(found()[0].getAttribute('aria-selected'), 'false');
  await press('ArrowUp');
  await press('ArrowUp');
  assert.equal(active(), 2, 'up from the first is the last');
  await press('ArrowDown');
  assert.equal(active(), 0, 'and down from the last is the first');
  found()[1].click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(opened.at(-1).id, `file:${paths[1]}`);
});

test('Esc empties the box and has the tree back with its folders open, and Esc again leaves the box', async (t) => {
  const { document, tab, folder, type, press, box, found } = filesInPage(t);
  tab.show();
  await tab.refresh();
  folder('src').click();
  await new Promise((resolve) => setImmediate(resolve));
  box.focus();
  await type('app');
  assert.equal(found().length, 1);
  await press('Escape');
  assert.equal(box.value, '');
  assert.equal(tab.tree.hidden, false);
  assert.equal(tab.found.hidden, true);
  assert.equal(folder('src').getAttribute('aria-expanded'), 'true', 'the folder opened before is still open');
  assert.equal(tab.body.querySelector('.pane-search-count').textContent, '', 'nothing is counted');
  assert.equal(document.activeElement, box, 'still in the box');
  await press('Escape');
  assert.equal(document.activeElement, null, 'out of it');
  assert.deepEqual(tab.state.open, ['src']);
});

test('the folder’s files are listed once for a search, however much is typed, and anew for the next one', async (t) => {
  const { tab, type, searched } = filesInPage(t);
  tab.show();
  await type('a');
  await type('ap');
  await type('app');
  assert.equal(searched.count, 1);
  await type('');
  await type('u');
  assert.equal(searched.count, 2, 'files come and go between searches');
  await tab.refresh();
  assert.equal(searched.count, 3, 'and while one is on show, going back to the tab lists them again');
});

test('only the last of searches typed one after another is drawn, however late the files come', async (t) => {
  let release;
  const slow = new Promise((resolve) => (release = resolve));
  const { tab, type, found } = filesInPage(t, { all: () => slow });
  tab.show();
  await type('app');
  assert.equal(tab.found.textContent, 'Listing the folder’s files…');
  await type('util');
  release({ paths: ['src/app.js', 'src/lib/util.js'], limited: false });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(
    found().map((row) => row.dataset.file),
    ['src/lib/util.js']
  );
});

test('a folder whose files can’t be listed says so, and Try again lists them again', async (t) => {
  let fails = true;
  const { tab, type, found } = filesInPage(t, {
    all: async () => {
      if (fails) throw new Error('File search is unavailable.');
      return { paths: ['src/app.js'], limited: false };
    },
  });
  tab.show();
  await type('app');
  assert.match(tab.found.textContent, /The folder’s files couldn’t be listed\. Try again/);
  fails = false;
  tab.found.querySelector('[data-again]').click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(
    found().map((row) => row.dataset.file),
    ['src/app.js']
  );
});

test('what a search found is counted, and what is said under it: more than are listed, or a folder searched in part', () => {
  assert.equal(foundCount(1), '1 file');
  assert.equal(foundCount(12_345), '12,345 files');
  assert.deepEqual(foundNotes({ typed: ' zz ', shown: 0, total: 0, searched: 900, limited: false }), [
    'No file’s name or folder has “zz”.',
  ]);
  assert.deepEqual(foundNotes({ typed: 'a', shown: 200, total: 1250, searched: 900, limited: false }), [
    'And 1,050 more. Type more of the name to find fewer.',
  ]);
  assert.deepEqual(foundNotes({ typed: 'a', shown: 3, total: 3, searched: 20_000, limited: true }), [
    'Only the first 20,000 files of this folder are searched.',
  ]);
  assert.deepEqual(foundNotes({ typed: 'a', shown: 3, total: 3, searched: 900, limited: false }), []);
});
