import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  applyVersion,
  compareVersions,
  nextVersion,
  planRelease,
  finalizeRelease,
  publishRelease,
  writeReleaseNotes,
} from '../scripts/release.js';
import { RELEASES_REPO } from '../src/shared/release-notes.js';

const git = (root, ...args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const json = (file, data) => fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-release-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const remote = path.join(dir, 'origin.git');
  const root = path.join(dir, 'work');
  git(dir, 'init', '--bare', '--initial-branch=main', remote);
  git(dir, 'clone', remote, root);
  git(root, 'config', 'user.name', 'Release test');
  git(root, 'config', 'user.email', 'release@example.invalid');
  json(path.join(root, 'package.json'), { name: 'test-app', version: '0.2.1', dependencies: { example: '1.0.0' } });
  json(path.join(root, 'package-lock.json'), {
    name: 'test-app',
    version: '0.2.1',
    packages: { '': { version: '0.2.1' }, example: { version: '1.0.0' } },
  });
  fs.writeFileSync(path.join(root, 'app.js'), 'original code\n');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'Existing release');
  git(root, 'tag', 'v0.2.1');
  git(root, 'push', 'origin', 'main', '--tags');
  fs.writeFileSync(path.join(root, 'app.js'), 'new code\n');
  git(root, 'commit', '-am', 'Feature to ship');
  git(root, 'push', 'origin', 'main');
  return { root, remote, dir };
}

test('version selection is numeric, respects explicit bumps, and skips reserved versions', () => {
  assert.equal(nextVersion('0.2.1', ['v0.2.1', 'v0.2.9', 'v0.2.10', 'v0.3.0-beta.1']), '0.2.11');
  assert.equal(nextVersion('0.3.0', ['v0.2.1']), '0.3.0');
  assert.equal(nextVersion('0.2.1', []), '0.2.1');
  assert.equal(compareVersions('1.0.0', '0.99.99'), 1);
  assert.throws(() => nextVersion('0.2.1-beta', []), /stable/);
  assert.throws(() => nextVersion('0.2.1', ['v0.2.9007199254740991']), /safe integers/);
});

test('a build never reserves a release and a manual tag must match a version on main', (t) => {
  const { root } = fixture(t);
  assert.equal(planRelease(root, 'build').tag, '');
  assert.throws(() => planRelease(root, 'tag', 'v0.2.2'), /Tag must match/);
  git(root, 'switch', '-c', 'unmerged');
  fs.writeFileSync(path.join(root, 'app.js'), 'not merged\n');
  git(root, 'commit', '-am', 'Unmerged change');
  assert.throws(() => planRelease(root, 'tag', 'v0.2.1'));
});

test('a release records the tested version atomically and retries reuse that version', (t) => {
  const { root, remote } = fixture(t);
  const plan = planRelease(root, 'auto');
  assert.equal(plan.tag, 'v0.2.2');
  applyVersion(root, plan.version);
  const result = finalizeRelease(root, plan);
  assert.equal(result.publish, true);
  assert.equal(git(remote, 'rev-parse', 'main'), result.sha);
  assert.equal(git(remote, 'rev-parse', 'v0.2.2^{commit}'), result.sha);
  assert.equal(git(remote, 'show', 'v0.2.2:app.js'), 'new code');
  assert.deepEqual(git(remote, 'diff', '--name-only', plan.source, result.sha).split('\n').sort(), [
    'package-lock.json',
    'package.json',
  ]);
  assert.equal(JSON.parse(git(remote, 'show', 'v0.2.2:package.json')).version, '0.2.2');
  assert.equal(JSON.parse(git(remote, 'show', 'v0.2.2:package-lock.json')).packages[''].version, '0.2.2');
  assert.equal(planRelease(root, 'auto').tag, plan.tag, 'manual run at bot commit does not bump again');
  git(root, 'switch', '--detach', plan.source);
  assert.deepEqual(planRelease(root, 'auto'), plan, 'rerunning all jobs keeps the original version');
  assert.deepEqual(finalizeRelease(root, plan), result, 'rerunning failed publish does not make another commit');
  git(root, 'switch', '--detach', result.sha);
  fs.writeFileSync(path.join(root, 'app.js'), 'next change\n');
  git(root, 'commit', '-am', 'Next feature');
  assert.equal(planRelease(root, 'auto').version, '0.2.3');
});

test('a newer main commit makes an older completed build skip publication', (t) => {
  const { root, remote, dir } = fixture(t);
  const plan = planRelease(root, 'auto');
  const newer = path.join(dir, 'newer');
  git(dir, 'clone', remote, newer);
  fs.writeFileSync(path.join(newer, 'app.js'), 'newer code\n');
  git(newer, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-am', 'Newer work');
  git(newer, 'push', 'origin', 'main');
  const sha = git(newer, 'rev-parse', 'HEAD');
  assert.deepEqual(finalizeRelease(root, plan), { publish: false });
  assert.equal(git(remote, 'rev-parse', 'main'), sha);
  assert.equal(git(remote, 'tag', '--list', 'v0.2.2'), '');
});

test('a version tag belonging to another commit is never overwritten', (t) => {
  const { root, remote } = fixture(t);
  const plan = planRelease(root, 'auto');
  git(root, 'tag', 'v0.2.2', 'HEAD~1');
  git(root, 'push', 'origin', 'refs/tags/v0.2.2');
  const original = git(remote, 'rev-parse', 'v0.2.2');
  assert.throws(() => finalizeRelease(root, plan), /belongs to another build/);
  assert.equal(git(remote, 'rev-parse', 'v0.2.2'), original);
});

test('main moving during the atomic push leaves neither a stale version commit nor a tag', (t) => {
  const { root, remote, dir } = fixture(t);
  const plan = planRelease(root, 'auto');
  const newer = path.join(dir, 'concurrent');
  git(dir, 'clone', remote, newer);
  fs.writeFileSync(path.join(newer, 'app.js'), 'concurrent work\n');
  git(newer, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-am', 'Concurrent change');
  const hook = path.join(root, '.git', 'hooks', 'pre-push');
  fs.writeFileSync(
    hook,
    `#!/usr/bin/env node\nrequire('node:child_process').execFileSync('git', ${JSON.stringify(['-C', newer, 'push', 'origin', 'main'])}, {stdio: 'ignore'});\n`,
    { mode: 0o755 }
  );
  assert.deepEqual(finalizeRelease(root, plan), { publish: false });
  assert.equal(git(remote, 'rev-parse', 'main'), git(newer, 'rev-parse', 'HEAD'));
  assert.equal(git(remote, 'tag', '--list', plan.tag), '');
});

test('a permission or repository-rule rejection fails instead of silently skipping', (t) => {
  const { root, remote } = fixture(t);
  const plan = planRelease(root, 'auto');
  fs.writeFileSync(path.join(remote, 'hooks', 'pre-receive'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  assert.throws(() => finalizeRelease(root, plan));
  assert.equal(git(remote, 'rev-parse', 'main'), plan.source);
  assert.equal(git(remote, 'tag', '--list', plan.tag), '');
});

test('an explicit minor bump can be tagged even when no further version edit is needed', (t) => {
  const { root, remote } = fixture(t);
  applyVersion(root, '0.3.0');
  git(root, 'commit', '-am', 'Prepare minor version');
  git(root, 'push', 'origin', 'main');
  const plan = planRelease(root, 'auto');
  assert.equal(plan.version, '0.3.0');
  assert.equal(finalizeRelease(root, plan).publish, true);
  assert.equal(JSON.parse(git(remote, 'show', 'v0.3.0:package.json')).version, '0.3.0');
  assert.equal(git(remote, 'diff', '--name-only', plan.source, 'v0.3.0'), '');
});

test('a mismatched lockfile fails before any version is changed', (t) => {
  const { root } = fixture(t);
  const file = path.join(root, 'package.json');
  const original = fs.readFileSync(file, 'utf8');
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  lock.version = '0.1.0';
  json(path.join(root, 'package-lock.json'), lock);
  assert.throws(() => applyVersion(root, '0.2.2'), /disagree/);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
});

const ASSETS = [
  'buddylist-mac-arm64.dmg',
  'buddylist-mac-arm64.zip',
  'buddylist-mac-arm64.zip.blockmap',
  'latest-mac.yml',
  'buddylist-win-x64.exe',
  'buddylist-win-x64.exe.blockmap',
  'latest.yml',
  'buddylist-linux-x86_64.AppImage',
  'buddylist-linux-amd64.deb',
  'latest-linux.yml',
];

function publisher(t, { releases = [], privateRepo = false, uploadFails = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'am-publish-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'dist'));
  for (const name of ASSETS) fs.writeFileSync(path.join(root, 'dist', name), 'asset');
  const calls = [];
  const runGh = (...args) => {
    calls.push(args);
    if (args[0] === 'api') return JSON.stringify(args.includes('--paginate') ? [releases] : { private: privateRepo });
    if (uploadFails && args[1] === 'upload') throw new Error('upload failed');
    return '';
  };
  const options = {
    root,
    tag: 'v0.2.2',
    repo: 'owner/buddylist',
    sourceRepo: 'owner/buddylist-app',
    token: 'test-token',
    runGh,
  };
  return { options, calls, writes: () => calls.filter((args) => args[0] === 'release') };
}

test('publish uploads the installers and the update feed to a draft before making the release latest', (t) => {
  const p = publisher(t);
  assert.deepEqual(publishRelease(p.options), { published: true, latest: true });
  assert.deepEqual(
    p.writes().map((args) => args[1]),
    ['create', 'upload', 'edit']
  );
  assert.ok(p.writes()[0].includes('--draft'));
  assert.deepEqual(
    p.writes()[1].slice(-ASSETS.length),
    ASSETS.map((name) => `dist/${name}`)
  );
  assert.ok(p.writes()[2].includes('--latest=true'));
});

test('draft retries resume uploads but published releases are left untouched', (t) => {
  const draft = publisher(t, { releases: [{ tag_name: 'v0.2.2', draft: true }] });
  publishRelease(draft.options);
  assert.deepEqual(
    draft.writes().map((args) => args[1]),
    ['upload', 'edit']
  );
  const published = publisher(t, { releases: [{ tag_name: 'v0.2.2', draft: false }] });
  assert.equal(publishRelease(published.options).alreadyPublished, true);
  assert.deepEqual(published.writes(), []);
});

test('a failed upload stays a draft and an older retry cannot replace latest', (t) => {
  const failed = publisher(t, { uploadFails: true });
  assert.throws(() => publishRelease(failed.options), /upload failed/);
  assert.deepEqual(
    failed.writes().map((args) => args[1]),
    ['create', 'upload']
  );
  const older = publisher(t, { releases: [{ tag_name: 'v0.2.3', draft: false, prerelease: false }] });
  assert.equal(publishRelease(older.options).latest, false);
  assert.ok(older.writes().at(-1).includes('--latest=false'));
});

test('missing credentials, a private repository and missing assets prevent publishing', (t) => {
  const p = publisher(t);
  assert.throws(() => publishRelease({ ...p.options, token: '' }), /GH_TOKEN/);
  assert.throws(() => publishRelease({ ...p.options, repo: '' }), /owner\/repository/);
  const privateRepo = publisher(t, { privateRepo: true });
  assert.throws(() => publishRelease(privateRepo.options), /must be public/);
  fs.rmSync(path.join(p.options.root, 'dist', 'buddylist-mac-arm64.zip'));
  assert.throws(() => publishRelease(p.options), /ENOENT/);
  assert.deepEqual(p.writes(), []);
  assert.deepEqual(privateRepo.writes(), []);
  // Without the feed, installed copies would never hear of the release.
  const noFeed = publisher(t);
  fs.rmSync(path.join(noFeed.options.root, 'dist', 'latest-mac.yml'));
  assert.throws(() => publishRelease(noFeed.options), /ENOENT/);
  assert.deepEqual(noFeed.writes(), []);
});

test('publishing from the public source repository requires its existing tested tag', (t) => {
  const p = publisher(t);
  assert.equal(publishRelease({ ...p.options, sourceRepo: 'Owner/Buddylist' }).published, true);
  assert.ok(p.writes()[0].includes('--verify-tag'));
  const legacy = publisher(t);
  publishRelease(legacy.options);
  assert.ok(!legacy.writes()[0].includes('--verify-tag'), 'private-source releases remain usable during migration');
});

test('a release missing any platform installer or update feed stays unpublished', (t) => {
  for (const asset of ASSETS) {
    const p = publisher(t);
    fs.rmSync(path.join(p.options.root, 'dist', asset));
    assert.throws(() => publishRelease(p.options), /ENOENT/, asset);
    assert.deepEqual(p.writes(), [], asset);
  }
});

test("publish describes the release with its What's new when the notes step wrote one", (t) => {
  const notesFile = (p) => p.writes()[0].at(p.writes()[0].indexOf('--notes-file') + 1);
  const plain = publisher(t);
  publishRelease(plain.options);
  assert.equal(notesFile(plain), 'docs/release-notes.md');
  const withNotes = publisher(t);
  fs.writeFileSync(path.join(withNotes.options.root, 'dist', 'release-notes.md'), "## What's new\n");
  publishRelease(withNotes.options);
  assert.equal(notesFile(withNotes), 'dist/release-notes.md');
  // A published release keeps the description it has.
  const published = publisher(t, { releases: [{ tag_name: 'v0.2.2', draft: false }] });
  fs.writeFileSync(path.join(published.options.root, 'dist', 'release-notes.md'), "## What's new\n");
  assert.equal(publishRelease(published.options).alreadyPublished, true);
  assert.deepEqual(published.writes(), []);
});

// ---- What's new ------------------------------------------------------------------------------------

/** A checkout with the description every release has and a changelog written by hand. */
function withChangelog(t, changelog) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'am-notes-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'docs'));
  fs.mkdirSync(path.join(root, 'site'));
  fs.writeFileSync(path.join(root, 'docs', 'release-notes.md'), 'buddylist brings Claude Code.\n');
  fs.writeFileSync(path.join(root, 'site', 'changelog.md'), changelog);
  return { root, written: () => fs.readFileSync(path.join(root, 'dist', 'release-notes.md'), 'utf8') };
}

const CHANGELOG = [
  '# Changelog',
  '',
  '## v0.2.12 — 2026-10-13',
  '',
  '- **Add the update card** — It says when a new version is ready. See [the FAQ](https://buddylist.dev/#faq).',
  '- Keep the box open',
  '',
  '### Fixes',
  '',
  'Fewer crashes.',
  '',
  '## v0.2.11 — 2026-10-12',
  '',
  '- Older work',
  '',
].join('\n');

test("the notes put the version's part of the changelog, as written, over the description every release has", (t) => {
  const { root, written } = withChangelog(t, CHANGELOG);
  assert.deepEqual(writeReleaseNotes({ root, tag: 'v0.2.12' }), { whatsNew: true });
  assert.equal(
    written(),
    "## What's new\n\n- **Add the update card** — It says when a new version is ready. See [the FAQ](https://buddylist.dev/#faq).\n- Keep the box open\n\n### Fixes\n\nFewer crashes.\n\nbuddylist brings Claude Code.\n"
  );
  assert.deepEqual(writeReleaseNotes({ root, tag: 'v0.2.11' }), { whatsNew: true });
  assert.equal(written(), "## What's new\n\n- Older work\n\nbuddylist brings Claude Code.\n");
});

test('a version the changelog has nothing for is released with the description every release has', (t) => {
  // Missing, or a heading written ahead with nothing under it yet.
  for (const changelog of [CHANGELOG, CHANGELOG.replace('## v0.2.12', '## v0.2.13\n\n## v0.2.12')]) {
    const { root, written } = withChangelog(t, changelog);
    assert.deepEqual(writeReleaseNotes({ root, tag: 'v0.2.13' }), { whatsNew: false });
    assert.equal(written(), 'buddylist brings Claude Code.\n');
  }
});

test('the notes need a release tag and a changelog without mistakes', (t) => {
  const { root } = withChangelog(t, CHANGELOG);
  for (const tag of ['0.2.12', undefined]) assert.throws(() => writeReleaseNotes({ root, tag }), /v1\.2\.3/);
  const broken = withChangelog(t, '## Unreleased\n- Something');
  assert.throws(() => writeReleaseNotes({ root: broken.root, tag: 'v0.2.12' }), /isn't a version/);
});

// ---- what the workflow asks the release script for ---------------------------------------------
const workflow = fs.readFileSync(new URL('../.github/workflows/build-app.yml', import.meta.url), 'utf8');

/** One of the workflow's `${{ }}` expressions, worked out for a run. They are written as JavaScript reads them too. */
function evaluate(expression, github, inputs = {}, needs = {}, vars = {}) {
  const helpers = {
    startsWith: (text, start) => String(text).startsWith(start),
    format: (text, ...values) => text.replace(/\{(\d+)\}/g, (_all, i) => values[i]),
  };
  return new Function('github', 'inputs', 'needs', 'vars', ...Object.keys(helpers), `return ${expression}`)(
    github,
    inputs,
    needs,
    vars,
    ...Object.values(helpers)
  );
}
const expressionAfter = (key) => new RegExp(`${key}: \\$\\{\\{ (.+) \\}\\}`).exec(workflow)[1];
const run = (event_name, ref, pull = null) => ({ event_name, ref, event: { pull_request: pull } });
const RUNS = {
  pushToMain: run('push', 'refs/heads/main'),
  manualOnMain: run('workflow_dispatch', 'refs/heads/main'),
  manualOnBranch: run('workflow_dispatch', 'refs/heads/some-branch'),
  versionTag: run('push', 'refs/tags/v0.3.0'),
  pullRequest: run('pull_request', 'refs/pull/7/merge', { number: 7 }),
};

test('only a run started by hand on main, or a version tag, releases: a push to main just builds', () => {
  const mode = (github) => evaluate(expressionAfter('RELEASE_MODE'), github);
  assert.equal(mode(RUNS.pushToMain), 'build');
  assert.equal(mode(RUNS.manualOnMain), 'auto');
  assert.equal(mode(RUNS.versionTag), 'tag');
  assert.equal(mode(RUNS.pullRequest), 'build');
  assert.equal(mode(RUNS.manualOnBranch), 'build');
  assert.equal(evaluate(expressionAfter('RELEASE_MODE'), RUNS.manualOnMain, { mode: 'build' }), 'build');
  assert.equal(evaluate(expressionAfter('RELEASE_MODE'), RUNS.manualOnMain, { mode: 'release' }), 'auto');
});

test('macOS packaging runs only for explicit builds and version-tag releases', () => {
  const condition = /^ {4}if: (.+)$/m.exec(workflow.split('  mac:\n')[1])[1];
  const packages = (github) => evaluate(condition, github);
  assert.equal(packages(RUNS.pullRequest), false);
  assert.equal(packages(RUNS.pushToMain), false);
  assert.equal(packages(run('push', 'refs/heads/feature')), false);
  assert.equal(packages(run('push', 'refs/tags/preview')), false);
  assert.equal(packages(RUNS.manualOnMain), true);
  assert.equal(packages(RUNS.manualOnBranch), true);
  assert.equal(packages(RUNS.versionTag), true);
});

test("macOS packaging runs on GitHub's Apple Silicon runner, or on the Mac MAC_RUNNER names", () => {
  const job = workflow.split('\n  mac:\n')[1].split('\n  desktop:\n')[0];
  const runner = (vars) => evaluate(/^ {4}runs-on: \$\{\{ (.+) \}\}$/m.exec(job)[1], RUNS.manualOnMain, {}, {}, vars);
  assert.equal(runner({}), 'macos-latest');
  // GitHub gives a variable that isn't set as an empty string.
  assert.equal(runner({ MAC_RUNNER: '' }), 'macos-latest');
  assert.equal(runner({ MAC_RUNNER: 'buddylist-mac' }), 'buddylist-mac');
  // Only the Mac build goes there: the other jobs keep GitHub's runners.
  assert.equal(workflow.split('MAC_RUNNER').length, job.split('MAC_RUNNER').length);
});

test('publishing waits for every native build and collects their artifacts before recording the version', () => {
  const release = workflow.split('\n  release:\n')[1].split('\n  changelog:\n')[0];
  assert.match(release, /needs: \[test, mac, desktop\]/);
  assert.ok(release.indexOf('actions/download-artifact@v4') < release.indexOf('node scripts/release.js finalize'));
  const desktop = workflow.split('\n  desktop:\n')[1].split('\n  release:\n')[0];
  assert.match(desktop, /os: windows-latest/);
  assert.match(desktop, /os: ubuntu-latest/);
  assert.match(desktop, /run: node scripts\/check-package.js/);
  assert.match(desktop, /continue-on-error: \$\{\{ needs.test.outputs.tag == '' \}\}/);
});

test('Windows and Linux installers are tested on pull requests that change them, and before every release', () => {
  const desktop = workflow.split('\n  desktop:\n')[1].split('\n  release:\n')[0];
  const condition = /^ {4}if: (.+)$/m.exec(desktop)[1];
  const packages = (github, installers = '') => evaluate(condition, github, {}, { test: { outputs: { installers } } });
  assert.equal(packages(RUNS.pullRequest, 'true'), true);
  assert.equal(packages(RUNS.pullRequest, 'false'), false);
  assert.equal(packages(RUNS.pullRequest), false);
  assert.equal(packages(RUNS.pushToMain), false);
  assert.equal(packages(RUNS.manualOnMain), true);
  assert.equal(packages(RUNS.manualOnBranch), true);
  assert.equal(packages(RUNS.versionTag), true);
});

test('only a pull request chooses whether to build installers, from its merge commit and its label', () => {
  const job = workflow.split('\n  test:\n')[1].split('\n  mac:\n')[0];
  assert.match(job, /installers: \$\{\{ steps\.packaging\.outputs\.installers \}\}/);
  const step = job.slice(job.indexOf('- name: Choose installer builds'));
  assert.match(step, /^ {8}id: packaging$/m);
  const chooses = (github) => evaluate(/^ {8}if: (.+)$/m.exec(step)[1], github);
  assert.equal(chooses(RUNS.pullRequest), true);
  for (const github of [RUNS.pushToMain, RUNS.manualOnMain, RUNS.manualOnBranch, RUNS.versionTag]) {
    assert.equal(chooses(github), false);
  }
  assert.match(step, /run: node scripts\/packaging-changes\.js HEAD\^1\n/);
  assert.match(
    step,
    /BUILD_INSTALLERS: \$\{\{ contains\(github\.event\.pull_request\.labels\.\*\.name, 'build-installers'\) \}\}/
  );
  // The diff needs the history of what the pull request goes into.
  assert.match(job, /- uses: actions\/checkout@v4\n {8}with:\n {10}fetch-depth: 0\n/);
  assert.ok(job.indexOf('- name: Choose installer builds') < job.indexOf('- run: npm ci'));
});

test('a pull request uploads no installers, and its screenshots and logs only when a check failed', () => {
  const desktop = workflow.split('\n  desktop:\n')[1].split('\n  release:\n')[0];
  const conditionOf = (name) => /^ {8}if: (.+)$/m.exec(desktop.slice(desktop.indexOf(`- name: ${name}\n`)))[1];
  const uploads = (name, github, status) =>
    new Function('github', 'always', 'failure', `return ${conditionOf(name)}`)(
      github,
      () => true,
      () => status === 'failure'
    );
  for (const status of ['success', 'failure', 'cancelled']) {
    assert.equal(uploads('Upload app screenshots and logs', RUNS.pullRequest, status), status === 'failure');
    for (const github of [RUNS.manualOnMain, RUNS.manualOnBranch, RUNS.versionTag]) {
      assert.equal(uploads('Upload app screenshots and logs', github, status), true);
    }
  }
  assert.equal(evaluate(conditionOf('Upload installers'), RUNS.pullRequest), false);
  for (const github of [RUNS.manualOnMain, RUNS.manualOnBranch, RUNS.versionTag]) {
    assert.equal(evaluate(conditionOf('Upload installers'), github), true);
  }
  // What the release collects is still uploaded by every platform it needs.
  assert.match(workflow.split('\n  release:\n')[1], /pattern: buddylist-\*\n/);
  assert.match(desktop, /name: buddylist-\$\{\{ matrix\.platform \}\}-x64\n/);
  assert.match(workflow.split('\n  mac:\n')[1].split('\n  desktop:\n')[0], /name: buddylist-mac-arm64\n/);
});

test('superseded app checks are cancelled but explicit builds and releases finish', () => {
  const cancels = (github) => evaluate(expressionAfter('cancel-in-progress'), github);
  assert.equal(cancels(RUNS.pullRequest), true);
  assert.equal(cancels(RUNS.pushToMain), true);
  assert.equal(cancels(RUNS.manualOnMain), false);
  assert.equal(cancels(RUNS.manualOnBranch), false);
  assert.equal(cancels(RUNS.versionTag), false);
});

test('site checks still cancel only superseded PRs, preserving deployments', () => {
  const site = fs.readFileSync(new URL('../.github/workflows/deploy-site.yml', import.meta.url), 'utf8');
  const condition = /cancel-in-progress: \$\{\{ (.+) \}\}/.exec(site)[1];
  for (const github of Object.values(RUNS)) {
    assert.equal(evaluate(condition, github), github.event_name === 'pull_request');
  }
});

test('builds of main never wait in the same line as a release', () => {
  const group = (github) => evaluate(expressionAfter('group'), github);
  assert.equal(group(RUNS.manualOnMain), 'app-release');
  assert.equal(group(RUNS.versionTag), 'app-release');
  assert.equal(group(RUNS.pushToMain), 'app-main');
  assert.equal(group(RUNS.pullRequest), 'app-pr-7');
});

test("the release's What's new is written from the changelog before publishing, with no token", () => {
  const mac = workflow.split('\n  release:\n')[1].split('\n  changelog:\n')[0];
  assert.match(mac, /permissions:\n {6}contents: write\n {4}steps:/);
  const notes = mac.indexOf('- name: Write release notes');
  const publish = mac.indexOf('- name: Publish public release');
  assert.ok(notes !== -1 && notes < publish, 'notes come before publishing');
  const step = mac.slice(notes, publish);
  assert.match(step, /if: steps\.finalize\.outputs\.publish == 'true'/);
  assert.match(step, /run: node scripts\/release\.js notes/);
  assert.match(step, /RELEASE_TAG: \$\{\{ needs\.test\.outputs\.tag \}\}/);
  assert.doesNotMatch(step, /TOKEN/);
});

test('the public repo publishes with its own token and the private repo keeps its migration token', () => {
  const mac = workflow.split('\n  release:\n')[1].split('\n  changelog:\n')[0];
  const publish = mac.indexOf('- name: Publish public release');
  const step = mac.slice(publish);
  assert.match(step, /run: node scripts\/release\.js publish/);
  const expression = /GH_TOKEN: \$\{\{ (.+) \}\}/.exec(step)[1];
  const token = (repository, secrets = {}) =>
    new Function('github', 'secrets', `return ${expression}`)({ repository, token: 'built-in' }, secrets);
  assert.equal(token('SafaElmali/buddylist', { RELEASES_TOKEN: 'legacy' }), 'built-in');
  assert.equal(token('SafaElmali/buddylist-app', { RELEASES_TOKEN: 'legacy' }), 'legacy');
  assert.equal(token('contributor/buddylist'), undefined);
  assert.doesNotMatch(mac.slice(0, publish), /RELEASES_TOKEN/);
});

test('a release deploys the site afterwards, so the changelog lists the version its commit names', () => {
  const job = workflow.split('\n  changelog:\n')[1];
  assert.match(job, /^ {4}needs: \[test, release\]$/m);
  assert.match(job, /^ {4}if: needs\.test\.outputs\.tag != ''$/m);
  // Only what starting a workflow takes.
  assert.match(job, /permissions:\n {6}actions: write\n {4}steps:/);
  assert.match(job, /run: gh workflow run deploy-site\.yml --repo "\$GITHUB_REPOSITORY" --ref main/);
  assert.match(job, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  const site = fs.readFileSync(new URL('../.github/workflows/deploy-site.yml', import.meta.url), 'utf8');
  assert.match(site, /^ {2}workflow_dispatch:$/m);
});

test('a build without the update feed, in the app or next to the installers, fails', () => {
  const check = /- name: Check installers\n {8}run: \|\n([\s\S]*?)\n {8}env:/.exec(workflow)[1];
  assert.match(check, /test -s dist\/buddylist-mac-arm64\.zip\.blockmap/);
  assert.match(check, /grep -q 'url: buddylist-mac-arm64\.zip' dist\/latest-mac\.yml/);
  // The whole line: copies up to v0.2.14 look in "buddylist-releases", which redirects here since its rename.
  // A new build names the repository itself.
  assert.match(check, /grep -qx 'repo: buddylist' "\$app\/Contents\/Resources\/app-update\.yml"/);
  const { publish } = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).build;
  assert.deepEqual(publish, [{ provider: 'github', owner: 'SafaElmali', repo: 'buddylist' }]);
  assert.equal(RELEASES_REPO, 'SafaElmali/buddylist');
});

test('a release that was skipped because main moved fails its run', () => {
  assert.match(
    workflow,
    /if: needs\.test\.outputs\.tag != '' && steps\.finalize\.outputs\.publish != 'true'\n\s+run: \|\n(?:.*\n){1,3}?\s+exit 1/
  );
});

test('the macOS build signs and notarizes only with a certificate and all three Apple values', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-signing-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // Stands in for npm: notes what it was asked and which Apple values it could see.
  const call = path.join(dir, 'npm-call');
  fs.writeFileSync(
    path.join(dir, 'npm'),
    '#!/bin/sh\nprintf \'%s\\n\' "$*" "${APPLE_ID-unset} ${APPLE_APP_SPECIFIC_PASSWORD-unset} ${APPLE_TEAM_ID-unset}" > "$NPM_CALL"\n',
    { mode: 0o755 }
  );
  const script = /- name: Build \.dmg\n {8}run: \|\n([\s\S]*?)\n {8}env:/.exec(workflow)[1];
  const build = (env) => {
    fs.rmSync(call, { force: true });
    execFileSync('bash', ['-e', '-o', 'pipefail', '-c', script], {
      env: { PATH: `${dir}:${process.env.PATH}`, NPM_CALL: call, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return fs.readFileSync(call, 'utf8').trim().split('\n');
  };
  const apple = {
    APPLE_ID: 'me@example.com',
    APPLE_APP_SPECIFIC_PASSWORD: 'app-password',
    APPLE_TEAM_ID: 'TEAM123456',
  };
  const adHoc = ['run dist -- --arm64 --publish never', 'unset unset unset'];

  // A missing migration secret must stop an official release before npm can build an ad-hoc app.
  assert.throws(() => build({ RELEASE_BUILD: 'true' }), /Command failed/);
  assert.equal(fs.existsSync(call), false);
  assert.throws(() => build({ RELEASE_BUILD: 'true', CSC_LINK: 'base64-p12', ...apple }), /Command failed/);
  assert.equal(fs.existsSync(call), false);
  assert.match(
    build({ RELEASE_BUILD: 'true', CSC_LINK: 'base64-p12', CSC_KEY_PASSWORD: 'p12-password', ...apple })[0],
    /hardenedRuntime=true/
  );

  // No certificate, or an empty secret: ad-hoc as package.json says, with nothing to notarize.
  assert.deepEqual(build({}), adHoc);
  assert.deepEqual(build(apple), adHoc);
  assert.deepEqual(build({ CSC_LINK: '', ...apple }), adHoc);

  assert.deepEqual(build({ CSC_LINK: 'base64-p12', ...apple }), [
    'run dist -- --arm64 --publish never -c.mac.identity=TEAM123456 -c.mac.hardenedRuntime=true',
    'me@example.com app-password TEAM123456',
  ]);

  // A signed app that is not notarized would still meet Gatekeeper, so it is never built.
  for (const missing of Object.keys(apple)) {
    for (const value of [undefined, '']) {
      const env = { CSC_LINK: 'base64-p12', ...apple, [missing]: value };
      if (value === undefined) delete env[missing];
      assert.throws(
        () => build(env),
        (err) => String(err.stderr).includes(missing)
      );
      assert.equal(fs.existsSync(call), false);
    }
  }
});

test('packaging leaves the Claude Code binary signed by Anthropic and gives the app its entitlements', () => {
  const { mac } = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).build;
  const ignored = (file) => mac.signIgnore.some((pattern) => new RegExp(pattern).test(file));
  const unpacked = '/dist/mac-arm64/buddylist.app/Contents/Resources/app.asar.unpacked/node_modules';
  assert.equal(ignored(`${unpacked}/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude`), true);
  assert.equal(ignored(`${unpacked}/@anthropic-ai/claude-agent-sdk-darwin-x64/claude`), true);
  assert.equal(ignored(`${unpacked}/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude.d`), false);
  assert.equal(ignored(`${unpacked}/node-pty/prebuilds/darwin-arm64/spawn-helper`), false);
  assert.equal(ignored(`${unpacked}/node-pty/prebuilds/darwin-arm64/pty.node`), false);
  assert.equal(ignored('/dist/mac-arm64/buddylist.app/Contents/MacOS/buddylist'), false);

  for (const key of ['entitlements', 'entitlementsInherit']) {
    const plist = fs.readFileSync(new URL(`../${mac[key]}`, import.meta.url), 'utf8');
    for (const entitlement of ['allow-jit', 'disable-library-validation', 'device.audio-input']) {
      assert.match(plist, new RegExp(`<key>com\\.apple\\.security\\.(cs\\.)?${entitlement}</key>\\s*<true/>`));
    }
  }
});
