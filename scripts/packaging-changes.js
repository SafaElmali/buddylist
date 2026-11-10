// Whether a pull request changes what goes into the installers, or how they are built and checked.
// Only then does its run build, install and open the Windows and Linux apps (the desktop job of
// .github/workflows/build-app.yml), about 15 billed minutes a push. Every other pull request still
// gets the test job, which bundles the app; explicit builds and releases build every installer.
//
// And whether it changes the phone app, or what serves it or a build makes of it. Only then does its
// run pack the app as a release is, on Linux and with no installer, pair a phone-sized WebKit and
// Chromium with it and use the phone app (the phone job, scripts/check-remote-ui.js): a few minutes more.
//
//   node scripts/packaging-changes.js <base>   ->  installers=true|false and phone=true|false, for what
//                                                  changed since <base>
//
// BUILD_INSTALLERS=true (the pull request's build-installers label) builds them whatever changed.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { SERVED } from '../src/main/remote/web.js';

/** What the installers are made from or checked with: files, and folders ending in "/". */
export const PACKAGING = [
  // What electron-builder is told (the "build" of package.json) and the packages it packs, the
  // native ones among them.
  'package.json',
  'package-lock.json',
  '.npmrc',
  // Its icons and entitlements.
  'build/',
  // The bundle it packs and the notices beside it, what it runs after every installer, npm ci's
  // postinstall, and the version the job gives the app before packaging.
  'scripts/build-app.js',
  'scripts/notices.js',
  'scripts/compress-dmg.js',
  'scripts/name-dev-app.js',
  'scripts/release.js',
  // The checks of the packaged and the installed app, the job itself and this choice.
  'scripts/check-package.js',
  'scripts/check-package-ui.js',
  '.github/workflows/build-app.yml',
  'scripts/packaging-changes.js',
  // What only a packaged app does: find its windows in the bundle's layout, and the Claude binary
  // and node-pty outside the asar archive.
  'src/main/paths.js',
  'src/providers/claude/binary.js',
  'src/main/terminals.js',
  // How a check run keeps to the background (BUDDYLIST_TEST=1), which only these checks run on Windows and Linux.
  'src/main/background.js',
  // What the job alone tests on Windows (Test platform integration).
  'src/main/app-updater.js',
  'src/main/shell-env.js',
  'src/main/git-bash.js',
  'src/providers/spawnable.js',
  'test/app-updater.test.js',
  'test/shell-env.test.js',
  'test/git-bash.test.js',
  'test/spawnable.test.js',
];

/**
 * What the phone app is made or served from, or checked with: files, and folders ending in "/".
 * Of what a browser may have, the app's own folders (a package it ships changes with package.json).
 */
export const PHONE = [
  ...SERVED.filter((entry) => entry.startsWith('src/')),
  // What serves it, and the preload the messenger runs on top of the socket.
  'src/main/remote/',
  'src/preload/',
  // What a build makes of it, and the packages it is made from and packed with.
  'scripts/build-app.js',
  'package.json',
  'package-lock.json',
  '.npmrc',
  // The check, Tailscale's stand-in it runs with, how its app keeps to the background, the job itself and this choice.
  'scripts/check-remote-ui.js',
  'test/fixtures/fake-tailscale.js',
  'src/main/background.js',
  '.github/workflows/build-app.yml',
  'scripts/packaging-changes.js',
];

/** @param {string[]} entries  files, and folders ending in "/" */
const among = (entries) => (/** @type {string[]} */ files) =>
  files.filter((file) => entries.some((entry) => (entry.endsWith('/') ? file.startsWith(entry) : file === entry)));

/**
 * @param {string[]} files  changed, as paths from the repository
 * @returns {string[]} those that change the installers
 */
export const packagingChanges = among(PACKAGING);

/**
 * @param {string[]} files  changed, as paths from the repository
 * @returns {string[]} those that change the phone app, or what serves it or checks it
 */
export const phoneChanges = among(PHONE);

/** What changed since `base`. Without renames, a file moved away from its path counts as a change of that path too. */
const changedSince = (base, root) =>
  execFileSync('git', ['diff', '--name-only', '--no-renames', base, 'HEAD'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);

/**
 * @param {string} base  what the pull request goes into: HEAD^1 of its merge commit
 * @param {{ root?: string, labelled?: boolean }} [opts]
 * @returns {{ installers: boolean, reason: string }}
 */
export function chooseInstallers(base, { root = process.cwd(), labelled = false } = {}) {
  if (labelled) return { installers: true, reason: 'The build-installers label asks for them.' };
  const changes = packagingChanges(changedSince(base, root));
  if (changes.length) return { installers: true, reason: `What goes into them changed: ${changes.join(', ')}.` };
  return {
    installers: false,
    reason: 'Nothing that goes into them changed. Add the build-installers label before a push to build them.',
  };
}

/**
 * @param {string} base  what the pull request goes into: HEAD^1 of its merge commit
 * @param {{ root?: string }} [opts]
 * @returns {{ phone: boolean, reason: string }}
 */
export function choosePhoneCheck(base, { root = process.cwd() } = {}) {
  const changes = phoneChanges(changedSince(base, root));
  if (changes.length) return { phone: true, reason: `What it is made or served from changed: ${changes.join(', ')}.` };
  return { phone: false, reason: 'Nothing the phone app is made or served from changed.' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { installers, reason } = chooseInstallers(process.argv[2], {
    labelled: process.env.BUILD_INSTALLERS === 'true',
  });
  console.log(`${installers ? 'Windows and Linux installers are built.' : 'No installers are built.'} ${reason}`);
  const phone = choosePhoneCheck(process.argv[2]);
  console.log(
    `${phone.phone ? 'The phone app is checked in a packaged build.' : 'The phone app is not checked.'} ${phone.reason}`
  );
  if (process.env.GITHUB_OUTPUT)
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `installers=${installers}\nphone=${phone.phone}\n`);
}
