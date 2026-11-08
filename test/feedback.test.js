import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  cleanFeedback,
  EMAIL_MAX,
  FEEDBACK_KINDS,
  FEEDBACK_SOURCES,
  MESSAGE_MAX,
  postFeedback,
  PROBLEMS,
  SCREENSHOT_MAX,
  SCREENSHOT_TYPES,
  screenshotProblem,
  SYSTEM_MAX,
  systemDetails,
} from '../src/shared/feedback.js';

const picture = (size = 12, type = 'image/png') => new Blob([new Uint8Array(size)], { type });
const report = (fields = {}) => ({ kind: 'bug', message: 'The window shakes forever.', from: 'app', ...fields });

// ---- what a report may hold -------------------------------------------------------------------

test('a report is tidied up before it is kept', () => {
  const fields = {
    kind: ' bug ',
    message: '  It broke.\n\nTwice.  ',
    email: ' Ada@Example.com ',
    system: ' macOS ',
    from: ' page ',
  };
  assert.deepEqual(cleanFeedback(fields), {
    report: {
      kind: 'bug',
      message: 'It broke.\n\nTwice.',
      email: 'ada@example.com',
      system: 'macOS',
      from: 'page',
      screenshot: null,
    },
  });
});

test('a report needs nothing but what it is, a message and which form sent it', () => {
  for (const { id } of FEEDBACK_KINDS) {
    assert.deepEqual(cleanFeedback({ kind: id, message: 'Hello', from: 'app' }), {
      report: { kind: id, message: 'Hello', email: '', system: '', from: 'app', screenshot: null },
    });
  }
});

test('a report comes from the app, the demo or the page, and one that says nothing is turned down', () => {
  assert.deepEqual(FEEDBACK_SOURCES, ['app', 'demo', 'page']);
  for (const from of FEEDBACK_SOURCES) assert.equal(cleanFeedback(report({ from })).report.from, from);
  // A form posted without its script, which is how a bot posts one.
  for (const from of [undefined, null, '', '  ', 'App', 'site', 'toString', 3, ['app']]) {
    assert.deepEqual(cleanFeedback(report({ from })), { problem: 'no-script' }, JSON.stringify(from));
  }
});

test('a report is feedback, a bug or a request, and nothing else', () => {
  assert.deepEqual(
    FEEDBACK_KINDS.map((kind) => kind.id),
    ['feedback', 'bug', 'request']
  );
  for (const kind of ['', 'Bug', 'praise', undefined, null, 3, {}, ['bug']]) {
    assert.deepEqual(cleanFeedback(report({ kind })), { problem: 'invalid-kind' }, JSON.stringify(kind));
  }
  for (const nothing of [undefined, null, 'bug']) assert.deepEqual(cleanFeedback(nothing), { problem: 'invalid-kind' });
});

test('a report without a message is turned down', () => {
  for (const message of ['', '   ', '\n\t', undefined, null, 42, ['hi']]) {
    assert.deepEqual(cleanFeedback(report({ message })), { problem: 'no-message' }, JSON.stringify(message));
  }
});

test('a message has a maximum length, counted without the space around it', () => {
  const longest = 'x'.repeat(MESSAGE_MAX);
  assert.equal(cleanFeedback(report({ message: `  ${longest}\n` })).report.message, longest);
  assert.deepEqual(cleanFeedback(report({ message: `${longest}x` })), { problem: 'message-too-long' });
});

test('a line break counts as one character, however the form sent it', () => {
  assert.equal(cleanFeedback(report({ message: 'one\r\ntwo\rthree\nfour' })).report.message, 'one\ntwo\nthree\nfour');
  // A browser lets this much be typed, and then posts every line break as two characters.
  const typed = `${'x\n'.repeat(MESSAGE_MAX / 2 - 1)}xx`;
  const posted = typed.replace(/\n/g, '\r\n');
  assert.ok(posted.length > MESSAGE_MAX);
  assert.equal(cleanFeedback(report({ message: posted })).report.message, typed);
  assert.deepEqual(cleanFeedback(report({ message: `${posted}x` })), { problem: 'message-too-long' });
});

test('an address is checked only when there is one', () => {
  for (const email of ['', '   ', undefined, null]) assert.equal(cleanFeedback(report({ email })).report.email, '');
  for (const email of ['ada', 'ada@', '@example.com', 'ada@example', 'a da@example.com', 'ada@@example.com']) {
    assert.deepEqual(cleanFeedback(report({ email })), { problem: 'invalid-email' }, email);
  }

  const domain = '@example.com';
  const longest = 'x'.repeat(EMAIL_MAX - domain.length) + domain;
  assert.equal(cleanFeedback(report({ email: longest })).report.email, longest);
  assert.deepEqual(cleanFeedback(report({ email: `x${longest}` })), { problem: 'invalid-email' });
});

test('what a report says about the system is cut to length, never refused', () => {
  assert.equal(cleanFeedback(report({ system: 'x'.repeat(SYSTEM_MAX + 50) })).report.system.length, SYSTEM_MAX);
  for (const system of [undefined, null, 42, {}]) assert.equal(cleanFeedback(report({ system })).report.system, '');
});

// ---- the picture ------------------------------------------------------------------------------

test('a report may carry a PNG, JPEG or WebP picture', () => {
  for (const type of Object.keys(SCREENSHOT_TYPES)) {
    const screenshot = picture(20, type);
    assert.equal(screenshotProblem(screenshot), null, type);
    assert.equal(cleanFeedback(report({ screenshot })).report.screenshot, screenshot);
  }
  assert.deepEqual(Object.values(SCREENSHOT_TYPES), ['png', 'jpg', 'webp']);
});

test('no picture, or the empty one of a form with no file chosen, is no picture', () => {
  for (const screenshot of [undefined, null, '', picture(0), picture(0, 'application/octet-stream')]) {
    assert.equal(screenshotProblem(screenshot), null);
    assert.equal(cleanFeedback(report({ screenshot })).report.screenshot, null);
  }
});

test('anything else in place of a picture is turned down', () => {
  const others = [picture(20, 'image/gif'), picture(20, 'image/svg+xml'), picture(20, 'text/html'), picture(20, '')];
  for (const screenshot of [...others, 'data:image/png;base64,AAAA', { type: 'toString', size: 4 }]) {
    assert.equal(screenshotProblem(screenshot), 'invalid-screenshot');
    assert.deepEqual(cleanFeedback(report({ screenshot })), { problem: 'invalid-screenshot' });
  }
});

test('a picture has a maximum size', () => {
  assert.equal(screenshotProblem({ type: 'image/png', size: SCREENSHOT_MAX }), null);
  assert.equal(screenshotProblem({ type: 'image/png', size: SCREENSHOT_MAX + 1 }), 'screenshot-too-large');
  assert.deepEqual(cleanFeedback(report({ screenshot: { type: 'image/jpeg', size: SCREENSHOT_MAX + 1 } })), {
    problem: 'screenshot-too-large',
  });
});

test('every problem has a sentence for the form', () => {
  const found = new Set([
    cleanFeedback({}).problem,
    cleanFeedback({ kind: 'bug' }).problem,
    cleanFeedback(report({ message: 'x'.repeat(MESSAGE_MAX + 1) })).problem,
    cleanFeedback(report({ email: 'ada' })).problem,
    cleanFeedback(report({ screenshot: picture(20, 'image/gif') })).problem,
    cleanFeedback(report({ screenshot: { type: 'image/png', size: SCREENSHOT_MAX + 1 } })).problem,
    cleanFeedback({ kind: 'bug', message: 'Hello' }).problem,
  ]);
  // And one the Worker says on its own, to a sender who posts too often.
  assert.deepEqual([...found, 'too-many'].sort(), Object.keys(PROBLEMS).sort());
  for (const sentence of Object.values(PROBLEMS)) assert.match(sentence, /^[A-Z].+\.$/);
  assert.match(PROBLEMS['screenshot-too-large'], /\b5 MB\b/);
});

// ---- where it comes from ----------------------------------------------------------------------

test('the app says its version and the system it runs on', () => {
  const app = { version: '0.2.3', release: '15.1', arch: 'arm64' };
  assert.equal(systemDetails({ ...app, platform: 'darwin' }), 'buddylist 0.2.3, macOS 15.1, arm64');
  assert.equal(systemDetails({ ...app, platform: 'win32' }), 'buddylist 0.2.3, Windows 15.1, arm64');
  assert.equal(systemDetails({ ...app, platform: 'linux' }), 'buddylist 0.2.3, Linux 15.1, arm64');
  assert.equal(systemDetails({ ...app, platform: 'freebsd' }), 'buddylist 0.2.3, freebsd 15.1, arm64');
});

// ---- sending ----------------------------------------------------------------------------------

const URL_ = 'https://buddylist.example/api/feedback';

/** A stand-in for fetch that remembers what it was asked and answers as told. */
function fakeFetch(answer = () => Response.json({ ok: true })) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    return answer();
  };
  return { fetch, calls };
}

test('a report is posted as a form, with the picture as a file', async () => {
  const { fetch, calls } = fakeFetch();
  const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
  await postFeedback(
    {
      kind: 'bug',
      message: ' It broke. ',
      email: 'Ada@example.com',
      system: 'macOS',
      from: 'app',
      screenshot: { type: 'image/jpeg', bytes },
    },
    { url: URL_, fetch }
  );

  assert.equal(calls.length, 1);
  const [{ url, init }] = calls;
  assert.equal(url, URL_);
  assert.equal(init.method, 'POST');
  const { screenshot, ...words } = Object.fromEntries(init.body);
  assert.deepEqual(words, {
    kind: 'bug',
    message: 'It broke.',
    email: 'ada@example.com',
    system: 'macOS',
    from: 'app',
  });
  assert.equal(screenshot.name, 'screenshot.jpg');
  assert.equal(screenshot.type, 'image/jpeg');
  assert.deepEqual(new Uint8Array(await screenshot.arrayBuffer()), new Uint8Array([1, 2, 3, 4]));
});

test('a report without a picture sends no file', async () => {
  for (const screenshot of [undefined, null]) {
    const { fetch, calls } = fakeFetch();
    await postFeedback(report({ screenshot }), { url: URL_, fetch });
    assert.deepEqual(Object.fromEntries(calls[0].init.body), {
      kind: 'bug',
      message: 'The window shakes forever.',
      email: '',
      system: '',
      from: 'app',
    });
  }
});

test('a report that breaks a rule is not sent, and says which', async () => {
  const cases = [
    [report({ kind: 'praise' }), PROBLEMS['invalid-kind']],
    [report({ message: ' ' }), PROBLEMS['no-message']],
    [report({ email: 'ada' }), PROBLEMS['invalid-email']],
    [report({ screenshot: { type: 'image/gif', bytes: new Uint8Array(4) } }), PROBLEMS['invalid-screenshot']],
    [
      report({ screenshot: { type: 'image/png', bytes: new Uint8Array(SCREENSHOT_MAX + 1) } }),
      PROBLEMS['screenshot-too-large'],
    ],
    [report({ from: undefined }), PROBLEMS['no-script']],
    [undefined, PROBLEMS['invalid-kind']],
  ];
  for (const [fields, message] of cases) {
    const { fetch, calls } = fakeFetch();
    await assert.rejects(postFeedback(fields, { url: URL_, fetch }), { message });
    assert.equal(calls.length, 0);
  }
});

test('a report that could not leave says to check the connection', async () => {
  const fetch = async () => {
    throw new TypeError('fetch failed');
  };
  await assert.rejects(postFeedback(report(), { url: URL_, fetch }), {
    message: "Couldn't send it. Check your connection and try again.",
  });
});

test('a report the Worker turns down says why, in the words of the form', async () => {
  const refused = (body, status = 400) => fakeFetch(() => Response.json(body, { status })).fetch;
  await assert.rejects(postFeedback(report(), { url: URL_, fetch: refused({ ok: false, error: 'invalid-email' }) }), {
    message: PROBLEMS['invalid-email'],
  });
  // Anything it has no words for, such as a page that isn't there, went wrong.
  const wrong = { message: 'Something went wrong. Please try again.' };
  await assert.rejects(
    postFeedback(report(), { url: URL_, fetch: refused({ ok: false, error: 'forbidden' }, 403) }),
    wrong
  );
  await assert.rejects(postFeedback(report(), { url: URL_, fetch: refused({ error: 'toString' }) }), wrong);
  const notFound = async () => new Response('Not found', { status: 404 });
  await assert.rejects(postFeedback(report(), { url: URL_, fetch: notFound }), wrong);
});

// ---- the forms --------------------------------------------------------------------------------

// The page's form is written out by hand, and the build fills in its limits.
test("the page's form offers the same kinds of report as the app", () => {
  const page = fs.readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');
  const offered = [...page.matchAll(/<input type="radio" name="kind" value="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(
    offered,
    FEEDBACK_KINDS.map((kind) => kind.id)
  );
  for (const { label } of FEEDBACK_KINDS) assert.ok(page.includes(`${label}</label`), label);
});

// A bot posts the fields it finds, so the one that lets a report in is left to the page's script.
test("the page's form leaves which form sent it to its script", () => {
  const page = fs.readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');
  const script = fs.readFileSync(new URL('../site/site.js', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /name="from"/);
  assert.match(script, /report\.set\('from', 'page'\)/);
});
