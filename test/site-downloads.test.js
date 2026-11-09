import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { missingDownloads, publishedReleaseInfo } from '../scripts/site-downloads.js';
import { changelogMarkup } from '../scripts/site-changelog.js';
import { RELEASES_REPO } from '../src/shared/release-notes.js';
import { desktopPlatform } from '../site/site-downloads.js';

const html = fs.readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');
const names = [
  'buddylist-mac-arm64.dmg',
  'buddylist-win-x64.exe',
  'buddylist-linux-x86_64.AppImage',
  'buddylist-linux-amd64.deb',
];
const assets = names.map((name) => ({ name, state: 'uploaded' }));

test('site release information excludes drafts and prereleases, even between published versions', () => {
  const latest = { tag_name: 'v1.2.3', draft: false, prerelease: false };
  const releases = [
    latest,
    { tag_name: 'v1.2.4', draft: true },
    { tag_name: 'v1.2.2', prerelease: true },
    { tag_name: 'v1.2.1', draft: false },
    { tag_name: 'preview' },
  ];
  assert.deepEqual(publishedReleaseInfo(releases, latest), { versions: ['1.2.3', '1.2.1'], latest: '1.2.3' });
  assert.throws(() => publishedReleaseInfo(releases, releases[1]), /published stable release/);
});

test('a prep version in package.json stays out of the site until its release is published', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-releases-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'site'));
  fs.writeFileSync(path.join(dir, 'site', 'index.html'), html);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '1.2.4' }));
  const released = { tag_name: 'v1.2.3', draft: false, prerelease: false, assets };
  const draft = { tag_name: 'v1.2.4', draft: true, prerelease: false, assets };
  const metadata = path.join(dir, 'releases.json');
  const envFile = path.join(dir, 'build-env');
  const changelog = '## v1.2.4\n- Next release\n## v1.2.3\n- Published release';
  fs.writeFileSync(
    path.join(dir, 'gh'),
    `#!/usr/bin/env node
const data = JSON.parse(require('node:fs').readFileSync(process.env.RELEASE_FIXTURE));
console.log(process.argv.includes('--paginate') ? data.releases.map((release) => JSON.stringify(release)).join('\\n') : JSON.stringify(data.latest));
`,
    { mode: 0o755 }
  );
  const run = (latest, releases) => {
    fs.writeFileSync(metadata, JSON.stringify({ latest, releases }));
    fs.writeFileSync(envFile, '');
    execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/site-downloads.js', import.meta.url))], {
      cwd: dir,
      env: {
        ...process.env,
        GH_TOKEN: '',
        GITHUB_OUTPUT: '',
        GITHUB_ENV: envFile,
        PATH: `${dir}${path.delimiter}${process.env.PATH}`,
        RELEASE_FIXTURE: metadata,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return JSON.parse(
      fs
        .readFileSync(envFile, 'utf8')
        .trim()
        .replace(/^SITE_RELEASES=/, '')
    );
  };
  const before = run(released, [draft, released]);
  assert.equal(before.latest, '1.2.3');
  assert.doesNotMatch(changelogMarkup(changelog, before.versions), /1\.2\.4|Next release/);
  const after = run({ ...draft, draft: false }, [{ ...draft, draft: false }, released]);
  assert.equal(after.latest, '1.2.4');
  assert.match(changelogMarkup(changelog, after.versions), /1\.2\.4/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'))).version, '1.2.4');
});

test('download selection recognizes desktop browsers with client hints or legacy platform data', () => {
  for (const [device, expected] of [
    [{ platform: 'MacIntel' }, 'mac'],
    [{ platform: 'Win32' }, 'windows'],
    [{ platform: 'Linux x86_64' }, 'linux'],
    [{ userAgentData: { platform: 'Windows', mobile: false } }, 'windows'],
    [{ userAgentData: { platform: 'macOS', mobile: false } }, 'mac'],
    [{ userAgentData: { platform: 'Linux', mobile: false } }, 'linux'],
    [{ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }, 'windows'],
    [{ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' }, 'linux'],
  ])
    assert.equal(desktopPlatform(device), expected, JSON.stringify(device));
});

test('phones, tablets, ChromeOS, ARM Windows/Linux and unknown devices get the download chooser', () => {
  for (const device of [
    {},
    { platform: 'iPhone' },
    { platform: 'MacIntel', maxTouchPoints: 5, userAgent: 'Macintosh' },
    { platform: 'Linux armv8l', userAgent: 'Android' },
    { userAgentData: { platform: 'Linux', mobile: true } },
    { platform: 'Linux x86_64', userAgent: 'Mozilla/5.0 (X11; CrOS x86_64)' },
    { platform: 'Linux aarch64' },
    { platform: 'Win32', userAgent: 'Windows NT 10.0; ARM64' },
    { userAgentData: { platform: 'Windows', architecture: 'arm' } },
  ])
    assert.equal(desktopPlatform(device), null, JSON.stringify(device));
});

test('automatic downloads use the installers advertised in the page, with a chooser before scripts run', () => {
  for (const [platform, file] of [
    ['mac', names[0]],
    ['windows', names[1]],
    ['linux', names[2]],
  ]) {
    const link = [...html.matchAll(/<a\b[^>]*>/g)].find(([tag]) =>
      tag.includes(`data-download-platform="${platform}"`)
    )?.[0];
    assert.ok(link?.includes(`/download/${file}"`), platform);
  }
  const automatic = [...html.matchAll(/<a\b[^>]*\bdata-download-auto\b[^>]*>/g)];
  assert.equal(automatic.length, 3);
  for (const [link] of automatic) assert.match(link, /href="#download"/);
});

test('a Mac-only release holds the site until the Windows and Linux downloads are published', () => {
  assert.deepEqual(missingDownloads(html, assets.slice(0, 1)), names.slice(1));
  assert.deepEqual(missingDownloads(html, assets), []);
});

test('an unfinished upload or a missing installer holds deployment, regardless of other assets', () => {
  for (const name of names) {
    assert.deepEqual(
      missingDownloads(
        html,
        assets.filter((asset) => asset.name !== name)
      ),
      [name]
    );
    assert.deepEqual(
      missingDownloads(
        html,
        assets.map((asset) => (asset.name === name ? { ...asset, state: 'new' } : asset))
      ),
      [name]
    );
  }
});

test('only latest download links in our public release repository need an installer', () => {
  const markup = `<a href="https://github.com/${RELEASES_REPO}/releases/latest/download/app.exe">Download</a>
    <a href="https://github.com/${RELEASES_REPO}/releases">Releases</a>
    <a href="https://example.com/example.exe">Other app</a>`;
  assert.deepEqual(missingDownloads(markup, []), ['app.exe']);
});

test('the site workflow checks published installers before allowing a production deployment', () => {
  const workflow = fs.readFileSync(new URL('../.github/workflows/deploy-site.yml', import.meta.url), 'utf8');
  const gate = workflow.indexOf('run: node scripts/site-downloads.js');
  const deploy = workflow.indexOf('- name: Build and deploy to Cloudflare');
  assert.ok(gate !== -1 && gate < deploy);
  assert.match(workflow.slice(deploy), /steps\.downloads\.outputs\.ready == 'true'/);
  const build = fs.readFileSync(new URL('../scripts/build-site.js', import.meta.url), 'utf8');
  assert.match(build, /process\.env\.SITE_RELEASES/);
  assert.match(build, /changelogMarkup\(read\('changelog.md'\), published\.versions\)/);
  assert.match(build, /jsonLd\(SITE_URL, facts, published\.latest\)/);
  assert.doesNotMatch(build, /package\.json/);
});
