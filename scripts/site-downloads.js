// A site push can arrive before the installers it advertises. Keep the current site live until
// the latest public release contains all of its download links; releasing starts deployment again.
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { RELEASES_REPO } from '../src/shared/release-notes.js';
import { releaseMetadata } from './release.js';

const DOWNLOADS = `https://github.com/${RELEASES_REPO}/releases/latest/download/`;
const STABLE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** Package versions and tags alone are not evidence that installers have been published. */
export function publishedReleaseInfo(releases, latest) {
  const published = releases.filter(
    ({ draft, prerelease, tag_name }) => !draft && !prerelease && STABLE_TAG.test(tag_name)
  );
  const versions = [...new Set(published.map(({ tag_name }) => tag_name.slice(1)))];
  assert.ok(
    !latest.draft && !latest.prerelease && versions.includes(latest.tag_name?.slice(1)),
    'Latest must be a published stable release'
  );
  return { versions, latest: latest.tag_name.slice(1) };
}

export function missingDownloads(html, assets) {
  const published = new Set(assets.filter(({ state }) => state === 'uploaded').map(({ name }) => name));
  const links = [...html.matchAll(/href="([^"]+)"/g)].map(([, href]) => href);
  const downloads = new Set(
    links.filter((href) => href.startsWith(DOWNLOADS)).map((href) => href.slice(DOWNLOADS.length))
  );
  return [...downloads].filter((name) => !published.has(name));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const release = JSON.parse(
    execFileSync('gh', ['api', `repos/${RELEASES_REPO}/releases/latest`], { encoding: 'utf8' })
  );
  const releases = releaseMetadata(RELEASES_REPO, (...args) => execFileSync('gh', args, { encoding: 'utf8' }));
  const info = publishedReleaseInfo(releases, release);
  // A single JSON line containing only stable version strings, consumed by both the build
  // check and Wrangler's build. This never uses the prep PR's package version as a fallback.
  if (process.env.GITHUB_ENV) fs.appendFileSync(process.env.GITHUB_ENV, `SITE_RELEASES=${JSON.stringify(info)}\n`);
  const missing = missingDownloads(fs.readFileSync('site/index.html', 'utf8'), release.assets);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `ready=${missing.length === 0}\n`);
  if (missing.length) {
    console.log(
      `::notice::Site deployment waits for published installers: ${missing.join(', ')}. The release workflow retries deployment after publishing.`
    );
  } else {
    console.log('All advertised installers are published; the site can deploy.');
  }
}
