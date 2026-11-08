import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { missingDownloads } from '../scripts/site-downloads.js';
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
});
