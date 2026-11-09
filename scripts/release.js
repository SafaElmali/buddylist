import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { changelogEntries, RELEASES_REPO } from '../src/shared/release-notes.js';

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const manifests = ['package.json', 'package-lock.json'];
// Every platform ships together. The feeds name their update files and SHA-512 checksums;
// a release missing any installer or update asset must stay unpublished (see docs/releases.md).
const assets = [
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
// The public description of every release, the one of this release with what is new in it, and
// the changelog that says what is new in each version, written by hand.
const NOTES = 'docs/release-notes.md';
const RELEASE_NOTES = 'dist/release-notes.md';
const CHANGELOG = 'site/changelog.md';
const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const isRelease = (tag) => /^v/.test(tag) && VERSION.test(tag.slice(1));

function parts(version) {
  assert.match(version, VERSION, 'Releases require a stable major.minor.patch version');
  const numbers = version.split('.').map(Number);
  assert.ok(numbers.every(Number.isSafeInteger), 'Version numbers must be safe integers');
  return numbers;
}

export function compareVersions(a, b) {
  const left = parts(a);
  const right = parts(b);
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return Math.sign(left[i] - right[i]);
  }
  return 0;
}

export function nextVersion(current, tags) {
  parts(current);
  const versions = tags.filter(isRelease).map((tag) => tag.slice(1));
  const latest = versions.sort(compareVersions).at(-1);
  if (!latest || compareVersions(current, latest) > 0) return current;
  const [major, minor, patch] = parts(latest);
  const next = `${major}.${minor}.${patch + 1}`;
  parts(next);
  return next;
}

function versionFiles(root, version) {
  parts(version);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, manifests[0]), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(root, manifests[1]), 'utf8'));
  assert.equal(pkg.version, lock.version, 'Package and lockfile versions disagree');
  assert.equal(pkg.version, lock.packages[''].version, 'Lockfile root version disagrees');
  pkg.version = lock.version = lock.packages[''].version = version;
  return [pkg, lock].map((value) => `${JSON.stringify(value, null, 2)}\n`);
}

export function applyVersion(root, version) {
  versionFiles(root, version).forEach((value, i) => fs.writeFileSync(path.join(root, manifests[i]), value));
}

function tagCommit(root, tag) {
  if (!git(root, 'tag', '--list', tag)) return '';
  return git(root, 'rev-parse', `${tag}^{commit}`);
}

export function prepareRelease(root, requested = 'auto') {
  const current = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  versionFiles(root, current);
  // Read remote tag names without replacing local tags in a checkout that held another history.
  const tags = git(root, 'ls-remote', '--tags', '--refs', 'origin', 'v*')
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t')[1].replace('refs/tags/', ''));
  const next = nextVersion(current, tags);
  const version = requested === 'auto' ? next : requested;
  assert.ok(compareVersions(version, next) >= 0, `Prepare version ${next} or newer`);
  applyVersion(root, version);
  return { version, tag: `v${version}` };
}

function remoteTagCommit(root, tag) {
  const refs = new Map(
    git(root, 'ls-remote', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`)
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split('\t').reverse())
  );
  return refs.get(`refs/tags/${tag}^{}`) || refs.get(`refs/tags/${tag}`) || '';
}

function checkTag(existing, source, tag) {
  assert.ok(!existing || existing === source, `${tag} points to another commit; write the next version in a prep PR`);
}

export function planRelease(root, mode, refName = '') {
  assert.ok(['release', 'tag', 'build'].includes(mode), 'Unknown release mode');
  const source = git(root, 'rev-parse', 'HEAD');
  const current = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  versionFiles(root, current);
  if (mode === 'build') return { mode, source, version: current, tag: '' };
  const tag = `v${current}`;
  if (mode === 'tag') assert.equal(refName, tag, 'Tag must match the package version');
  git(root, 'diff', '--exit-code', source, '--', ...manifests);
  git(root, 'merge-base', '--is-ancestor', source, 'origin/main');
  checkTag(tagCommit(root, tag), source, tag);
  return { mode, source, version: current, tag };
}

export function finalizeRelease(root, { mode, source, version, tag }) {
  assert.ok(['release', 'tag'].includes(mode));
  assert.equal(tag, `v${version}`);
  parts(version);
  assert.equal(git(root, 'rev-parse', 'HEAD'), source, 'Checkout changed since testing');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version, version);
  versionFiles(root, version);
  git(root, 'diff', '--exit-code', source, '--', ...manifests);
  git(root, 'fetch', '--no-tags', 'origin', 'main');
  git(root, 'merge-base', '--is-ancestor', source, 'origin/main');
  const existing = remoteTagCommit(root, tag);
  checkTag(existing, source, tag);
  if (existing) return { publish: true, sha: source };
  assert.notEqual(mode, 'tag', 'Release tag disappeared since testing');
  const local = tagCommit(root, tag);
  checkTag(local, source, tag);
  const identity = [
    '-c',
    'user.name=github-actions[bot]',
    '-c',
    'user.email=41898282+github-actions[bot]@users.noreply.github.com',
  ];
  if (!local) git(root, ...identity, 'tag', '-a', tag, source, '-m', `buddylist ${tag}\n\nSource-Commit: ${source}`);
  try {
    // A single creation refspec: no branch push, tag updates, or automatic extra tags.
    git(root, '-c', 'push.followTags=false', 'push', 'origin', `refs/tags/${tag}:refs/tags/${tag}`);
  } catch (error) {
    const pushed = remoteTagCommit(root, tag);
    checkTag(pushed, source, tag);
    if (pushed === source) return { publish: true, sha: source };
    throw error;
  }
  return { publish: true, sha: source };
}

/**
 * Writes this release's description: its version's part of the changelog under "What's new", when
 * the changelog has one, over the description every release has. Publishing uses it in place of that one.
 * @param {object} opts
 * @param {string} opts.root
 * @param {string} opts.tag  the release, such as v0.2.8
 * @returns {{ whatsNew: boolean }}  whether the changelog says what is new in it
 */
export function writeReleaseNotes({ root, tag }) {
  assert.ok(isRelease(tag || ''), 'Release tags look like v1.2.3');
  const changelog = changelogEntries(fs.readFileSync(path.join(root, CHANGELOG), 'utf8'));
  const notes = changelog.find(({ version }) => version === tag.slice(1))?.markdown;
  const section = notes ? `## What's new\n\n${notes}\n\n` : '';
  fs.mkdirSync(path.join(root, path.dirname(RELEASE_NOTES)), { recursive: true });
  fs.writeFileSync(path.join(root, RELEASE_NOTES), section + fs.readFileSync(path.join(root, NOTES), 'utf8'));
  return { whatsNew: Boolean(notes) };
}

// Keep CLI output small as releases accumulate: installers' metadata and release bodies
// are unnecessary here. --paginate applies --jq to each page, emitting one JSON object per line.
export function releaseMetadata(repo, runGh) {
  return runGh(
    'api',
    '--paginate',
    `repos/${repo}/releases?per_page=100`,
    '--jq',
    '.[] | {tag_name, draft, prerelease}'
  )
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export function publishRelease({ root, tag, repo, sourceRepo, token, runGh }) {
  assert.ok(token, 'Set GH_TOKEN to a token with Contents: write on the releases repository');
  assert.match(repo || '', /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 'The releases repository is owner/repository');
  assert.equal(repo.toLowerCase(), (sourceRepo || '').toLowerCase(), 'Publish from the source repository');
  assert.equal(tag, `v${parts(tag.slice(1)).join('.')}`);
  const gh = runGh || ((...args) => execFileSync('gh', args, { cwd: root, encoding: 'utf8' }));
  assert.equal(JSON.parse(gh('api', `repos/${repo}`)).private, false, 'Destination must be public');
  const releases = releaseMetadata(repo, gh);
  const existing = releases.find((release) => release.tag_name === tag);
  if (existing && !existing.draft) {
    console.log(`${tag} is already published; leaving its assets unchanged.`);
    return { published: false, alreadyPublished: true };
  }
  for (const name of assets) assert.ok(fs.statSync(path.join(root, 'dist', name)).size > 0, `Missing asset: ${name}`);
  const latest = releases.every(
    (release) =>
      release.draft ||
      release.prerelease ||
      !/^v/.test(release.tag_name) ||
      !VERSION.test(release.tag_name.slice(1)) ||
      compareVersions(tag.slice(1), release.tag_name.slice(1)) > 0
  );
  if (!existing) {
    // This release's own description, when the notes step wrote one.
    const notes = fs.existsSync(path.join(root, RELEASE_NOTES)) ? RELEASE_NOTES : NOTES;
    // finalize already pushed the tested tag here. Never let gh create a different tag at main.
    gh(
      'release',
      'create',
      tag,
      '--repo',
      repo,
      '--draft',
      '--title',
      `buddylist ${tag}`,
      '--notes-file',
      notes,
      '--verify-tag'
    );
  }
  gh('release', 'upload', tag, '--repo', repo, '--clobber', ...assets.map((name) => `dist/${name}`));
  gh('release', 'edit', tag, '--repo', repo, '--draft=false', `--latest=${latest}`);
  console.log(`Published https://github.com/${repo}/releases/tag/${tag}`);
  return { published: true, latest };
}

function output(values) {
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      Object.entries(values)
        .map(([key, value]) => `${key}=${value}\n`)
        .join('')
    );
  }
  console.log(JSON.stringify(values));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = process.cwd();
  const [command, argument] = process.argv.slice(2);
  const env = process.env;
  if (command === 'plan') {
    const plan = planRelease(root, argument, env.GITHUB_REF_NAME);
    output(plan);
  } else if (command === 'prepare') {
    output(prepareRelease(root, argument));
  } else if (command === 'version') {
    applyVersion(root, argument);
  } else if (command === 'verify-version') {
    const current = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
    assert.equal(current, argument, 'Build must use the version committed in the prep PR');
    versionFiles(root, current);
  } else if (command === 'finalize') {
    output(
      finalizeRelease(root, {
        mode: env.RELEASE_MODE,
        source: env.RELEASE_SOURCE,
        version: env.RELEASE_VERSION,
        tag: env.RELEASE_TAG,
      })
    );
  } else if (command === 'notes') {
    const notes = writeReleaseNotes({ root, tag: env.RELEASE_TAG });
    if (!notes.whatsNew) {
      console.log(`::warning::${CHANGELOG} has nothing for ${env.RELEASE_TAG}, so its release says nothing new.`);
    }
    output(notes);
  } else if (command === 'publish') {
    output(
      publishRelease({
        root,
        tag: env.RELEASE_TAG,
        repo: RELEASES_REPO,
        sourceRepo: env.GITHUB_REPOSITORY,
        token: env.GH_TOKEN,
      })
    );
  } else {
    throw new Error('Expected prepare, plan, version, verify-version, finalize, notes or publish');
  }
}
