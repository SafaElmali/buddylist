import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../site/worker.js';
import { MESSAGE_MAX, postFeedback, PROBLEMS, SCREENSHOT_MAX } from '../src/shared/feedback.js';

const SITE = 'https://buddylist.example';

/** A stand-in for the KV namespace that remembers what was written. */
function fakeStore() {
  const store = new Map();
  return {
    store,
    writes: [],
    async put(key, value, options) {
      this.writes.push({ key, value, options });
      store.set(key, value);
    },
  };
}

/** A stand-in for the FORM_LIMIT binding: each key may post `most` times. */
function fakeLimit(most = Infinity) {
  const counts = new Map();
  return {
    async limit({ key }) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
      return { success: counts.get(key) <= most };
    },
  };
}

const picture = (size = 12, type = 'image/png') => new Blob([new Uint8Array(size).fill(7)], { type });

function formOf(fields) {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return form;
}

function post(fields, { origin = SITE, path = '/api/feedback', headers = {} } = {}) {
  return new Request(SITE + path, {
    method: 'POST',
    headers: { ...(origin && { origin }), ...headers },
    body: fields instanceof FormData || typeof fields === 'string' ? fields : formOf(fields),
  });
}

async function send(request, feedback = fakeStore(), limit = fakeLimit()) {
  const response = await worker.fetch(request, {
    FEEDBACK: feedback,
    FORM_LIMIT: limit,
    ASSETS: { fetch: async () => new Response('Not found', { status: 404 }) },
  });
  const body = response.headers.get('content-type')?.includes('json') ? await response.json() : await response.text();
  return { status: response.status, body, feedback };
}

const report = (fields = {}) => ({ kind: 'bug', message: 'The window shakes forever.', from: 'page', ...fields });

// ---- keeping a report -------------------------------------------------------------------------

test('a report is kept with when it was sent', async () => {
  const fields = {
    kind: 'request',
    message: ' More winks, please. ',
    email: ' Ada@Example.com ',
    system: 'Firefox',
    from: 'page',
  };
  const { status, body, feedback } = await send(post(fields));

  assert.equal(status, 200);
  assert.deepEqual(body, { ok: true });
  assert.equal(feedback.writes.length, 1);
  const [{ key, value, options }] = feedback.writes;
  assert.match(key, /^feedback:\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z-[0-9a-f]{8}$/);
  const kept = JSON.parse(value);
  assert.deepEqual(kept, {
    kind: 'request',
    message: 'More winks, please.',
    email: 'ada@example.com',
    system: 'Firefox',
    from: 'page',
    sentAt: kept.sentAt,
    screenshot: null,
  });
  assert.ok(key.startsWith(`feedback:${kept.sentAt}-`));
  assert.deepEqual(options, {
    metadata: { kind: 'request', from: 'page', says: 'More winks, please.', screenshot: false },
  });
});

test('the line breaks of a posted message are kept as one character each', async () => {
  // FormData posts a line break as "\r\n", whatever was typed.
  const { feedback } = await send(post(report({ message: 'First line.\nSecond line.' })));
  const [{ value, options }] = feedback.writes;
  assert.equal(JSON.parse(value).message, 'First line.\nSecond line.');
  assert.equal(options.metadata.says, 'First line.\nSecond line.');
});

test('a report needs no address and no system', async () => {
  const { status, feedback } = await send(post(report()));
  assert.equal(status, 200);
  const kept = JSON.parse(feedback.writes[0].value);
  assert.equal(kept.email, '');
  assert.equal(kept.system, '');
});

test('two reports sent at once are both kept', async () => {
  const feedback = fakeStore();
  await Promise.all([send(post(report()), feedback), send(post(report()), feedback)]);
  assert.equal(feedback.store.size, 2);
});

test('the list of reports shows the start of a long message, within what a key may carry', async () => {
  // The worst a message can do to the list: characters that are written out as six each.
  const { feedback } = await send(post(report({ message: `a${'\u0001'.repeat(MESSAGE_MAX - 2)}b` })));
  const [{ value, options }] = feedback.writes;
  assert.equal(JSON.parse(value).message.length, MESSAGE_MAX);
  assert.equal(options.metadata.says.length, 80);
  assert.ok(new TextEncoder().encode(JSON.stringify(options.metadata)).length <= 1024);
});

// ---- the picture ------------------------------------------------------------------------------

test('a picture is kept next to its report, named after what it is', async () => {
  for (const [type, ending] of [
    ['image/png', 'png'],
    ['image/jpeg', 'jpg'],
    ['image/webp', 'webp'],
  ]) {
    const { status, feedback } = await send(post(report({ screenshot: picture(20, type) })));
    assert.equal(status, 200, type);
    const [shot, words] = feedback.writes;
    const id = words.key.slice('feedback:'.length);
    assert.equal(shot.key, `screenshot:${id}.${ending}`);
    assert.deepEqual(new Uint8Array(shot.value), new Uint8Array(20).fill(7));
    assert.deepEqual(shot.options, { metadata: { type } });
    assert.equal(JSON.parse(words.value).screenshot, shot.key);
    assert.equal(words.options.metadata.screenshot, true);
  }
});

test('a form with no file chosen is a report without a picture', async () => {
  // What a browser sends for an empty file field.
  const empty = new File([], '', { type: 'application/octet-stream' });
  const { status, feedback } = await send(post(report({ screenshot: empty })));
  assert.equal(status, 200);
  assert.equal(feedback.writes.length, 1);
  assert.equal(JSON.parse(feedback.writes[0].value).screenshot, null);
});

test('a picture that is something else, or too large, is turned down and nothing is kept', async () => {
  const other = await send(post(report({ screenshot: picture(20, 'image/gif') })));
  assert.equal(other.status, 400);
  assert.equal(other.body.error, 'invalid-screenshot');
  assert.equal(other.feedback.writes.length, 0);

  const text = await send(post(report({ screenshot: 'data:image/png;base64,AAAA' })));
  assert.equal(text.status, 400);
  assert.equal(text.body.error, 'invalid-screenshot');

  const large = await send(post(report({ screenshot: picture(SCREENSHOT_MAX + 1) })));
  assert.equal(large.status, 413);
  assert.deepEqual(large.body, {
    ok: false,
    error: 'screenshot-too-large',
    message: PROBLEMS['screenshot-too-large'],
  });
  assert.equal(large.feedback.writes.length, 0);

  // A declared length is enough to turn it down, before reading anything.
  const declared = await send(post(report(), { headers: { 'content-length': String(SCREENSHOT_MAX + 70_000) } }));
  assert.equal(declared.status, 413);
  assert.equal(declared.body.error, 'screenshot-too-large');
});

test('a picture as large as it may be still fits', async () => {
  const { status, feedback } = await send(post(report({ screenshot: picture(SCREENSHOT_MAX) })));
  assert.equal(status, 200);
  assert.equal(feedback.writes[0].value.byteLength, SCREENSHOT_MAX);
});

// ---- what is turned down ----------------------------------------------------------------------

test('a report that breaks a rule is turned down with the sentence for the form', async () => {
  const cases = [
    [report({ kind: 'praise' }), 'invalid-kind'],
    [{ message: 'no kind' }, 'invalid-kind'],
    [report({ message: '   ' }), 'no-message'],
    [{ kind: 'bug' }, 'no-message'],
    [report({ message: 'x'.repeat(MESSAGE_MAX + 1) }), 'message-too-long'],
    [report({ email: 'ada@' }), 'invalid-email'],
  ];
  for (const [fields, error] of cases) {
    const { status, body, feedback } = await send(post(fields));
    assert.equal(status, 400, error);
    assert.deepEqual(body, { ok: false, error, message: PROBLEMS[error] });
    assert.equal(feedback.writes.length, 0);
  }
});

test('a body that is not a form is turned down', async () => {
  for (const body of [JSON.stringify(report()), 'kind=bug&message=hi', '']) {
    const request = post(body, { headers: { 'content-type': 'application/json' } });
    const { status, body: answer, feedback } = await send(request);
    assert.equal(status, 400, body);
    assert.deepEqual(answer, { ok: false, error: 'invalid-form' });
    assert.equal(feedback.writes.length, 0);
  }
});

test('a report that does not say which form sent it is turned down, as a bot posts the page', async () => {
  // The page's form posted as it is found, from the page itself and from anywhere else.
  const found = { kind: 'feedback', message: 'Hello http://buddylist.dev,', email: 'seo@example.com', website: '' };
  for (const origin of [SITE, null]) {
    const { status, body, feedback } = await send(post(found, { origin }));
    assert.equal(status, 400, String(origin));
    assert.deepEqual(body, { ok: false, error: 'no-script', message: PROBLEMS['no-script'] });
    assert.equal(feedback.writes.length, 0);
  }
});

test('an app from before 0.2.34, which does not say where a report comes from, is still heard', async () => {
  const { from: _, ...old } = report();
  const node = { origin: null, headers: { 'user-agent': 'node' } };
  const { status, feedback } = await send(post(old, node));
  assert.equal(status, 200);
  assert.equal(JSON.parse(feedback.writes[0].value).from, 'app');

  // Anything else that says nothing is not the app.
  for (const options of [
    { origin: null },
    { origin: SITE, headers: { 'user-agent': 'node' } },
    { origin: null, headers: { 'user-agent': 'curl/8.7.1' } },
  ]) {
    const { status: refused, feedback: kept } = await send(post(old, options));
    assert.equal(refused, 400, JSON.stringify(options));
    assert.equal(kept.writes.length, 0);
  }
});

test('a bot that fills in the hidden field is told yes and left out', async () => {
  const { status, body, feedback } = await send(post(report({ website: 'https://spam.example' })));
  assert.equal(status, 200);
  assert.deepEqual(body, { ok: true });
  assert.equal(feedback.writes.length, 0);
});

test('the page and the app may post, another page may not', async () => {
  // The app sends no address of its own.
  for (const origin of [SITE, null]) {
    const { status, feedback } = await send(post(report(), { origin }));
    assert.equal(status, 200, String(origin));
    assert.equal(feedback.writes.length, 1);
  }
  for (const origin of ['https://elsewhere.example', 'http://buddylist.example', 'null']) {
    const { status, body, feedback } = await send(post(report(), { origin }));
    assert.equal(status, 403, origin);
    assert.deepEqual(body, { ok: false, error: 'forbidden' });
    assert.equal(feedback.writes.length, 0);
  }
});

// ---- how often --------------------------------------------------------------------------------

const from = (ip) => ({ headers: { 'cf-connecting-ip': ip } });

test('a sender who posts too often is turned away with the sentence for the form', async () => {
  const feedback = fakeStore();
  const limit = fakeLimit(1);
  const first = await send(post(report(), from('203.0.113.7')), feedback, limit);
  assert.equal(first.status, 200);

  const { status, body } = await send(post(report({ screenshot: picture() }), from('203.0.113.7')), feedback, limit);
  assert.equal(status, 429);
  assert.deepEqual(body, { ok: false, error: 'too-many', message: PROBLEMS['too-many'] });
  assert.equal(feedback.writes.length, 1);
});

/** A FORM_LIMIT that turns everyone away and remembers who it was asked about. */
function countedKeys() {
  return {
    keys: [],
    async limit({ key }) {
      this.keys.push(key);
      return { success: false };
    },
  };
}

test('only a post to the form is counted', async () => {
  const limit = countedKeys();
  const get = await send(new Request(`${SITE}/api/feedback`, { headers: { origin: SITE } }), undefined, limit);
  assert.equal(get.status, 405);
  const page = await send(new Request(`${SITE}/index.html`), undefined, limit);
  assert.equal(page.status, 404);
  assert.deepEqual(limit.keys, []);
});

test('the old waitlist address is not a form any more', async () => {
  const limit = countedKeys();
  const joined = new Request(`${SITE}/api/waitlist`, {
    method: 'POST',
    headers: { origin: SITE, 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'ada@example.com' }),
  });
  const { status, feedback } = await send(joined, undefined, limit);
  assert.equal(status, 404);
  assert.deepEqual(limit.keys, []);
  assert.equal(feedback.writes.length, 0);
});

// ---- routing ----------------------------------------------------------------------------------

test('feedback only takes POST', async () => {
  for (const method of ['GET', 'PUT', 'DELETE']) {
    const { status, body } = await send(new Request(`${SITE}/api/feedback`, { method, headers: { origin: SITE } }));
    assert.equal(status, 405, method);
    assert.deepEqual(body, { ok: false, error: 'method-not-allowed' });
  }
});

test('an address next to it is not found', async () => {
  for (const path of ['/api/feedback/', '/api/feedbacks', '/feedback', '/api/toString', '/api/constructor']) {
    const { status, feedback } = await send(post(report(), { path }));
    assert.equal(status, 404, path);
    assert.equal(feedback.writes.length, 0);
  }
});

// ---- from the app, all the way --------------------------------------------------------------

test('what the app sends is what the Worker keeps', async () => {
  const feedback = fakeStore();
  const fetch = (url, init) => worker.fetch(new Request(url, init), { FEEDBACK: feedback, FORM_LIMIT: fakeLimit() });
  const bytes = new Uint8Array([9, 8, 7]).buffer;
  await postFeedback(
    {
      kind: 'bug',
      message: 'It broke.',
      email: 'ada@example.com',
      system: 'buddylist 0.2.3, macOS 15.1, arm64',
      from: 'app',
      screenshot: { type: 'image/png', bytes },
    },
    { url: `${SITE}/api/feedback`, fetch }
  );

  const [shot, words] = feedback.writes;
  assert.deepEqual(new Uint8Array(shot.value), new Uint8Array([9, 8, 7]));
  const kept = JSON.parse(words.value);
  assert.deepEqual(kept, {
    kind: 'bug',
    message: 'It broke.',
    email: 'ada@example.com',
    system: 'buddylist 0.2.3, macOS 15.1, arm64',
    from: 'app',
    sentAt: kept.sentAt,
    screenshot: shot.key,
  });
});

test('what the Worker turns down reaches the app in the words of the form', async () => {
  // The rules are the same on both sides, so only a Worker with stricter ones gets to say no.
  const fetch = async () => Response.json({ ok: false, error: 'message-too-long' }, { status: 400 });
  await assert.rejects(postFeedback(report(), { url: `${SITE}/api/feedback`, fetch }), {
    message: PROBLEMS['message-too-long'],
  });
});

test('a sender who posts too often hears it in the app', async () => {
  const env = { FEEDBACK: fakeStore(), FORM_LIMIT: fakeLimit(0) };
  const fetch = (url, init) => worker.fetch(new Request(url, init), env);
  await assert.rejects(postFeedback(report(), { url: `${SITE}/api/feedback`, fetch }), {
    message: PROBLEMS['too-many'],
  });
  assert.equal(env.FEEDBACK.writes.length, 0);
});
