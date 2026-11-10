import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  chooseInstallers,
  choosePhoneCheck,
  PACKAGING,
  packagingChanges,
  PHONE,
  phoneChanges,
} from '../scripts/packaging-changes.js';
import { SERVED } from '../src/main/remote/web.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'packaging-changes.js');
const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'build-app.yml'), 'utf8');
const desktop = workflow.split('\n  desktop:\n')[1].split('\n  release:\n')[0];
const phone = workflow.split('\n  phone:\n')[1]?.split('\n  mac:\n')[0] ?? '';
const testJob = workflow.split('\n  test:\n')[1].split('\n  phone:\n')[0];
const git = (root, ...args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

test('what goes into the installers, or checks them, builds them; the rest of the app does not', () => {
  const packaging = [
    'package.json',
    'package-lock.json',
    '.npmrc',
    'build/icon.png',
    'build/entitlements.mac.plist',
    'scripts/build-app.js',
    'scripts/compress-dmg.js',
    'scripts/name-dev-app.js',
    'scripts/check-package.js',
    'scripts/check-package-ui.js',
    'scripts/release.js',
    'scripts/packaging-changes.js',
    '.github/workflows/build-app.yml',
    'src/main/paths.js',
    'src/main/background.js',
    'src/providers/claude/binary.js',
    'src/main/terminals.js',
    'src/main/git-bash.js',
    'test/spawnable.test.js',
  ];
  const app = [
    'src/renderer/chat/chat.js',
    'src/renderer/contacts.html',
    'src/main/index.js',
    'src/main/ipc.js',
    'src/main/storage/store.js',
    'src/preload/index.cjs',
    'src/shared/ipc-channels.js',
    'src/providers/claude/index.js',
    'test/release.test.js',
    'test/packaging-changes.test.js',
    'docs/releases.md',
    'site/changelog.md',
    'scripts/build-site.js',
    'eslint.config.js',
    '.github/workflows/deploy-site.yml',
    // Only the folder build/ and these very paths count.
    'build-notes/icon.png',
    'package.json.orig',
    'src/main/paths.js.bak',
  ];
  assert.deepEqual(packagingChanges(packaging), packaging);
  assert.deepEqual(packagingChanges(app), []);
  assert.deepEqual(packagingChanges([...app, 'package-lock.json']), ['package-lock.json']);
  assert.deepEqual(packagingChanges([]), []);
});

test('every script and test the desktop job runs is one of the paths that build it', () => {
  const scripts = [...desktop.matchAll(/node (scripts\/[\w-]+\.js)/g)].map(([, script]) => script);
  assert.ok(scripts.includes('scripts/check-package.js') && scripts.includes('scripts/check-package-ui.js'));
  const tests = /- name: Test platform integration\n {8}run: node --test (.+)\n/.exec(desktop)[1].split(' ');
  assert.ok(tests.length >= 4);
  // And the modules those tests are of: the job is their only run on Windows.
  const tested = tests.flatMap((file) =>
    [...fs.readFileSync(path.join(ROOT, file), 'utf8').matchAll(/from '\.\.\/(src\/[^']+)'/g)].map(([, src]) => src)
  );
  assert.ok(tested.length >= tests.length);
  for (const file of [...scripts, ...tests, ...tested]) {
    assert.deepEqual(packagingChanges([file]), [file], `${file} is run by the desktop job`);
  }
  for (const entry of PACKAGING) {
    assert.ok(fs.existsSync(path.join(ROOT, entry)) || entry === '.npmrc', `${entry} exists`);
  }
});

test('what the phone app is, what serves it and what a build makes of it check it in a packaged build; the rest does not', () => {
  const phoneApp = [
    'src/renderer/phone/main.js',
    'src/renderer/phone/sw.js',
    'src/renderer/phone/phone.css',
    'src/renderer/phone/index.html',
    'src/renderer/phone/manifest.webmanifest',
    'src/renderer/phone/icons/icon-192.png',
    'src/renderer/remote/login.html',
    'src/renderer/remote/network-ipc.js',
    'src/renderer/lib/dom.js',
    'src/renderer/chat/stop-key.js',
    'src/renderer/styles/palettes.css',
    'src/shared/phone-sections.js',
    'src/main/remote/web.js',
    'src/main/remote/host.js',
    'src/preload/index.cjs',
    'package.json',
    'package-lock.json',
    '.npmrc',
    'scripts/build-app.js',
    'scripts/check-remote-ui.js',
    'test/fixtures/fake-tailscale.js',
    'src/main/background.js',
    '.github/workflows/build-app.yml',
    'scripts/packaging-changes.js',
  ];
  const rest = [
    'src/renderer/chat/chat.js',
    'src/renderer/contacts.html',
    'src/renderer/styles/chat.css',
    'src/main/index.js',
    'src/main/ipc.js',
    'src/main/paths.js',
    'src/providers/claude/index.js',
    'test/phone-connection.test.js',
    'test/remote-web.test.js',
    'scripts/check-package-ui.js',
    'scripts/compress-dmg.js',
    'build/icon.png',
    'docs/remote-access.md',
    'site/changelog.md',
    // Only these folders and these very paths count.
    'src/renderer/phone-notes.md',
    'src/renderer/chat/stop-key.js.bak',
    'src/main/remote.js',
  ];
  assert.deepEqual(phoneChanges(phoneApp), phoneApp);
  assert.deepEqual(phoneChanges(rest), []);
  assert.deepEqual(phoneChanges([...rest, 'src/renderer/phone/home.js']), ['src/renderer/phone/home.js']);
  assert.deepEqual(phoneChanges([]), []);
});

test('every file a build serves the phone, and everything the phone job runs, checks the phone app', () => {
  // What a browser may have (src/main/remote/web.js): of the app's own folder, or of a package it ships.
  for (const entry of SERVED.filter((served) => served.startsWith('src/')))
    assert.deepEqual(phoneChanges([entry.endsWith('/') ? `${entry}a.js` : entry]).length, 1, entry);
  assert.ok(SERVED.some((served) => served.startsWith('node_modules/')));
  assert.deepEqual(phoneChanges(['package.json', 'package-lock.json']), ['package.json', 'package-lock.json']);
  const scripts = [...phone.matchAll(/node (scripts\/[\w-]+\.js)/g)].map(([, script]) => script);
  assert.ok(scripts.includes('scripts/check-remote-ui.js'));
  const smoke = fs.readFileSync(path.join(ROOT, 'scripts', 'check-remote-ui.js'), 'utf8');
  const fixtures = [...smoke.matchAll(/'\.\.\/(test\/fixtures\/[\w.-]+)'/g)].map(([, fixture]) => fixture);
  assert.deepEqual(fixtures, ['test/fixtures/fake-tailscale.js']);
  for (const file of [...scripts, ...fixtures]) assert.deepEqual(phoneChanges([file]), [file], `${file} is run`);
  // Mermaid's folder is the build's own, made from its package (scripts/build-app.js).
  const made = ['.npmrc', 'src/renderer/mermaid/'];
  for (const entry of PHONE)
    assert.ok(fs.existsSync(path.join(ROOT, entry)) || made.includes(entry), `${entry} exists`);
});

test('a pull request the phone check is for opens a packaged build of it with a phone, and keeps what it saw if that fails', () => {
  assert.ok(phone, 'build-app.yml has a phone job, after test');
  // Its choice comes from the test job, as the installers' does, and only a pull request makes it.
  assert.match(testJob, /\n {6}phone: \$\{\{ steps\.packaging\.outputs\.phone \}\}\n/);
  assert.match(phone, /^ {4}needs: test$/m);
  assert.match(phone, /^ {4}if: github\.event_name == 'pull_request' && needs\.test\.outputs\.phone == 'true'$/m);
  // A cheap job: Linux, bounded, no installers.
  assert.match(phone, /^ {4}runs-on: ubuntu-latest$/m);
  const minutes = Number(/^ {4}timeout-minutes: (\d+)$/m.exec(phone)?.[1]);
  assert.ok(minutes > 0 && minutes <= 20, `bounded: ${minutes} minutes`);
  // It uploads nothing but what the check saw.
  assert.equal([...phone.matchAll(/uses: actions\/upload-artifact@/g)].length, 1);
  // A release's scripts (SENTRY_AUTH_TOKEN with no org or project sends nothing), packed as the installers are.
  const build = /- name: Build the app as a release is built\n {8}run: (.+)\n {8}env:\n((?: {10}.+\n)+)/.exec(phone);
  assert.ok(build, 'a step builds the app');
  assert.equal(build[1], 'npm run dist:linux -- --dir --x64 --publish never');
  assert.match(build[2], /SENTRY_AUTH_TOKEN: local\n/);
  assert.doesNotMatch(build[2], /SENTRY_ORG|SENTRY_PROJECT/);
  const smoke =
    /run: xvfb-run -a node scripts\/check-remote-ui\.js dist\/linux-unpacked\/buddylist dist\/remote-check\n {8}env:\n((?: {10}.+\n)+)/.exec(
      phone
    );
  assert.ok(smoke, 'the packaged app is what the phones are paired with');
  assert.match(smoke[1], /BUDDYLIST_CHECK_VIDEO: '1'\n/);
  // What it saw, its videos and the app's log are kept a day when it fails: the job's media.
  const upload = /- name: (.+)\n {8}if: (.+)\n {8}uses: actions\/upload-artifact@v4\n {8}with:\n((?: {10}.+\n)+)/.exec(
    phone
  );
  assert.ok(upload, 'a step uploads what the check saw');
  assert.equal(upload[2], 'failure()');
  assert.match(upload[3], / {10}path: dist\/remote-check\n/);
  assert.match(upload[3], / {10}retention-days: 1\n/);
});

/** A repository with a pull request merged into main the way GitHub checks one out: HEAD^1 is main. */
function pullRequest(t, change) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'am-packaging-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(root, 'init', '--initial-branch=main');
  git(root, 'config', 'user.name', 'Packaging test');
  git(root, 'config', 'user.email', 'packaging@example.invalid');
  const files = ['package.json', 'scripts/check-package.js', 'src/renderer/chat.js', 'src/renderer/phone/main.js'];
  for (const file of [...files, 'docs/releases.md']) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), `${file}\n`);
  }
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'main');
  git(root, 'checkout', '-b', 'feature');
  change(root);
  git(root, 'add', '-A');
  git(root, 'commit', '-m', 'feature');
  // main moves on with a change of its own, which is no part of the pull request.
  git(root, 'checkout', 'main');
  fs.writeFileSync(path.join(root, 'package.json'), 'a newer version\n');
  git(root, 'commit', '-am', 'release');
  git(root, 'merge', '--no-ff', '-m', 'merge', 'feature');
  return root;
}

test('a pull request builds installers when its own changes reach them, or it has the label', (t) => {
  const renderer = pullRequest(t, (root) => fs.appendFileSync(path.join(root, 'src/renderer/chat.js'), 'more\n'));
  const docs = pullRequest(t, (root) => fs.appendFileSync(path.join(root, 'docs/releases.md'), 'more\n'));
  const lockfile = pullRequest(t, (root) => fs.writeFileSync(path.join(root, 'package-lock.json'), '{}\n'));
  const moved = pullRequest(t, (root) => git(root, 'mv', 'scripts/check-package.js', 'scripts/check.js'));
  const icon = pullRequest(t, (root) => {
    fs.mkdirSync(path.join(root, 'build'));
    fs.writeFileSync(path.join(root, 'build/icon.png'), 'png\n');
  });

  assert.equal(chooseInstallers('HEAD^1', { root: renderer }).installers, false);
  assert.match(chooseInstallers('HEAD^1', { root: renderer }).reason, /build-installers label/);
  assert.equal(chooseInstallers('HEAD^1', { root: docs }).installers, false);
  assert.deepEqual(chooseInstallers('HEAD^1', { root: lockfile }), {
    installers: true,
    reason: 'What goes into them changed: package-lock.json.',
  });
  assert.match(chooseInstallers('HEAD^1', { root: moved }).reason, /scripts\/check-package\.js/);
  assert.equal(chooseInstallers('HEAD^1', { root: icon }).installers, true);
  assert.equal(chooseInstallers('HEAD^1', { root: renderer, labelled: true }).installers, true);
});

test('a pull request checks the phone app when its own changes reach it', (t) => {
  const renderer = pullRequest(t, (root) => fs.appendFileSync(path.join(root, 'src/renderer/chat.js'), 'more\n'));
  const docs = pullRequest(t, (root) => fs.appendFileSync(path.join(root, 'docs/releases.md'), 'more\n'));
  const phoneApp = pullRequest(t, (root) => fs.appendFileSync(path.join(root, 'src/renderer/phone/main.js'), 'more\n'));
  const served = pullRequest(t, (root) => {
    fs.mkdirSync(path.join(root, 'src/main/remote'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src/main/remote/web.js'), 'served\n');
  });
  const moved = pullRequest(t, (root) => git(root, 'mv', 'src/renderer/phone/main.js', 'src/renderer/main.js'));

  // main's own newer package.json is no part of any of them.
  assert.deepEqual(choosePhoneCheck('HEAD^1', { root: renderer }), {
    phone: false,
    reason: 'Nothing the phone app is made or served from changed.',
  });
  assert.equal(choosePhoneCheck('HEAD^1', { root: docs }).phone, false);
  assert.deepEqual(choosePhoneCheck('HEAD^1', { root: phoneApp }), {
    phone: true,
    reason: 'What it is made or served from changed: src/renderer/phone/main.js.',
  });
  assert.equal(choosePhoneCheck('HEAD^1', { root: served }).phone, true);
  assert.match(choosePhoneCheck('HEAD^1', { root: moved }).reason, /src\/renderer\/phone\/main\.js/);
  // And a change of the phone app alone builds no installers.
  assert.equal(chooseInstallers('HEAD^1', { root: phoneApp }).installers, false);
});

test('the workflow step reads the label and writes its choice as an output', (t) => {
  const root = pullRequest(t, (dir) => fs.appendFileSync(path.join(dir, 'src/renderer/chat.js'), 'more\n'));
  const output = path.join(root, 'output');
  const run = (labelled) => {
    fs.writeFileSync(output, 'mode=build\n');
    const log = execFileSync(process.execPath, [SCRIPT, 'HEAD^1'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, GITHUB_OUTPUT: output, BUILD_INSTALLERS: labelled },
    });
    return { log, output: fs.readFileSync(output, 'utf8') };
  };
  assert.deepEqual(run('false'), {
    log:
      'No installers are built. Nothing that goes into them changed. Add the build-installers label before a push to build them.\n' +
      'The phone app is not checked. Nothing the phone app is made or served from changed.\n',
    output: 'mode=build\ninstallers=false\nphone=false\n',
  });
  assert.equal(run('true').output, 'mode=build\ninstallers=true\nphone=false\n');
  fs.appendFileSync(path.join(root, 'src/renderer/phone/main.js'), 'more\n');
  git(root, 'commit', '-am', 'phone');
  assert.deepEqual(run('false'), {
    log:
      'No installers are built. Nothing that goes into them changed. Add the build-installers label before a push to build them.\n' +
      'The phone app is checked in a packaged build. What it is made or served from changed: src/renderer/phone/main.js.\n',
    output: 'mode=build\ninstallers=false\nphone=true\n',
  });
});

test('the required test job runs for every push to main and every pull request', () => {
  const triggers = workflow.split('\njobs:')[0];
  assert.match(triggers, /push:\n {4}branches: \[main\]/);
  assert.match(triggers, /\n {2}pull_request:\n/);
  assert.doesNotMatch(triggers, /\bpaths(?:-ignore)?:/);
});
