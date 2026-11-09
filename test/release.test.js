import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyVersion,
  prepareRelease,
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

function prepared(t) {
  const repo = fixture(t);
  prepareRelease(repo.root);
  git(repo.root, 'commit', '-am', 'Prepare release');
  git(repo.root, 'push', 'origin', 'main');
  return { ...repo, plan: planRelease(repo.root, 'release') };
}

test('prepare writes both manifests without committing or tagging, using the next stable version', (t) => {
  const { root, remote } = fixture(t);
  const head = git(root, 'rev-parse', 'HEAD');
  assert.deepEqual(prepareRelease(root), { version: '0.2.2', tag: 'v0.2.2' });
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json')));
  assert.equal(pkg.version, '0.2.2');
  assert.equal(lock.version, '0.2.2');
  assert.equal(lock.packages[''].version, '0.2.2');
  assert.deepEqual(pkg.dependencies, { example: '1.0.0' });
  assert.equal(lock.packages.example.version, '1.0.0');
  assert.equal(git(root, 'rev-parse', 'HEAD'), head);
  assert.equal(git(remote, 'rev-parse', 'main'), head);
  assert.equal(git(root, 'tag', '--list', 'v0.2.2'), '');
  assert.equal(prepareRelease(root).version, '0.2.2', 'an uncommitted preparation is idempotent');
  assert.equal(prepareRelease(root, '0.3.0').version, '0.3.0');
  assert.throws(() => prepareRelease(root, '0.2.2'), /0.3.0 or newer/);
  assert.throws(() => prepareRelease(root, '1.0.0-beta'), /stable/);
});

test('prepare sees remotely reserved tags without needing them in the local tag namespace', (t) => {
  const { root, remote } = fixture(t);
  git(remote, 'tag', 'v0.2.10');
  assert.equal(git(root, 'tag', '--list', 'v0.2.10'), '');
  assert.equal(prepareRelease(root, 'auto').version, '0.2.11');
});

test('the prepare CLI supports explicit versions and packaging only verifies the committed version', (t) => {
  const { root } = fixture(t);
  const script = fileURLToPath(new URL('../scripts/release.js', import.meta.url));
  const command = (...args) =>
    execFileSync(process.execPath, [script, ...args], {
      cwd: root,
      env: { ...process.env, GITHUB_OUTPUT: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
  assert.equal(JSON.parse(command('prepare', '0.3.0')).version, '0.3.0');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'))).packages[''].version, '0.3.0');
  const before = git(root, 'diff');
  command('verify-version', '0.3.0');
  assert.throws(() => command('verify-version', '0.4.0'));
  assert.equal(git(root, 'diff'), before, 'verification never rewrites the package files');
});

test('an unprepared version fails before packaging instead of choosing a new version in CI', (t) => {
  const { root } = fixture(t);
  assert.throws(() => planRelease(root, 'release'), /write the next version in a prep PR/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version, '0.2.1');
  prepareRelease(root);
  assert.throws(() => planRelease(root, 'release'), /Command failed/, 'preparation must be committed');
});

test('finalize pushes only a new tag on the built commit, even with branch updates prohibited', (t) => {
  const { root, remote, plan } = prepared(t);
  const commitCount = git(root, 'rev-list', '--count', 'HEAD');
  // Simulate the proposed tag rules: allow creation, reject updates/deletions and all branches.
  fs.writeFileSync(
    path.join(remote, 'hooks', 'pre-receive'),
    [
      '#!/bin/sh',
      'while read old new ref; do',
      '  [ "$old" = 0000000000000000000000000000000000000000 ] || exit 1',
      '  [ "$new" != 0000000000000000000000000000000000000000 ] || exit 1',
      '  [ "$ref" = refs/tags/v0.2.2 ] || exit 1',
      'done',
      '',
    ].join('\n'),
    { mode: 0o755 }
  );
  git(root, 'config', 'push.followTags', 'true');
  git(root, 'tag', '-a', 'v9.0.0', '-m', 'Unrelated local tag');
  assert.deepEqual(finalizeRelease(root, plan), { publish: true, sha: plan.source });
  assert.equal(git(remote, 'rev-parse', 'main'), plan.source);
  assert.equal(git(remote, 'rev-parse', 'v0.2.2^{commit}'), plan.source);
  assert.equal(git(remote, 'cat-file', '-t', 'v0.2.2'), 'tag');
  assert.match(git(remote, 'cat-file', '-p', 'v0.2.2'), new RegExp(`Source-Commit: ${plan.source}`));
  assert.equal(git(remote, 'tag', '--list', 'v9.0.0'), '');
  assert.equal(git(root, 'rev-list', '--count', 'HEAD'), commitCount);
  assert.equal(git(root, 'status', '--porcelain'), '');
});

test('a retry on the same commit reuses its exact tag and performs no push', (t) => {
  const { root, remote, plan } = prepared(t);
  const result = finalizeRelease(root, plan);
  const tagObject = git(remote, 'rev-parse', plan.tag);
  fs.writeFileSync(path.join(root, '.git', 'hooks', 'pre-push'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  assert.deepEqual(planRelease(root, 'release'), plan);
  assert.deepEqual(finalizeRelease(root, plan), result);
  assert.equal(git(remote, 'rev-parse', plan.tag), tagObject);
});

test('an existing remote tag on another commit fails clearly and is never changed', (t) => {
  const { root, remote, plan } = prepared(t);
  git(remote, 'tag', plan.tag, 'main~1');
  const original = git(remote, 'rev-parse', plan.tag);
  assert.throws(() => finalizeRelease(root, plan), /write the next version in a prep PR/);
  assert.equal(git(remote, 'rev-parse', plan.tag), original);
  assert.equal(git(remote, 'rev-parse', 'main'), plan.source);
});

test('main advancing while packaging does not change which commit the release tags', (t) => {
  const { root, remote, dir, plan } = prepared(t);
  const newer = path.join(dir, 'newer');
  git(dir, 'clone', remote, newer);
  fs.writeFileSync(path.join(newer, 'app.js'), 'newer code\n');
  git(newer, '-c', 'user.name=Test', '-c', 'user.email=fake@example.com', 'commit', '-am', 'Newer work');
  git(newer, 'push', 'origin', 'main');
  const sha = git(newer, 'rev-parse', 'HEAD');
  assert.deepEqual(finalizeRelease(root, plan), { publish: true, sha: plan.source });
  assert.equal(git(remote, 'rev-parse', 'main'), sha);
  assert.equal(git(remote, 'rev-parse', `${plan.tag}^{commit}`), plan.source);
});

test('a tag creation race accepts the same built commit and rejects another commit', (t) => {
  for (const sameCommit of [true, false]) {
    const { root, remote, plan } = prepared(t);
    const target = sameCommit ? plan.source : git(root, 'rev-parse', 'HEAD~1');
    fs.writeFileSync(
      path.join(root, '.git', 'hooks', 'pre-push'),
      `#!/usr/bin/env node\nrequire('node:child_process').execFileSync('git', ${JSON.stringify(['--git-dir', remote, 'update-ref', `refs/tags/${plan.tag}`, target])});\n`,
      { mode: 0o755 }
    );
    if (sameCommit) assert.deepEqual(finalizeRelease(root, plan), { publish: true, sha: plan.source });
    else assert.throws(() => finalizeRelease(root, plan), /write the next version in a prep PR/);
    assert.equal(git(remote, 'rev-parse', `${plan.tag}^{commit}`), target);
    assert.equal(git(remote, 'rev-parse', 'main'), plan.source);
  }
});

test('a permission rejection fails; retrying after it succeeds without another commit', (t) => {
  const { root, remote, plan } = prepared(t);
  const hook = path.join(remote, 'hooks', 'pre-receive');
  fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  assert.throws(() => finalizeRelease(root, plan));
  assert.equal(git(remote, 'rev-parse', 'main'), plan.source);
  assert.equal(git(remote, 'tag', '--list', plan.tag), '');
  fs.rmSync(hook);
  assert.deepEqual(finalizeRelease(root, plan), { publish: true, sha: plan.source });
});

test('explicit tag runs require their unchanged tag and a matching version committed on main', (t) => {
  const { root, remote, plan } = prepared(t);
  git(root, 'tag', plan.tag);
  git(root, 'push', 'origin', `refs/tags/${plan.tag}`);
  const tagged = planRelease(root, 'tag', plan.tag);
  assert.deepEqual(finalizeRelease(root, tagged), { publish: true, sha: plan.source });
  git(remote, 'update-ref', '-d', `refs/tags/${plan.tag}`);
  assert.throws(() => finalizeRelease(root, tagged), /tag disappeared/);
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
    if (args[0] === 'api')
      return args.includes('--paginate')
        ? releases.map((release) => JSON.stringify(release)).join('\n')
        : JSON.stringify({ private: privateRepo });
    if (uploadFails && args[1] === 'upload') throw new Error('upload failed');
    return '';
  };
  const options = {
    root,
    tag: 'v0.2.2',
    repo: 'owner/buddylist',
    sourceRepo: 'owner/buddylist',
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
  const fork = publisher(t);
  assert.throws(() => publishRelease({ ...fork.options, sourceRepo: 'contributor/buddylist' }), /source repository/);
  assert.deepEqual(fork.writes(), []);
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
  assert.equal(mode(RUNS.manualOnMain), 'release');
  assert.equal(mode(RUNS.versionTag), 'tag');
  assert.equal(mode(RUNS.pullRequest), 'build');
  assert.equal(mode(RUNS.manualOnBranch), 'build');
  assert.equal(evaluate(expressionAfter('RELEASE_MODE'), RUNS.manualOnMain, { mode: 'build' }), 'build');
  assert.equal(evaluate(expressionAfter('RELEASE_MODE'), RUNS.manualOnMain, { mode: 'release' }), 'release');
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

test('the release job uses its own token, publishes only from the source repo, and never prepares versions', () => {
  const release = workflow.split('\n  release:\n')[1].split('\n  changelog:\n')[0];
  const condition = /^ {4}if: (.+)$/m.exec(release)[1];
  const publishes = (repository) => evaluate(condition, { repository }, {}, { test: { outputs: { tag: 'v0.3.0' } } });
  assert.equal(publishes('SafaElmali/buddylist'), true);
  assert.equal(publishes('contributor/buddylist'), false);
  assert.match(release.slice(release.indexOf('- name: Publish public release')), /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.doesNotMatch(workflow, /RELEASES_TOKEN|release\.js (?:prepare|version) /);
  assert.equal(workflow.match(/release\.js verify-version /g).length, 2);
  assert.doesNotMatch(release, /git (?:commit|push)|refs\/heads\/main/);
  assert.match(release, /node scripts\/release\.js finalize/);
});

test('a release dispatches the site after publication, so its changelog can include the released version', () => {
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
