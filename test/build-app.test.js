import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { build as bundle } from 'esbuild';
import fs from 'node:fs';
import { isBuiltin } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import {
  APP_BUILD_DIR,
  buildApp,
  builtScripts,
  filesIn,
  MERMAID,
  MERMAID_BUILD_DIR,
  services,
} from '../scripts/build-app.js';
import { BUNDLED_PACK_DIR } from '../src/main/pack.js';
import {
  MESSENGER_SCRIPT,
  messengerScript,
  PHONE_BUILD,
  PHONE_BUNDLE,
  PHONE_PAGE,
  phoneBundle,
  phonePage,
  servedFile,
  SERVICE_WORKER,
} from '../src/main/remote/web.js';
import { PRELOAD, RENDERER_DIR, SRC_DIR, TRAY_ICON } from '../src/main/paths.js';
import { APP_ICON_SIZES, appIconFiles } from '../src/renderer/lib/icons.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
/** The app's folder, as packed: the build is its src/ (see the "files" in package.json). */
const APP = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-build-app-'));
const OUT = path.join(APP, 'src');
after(() => fs.rmSync(APP, { recursive: true, force: true }));

// Built as a release is, with the key to Sentry: without the organization and project it is for, nothing is sent.
// The scripts a release ships are made from Sentry's modules (see sourceMaps()), and these tests check those.
const madeFrom = await buildApp(OUT, { SENTRY_AUTH_TOKEN: 'only for these tests' });

const isScript = (file) => /\.(js|cjs)$/.test(file);
/** Mermaid's own build, which the build copies beside the windows' folders as it is (see the tests at the end). */
const isMermaid = (file) => file.startsWith(MERMAID_BUILD_DIR + path.sep);
const source = filesIn(SRC_DIR);
const built = filesIn(OUT);
const read = (file) => fs.readFileSync(path.join(OUT, file), 'utf8');
/** Where the build has a file that the main process finds by its path in src/. */
const inBuild = (file) => path.join(OUT, path.relative(SRC_DIR, file));
/** The phone app's bundle, as the build describes it (see phoneBundle in web.js), and its files' place in the build. */
const phoneBuild = phoneBundle(APP);
const PHONE_DIR = path.join(path.relative('src', PHONE_BUILD), path.sep);
const isPhoneBundle = (file) => file.startsWith(PHONE_DIR);
/** The file of the build at an address of the phone app's. */
const atAddress = (address) => path.relative(OUT, path.join(APP, address));
/**
 * What a script of the phone app's bundle imports, by name or later with import(), as the bundler reads it: the words
 * `from"…"` stand in its strings too (highlight.js names every language's keywords).
 * @returns {Promise<{ path: string, kind: string }[]>}
 */
async function importsOf(file) {
  const { metafile } = await bundle({
    entryPoints: [path.join(OUT, file)],
    bundle: true,
    external: ['*'],
    format: 'esm',
    platform: 'browser',
    write: false,
    metafile: true,
    logLevel: 'silent',
  });
  return Object.values(metafile.outputs)[0].imports;
}
/** The phone app's page, as the host serves it from this build (see host.js). */
const phoneHome = () =>
  phonePage(read(path.relative('src', PHONE_PAGE)), 'blue', {
    ...phoneBuild,
    palettes: read('renderer/styles/palettes.css'),
  });

test('the build holds one script per process and window, and the phone app’s bundle', () => {
  assert.deepEqual(
    built.filter(isScript).filter((file) => !isPhoneBundle(file)),
    [
      'main/index.js',
      'preload/index.cjs',
      'renderer/chat/main.js',
      'renderer/chat/voice-worklet.js',
      'renderer/contacts/main.js',
      'renderer/history/main.js',
      'renderer/onboarding/main.js',
      'renderer/phone/sw.js',
      'renderer/quick-send/main.js',
      'renderer/remote/login.js',
      'renderer/spending/main.js',
      'renderer/toast/main.js',
    ]
  );
  assert.deepEqual(
    builtScripts(),
    built.filter(isScript).filter((file) => !isPhoneBundle(file))
  );
  // The phone app's messenger and Home, the conversation, and what they share, each named by what is in it.
  const phone = built.filter(isPhoneBundle);
  assert.ok(phone.length >= 4, phone.join(', '));
  for (const file of phone) assert.match(path.basename(file), /^[\w-]+-[A-Z0-9]{8}\.(?:js|css)$/, file);
});

test('the phone app is one bundle: its messenger and Home first, the conversation once one opens', async () => {
  assert.ok(fs.existsSync(path.join(APP, PHONE_BUNDLE)));
  const page = read(path.relative('src', PHONE_PAGE));
  const named = [...page.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="(\/[^"]+\.(?:js|css))"/g)].map(
    ([, to]) => to
  );
  // Every script and stylesheet the page names but the palettes, which a page has inline: its own.
  assert.deepEqual(Object.keys(phoneBuild.files).sort(), named.filter((to) => !to.endsWith('/palettes.css')).sort());
  for (const to of Object.values(phoneBuild.files)) assert.ok(isPhoneBundle(atAddress(to)), to);
  // What Home needs before it draws, all of it named in the page: the scripts and what they import, never import()ed.
  const home = [...new Set([...Object.values(phoneBuild.files), ...phoneBuild.modules])];
  for (const address of home.filter((to) => to.endsWith('.js')))
    for (const { path: to } of (await importsOf(atAddress(address))).filter(({ kind }) => kind === 'import-statement'))
      assert.ok(home.includes(new URL(to, `http://mac${address}`).pathname), `${address} imports ${to}`);
  const homeFiles = home.map(atAddress);
  // Markdown, highlighting and the picture viewer are the conversation's, loaded later.
  const later = built.filter((file) => isPhoneBundle(file) && !homeFiles.includes(file));
  const hasMarkdown = (file) => /\bhljs\b/.test(read(file)) && /DOMPurify/.test(read(file));
  assert.ok(later.some(hasMarkdown), 'the conversation brings Markdown');
  assert.ok(!homeFiles.some(hasMarkdown), 'Home has none of it');
  const bytes = homeFiles.reduce((sum, file) => sum + fs.statSync(path.join(OUT, file)).size, 0);
  assert.ok(bytes < 150 * 1024, `Home is ${Math.round(bytes / 1024)} KB before compression`);
});

test('the phone app’s modules are one copy each, the messenger’s and the screens’ alike', () => {
  const phone = built.filter((file) => isPhoneBundle(file) && file.endsWith('.js'));
  // What only one module has: host.js's key for what the app said, and network-ipc.js's name for its event.
  for (const only of ['buddylist:host', 'buddylist:connection']) {
    const holding = phone.filter((file) => read(file).includes(`"${only}"`));
    assert.equal(holding.length, 1, `${only} is in ${holding.join(', ')}`);
  }
  // The preload is in the messenger, which a page runs first (see phonePage).
  const messenger = atAddress(phoneBuild.files[MESSENGER_SCRIPT]);
  const preload = (file) => /\bexposeInMainWorld\("messenger",/.test(read(file));
  assert.deepEqual(phone.filter(preload), [messenger]);
});

test('the scripts are a release’s, each made ready for its source maps in Sentry', () => {
  const phone = [MESSENGER_SCRIPT, '/src/renderer/phone/main.js'].map((from) => atAddress(phoneBuild.files[from]));
  for (const script of ['main/index.js', 'preload/index.cjs', ...phone]) {
    assert.match(read(script), /_sentryDebugIds/, script);
  }
  // Which has the preload, a CommonJS module, set module.exports: the phone app's messenger runs it (see below).
  assert.match(read('preload/index.cjs'), /\bmodule\.exports=/);
});

test('the phone app gets its messenger from the preload of a build', () => {
  const window = {};
  const electron = {
    contextBridge: { exposeInMainWorld: (name, api) => (window[name] = api) },
    ipcRenderer: {},
    webUtils: {},
  };
  // As a page runs it, but for its import: what it imports is given here.
  const [imported, ...lines] = messengerScript(read('preload/index.cjs')).split('\n');
  assert.match(imported, /^import \{ networkElectron \} from '\/src\/renderer\/remote\/network-ipc\.js';$/);
  new Function('networkElectron', 'window', 'globalThis', lines.join('\n'))(() => electron, window, window);
  assert.equal(typeof window.messenger.app.init, 'function');
  assert.equal(typeof window.messenger.on.contacts, 'function');
});

test('the phone app’s service worker is a classic script, as a browser registers it, and listens for its notes', () => {
  const heard = [];
  vm.runInNewContext(read('renderer/phone/sw.js'), { self: { addEventListener: (name) => heard.push(name) } });
  assert.deepEqual(heard.sort(), [
    'activate',
    'fetch',
    'install',
    'notificationclick',
    'push',
    'pushsubscriptionchange',
  ]);
});

test('a build serves every file the phone app and its sign-in page ask for', async () => {
  /** What a page at `page` asks for, by the address it is served at. */
  const asked = (page, html) =>
    [...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"/g)].map(
      ([, to]) => new URL(to, `http://mac${page}`).pathname
    );
  const phone = asked('/', phoneHome());
  assert.ok(!phone.includes(MESSENGER_SCRIPT), 'the bundle has its messenger');
  const signIn = asked('/src/renderer/remote/login.html', read('renderer/remote/login.html'));
  const manifest = JSON.parse(read('renderer/phone/manifest.webmanifest'));
  // What the bundle's scripts import, by name or later with import(): one another, and Mermaid once a reply has a
  // diagram.
  const imported = [];
  for (const file of built.filter((one) => isPhoneBundle(one) && one.endsWith('.js')))
    for (const { path: to } of await importsOf(file))
      imported.push(new URL(to, `http://mac/src/${file.split(path.sep).join('/')}`).pathname);
  assert.equal(imported.filter((to) => to.includes('mermaid')).length, 1);
  const files = [...phone, ...signIn, ...manifest.icons.map(({ src }) => src), ...imported, `/${SERVICE_WORKER}`];
  assert.ok(files.length > 10);
  for (const pathname of files) assert.ok(servedFile(APP, pathname), pathname);
});

test('the recording worklet ships separately and registers its processor', () => {
  const code = read('renderer/chat/voice-worklet.js');
  assert.match(code, /registerProcessor\("voice-capture"/);
  assert.match(code, /AudioWorkletProcessor/);
});

test('everything else in src/ is in the build, in the same place', () => {
  const phone = (file) => isPhoneBundle(file) || file === path.relative('src', PHONE_BUNDLE);
  // The notices are the build's own (see the test above).
  assert.deepEqual(
    built.filter((file) => !isScript(file) && !isMermaid(file) && !phone(file) && file !== 'THIRD_PARTY_NOTICES.txt'),
    source.filter((file) => !isScript(file))
  );
});

test('pages, pictures and sounds are copied as they are', () => {
  for (const file of source.filter((file) => !/\.(js|cjs|css)$/.test(file))) {
    assert.ok(fs.readFileSync(path.join(SRC_DIR, file)).equals(fs.readFileSync(path.join(OUT, file))), file);
  }
});

test('the main process imports only Electron, what its tools are described with, and Node itself', async () => {
  // Asked of the bundler, which reads the script as code: the words `from"…"` also stand in its strings.
  const { metafile } = await bundle({
    entryPoints: [path.join(OUT, 'main/index.js')],
    bundle: true,
    packages: 'external',
    platform: 'node',
    format: 'esm',
    write: false,
    metafile: true,
    logLevel: 'silent',
  });
  const imported = Object.values(metafile.outputs)[0]
    .imports.filter(({ kind }) => kind === 'import-statement')
    .map((found) => found.path);
  assert.ok(imported.includes('electron'));
  const packed = [...new Set(imported)].filter((name) => !isBuiltin(name)).sort();
  assert.deepEqual(packed, ['electron', 'zod']);
  // What stays outside the bundle is packed with the app only as one of its own dependencies:
  // the SDK asks for zod too, but as a peer, which is not put where the app can import it.
  const { dependencies } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  for (const name of packed.filter((name) => name !== 'electron')) assert.ok(name in dependencies, name);
});

test('what reports errors is inside the main script, and not packed next to it', () => {
  const { dependencies, devDependencies } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  // Packed as a package it would be well over 100 MB, most of it for servers. A dependency is packed.
  assert.ok(!Object.keys(dependencies).some((name) => name.startsWith('@sentry/')));
  assert.ok('@sentry/electron' in devDependencies);
  const main = read('main/index.js');
  // Its own name for itself, which only its code has.
  assert.match(main, /sentry\.javascript\.electron/);
  // Still small next to the package: the parts the app does not use are left out. The script
  // holds the updater too (see below), about a quarter of a megabyte.
  // The current app, with manager coordination, instruction approvals, phone access levels and the phone page's
  // bundle and palettes, is about 1.70 MiB.
  // Keep a bounded budget as features grow, measured in shipped bytes rather than string characters.
  const bytes = Buffer.byteLength(main);
  assert.ok(bytes < 1.75 * 1024 * 1024, `The main bundle is ${(bytes / 1024 / 1024).toFixed(2)} MiB`);
});

test('a build that is given no project reports and counts nowhere: no address or token is in its main script', () => {
  const main = read('main/index.js');
  // Each place that reads one was given what the build had, here nothing.
  assert.doesNotMatch(main, /process\.env\.(SENTRY_DSN|POSTHOG_KEY)\b/);
  assert.doesNotMatch(main, /https:\/\/[0-9a-f]{32}@o\d+\.ingest\.|phc_[A-Za-z0-9]{20,}/);
});

test('the build of a release writes in the projects it is given, where the main process reads them', async () => {
  const given = { SENTRY_DSN: 'https://key@o1.ingest.example/2', POSTHOG_KEY: 'phc_test' };
  assert.deepEqual(services({}), { 'process.env.SENTRY_DSN': '""', 'process.env.POSTHOG_KEY': '""' });
  // Built as the main script is, from the modules that hold them.
  const { outputFiles } = await bundle({
    stdin: {
      contents:
        "export { SENTRY_DSN } from './main/error-reports.js'; export { POSTHOG_KEY } from './main/analytics.js';",
      resolveDir: SRC_DIR,
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    define: services(given),
    write: false,
    logLevel: 'silent',
  });
  const built = await import(`data:text/javascript,${encodeURIComponent(outputFiles[0].text)}`);
  assert.equal(built.SENTRY_DSN, given.SENTRY_DSN);
  assert.equal(built.POSTHOG_KEY, given.POSTHOG_KEY);
});

test('the build has the notices of what its scripts hold, of Mermaid’s build, and of what is packed beside them', () => {
  const text = read('THIRD_PARTY_NOTICES.txt');
  const titles = [...text.matchAll(/^={100}\n(.+)\n={100}$/gm)].map(([, title]) => title);
  const named = (name) => titles.some((title) => title.startsWith(`${name} `));
  // In a window's script, in the main script, Mermaid and what it draws with, and packed as they are.
  for (const name of ['marked', 'dompurify', '@xterm/xterm', 'electron-updater', '@sentry/electron', 'mermaid', 'd3'])
    assert.ok(named(name), name);
  for (const name of ['@anthropic-ai/claude-agent-sdk', 'zod', 'node-pty']) assert.ok(named(name), name);
  assert.ok(!named('electron'), 'Electron has its own, published with it');
  // And the code copied into src/, which a window's script holds.
  assert.ok(named('QR Code generator library, by Project Nayuki') && named('Material Icon Theme'));
  assert.match(text, /© Anthropic PBC\. All rights reserved\./);
  assert.match(text, /MSN Messenger media/);
});

test('what updates the app in place is inside the main script too, and finds Electron and Node from there', () => {
  const { dependencies, devDependencies } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  // Packed as a package, it and what it needs would be some 3 MB more in the app, unused.
  assert.ok(!('electron-updater' in dependencies));
  assert.match(devDependencies['electron-updater'], /^\d+\.\d+\.\d+$/, 'one version, the one tried');
  const main = read('main/index.js');
  // What it says when a release has no ZIP for it: only its code has that.
  assert.match(main, /ERR_UPDATER_ZIP_FILE_NOT_FOUND/);
  // It asks for them with require(), which an ES module has only when it makes one.
  assert.ok(
    main.startsWith("import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);")
  );
});

test('the Agent SDK is not in the script either, and is not read as the app starts: it is looked up when Claude is first needed', () => {
  const { dependencies } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const main = read('main/index.js');
  // An import at the top would read all of it before the first window is there (see the test above).
  assert.doesNotMatch(main, /\bfrom"@anthropic-ai\/claude-agent-sdk"/);
  // Asked for by name with a require() of the script's own, so the package packed next to it is the one found.
  assert.match(main, /\bcreateRequire\b/);
  assert.match(main, /[\w$]\("@anthropic-ai\/claude-agent-sdk"\)/);
  assert.ok('@anthropic-ai/claude-agent-sdk' in dependencies);
});

test('the preload needs nothing but Electron, as a sandboxed preload must', () => {
  const required = [...read('preload/index.cjs').matchAll(/\brequire\("([^"]+)"\)/g)].map(([, name]) => name);
  assert.deepEqual(required, ['electron']);
});

test('a window script imports nothing: the code it needs is inside it, but for Mermaid once a reply has a diagram', () => {
  for (const script of built.filter((file) => file.startsWith('renderer') && isScript(file) && !isPhoneBundle(file))) {
    assert.doesNotMatch(read(script), /\b(from|import)\s*["'][./]/, script);
    for (const [, imported] of read(script).matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) {
      assert.equal(path.join(path.dirname(script), imported), path.join(MERMAID_BUILD_DIR, MERMAID.script), script);
    }
  }
});

test('the phone app’s bundle imports only its own files, beside one another, and Mermaid', async () => {
  for (const script of built.filter((file) => isPhoneBundle(file) && isScript(file)))
    for (const { path: to } of await importsOf(script)) {
      const file = path.join(path.dirname(script), to);
      if (file === path.join(MERMAID_BUILD_DIR, MERMAID.script)) continue;
      assert.match(to, /^\.\/[\w-]+\.js$/, `${script} imports ${to}`);
      assert.ok(built.includes(file), `${script} imports ${to}`);
    }
});

test('no comment of the source is left in a script or a stylesheet', () => {
  for (const script of built.filter(isScript)) {
    // A comment's tag as the source writes it, with a type: the highlighter has the words alone
    // in its grammars, as the code that finds them.
    assert.doesNotMatch(read(script), /@(param|returns|typedef) \{/, script);
    assert.doesNotMatch(read(script), /sourceMappingURL/, script);
  }
  for (const sheet of built.filter((file) => file.endsWith('.css'))) {
    assert.doesNotMatch(read(sheet), /\/\*/, sheet);
  }
});

test('a script in the build is much smaller than the files it is made from', () => {
  const size = (dir, file) => fs.statSync(path.join(dir, file)).size;
  // The build says what went into a script: for the main process, more than the files of src/.
  const mainSource = source.filter((file) => /^(main|providers|shared)\//.test(file) && isScript(file));
  const sourceBytes = mainSource.reduce((sum, file) => sum + size(SRC_DIR, file), 0);
  assert.ok(madeFrom['main/index.js'] > sourceBytes);
  assert.ok(size(OUT, 'main/index.js') < madeFrom['main/index.js'] / 2);
  assert.deepEqual(Object.keys(madeFrom).filter(isScript).sort(), built.filter(isScript));
});

test('every page finds its scripts and stylesheets in the build, or in a package that ships with the app', () => {
  const { dependencies } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const pages = built.filter((file) => file.endsWith('.html'));
  assert.deepEqual(
    pages,
    source.filter((file) => file.endsWith('.html'))
  );
  for (const page of pages) {
    // The phone app's page is served as the host makes it of the bundle.
    const html = page === path.relative('src', PHONE_PAGE) ? phoneHome() : read(page);
    const links = [...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"/g)].map(([, to]) => to);
    assert.ok(links.length >= 2, page);
    for (const link of links) {
      // The messenger is made as the phone app asks for it (see remote/host.js).
      if (link === MESSENGER_SCRIPT) continue;
      // The phone app is opened at "/", and names what it loads from the app's folder, whose src/ the build is.
      const file = link.startsWith('/src/')
        ? path.join(OUT, link.slice('/src/'.length))
        : path.join(OUT, path.dirname(page), link);
      // The one thing a page takes from outside the build: the stylesheet of a package the app
      // depends on, a terminal's. Such a package is packed whole next to the build, as
      // node_modules is next to src/, so the same path leads to it there.
      const packed = path.relative(path.join(OUT, '..', 'node_modules'), file);
      if (file.startsWith(OUT + path.sep)) {
        assert.ok(fs.existsSync(file), `${page}: ${link}`);
        continue;
      }
      assert.ok(!packed.startsWith('..'), `${page}: ${link} is neither in the build nor in a package`);
      const name = packed
        .split(path.sep)
        .slice(0, packed.startsWith('@') ? 2 : 1)
        .join('/');
      assert.ok(name in dependencies, `${page}: ${link} is in ${name}, which is not packed with the app`);
      assert.ok(fs.existsSync(path.join(ROOT, 'node_modules', packed)), `${page}: ${link}`);
    }
  }
});

test('a terminal’s pseudo-terminal is not in the script: it is built for the computer, and packed unpacked', () => {
  const { dependencies, build } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  // Looked up when the first terminal opens, so an app where it can't be loaded still starts.
  assert.match(read('main/index.js'), /\bimport\("node-pty"\)/);
  assert.ok('node-pty' in dependencies);
  // The program it starts shells with can't be run from inside the app's archive.
  assert.ok(build.asarUnpack.includes('node_modules/node-pty/**'));
});

test('the packages left out of the app are the ones its scripts already hold', () => {
  const { dependencies, build } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const leftOut = build.files.filter((entry) => typeof entry === 'string' && entry.startsWith('!'));
  // The rest of what is left out is in the test below.
  assert.deepEqual(leftOut.slice(0, 2), [
    '!node_modules/{dompurify,marked,node-addon-api,@xterm/addon-fit,@xterm/addon-search,@xterm/addon-serialize,@xterm/headless,@types/trusted-types}/**',
    '!node_modules/@xterm/xterm/{lib,src,typings}',
  ]);
  // Nothing a process or a page loads from node_modules once packed is among them: the main
  // process takes only what the test above lists, and a page only a terminal's stylesheet.
  const main = read('main/index.js');
  const held = [
    'dompurify',
    'marked',
    'node-addon-api',
    '@xterm/addon-fit',
    '@xterm/addon-search',
    '@xterm/addon-serialize',
    '@xterm/headless',
  ];
  for (const name of [...held, '@xterm/xterm']) {
    assert.doesNotMatch(main, new RegExp(`["']${name}["']`), name);
  }
  const linked = built
    .filter((file) => file.endsWith('.html'))
    .flatMap((page) => [...read(page).matchAll(/\b(?:src|href)="([^"]*node_modules[^"]*)"/g)].map(([, to]) => to));
  assert.deepEqual([...new Set(linked)], ['../../node_modules/@xterm/xterm/css/xterm.css']);
  assert.ok('@xterm/xterm' in dependencies);
});

test('of the two packages the main process loads, only the files it never reads are left out', async () => {
  const { build } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const leftOut = build.files.filter((entry) => typeof entry === 'string' && entry.startsWith('!'));
  assert.deepEqual(leftOut.slice(2), [
    '!node_modules/@anthropic-ai/claude-agent-sdk/{bridge.mjs,browser-sdk.js,core*.mjs,extractFromBunfs.js}',
    '!node_modules/zod/{src,v3}',
    '!node_modules/zod/**/*.d.cts',
  ]);
  const main = read('main/index.js');

  // The SDK is one script that names no other script of its package: the rest of them are its
  // builds for a browser and for a bridge, and the pieces those two share.
  const sdkDir = path.join(ROOT, 'node_modules', '@anthropic-ai', 'claude-agent-sdk');
  const sdkPackage = JSON.parse(fs.readFileSync(path.join(sdkDir, 'package.json'), 'utf8'));
  assert.equal(sdkPackage.exports['.'].default, './sdk.mjs');
  const sdk = fs.readFileSync(path.join(sdkDir, 'sdk.mjs'), 'utf8');
  const otherScripts = fs.readdirSync(sdkDir).filter((name) => /\.m?js$/.test(name) && name !== 'sdk.mjs');
  assert.ok(otherScripts.includes('bridge.mjs') && otherScripts.includes('browser-sdk.js'));
  for (const script of otherScripts) assert.ok(!sdk.includes(script), script);
  // And the main process asks for the package, never for one of those by its path.
  assert.doesNotMatch(main, /@anthropic-ai\/claude-agent-sdk\//);

  // zod is asked for as a package too. Imported or required, that is its v4 build, which reads
  // nothing of its TypeScript source or of the v3 it still ships. A .d.cts only describes types.
  assert.doesNotMatch(main, /["']zod\//);
  const inZod = '/node_modules/zod/';
  for (const entry of ['index.js', 'index.cjs']) {
    const { metafile } = await bundle({
      entryPoints: [path.join(ROOT, 'node_modules', 'zod', entry)],
      bundle: true,
      write: false,
      metafile: true,
      platform: 'node',
      logLevel: 'silent',
    });
    const reached = Object.keys(metafile.inputs).map((file) => file.slice(file.lastIndexOf(inZod) + inZod.length));
    assert.ok(reached.includes(entry) && reached.length > 10, entry);
    for (const file of reached) assert.doesNotMatch(file, /^(src|v3)\//, `${entry} reads ${file}`);
  }
});

test('the files the main process looks up by path are in the build', () => {
  for (const file of [PRELOAD, TRAY_ICON, path.join(RENDERER_DIR, 'chat.html'), path.join(BUNDLED_PACK_DIR, 'winks')]) {
    assert.ok(fs.existsSync(inBuild(file)), file);
  }
});

test('the app icon a title bar, the toast, About and the welcome wizard show is in the build, at each size and twice it', () => {
  const pictures = APP_ICON_SIZES.flatMap(appIconFiles);
  assert.equal(pictures.length, 4);
  // A page finds them from where it is, beside them.
  for (const file of pictures) assert.ok(fs.existsSync(path.join(OUT, 'renderer', file)), file);
  for (const page of ['toast.html', 'onboarding.html']) {
    const named = [
      ...read(path.join('renderer', page)).matchAll(/<img\b[^>]*\bsrc="([^"]+)"[^>]*\bsrcset="(\S+) 2x"/g),
    ];
    assert.equal(named.length, 1, page);
    for (const file of named[0].slice(1)) assert.ok(pictures.includes(file), `${page}: ${file}`);
  }
});

test('building again clears out what the last build left', async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-build-app-'));
  try {
    fs.writeFileSync(path.join(out, 'left-over.js'), '// from an older build');
    await buildApp(out);
    // The same files, but for the names of the phone app's: a release's are made from Sentry's modules too.
    const unnamed = (file) => (isPhoneBundle(file) ? file.replace(/-[A-Z0-9]{8}(\.\w+)$/, '-#$1') : file);
    assert.deepEqual(filesIn(out).map(unnamed), built.map(unnamed));
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('the package takes the code from the build, never from src/', () => {
  const { main, build } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const packed = build.files.filter((entry) => typeof entry === 'object');
  assert.deepEqual(
    build.files.filter((entry) => typeof entry === 'string' && !entry.startsWith('!')),
    ['package.json']
  );
  assert.equal(packed.length, 1);
  assert.equal(path.join(ROOT, packed[0].from), APP_BUILD_DIR);
  // "main" names the same file in the package as it does in development.
  assert.ok(fs.existsSync(path.join(OUT, path.relative(packed[0].to, main))));
});

// ---- Mermaid, which draws the diagrams in replies ---------------------------------------------------

test('a window asks for Mermaid where `npm start` finds it, in its package', () => {
  const diagrams = fs.readFileSync(path.join(SRC_DIR, 'renderer', 'lib', 'diagrams.js'), 'utf8');
  const asked = [...diagrams.matchAll(/\bimport\(\s*'([^']+\.mjs)'\s*\)/g)].map(([, to]) => to);
  assert.equal(asked.length, 1);
  const found = path.join(SRC_DIR, 'renderer', 'lib', asked[0]);
  assert.equal(found, path.join(MERMAID.dir, MERMAID.script));
  assert.ok(fs.existsSync(found));
});

test('Mermaid is in the build as its own build, beside the windows, with every piece it loads and nothing else', async () => {
  const copied = built.filter(isMermaid);
  // Only its scripts: its source maps would hand out its source, and weigh more than it does.
  for (const file of copied) assert.match(file, /\.mjs$/, file);
  // Read as a bundler reads it: each piece it imports is in the build, and it imports no package.
  const { metafile } = await bundle({
    entryPoints: [path.join(OUT, MERMAID_BUILD_DIR, MERMAID.script)],
    bundle: true,
    packages: 'external',
    format: 'esm',
    platform: 'browser',
    write: false,
    metafile: true,
    logLevel: 'silent',
  });
  assert.deepEqual(Object.values(metafile.outputs)[0].imports, []);
  // The bundler names them from where the tests run, by the real path of the folder.
  const reached = Object.keys(metafile.inputs).map((file) => path.relative(fs.realpathSync(OUT), path.resolve(file)));
  assert.ok(reached.length > 10);
  for (const file of reached) assert.ok(copied.includes(file), file);
});

test('no package of Mermaid is packed: only its build, copied into the app’s', () => {
  const { dependencies, devDependencies } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  // As a package, with the packages it needs, it would be some 200 MB more in the app.
  assert.ok(!('mermaid' in dependencies));
  assert.ok('mermaid' in devDependencies);
});
