import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';
import { EVENTS, REQUESTS } from '../src/shared/ipc-channels.js';
import {
  contentSecurityPolicy,
  messengerScript,
  moduleGraph,
  PHONE_ENTRIES,
  PHONE_PAGE,
  phonePage,
  phonePalettes,
  servedFile,
  SERVED,
  signInPage,
} from '../src/main/remote/web.js';
import { CONNECTION, networkElectron } from '../src/renderer/remote/network-ipc.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRELOAD = fs.readFileSync(path.join(ROOT, 'src', 'preload', 'index.cjs'), 'utf8');
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('only the phone app, and what it loads, is served', () => {
  // No folder of the windows is given out whole, nor a package only they load.
  assert.ok(!SERVED.includes('src/renderer/'));
  assert.ok(!SERVED.some((prefix) => prefix.startsWith('node_modules/@xterm/')));
  assert.equal(servedFile(ROOT, `/${PHONE_PAGE}`), fs.realpathSync(path.join(ROOT, PHONE_PAGE)));
  assert.ok(servedFile(ROOT, '/src/shared/ipc-channels.js'));
  assert.ok(servedFile(ROOT, '/src/renderer/styles/pro-theme.css'));
  assert.ok(servedFile(ROOT, '/src/renderer/chat/stop-key.js'));
  for (const pathname of [
    '/',
    '/src/renderer/',
    // The windows are this Mac's own.
    '/src/renderer/chat.html',
    '/src/renderer/contacts.html',
    '/src/renderer/chat/main.js',
    '/src/renderer/settings/remote.js',
    '/src/renderer/styles/chat.css',
    '/src/renderer/styles/browser.css',
    '/src/renderer/chat/stop-key.js.map',
    '/node_modules/@xterm/xterm/lib/xterm.mjs',
    '/src/main/index.js',
    '/src/providers/index.js',
    '/src/renderer/../main/index.js',
    '/src/renderer/phone/./index.html',
    '/src/renderer/%2E%2E/main/index.js',
    '/src/renderer\\..\\main\\index.js',
    '/src/renderer/phone/index.html%00.css',
    '/src/renderer/%E0%A4%A',
    '/preview/host.js',
    '/package.json',
    '/node_modules/.package-lock.json',
  ])
    assert.equal(servedFile(ROOT, pathname), null, pathname);
});

test('a link out of the folder is not followed', (t) => {
  if (process.platform === 'win32') return;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-web-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const secret = path.join(os.tmpdir(), `remote-web-secret-${process.pid}`);
  fs.writeFileSync(secret, 'secret');
  t.after(() => fs.rmSync(secret, { force: true }));
  const phone = path.join(root, 'src', 'renderer', 'phone');
  fs.mkdirSync(phone, { recursive: true });
  fs.symlinkSync(secret, path.join(phone, 'linked.js'));
  fs.writeFileSync(path.join(phone, 'own.js'), '');
  assert.equal(servedFile(root, '/src/renderer/phone/linked.js'), null);
  assert.ok(servedFile(root, '/src/renderer/phone/own.js'));
  fs.mkdirSync(path.join(root, 'src/main'));
  fs.writeFileSync(path.join(root, 'src/main/secret.js'), 'private');
  fs.symlinkSync('../../main/secret.js', path.join(phone, 'inside-root.js'));
  assert.equal(servedFile(root, '/src/renderer/phone/inside-root.js'), null);
});

/** Every file a module imports, and what those import, as paths from the app's folder. */
function importedBy(file, seen = new Set()) {
  if (seen.has(file)) return seen;
  seen.add(file);
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
  for (const [, spec] of source.matchAll(/^\s*(?:import|export)\b[^'";]*?['"](\.{1,2}\/[^'"]+|\/[^'"]+)['"]/gm))
    importedBy(
      path.relative(ROOT, spec.startsWith('/') ? path.join(ROOT, spec) : path.resolve(ROOT, path.dirname(file), spec)),
      seen
    );
  return seen;
}

test('everything the phone app loads is served: its page, its scripts and what they import, its icons', () => {
  const page = fs.readFileSync(path.join(ROOT, PHONE_PAGE), 'utf8');
  const linked = [...page.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map(([, address]) => address);
  assert.ok(linked.includes('/remote/messenger.js'), 'the messenger first');
  const files = linked.filter((address) => address !== '/remote/messenger.js');
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/renderer/phone/manifest.webmanifest'), 'utf8'));
  assert.ok(manifest.icons.length >= 2);
  files.push(...manifest.icons.map((icon) => icon.src));
  const scripts = files.filter((address) => address.endsWith('.js'));
  assert.ok(scripts.length >= 1);
  const imported = new Set(
    [...scripts, '/src/renderer/remote/network-ipc.js'].flatMap((script) => [...importedBy(script.slice(1))])
  );
  assert.ok(imported.size > 20, 'markdown, the shared helpers and the packages they use');
  for (const file of [...files.map((address) => address.slice(1)), ...imported])
    assert.ok(servedFile(ROOT, `/${file}`), `${file} is loaded by the phone app, but not served`);
});

test("the page's policy lets a home screen read the app's manifest, from here only", () => {
  const policy = contentSecurityPolicy('mac.tail1234.ts.net').split('; ');
  assert.ok(policy.includes("default-src 'none'"));
  assert.ok(policy.includes("manifest-src 'self'"), 'default-src none would block the manifest');
  assert.ok(policy.includes("connect-src 'self' ws://mac.tail1234.ts.net wss://mac.tail1234.ts.net"));
});

test("the phone app's page opens in the palette of the user's theme, and in no other markup", () => {
  const page = fs.readFileSync(path.join(ROOT, PHONE_PAGE), 'utf8');
  assert.match(phonePage(page, 'olive'), /<html[^>]* data-palette="olive"/);
  assert.match(phonePage(page, 'pink'), /data-look="professional"/);
  assert.match(phonePage(page, '"><script>alert(1)</script>'), /data-palette="blue"/);
  assert.doesNotMatch(page, /http-equiv="Content-Security-Policy"/, 'its policy is a header (see host.js)');
});

test('the modules the phone app needs before it draws are all named in its page, at once, and only those', () => {
  const graph = moduleGraph(ROOT, PHONE_ENTRIES);
  const expected = new Set(PHONE_ENTRIES.flatMap((entry) => [...importedBy(entry.slice(1))]).map((file) => `/${file}`));
  assert.deepEqual(new Set(graph), expected);
  for (const address of graph) assert.ok(servedFile(ROOT, address), address);
  // Loaded only when a reply has a diagram: import() is not followed.
  assert.ok(!graph.some((address) => address.includes('mermaid')));
  const page = phonePage(fs.readFileSync(path.join(ROOT, PHONE_PAGE), 'utf8'), 'blue', { modules: graph });
  const preloads = [...page.matchAll(/<link rel="modulepreload" href="([^"]+)" \/>/g)].map(([, href]) => href);
  assert.deepEqual(preloads, graph);
  assert.ok(page.indexOf('rel="modulepreload"') < page.indexOf('<script type="module"'), 'before the scripts');
  // Only addresses that are served get in, and nothing that would close the tag.
  assert.doesNotMatch(phonePage(page, 'blue', { modules: ['/x" onload="alert(1)'] }), /onload/);
});

test('the phone is given the professional look’s palettes only, every one, by day and at night', () => {
  const css = fs.readFileSync(path.join(ROOT, 'src/renderer/styles/palettes.css'), 'utf8');
  const phone = phonePalettes(css);
  assert.ok(phone.length < css.length * 0.5, `${phone.length} of ${css.length}`);
  assert.doesNotMatch(phone, /:root:not\(\[data-look='professional'\]\)/);
  for (const palette of ['olive', 'silver', 'royale', 'pink'])
    assert.equal(
      phone.split(`:root[data-look='professional'][data-palette='${palette}']`).length - 1,
      2,
      `${palette} by day and at night`
    );
  assert.equal((phone.match(/\{/g) || []).length, (phone.match(/\}/g) || []).length);
  assert.match(phone, /@media \(prefers-color-scheme: dark\) \{/);
});

const PALETTES_CSS = fs.readFileSync(path.join(ROOT, 'src/renderer/styles/palettes.css'), 'utf8');
/** How often a sheet has a palette's professional rule, as written or as a build minifies it. */
const professional = (css, palette) =>
  (css.match(new RegExp(`:root\\[data-look=('?)professional\\1\\]\\[data-palette=('?)${palette}\\2\\]`, 'g')) || [])
    .length;

test('a page is given its own palette only, by day and at night, from the palettes as written or as built', async () => {
  // A build of the app minifies every stylesheet (scripts/build-app.js): no rule is on a line of its own there.
  const { code: built } = await transform(PALETTES_CSS, { loader: 'css', minify: true });
  assert.doesNotMatch(built, /\n\S/);
  for (const css of [PALETTES_CSS, built]) {
    const royale = phonePalettes(css, 'royale');
    assert.equal(professional(royale, 'royale'), 2, 'by day and at night');
    for (const other of ['olive', 'silver', 'pink']) assert.equal(professional(royale, other), 0, other);
    assert.doesNotMatch(royale, /:not\(/, 'nothing of the messenger look');
    assert.match(royale, /@media ?\(prefers-color-scheme: ?dark\) ?\{/);
    // Still a stylesheet: a bundler reads it as one.
    await transform(royale, { loader: 'css', logLevel: 'silent' });
    assert.ok(royale.length < css.length / 6, `${royale.length} of ${css.length}`);
    // Luna's blue is theme.css's and pro-theme.css's own: none of the palettes.
    assert.equal(phonePalettes(css, 'blue'), '');
    // And without one, every palette of the professional look, as the palettes' file is served.
    const every = phonePalettes(css);
    for (const palette of ['olive', 'silver', 'royale', 'pink']) assert.equal(professional(every, palette), 2, palette);
    assert.doesNotMatch(every, /:not\(/);
  }
});

/** The page of a build, which stands for the files the page names (see the phone bundle in scripts/build-app.js). */
const BUILT = '/src/renderer/phone/build';
const BUNDLE = {
  files: {
    '/remote/messenger.js': `${BUILT}/messenger-AAAA1111.js`,
    '/src/renderer/phone/main.js': `${BUILT}/main-BBBB2222.js`,
    '/src/renderer/styles/theme.css': `${BUILT}/phone-CCCC3333.css`,
    '/src/renderer/styles/pro-theme.css': `${BUILT}/phone-CCCC3333.css`,
    '/src/renderer/phone/phone.css': `${BUILT}/phone-CCCC3333.css`,
  },
  modules: [`${BUILT}/chunk-DDDD4444.js`, `${BUILT}/chunk-EEEE5555.js`],
};
const linkedBy = (page) => [...page.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"/g)].map(([, to]) => to);

test('the page of a build names its bundle: the messenger first, one stylesheet, its palette inline', () => {
  const html = fs.readFileSync(path.join(ROOT, PHONE_PAGE), 'utf8');
  const page = phonePage(html, 'olive', { ...BUNDLE, palettes: PALETTES_CSS });
  const linked = linkedBy(page);
  assert.deepEqual(
    linked.filter((to) => to.startsWith(BUILT)),
    [`${BUILT}/phone-CCCC3333.css`, ...BUNDLE.modules, `${BUILT}/messenger-AAAA1111.js`, `${BUILT}/main-BBBB2222.js`]
  );
  // Nothing it stands for is asked for besides, nor the palettes' file.
  for (const from of [...Object.keys(BUNDLE.files), '/src/renderer/styles/palettes.css'])
    assert.ok(!linked.includes(from), from);
  // What a home screen asks for stays.
  assert.ok(linked.includes('/src/renderer/phone/manifest.webmanifest'));
  assert.ok(linked.includes('/src/renderer/phone/icons/icon-192.png'));
  assert.ok(page.indexOf('rel="modulepreload"') < page.indexOf('<script type="module"'), 'before the scripts');
  // The user's palette, by day and at night, and no other: painted with the page, from no file of its own.
  const [, inline] = /<style>([\s\S]*?)<\/style>/.exec(page) ?? [];
  assert.equal(professional(inline, 'olive'), 2);
  assert.equal(professional(inline, 'royale'), 0);
  assert.ok(page.indexOf('phone-CCCC3333.css') < page.indexOf('<style>'), 'after the looks, where the palettes were');
  // Luna's blue needs none.
  assert.doesNotMatch(phonePage(html, 'blue', { ...BUNDLE, palettes: PALETTES_CSS }), /<style>/);
});

test('the page of the app run from its source names its own files, with its palette inline', () => {
  const html = fs.readFileSync(path.join(ROOT, PHONE_PAGE), 'utf8');
  const page = phonePage(html, 'pink', { palettes: PALETTES_CSS });
  assert.deepEqual(
    linkedBy(page).filter((to) => /\.(?:js|css)$/.test(to)),
    linkedBy(html).filter((to) => /\.(?:js|css)$/.test(to) && to !== '/src/renderer/styles/palettes.css')
  );
  assert.equal(professional(/<style>([\s\S]*?)<\/style>/.exec(page)?.[1] ?? '', 'pink'), 2);
});

/** What the messenger imports, in a page: here the test gives it instead. */
const IMPORT = /^import \{ networkElectron \} from '\/src\/renderer\/remote\/network-ipc\.js';\n/;

test('the messenger is the preload itself, run on the network', () => {
  const script = messengerScript(PRELOAD);
  assert.ok(script.includes(PRELOAD));
  assert.match(script, IMPORT);
  assert.match(script, /__BUDDYLIST_PACK_BASE__ = '\/pack\/'/);
  // A build bundles it, from the network's module where it is (see scripts/build-app.js).
  assert.match(
    messengerScript(PRELOAD, './network-ipc.js'),
    /^import \{ networkElectron \} from '\.\/network-ipc\.js';\n/
  );
});

/**
 * A browser tab, as far as the messenger sees it: the messenger script, as a page runs it, on top of it.
 * @param {{ search?: string, session?: number, preload?: string }} [options]  preload: the preload it is made from
 */
function browserTab({
  search = '?look=professional&palette=blue&contactId=c1',
  session = 204,
  preload = PRELOAD,
} = {}) {
  const sockets = [];
  class FakeWebSocket {
    static OPEN = 1;
    readyState = 0;
    sent = [];
    #listeners = {};
    constructor(url) {
      this.url = url;
      sockets.push(this);
    }
    addEventListener(name, listener) {
      (this.#listeners[name] ||= []).push(listener);
    }
    send(text) {
      this.sent.push(JSON.parse(text));
    }
    emit(name, event = {}) {
      if (name === 'open') this.readyState = 1;
      for (const listener of this.#listeners[name] || []) listener(event);
    }
    reply(message) {
      this.emit('message', { data: JSON.stringify(message) });
    }
  }
  const went = [];
  const opened = [];
  const connection = [];
  const win = {
    CustomEvent: class {
      constructor(type, { detail }) {
        Object.assign(this, { type, detail });
      }
    },
    dispatchEvent: (event) => connection.push([event.type, event.detail]),
    WebSocket: FakeWebSocket,
    location: {
      protocol: 'http:',
      host: '127.0.0.1:6767',
      search,
      assign: (to) => went.push(to),
      reload: () => went.push('reload'),
    },
    fetch: async () => ({ status: session }),
    open: (...args) => opened.push(args),
  };
  const script = messengerScript(preload);
  new Function('networkElectron', 'window', 'globalThis', script.replace(IMPORT, ''))(networkElectron, win, win);
  return { win, sockets, went, opened, connection, messenger: win.messenger };
}

test('the messenger runs the preload as the CommonJS module it is: a release builds it to set module.exports', () => {
  // What a release's build of the preload has besides (see sourceMaps() in scripts/build-app.js).
  const built = `module.exports = {};\nexports.built = true;\n${PRELOAD}`;
  const { win, sockets, messenger } = browserTab({ preload: built });
  assert.equal(win.__BUDDYLIST_PACK_BASE__, '/pack/');
  assert.equal(sockets.length, 1);
  assert.equal(typeof messenger.app.init, 'function');
  assert.throws(() => browserTab({ preload: `require('fs');\n${PRELOAD}` }), /fs is not there in a browser/);
});

test('the windows get the same messenger as in the app, and its requests go over the WebSocket', async () => {
  const { sockets, messenger } = browserTab();
  assert.equal(sockets[0].url, 'ws://127.0.0.1:6767/api/socket?patches=contacts');
  // Asked before the connection was open: sent once it is.
  const answer = messenger.chat.send('c1', { text: 'ping' });
  const init = messenger.app.init();
  assert.deepEqual(sockets[0].sent, []);
  sockets[0].emit('open');
  assert.deepEqual(sockets[0].sent, [
    { kind: 'request', id: 1, channel: REQUESTS.chatSend, args: ['c1', { text: 'ping' }] },
    { kind: 'request', id: 2, channel: REQUESTS.appInit, args: [] },
  ]);
  sockets[0].reply({ kind: 'response', id: 2, result: { contacts: [] } });
  sockets[0].reply({ kind: 'response', id: 1, result: { id: 'm1' } });
  assert.deepEqual(await answer, { id: 'm1' });
  // invokeNow, which waits for its answer here too.
  assert.deepEqual(await init, { contacts: [] });

  const refused = messenger.contacts.remove('c1');
  sockets[0].reply({ kind: 'response', id: 3, error: 'contact:remove can’t be asked for from another computer yet.' });
  await assert.rejects(refused, /another computer/);
});

test('events reach the windows that listen, until they stop', () => {
  const { sockets, messenger } = browserTab();
  sockets[0].emit('open');
  const heard = [];
  const stop = messenger.on.session((event) => heard.push(event));
  sockets[0].reply({ kind: 'event', channel: EVENTS.sessionEvent, payload: { type: 'delta', text: 'po' } });
  sockets[0].reply({ kind: 'event', channel: EVENTS.contactsChanged, payload: [] });
  stop();
  sockets[0].reply({ kind: 'event', channel: EVENTS.sessionEvent, payload: { type: 'delta', text: 'ng' } });
  sockets[0].emit('message', { data: 'not json' });
  assert.deepEqual(heard, [{ type: 'delta', text: 'po' }]);
});

test('a link opens in a new tab, and only a web address', async () => {
  const { sockets, opened, messenger } = browserTab();
  sockets[0].emit('open');
  await messenger.app.openExternal('javascript:alert(1)');
  await messenger.app.openExternal('https://github.com/x/y/pull/1');
  assert.deepEqual(opened, [['https://github.com/x/y/pull/1', '_blank', 'noopener,noreferrer']]);
  // None of it went to the app.
  assert.deepEqual(sockets[0].sent, []);
  assert.equal(messenger.app.pathForFile({ name: 'a.txt' }), '');
});

test('the page hears how the connection is, to say so', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { sockets, connection } = browserTab();
  sockets[0].emit('open');
  sockets[0].emit('close', { code: 1006 });
  assert.deepEqual(connection, [
    [CONNECTION, 'connected'],
    [CONNECTION, 'reconnecting'],
  ]);
});

test('signed out, here or on the Mac, the page goes to the sign-in page at once', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { sockets, went, connection, messenger } = browserTab();
  sockets[0].emit('open');
  const waiting = messenger.chat.send('c1', { text: 'ping' });
  sockets[0].emit('close', { code: 1008, reason: 'Signed out' });
  await assert.rejects(waiting, /Not confirmed yet/);
  assert.deepEqual(went, ['/login?why=signed-out']);
  t.mock.timers.tick(10_000);
  await flush();
  assert.equal(sockets.length, 1, 'it does not try again');
  assert.deepEqual(connection, [[CONNECTION, 'connected']]);
  await assert.rejects(messenger.chat.send('c1', { text: 'not sent' }), /Reconnecting/);
});

test('a dropped connection fails what waits, and comes back without reading the page anew', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { sockets, went, connection, messenger } = browserTab();
  sockets[0].emit('open');
  const waiting = messenger.chat.send('c1', { text: 'ping' });
  sockets[0].emit('close');
  await assert.rejects(waiting, /Not confirmed yet/);
  t.mock.timers.tick(1000);
  await flush();
  assert.equal(sockets.length, 2);
  sockets[1].emit('open');
  assert.deepEqual(went, []);
  assert.deepEqual(connection.at(-1), [CONNECTION, 'connected']);
});

test('a session that ended signs in again', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { sockets, went } = browserTab({ session: 401 });
  sockets[0].emit('open');
  sockets[0].emit('close');
  t.mock.timers.tick(1000);
  await flush();
  assert.deepEqual(went, ['/login?why=expired']);
  assert.equal(sockets.length, 1);
});

test('messages entered while disconnected are rejected and never replayed', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { sockets, messenger } = browserTab();
  sockets[0].emit('close');
  await assert.rejects(messenger.chat.send('c1', { text: 'not sent' }), /Reconnecting/);
  t.mock.timers.tick(1000);
  await flush();
  sockets[1].emit('open');
  assert.deepEqual(sockets[1].sent, []);
});

test('the sign-in page is told what the computer it signs in to is called: Mac, PC or computer, nothing else', () => {
  const html = '<!doctype html>\n<html lang="en">\n  <head></head>\n</html>\n';
  for (const noun of ['Mac', 'PC', 'computer'])
    assert.match(signInPage(html, noun), new RegExp(`<html lang="en" data-noun="${noun}">`), noun);
  assert.match(signInPage(html, '"><script>alert(1)</script>'), /<html lang="en" data-noun="computer">/);
  assert.match(signInPage(html, undefined), /data-noun="computer"/);
  const page = fs.readFileSync(new URL('../src/renderer/remote/login.html', import.meta.url), 'utf8');
  assert.match(signInPage(page, 'PC'), /<html lang="en" data-noun="PC">/);
});
