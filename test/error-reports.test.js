import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  cleanErrorReport,
  describeError,
  MESSAGE_MAX,
  NAME_MAX,
  releaseName,
  scrubber,
  STACK_MAX,
  WINDOW_REPORTS_MAX,
} from '../src/shared/error-reports.js';
import { SENTRY_DSN, startErrorReports } from '../src/main/error-reports.js';

const DSN = 'https://key@o1.ingest.sentry.io/2';
const ID = '6b1c2a54-0f1e-4c3a-9d7e-2f4b8a1c5e90';

// ---- what was thrown, as a window hands it over ------------------------------------------------

test('an error is described by its kind, its message and where it happened', () => {
  const thrown = new TypeError('list.map is not a function');
  assert.deepEqual(describeError(thrown), {
    name: 'TypeError',
    message: 'list.map is not a function',
    stack: thrown.stack,
  });
});

test('anything can be thrown, and all of it can be described', () => {
  assert.deepEqual(describeError('just words'), { name: 'Error', message: 'just words', stack: '' });
  assert.deepEqual(describeError(404), { name: 'Error', message: '404', stack: '' });
  assert.deepEqual(describeError(undefined), { name: 'Error', message: 'undefined', stack: '' });
  assert.deepEqual(describeError(null), { name: 'Error', message: 'null', stack: '' });
  assert.deepEqual(describeError({ code: 3 }), { name: 'Error', message: '[object Object]', stack: '' });
  // Something from another page, or made to look like an error.
  assert.deepEqual(describeError({ message: 'looks like one' }), {
    name: 'Error',
    message: 'looks like one',
    stack: '',
  });
  // Not even this may fail: it would be an error while reporting one.
  assert.equal(describeError(Object.create(null)).name, 'Error');
  assert.ok(describeError(Object.create(null)).message);
});

test('a description is cut to length', () => {
  const thrown = Object.assign(new Error('m'.repeat(MESSAGE_MAX + 10)), { name: 'N'.repeat(NAME_MAX + 10) });
  thrown.stack = 's'.repeat(STACK_MAX + 10);
  const described = describeError(thrown);
  assert.deepEqual(
    [described.name.length, described.message.length, described.stack.length],
    [NAME_MAX, MESSAGE_MAX, STACK_MAX]
  );
  assert.equal(describeError('w'.repeat(MESSAGE_MAX + 10)).message.length, MESSAGE_MAX);
});

// ---- a window's report, as the main process takes it -------------------------------------------

test('a report is taken with its kind, message, stack and the source maps of its scripts', () => {
  const report = {
    name: 'TypeError',
    message: 'no',
    stack: 'TypeError: no\n    at f (a.js:1:2)',
    debugIds: { at: ID },
  };
  assert.deepEqual(cleanErrorReport(report), report);
  assert.deepEqual(cleanErrorReport({ message: 'no' }), { name: 'Error', message: 'no', stack: '', debugIds: {} });
});

test('a report that says nothing is no report', () => {
  for (const nothing of [undefined, null, 'words', 7, {}, { name: 'TypeError' }, { message: 4, stack: {} }]) {
    assert.equal(cleanErrorReport(nothing), null);
  }
});

test('whatever a window sends is cut to length, and only words are kept', () => {
  const cleaned = cleanErrorReport({
    name: 'N'.repeat(NAME_MAX + 1),
    message: 'm'.repeat(MESSAGE_MAX + 1),
    stack: 's'.repeat(STACK_MAX + 1),
  });
  assert.deepEqual(
    [cleaned.name.length, cleaned.message.length, cleaned.stack.length],
    [NAME_MAX, MESSAGE_MAX, STACK_MAX]
  );
  assert.equal(cleanErrorReport({ name: { toString: () => 'x' }, message: 'm' }).name, 'Error');
});

test('only a source map id that looks like one is kept, and only a few of them', () => {
  const debugIds = { one: ID, two: 'not-an-id', three: 7, [`${'x'.repeat(MESSAGE_MAX)}x`]: ID };
  assert.deepEqual(cleanErrorReport({ message: 'm', debugIds }).debugIds, { one: ID });
  for (const none of [undefined, null, 'words', 4]) {
    assert.deepEqual(cleanErrorReport({ message: 'm', debugIds: none }).debugIds, {});
  }
  const many = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`script ${i}`, ID]));
  assert.equal(Object.keys(cleanErrorReport({ message: 'm', debugIds: many }).debugIds).length, 4);
});

// ---- what a report leaves out ------------------------------------------------------------------

test('the home folder is written as ~ wherever a report has it', () => {
  const scrub = scrubber('/Users/ada');
  const report = {
    message: "ENOENT: no such file or directory, open '/Users/ada/work/shop/.env'",
    exception: {
      values: [{ value: 'in /Users/ada', stacktrace: { frames: [{ filename: '/Users/ada/app/main.js' }] } }],
    },
    breadcrumbs: [{ message: 'cwd /Users/ada/work', data: { path: '/Users/ada/work', count: 2 } }],
  };
  assert.deepEqual(scrub(report), {
    message: "ENOENT: no such file or directory, open '~/work/shop/.env'",
    exception: { values: [{ value: 'in ~', stacktrace: { frames: [{ filename: '~/app/main.js' }] } }] },
    breadcrumbs: [{ message: 'cwd ~/work', data: { path: '~/work', count: 2 } }],
  });
});

test('a home folder with a space in it is found in a file’s address too', () => {
  const scrub = scrubber('/Users/Ada Lovelace');
  assert.equal(scrub('at /Users/Ada Lovelace/a.js'), 'at ~/a.js');
  assert.equal(scrub('at file:///Users/Ada%20Lovelace/a.js:1:2'), 'at file://~/a.js:1:2');
  assert.equal(scrubber('C:\\Users\\ada')('at C:/Users/ada/a.js and C:\\Users\\ada\\b.js'), 'at ~/a.js and ~\\b.js');
});

test('a Windows home folder is found as a path either way round, and in a file’s address', () => {
  // A window's script, from an app installed for one person, which Windows puts in their home folder.
  const script = 'AppData/Local/Programs/buddylist/resources/app.asar/src/renderer/chat/main.js';
  for (const [home, address] of [
    ['C:\\Users\\ada', 'C:/Users/ada'],
    ['C:\\Users\\Jane Doe', 'C:/Users/Jane%20Doe'],
    ['C:\\Users\\Şafa', 'C:/Users/%C5%9Eafa'],
  ]) {
    const scrub = scrubber(home);
    assert.equal(scrub(`at render (file:///${address}/${script}:1:2)`), `at render (file:///~/${script}:1:2)`, home);
    assert.equal(scrub(`open '${home}\\work\\.env'`), "open '~\\work\\.env'", home);
    assert.equal(scrub(`at ${home.replaceAll('\\', '/')}/work/a.js`), 'at ~/work/a.js', home);
  }
});

test('a Windows home folder is found with its drive letter in either case', () => {
  const scrub = scrubber('C:\\Users\\Jane Doe');
  assert.equal(scrub('at c:\\Users\\Jane Doe\\a.js'), 'at ~\\a.js');
  assert.equal(scrub('at file:///c:/Users/Jane%20Doe/a.js'), 'at file:///~/a.js');
  assert.equal(scrubber('c:\\Users\\ada')('at C:/Users/ada/a.js'), 'at ~/a.js');
});

test('a Windows home folder is found in JSON, which doubles its backslashes', () => {
  // What V8 says of JSON it could not read quotes it as it was written.
  const said = String.raw`Unexpected token 'C', "C:\\Users\\Jane Doe\\work" is not valid JSON`;
  assert.equal(scrubber('C:\\Users\\Jane Doe')(said), String.raw`Unexpected token 'C', "~\\work" is not valid JSON`);
});

test('a home folder on a Mac or on Linux is found as it always was', () => {
  const scrub = scrubber('/home/şafa');
  assert.equal(scrub('at /home/şafa/a.js and file:///home/%C5%9Fafa/b.js'), 'at ~/a.js and file://~/b.js');
  assert.equal(scrubber('/Users/Ada Lovelace')('"/Users/Ada Lovelace/a.js"'), '"~/a.js"');
});

test('a web address is left out: it is a page someone had open, or a repository of theirs', () => {
  const scrub = scrubber('/Users/ada');
  assert.equal(
    scrub("ERR_CONNECTION_REFUSED (-102) loading 'http://localhost:3000/admin?token=abc'"),
    "ERR_CONNECTION_REFUSED (-102) loading '[link]'"
  );
  assert.equal(
    scrub('see https://github.com/ada/secret/pull/4, then (https://example.com/a)'),
    'see [link] then ([link])'
  );
});

test('a page of the app loses what it was opened with', () => {
  const scrub = scrubber('/Users/ada');
  assert.equal(scrub('app:///src/renderer/toast.html?title=Claude&body=the%20words'), 'app:///src/renderer/toast.html');
  assert.equal(scrub('file:///Users/ada/app/chat.html?contact=42#top'), 'file://~/app/chat.html');
  // A script's place in a stack is not something it was opened with.
  assert.equal(scrub('app:///src/renderer/chat/main.js:1:2345'), 'app:///src/renderer/chat/main.js:1:2345');
});

test('a part that is not words is left as it is, and a report that holds itself is gone through once', () => {
  const scrub = scrubber('/Users/ada');
  const when = new Date(0);
  const report = { level: 'error', timestamp: 12.5, handled: false, nothing: null, when, at: '/Users/ada' };
  report.self = report;
  assert.equal(scrub(report), report);
  assert.deepEqual(
    [report.level, report.timestamp, report.handled, report.nothing, report.when, report.at, report.self],
    ['error', 12.5, false, null, when, '~', report]
  );
  for (const other of [undefined, null, 4, true]) assert.equal(scrub(other), other);
});

test('a home folder that is everything, or nothing, is not looked for', () => {
  assert.equal(scrubber('/')('at /usr/lib/a.js'), 'at /usr/lib/a.js');
  assert.equal(scrubber('')('at /usr/lib/a.js'), 'at /usr/lib/a.js');
});

// ---- reporting, in the main process ------------------------------------------------------------

/** The SDK, as far as the app uses it. */
function fakeSentry() {
  const sdk = {
    IPCMode: { Classic: 1, Protocol: 2, Both: 3 },
    inits: [],
    captured: [],
    options: null,
    init(options) {
      sdk.inits.push(options);
      sdk.options = { ...options };
    },
    getClient: () => ({ getOptions: () => sdk.options }),
    captureException: (error, hint) => sdk.captured.push({ error, hint }),
  };
  return sdk;
}

const start = (sentry, extra = {}) =>
  startErrorReports({ sentry, dsn: DSN, version: '1.2.3', enabled: true, home: '/Users/ada', ...extra });

test('a version is called the same where its errors and its source maps are sent', () => {
  assert.equal(releaseName('1.2.3'), 'buddylist@1.2.3');
  const sentry = fakeSentry();
  start(sentry);
  assert.equal(sentry.inits[0].release, 'buddylist@1.2.3');
});

test('the address in the code is one reports can be sent to, or none yet', () => {
  if (SENTRY_DSN) assert.match(SENTRY_DSN, /^https:\/\/[0-9a-f]+@[\w.-]+\/\d+$/);
  else assert.equal(SENTRY_DSN, '');
});

test('without an address nothing is started, and nothing fails', () => {
  const sentry = fakeSentry();
  const reports = start(sentry, { dsn: '' });
  reports.setEnabled(true);
  reports.fromWindow({ message: 'boom' }, 'file:///app/src/renderer/chat.html');
  reports.setEnabled(false);
  assert.deepEqual([sentry.inits, sentry.captured], [[], []]);
});

test('reports say nothing about who sent them', () => {
  const sentry = fakeSentry();
  start(sentry);
  const [options] = sentry.inits;
  assert.equal(options.dsn, DSN);
  assert.equal(options.sendDefaultPii, false);
  assert.deepEqual(options.dataCollection, { userInfo: false });
  const report = {
    message: 'at /Users/ada/x, see https://example.com/y',
    contexts: { culture: { locale: 'en-GB', timezone: 'Europe/London' }, os: { name: 'macOS' } },
  };
  assert.deepEqual(options.beforeSend(report, {}), {
    message: 'at ~/x, see [link]',
    contexts: { os: { name: 'macOS' } },
  });
  assert.deepEqual(options.beforeSend({ message: 'no contexts' }, {}), { message: 'no contexts' });
  // A window of an app installed on Windows: its page is in the home folder.
  const windows = fakeSentry();
  start(windows, { home: 'C:\\Users\\Jane Doe' });
  assert.deepEqual(
    windows.inits[0].beforeBreadcrumb({
      message: 'renderer.dom-ready',
      data: { url: 'file:///C:/Users/Jane%20Doe/AppData/Local/Programs/buddylist/chat.html?contact=42' },
    }),
    { message: 'renderer.dom-ready', data: { url: 'file:///~/AppData/Local/Programs/buddylist/chat.html' } }
  );
  assert.deepEqual(
    options.beforeBreadcrumb(
      { message: 'renderer.dom-ready', data: { url: 'app:///src/renderer/toast.html?body=hi' } },
      {}
    ),
    { message: 'renderer.dom-ready', data: { url: 'app:///src/renderer/toast.html' } }
  );
});

test('the trail of console lines and web addresses is not gathered, and no window gets a script of the SDK’s', () => {
  const sentry = fakeSentry();
  start(sentry);
  const names = ['SentryMinidump', 'Console', 'ElectronBreadcrumbs', 'NodeFetch', 'ElectronNet', 'PreloadInjection'];
  const kept = sentry.inits[0].integrations(names.map((name) => ({ name })));
  assert.deepEqual(kept, [{ name: 'SentryMinidump' }, { name: 'ElectronBreadcrumbs' }]);
});

test('the SDK registers no scheme of its own, which would take the place of pack://', () => {
  const sentry = fakeSentry();
  start(sentry);
  assert.equal(sentry.inits[0].ipcMode, sentry.IPCMode.Classic);
});

test('an app that starts with reports off starts nothing, until they are turned on', () => {
  const sentry = fakeSentry();
  const reports = start(sentry, { enabled: false });
  reports.fromWindow({ message: 'boom' }, 'file:///app/src/renderer/chat.html');
  reports.setEnabled(false);
  assert.deepEqual([sentry.inits, sentry.captured], [[], []]);

  reports.setEnabled(true);
  assert.equal(sentry.inits.length, 1);
  reports.fromWindow({ message: 'boom' }, 'file:///app/src/renderer/chat.html');
  assert.equal(sentry.captured.length, 1);
});

test('turning reports off and on again is heard by what is already running', () => {
  const sentry = fakeSentry();
  const reports = start(sentry);
  assert.notEqual(sentry.options.enabled, false);
  reports.setEnabled(false);
  assert.equal(sentry.options.enabled, false);
  reports.setEnabled(true);
  assert.equal(sentry.options.enabled, true);
  // Started once, however often it is switched.
  assert.equal(sentry.inits.length, 1);
});

test('an error from a window is reported as the error it was, and says which window', () => {
  const sentry = fakeSentry();
  const stack = 'TypeError: list.map is not a function\n    at render (file:///app/src/renderer/chat/main.js:1:2345)';
  start(sentry).fromWindow(
    { name: 'TypeError', message: 'list.map is not a function', stack },
    'file:///Applications/buddylist.app/Contents/Resources/app.asar/src/renderer/chat.html?contact=42'
  );
  const [{ error, hint }] = sentry.captured;
  assert.ok(error instanceof Error);
  assert.deepEqual([error.name, error.message, error.stack], ['TypeError', 'list.map is not a function', stack]);
  assert.deepEqual(hint, {
    captureContext: { tags: { window: 'chat' } },
    data: { mechanism: { handled: false, type: 'window' } },
  });
});

test('an error that came without a stack still reads as one', () => {
  const sentry = fakeSentry();
  start(sentry).fromWindow({ message: 'Script error.' }, 'not an address');
  const [{ error, hint }] = sentry.captured;
  assert.equal(error.stack, 'Error: Script error.');
  assert.equal(hint.captureContext.tags.window, '');
});

test('a report that says nothing is not sent on', () => {
  const sentry = fakeSentry();
  const reports = start(sentry);
  for (const nothing of [undefined, null, {}, 'words']) reports.fromWindow(nothing, 'file:///app/chat.html');
  assert.deepEqual(sentry.captured, []);
});

test('the source map of a window’s script is put where the SDK looks it up', (t) => {
  const before = globalThis._sentryDebugIds;
  t.after(() => {
    globalThis._sentryDebugIds = before;
  });
  const own = { 'Error\n    at file:///app/src/main/index.js:1:1': '11111111-2222-4333-8444-555555555555' };
  globalThis._sentryDebugIds = own;
  const at = 'Error\n    at file:///app/src/renderer/chat/main.js:1:1';
  start(fakeSentry()).fromWindow({ message: 'boom', debugIds: { [at]: ID } }, 'file:///app/src/renderer/chat.html');
  // Next to the main process's own, in the list its script already made.
  assert.equal(globalThis._sentryDebugIds, own);
  assert.deepEqual(globalThis._sentryDebugIds, { ...own, [at]: ID });

  globalThis._sentryDebugIds = undefined;
  start(fakeSentry()).fromWindow({ message: 'boom', debugIds: { [at]: ID } }, 'file:///app/src/renderer/chat.html');
  assert.deepEqual(globalThis._sentryDebugIds, { [at]: ID });
});

// ---- a window, handing its errors over ---------------------------------------------------------

test('every window hands its errors over, before it loads anything else', () => {
  const renderer = new URL('../src/renderer/', import.meta.url);
  const pages = fs.readdirSync(renderer).filter((file) => file.endsWith('.html'));
  assert.ok(pages.length >= 5);
  for (const page of pages) {
    const [, script] = fs.readFileSync(new URL(page, renderer), 'utf8').match(/<script type="module" src="([^"]+)"/);
    const [first] = fs.readFileSync(new URL(script, renderer), 'utf8').match(/^import .*$/m);
    assert.equal(first, "import '../lib/error-reports.js';", page);
  }
});

test('a window hands over the errors nothing caught, up to a number of them', async () => {
  const handed = [];
  const listeners = {};
  globalThis.window = {
    messenger: {
      errors: {
        report: (report) => {
          handed.push(report);
          // The main process may be gone: that is not another error.
          return Promise.reject(new Error('no answer'));
        },
      },
    },
    addEventListener: (type, listener) => {
      listeners[type] = listener;
    },
  };
  await import('../src/renderer/lib/error-reports.js');

  // A built script has said which source map reads its stacks. One run from src/ has not.
  globalThis._sentryDebugIds = { at: ID };
  const thrown = new RangeError('too far');
  listeners.error({ error: thrown, message: 'Uncaught RangeError: too far' });
  assert.deepEqual(handed, [{ name: 'RangeError', message: 'too far', stack: thrown.stack, debugIds: { at: ID } }]);
  delete globalThis._sentryDebugIds;

  // A script the page may not look into fails with words only.
  listeners.error({ error: null, message: 'Script error.' });
  assert.deepEqual(handed[1], { name: 'Error', message: 'Script error.', stack: '', debugIds: undefined });

  listeners.unhandledrejection({ reason: 'gave up' });
  assert.deepEqual(handed[2], { name: 'Error', message: 'gave up', stack: '', debugIds: undefined });

  for (let i = 0; i < WINDOW_REPORTS_MAX * 2; i += 1) listeners.error({ error: new Error(`again ${i}`) });
  assert.equal(handed.length, WINDOW_REPORTS_MAX);
  // Give the refused reports their turn: none of them may end up as an unhandled rejection.
  await new Promise((resolve) => setImmediate(resolve));
});
