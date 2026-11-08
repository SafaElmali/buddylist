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

// A retry may start from the original source or from the bot's version commit.
// Only the two version files may differ from the source that was tested.
function reusableRelease(root, tag, source) {
  if (!/^v/.test(tag) || !VERSION.test(tag.slice(1))) return '';
  const sha = tagCommit(root, tag);
  if (!sha) return '';
  if (git(root, 'show', '-s', '--format=%s', sha) !== `chore: release ${tag}`) return '';
  if (sha !== source && git(root, 'show', '-s', '--format=%P', sha) !== source) return '';
  const changed = git(root, 'diff', '--name-only', source, sha).split('\n').filter(Boolean);
  if (changed.some((file) => !manifests.includes(file))) return '';
  const expected = versionFiles(root, tag.slice(1));
  if (!manifests.every((file, i) => `${git(root, 'show', `${sha}:${file}`)}\n` === expected[i])) return '';
  return sha;
}

export function planRelease(root, mode, refName = '') {
  assert.ok(['auto', 'tag', 'build'].includes(mode), 'Unknown release mode');
  const source = git(root, 'rev-parse', 'HEAD');
  const current = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  versionFiles(root, current);
  if (mode === 'build') return { mode, source, version: current, tag: '' };
  if (mode === 'tag') {
    assert.equal(refName, `v${current}`, 'Tag must match the package version');
    git(root, 'merge-base', '--is-ancestor', source, 'origin/main');
    return { mode, source, version: current, tag: refName };
  }
  const commits = git(root, 'log', '--all', '--format=%H%x09%P%x09%s', '--grep=^chore: release v');
  for (const line of commits.split('\n')) {
    const [sha, parent, subject] = line.split('\t');
    if (sha !== source && parent !== source) continue;
    const tag = subject?.replace(/^chore: release /, '');
    if (tag && reusableRelease(root, tag, source)) return { mode, source, version: tag.slice(1), tag };
  }
  const version = nextVersion(current, git(root, 'tag', '--list', 'v*').split('\n'));
  return { mode, source, version, tag: `v${version}` };
}

export function finalizeRelease(root, { mode, source, version, tag }) {
  assert.ok(['auto', 'tag'].includes(mode));
  assert.equal(tag, `v${version}`);
  parts(version);
  assert.equal(git(root, 'rev-parse', 'HEAD'), source, 'Checkout changed since testing');
  git(root, 'fetch', 'origin', 'main', '--tags');
  if (mode === 'tag') {
    assert.equal(tagCommit(root, tag), source, 'Release tag moved since testing');
    git(root, 'merge-base', '--is-ancestor', source, 'origin/main');
    return { publish: true, sha: source };
  }
  const existing = tagCommit(root, tag);
  if (existing) {
    assert.equal(reusableRelease(root, tag, source), existing, 'Version tag belongs to another build');
    return { publish: true, sha: existing };
  }
  if (git(root, 'rev-parse', 'origin/main') !== source) {
    console.log('Main advanced while building; nothing is published. Run the release again.');
    return { publish: false };
  }
  applyVersion(root, version);
  git(root, 'add', '--', ...manifests);
  assert.ok(
    git(root, 'diff', '--cached', '--name-only')
      .split('\n')
      .filter(Boolean)
      .every((file) => manifests.includes(file))
  );
  const identity = [
    '-c',
    'user.name=github-actions[bot]',
    '-c',
    'user.email=41898282+github-actions[bot]@users.noreply.github.com',
  ];
  git(root, ...identity, 'commit', '--allow-empty', '-m', `chore: release ${tag}`);
  const sha = git(root, 'rev-parse', 'HEAD');
  git(root, ...identity, 'tag', '-a', tag, '-m', `buddylist ${tag}\n\nSource-Commit: ${source}`);
  try {
    // Never rewrite main or a tag. Both refs must be accepted together.
    git(root, 'push', '--atomic', 'origin', 'HEAD:refs/heads/main', `refs/tags/${tag}`);
  } catch (error) {
    const remote = git(root, 'ls-remote', 'origin', 'refs/heads/main', `refs/tags/${tag}`, `refs/tags/${tag}^{}`);
    const refs = new Map(
      remote
        .split('\n')
        .filter(Boolean)
        .map((line) => line.split('\t').reverse())
    );
    if (refs.get(`refs/tags/${tag}^{}`) === sha) return { publish: true, sha };
    if (!refs.has(`refs/tags/${tag}`) && refs.get('refs/heads/main') !== source) {
      console.log('Main advanced during the push; nothing is published. Run the release again.');
      return { publish: false };
    }
    throw error;
  }
  return { publish: true, sha };
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

export function publishRelease({ root, tag, repo, sourceRepo, token, runGh }) {
  assert.ok(token, 'Set GH_TOKEN to a token with Contents: write on the releases repository');
  assert.match(repo || '', /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 'The releases repository is owner/repository');
  const sameRepo = repo.toLowerCase() === (sourceRepo || '').toLowerCase();
  assert.equal(tag, `v${parts(tag.slice(1)).join('.')}`);
  const gh = runGh || ((...args) => execFileSync('gh', args, { cwd: root, encoding: 'utf8' }));
  assert.equal(JSON.parse(gh('api', `repos/${repo}`)).private, false, 'Destination must be public');
  const releases = JSON.parse(gh('api', '--paginate', '--slurp', `repos/${repo}/releases?per_page=100`)).flat();
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
    // The private source repository still publishes across repositories until migration completes.
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
      ...(sameRepo ? ['--verify-tag'] : [])
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
    if (plan.mode === 'auto') applyVersion(root, plan.version);
    output(plan);
  } else if (command === 'version') {
    applyVersion(root, argument);
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
    throw new Error('Expected plan, version, finalize, notes or publish');
  }
}
