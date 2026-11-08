import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ARCHIVE_LIMIT, matches, snippet, summarize, toArchive } from '../src/main/storage/archive.js';
import { History } from '../src/main/storage/history.js';
import { MemoryHistory } from '../preview/memory-storage.js';
import { tempDir } from './fixtures/temp-dir.js';

const tmp = () => tempDir('cm-archive-');

/** Writes a short conversation whose entries are one second apart, starting at `at`. */
function talk(history, contactId, at, text = 'hello') {
  history.append(contactId, { kind: 'user', text, time: at });
  history.append(contactId, { kind: 'assistant', text: `re: ${text}`, time: at + 1000 });
}

// ---- the rules both kinds of storage follow --------------------------------------------------

test('a conversation is only worth keeping once somebody has said something', () => {
  const about = { id: 'a1', contactId: 'c1', cwd: '/work' };
  assert.equal(toArchive([], about), null);
  assert.equal(
    toArchive(
      [
        { id: '1', time: 5, kind: 'nudge', from: 'me' },
        { id: '2', time: 6, kind: 'notice', text: 'Signed in.' },
        { id: '3', time: 7, kind: 'tool', activity: { kind: 'command', command: 'ls' } },
      ],
      about
    ),
    null
  );
  const entries = [
    { id: '1', time: 5, kind: 'notice', text: 'Signed in.' },
    { id: '2', time: 9, kind: 'assistant', text: 'Hey!' },
  ];
  assert.deepEqual(toArchive(entries, about), {
    version: 1,
    id: 'a1',
    contactId: 'c1',
    cwd: '/work',
    startedAt: 5,
    endedAt: 9,
    entries,
  });
});

test('a summary previews the first thing you said, on one line', () => {
  const summary = summarize({
    id: 'a1',
    cwd: '/work',
    entries: [
      { id: '1', time: 10, kind: 'notice', text: 'Signed in.' },
      { id: '2', time: 20, kind: 'assistant', text: 'Hey!' },
      { id: '3', time: 30, kind: 'user', text: '  fix the\n\n  failing   tests ' },
      { id: '4', time: 40, kind: 'tool', activity: { kind: 'command', command: 'npm test' } },
      { id: '5', time: 50, kind: 'user', text: 'thanks' },
      { id: '6', time: 60, kind: 'result' },
    ],
  });
  assert.deepEqual(summary, {
    id: 'a1',
    cwd: '/work',
    startedAt: 10,
    endedAt: 60,
    preview: 'fix the failing tests',
    messages: 3,
  });
});

test('a summary falls back to the reply when you only sent pictures, and is cut to a line', () => {
  const pictures = summarize({
    id: 'a1',
    cwd: '/work',
    entries: [
      { id: '1', time: 1, kind: 'user', text: '', images: 2 },
      { id: '2', time: 2, kind: 'assistant', text: 'Nice **screenshot**' },
    ],
  });
  assert.equal(pictures.preview, 'Nice **screenshot**');
  const long = summarize({
    id: 'a2',
    cwd: '/work',
    entries: [{ id: '1', time: 1, kind: 'user', text: 'x'.repeat(500) }],
  });
  assert.equal(long.preview.length, 120);
  assert.deepEqual(summarize({ id: 'a3', cwd: '/work', entries: [] }), {
    id: 'a3',
    cwd: '/work',
    startedAt: null,
    endedAt: null,
    preview: '',
    messages: 0,
  });
});

test('search looks through messages, replies, notices and activity lines, in any case', () => {
  const entries = [
    { kind: 'user', text: 'Please fix the Login page' },
    { kind: 'assistant', text: 'The **Session** cookie was never set.' },
    { kind: 'tool', activity: { kind: 'command', command: 'npm run Test:e2e' } },
    { kind: 'tool', activity: { kind: 'edit', path: '/work/src/Auth.js', changes: [{ before: 'old', after: 'new' }] } },
    { kind: 'tool', activity: { kind: 'search', query: 'setCookie' } },
    { kind: 'tool', activity: { kind: 'web', url: 'https://example.com/Docs' } },
    { kind: 'tool', activity: { kind: 'skill', label: 'Review' } },
    { kind: 'tool', activity: { kind: 'todo', todos: [{ text: 'Write the Migration', status: 'pending' }] } },
    { kind: 'tool', toolId: 'legacy' },
    { kind: 'notice', text: 'Mode changed: Plan mode.' },
    { kind: 'error', text: 'Not Logged in' },
    { kind: 'nudge', from: 'me' },
  ];
  for (const query of [
    'login page',
    'LOGIN',
    'session** cookie',
    'test:e2e',
    'src/auth.js',
    'setcookie',
    'example.com/docs',
    'review',
    'migration',
    'plan mode',
    'not logged',
    '  login  ',
  ]) {
    assert.equal(matches(entries, query), true, query);
  }
  // Not what a file change replaced, nor anything that is not there.
  for (const query of ['old', 'logout', 'nudge', 'tool']) assert.equal(matches(entries, query), false, query);
});

test('an empty search matches every conversation', () => {
  assert.equal(matches([], ''), true);
  assert.equal(matches([{ kind: 'user', text: 'hi' }], '   '), true);
  assert.equal(matches([], 'hi'), false);
});

test('a search matches a conversation that has every word of it, each anywhere in it', () => {
  const entries = [
    { kind: 'user', text: 'Add the Stripe webhook' },
    { kind: 'assistant', text: 'Done. Retries need idempotency keys.' },
    { kind: 'tool', activity: { kind: 'command', command: 'npm run test:payments' } },
  ];
  assert.equal(matches(entries, 'stripe idempotency'), true, 'in two messages');
  assert.equal(matches(entries, 'IDEMPOTENCY  stripe'), true, 'in any order and letter case');
  assert.equal(matches(entries, 'stripe test:payments'), true, 'a message and an activity line');
  assert.equal(matches(entries, 'stripe refunds'), false, 'every word has to be there');
});

test('a "quoted phrase" has to be in the conversation as it is written', () => {
  const entries = [
    { kind: 'user', text: 'Add the Stripe webhook' },
    { kind: 'assistant', text: 'Stripe idempotency keys are in.' },
    { kind: 'user', text: 'Check the login\n  page' },
  ];
  assert.equal(matches(entries, '"stripe idempotency"'), true);
  assert.equal(matches(entries, '"add webhook"'), false, 'not with words in between');
  assert.equal(matches(entries, '"login page"'), true, 'across a line break');
  assert.equal(matches(entries, '"stripe idempotency" login'), true, 'beside a word');
});

test('what else a conversation is known by counts as said in it', () => {
  const entries = [{ kind: 'user', text: 'Fix the checkout' }];
  assert.equal(matches(entries, 'checkout codex'), false);
  assert.equal(matches(entries, 'checkout codex', ['Codex (shop)', 'shop']), true);
  assert.equal(matches([], 'shop', ['Codex (shop)']), true);
});

// ---- the line a search shows -----------------------------------------------------------------

test('a snippet is the line the text is first found in, on one line', () => {
  const entries = [
    { kind: 'notice', text: 'Signed in.' },
    { kind: 'user', text: '  Please fix\n\n  the   Login page ' },
    { kind: 'assistant', text: 'The **login** cookie was never set.\nShall I add it?' },
    { kind: 'nudge', from: 'me' },
  ];
  assert.equal(snippet(entries, 'LOGIN'), 'Please fix the Login page', 'the first match, in any letter case');
  assert.equal(snippet(entries, 'cookie'), 'The **login** cookie was never set. Shall I add it?');
  assert.equal(snippet(entries, '  cookie '), snippet(entries, 'cookie'), 'the query is trimmed');
  assert.equal(
    snippet(entries, 'the   login'),
    'Please fix the Login page',
    'found across the spaces it was typed with'
  );
  assert.equal(snippet(entries, 'signed in'), 'Signed in.', 'a notice is searched like a message');
  for (const s of [snippet(entries, 'login'), snippet(entries, 'cookie')]) assert.doesNotMatch(s, /\s\s|\n|^\s|\s$/);
});

test('a snippet is the first line with every word searched for, or else the first with any', () => {
  const entries = [
    { kind: 'user', text: 'Add the Stripe webhook' },
    { kind: 'assistant', text: 'Retries need idempotency keys.' },
    { kind: 'assistant', text: 'Stripe idempotency keys are in.' },
  ];
  assert.equal(snippet(entries, 'idempotency stripe'), 'Stripe idempotency keys are in.');
  const apart = entries.slice(0, 2);
  assert.equal(snippet(apart, 'idempotency stripe'), 'Add the Stripe webhook', 'no line has both');
  assert.equal(snippet(apart, '"stripe idempotency"'), '', 'nor the phrase');
  const long = [{ kind: 'assistant', text: `${'x'.repeat(300)} idempotency ${'y'.repeat(300)} stripe` }];
  assert.ok(
    snippet(long, 'stripe idempotency').startsWith(`…${'x'.repeat(19)} idempotency`),
    'cut at the first word in it'
  );
});

test('a snippet of an activity line is what the activity names', () => {
  const entries = [
    { kind: 'user', text: 'run them' },
    { kind: 'tool', activity: { kind: 'command', command: 'npm run test:auth' } },
    { kind: 'tool', activity: { kind: 'edit', path: '/work/src/Auth.js', changes: [{ before: 'old', after: 'new' }] } },
    { kind: 'tool', activity: { kind: 'todo', todos: [{ text: 'Write the migration' }, { text: 'Run it' }] } },
    { kind: 'tool', toolId: 'legacy' },
  ];
  assert.equal(snippet(entries, 'TEST:AUTH'), 'npm run test:auth');
  assert.equal(snippet(entries, 'src/auth'), '/work/src/Auth.js');
  assert.equal(snippet(entries, 'migration'), 'Write the migration Run it');
  assert.equal(snippet(entries, 'old'), '', 'what a file change replaced is not searched');
});

test('a conversation without the text, or a search for nothing, has no snippet', () => {
  const entries = [{ kind: 'user', text: 'hello there' }];
  assert.equal(snippet(entries, 'goodbye'), '');
  assert.equal(snippet(entries, ''), '');
  assert.equal(snippet(entries, '   '), '');
  assert.equal(snippet([], 'hello'), '');
  // Whatever matches() finds has a snippet, and nothing else does.
  for (const query of ['hello', 'HELLO THERE', 'o t', 'x']) {
    assert.equal(Boolean(snippet(entries, query)), matches(entries, query), query);
  }
});

test('a long line is cut to 120 characters around the match, with … where it was cut', () => {
  const said = (text) => [{ kind: 'assistant', text }];
  const fits = `needle ${'x'.repeat(113)}`;
  assert.equal(fits.length, 120);
  assert.equal(snippet(said(fits), 'needle'), fits, 'a line that fits is left whole');

  const atStart = snippet(said(`needle ${'x'.repeat(300)}`), 'needle');
  assert.equal(atStart, `needle ${'x'.repeat(112)}…`);

  const nearStart = snippet(said(`${'a'.repeat(19)} needle ${'b'.repeat(300)}`), 'needle');
  assert.equal(nearStart, `${'a'.repeat(19)} needle ${'b'.repeat(92)}…`, 'what little comes before is kept');

  const inTheMiddle = snippet(said(`${'a'.repeat(200)} needle ${'b'.repeat(200)}`), 'NEEDLE');
  assert.equal(inTheMiddle, `…${'a'.repeat(19)} needle ${'b'.repeat(91)}…`, 'cut at both ends');

  const atEnd = snippet(said(`${'x'.repeat(300)} needle`), 'needle');
  assert.equal(atEnd, `…${'x'.repeat(112)} needle`, 'the end of the line fills it');

  for (const s of [atStart, nearStart, inTheMiddle, atEnd]) assert.equal(s.length, 120);
  // A cut next to a space leaves no space beside the "…".
  const cutAtSpace = snippet(said(`${'a'.repeat(50)} ${'b'.repeat(18)} needle ${'c'.repeat(200)}`), 'needle');
  assert.ok(cutAtSpace.startsWith(`…${'b'.repeat(18)} needle c`));
});

// ---- the same behaviour on disk and in the browser preview's memory --------------------------

const stores = [
  ['History', () => new History(tmp())],
  ['MemoryHistory', () => new MemoryHistory()],
];

/** What an async generator yields, all of it. */
const all = async (generator) => {
  const items = [];
  for await (const item of generator) items.push(item);
  return items;
};

for (const [name, create] of stores) {
  test(`${name}: an archive scan can skip conversations by summary`, async () => {
    const history = create();
    talk(history, 'c1', 1000, 'first');
    history.archive('c1', { cwd: '/work' });
    talk(history, 'c1', 5000, 'second');
    history.archive('c1', { cwd: '/work' });
    const read = await all(history.eachArchived('c1', { include: (summary) => summary.preview === 'first' }));
    assert.deepEqual(
      read.map(([summary]) => summary.preview),
      ['first']
    );
    assert.equal((await all(history.eachArchived('c1'))).length, 2, 'filtering leaves the archive intact');
  });

  test(`${name}: every past conversation is read with its summary, newest first`, async () => {
    const history = create();
    assert.deepEqual(await all(history.eachArchived('c1')), [], 'none yet');
    talk(history, 'c1', 1000, 'first');
    history.archive('c1', { cwd: '/work' });
    talk(history, 'c1', 5000, 'second');
    history.archive('c1', { cwd: '/work' });
    talk(history, 'c2', 9000, 'someone else');
    history.archive('c2', { cwd: '/work' });

    const read = await all(history.eachArchived('c1'));
    assert.deepEqual(
      read.map(([summary, conversation]) => [summary.preview, conversation.entries[0].text]),
      [
        ['second', 'second'],
        ['first', 'first'],
      ]
    );
    for (const [summary, conversation] of read) {
      assert.deepEqual(
        summary,
        history.listArchived('c1').find((c) => c.id === summary.id)
      );
      assert.deepEqual(conversation, history.readArchived('c1', summary.id));
    }
  });

  test(`${name}: archiving moves the conversation out of the way and keeps it whole`, async () => {
    const history = create();
    talk(history, 'c1', 1000, 'first');
    const tool = history.append('c1', {
      kind: 'tool',
      toolId: 't1',
      activity: { kind: 'read', path: '/a' },
      time: 3000,
    });
    history.update('c1', tool.id, { output: 'done' });
    const entries = history.read('c1');

    const summary = history.archive('c1', { cwd: '/work/api' });

    assert.deepEqual(history.read('c1'), [], 'the next conversation starts empty');
    assert.deepEqual(summary, {
      id: summary.id,
      cwd: '/work/api',
      startedAt: 1000,
      endedAt: 3000,
      preview: 'first',
      messages: 2,
    });
    assert.deepEqual(history.listArchived('c1'), [summary]);
    assert.deepEqual(await all(history.eachArchived('c1')), [[summary, history.readArchived('c1', summary.id)]]);
    assert.deepEqual(history.readArchived('c1', summary.id), {
      version: 1,
      id: summary.id,
      contactId: 'c1',
      cwd: '/work/api',
      startedAt: 1000,
      endedAt: 3000,
      entries,
    });
  });

  test(`${name}: an archived conversation keeps the agent sessions in it, to be picked up again`, () => {
    const history = create();
    talk(history, 'c1', 1000, 'with guests');
    const summary = history.archive('c1', {
      cwd: '/work',
      sessionId: 's-host',
      guests: [
        { id: 'g1', permissionMode: 'plan', sessionId: 's-g1' },
        { id: 'g2', permissionMode: 'default', sessionId: null },
      ],
    });
    assert.equal(summary.sessionId, 's-host', 'the listing says it can be picked up');
    assert.deepEqual(history.listArchived('c1'), [summary]);
    const kept = history.readArchived('c1', summary.id);
    assert.equal(kept.sessionId, 's-host');
    assert.deepEqual(kept.guests, [{ id: 'g1', sessionId: 's-g1' }], 'only the guests that had a session');

    talk(history, 'c1', 5000, 'nobody had a session');
    const none = history.archive('c1', { cwd: '/work', sessionId: null, guests: [] });
    assert.equal('sessionId' in none, false);
    const plain = history.readArchived('c1', none.id);
    assert.deepEqual(['sessionId' in plain, 'guests' in plain], [false, false]);
  });

  test(`${name}: a past conversation begins again as the one going on, and is added to from there`, () => {
    const history = create();
    talk(history, 'c1', 1000, 'from before');
    const summary = history.archive('c1', { cwd: '/work', sessionId: 's-1' });
    talk(history, 'c1', 9000, 'going on');
    history.archive('c1', { cwd: '/work' });

    history.begin('c1', history.readArchived('c1', summary.id).entries);
    history.append('c1', { kind: 'user', text: 'and now?', time: 20_000 });
    assert.deepEqual(
      history.read('c1').map((e) => [e.kind, e.text]),
      [
        ['user', 'from before'],
        ['assistant', 're: from before'],
        ['user', 'and now?'],
      ]
    );

    history.begin('c1', []);
    assert.deepEqual(history.read('c1'), [], 'what was going on before is gone');
  });

  test(`${name}: a conversation nobody spoke in is dropped, not archived`, () => {
    const history = create();
    assert.equal(history.archive('c1', { cwd: '/work' }), null, 'nothing happened at all');
    history.append('c1', { kind: 'nudge', from: 'me' });
    history.append('c1', { kind: 'wink', from: 'me', file: 'knock.gif' });
    history.append('c1', { kind: 'notice', text: 'Signed in.' });
    assert.equal(history.archive('c1', { cwd: '/work' }), null);
    assert.deepEqual(history.listArchived('c1'), []);
    assert.deepEqual(history.read('c1'), [], 'and it is still cleared');
  });

  test(`${name}: a conversation the contact started is kept`, () => {
    const history = create();
    history.append('c1', { kind: 'assistant', text: 'Hey! Got a minute?', time: 500 });
    const summary = history.archive('c1', { cwd: '/work' });
    assert.equal(summary.preview, 'Hey! Got a minute?');
    assert.equal(summary.messages, 1);
  });

  test(`${name}: past conversations are listed newest first, each with its own folder and preview`, () => {
    const history = create();
    talk(history, 'c1', 1000, 'monday');
    const monday = history.archive('c1', { cwd: '/work/old' });
    talk(history, 'c1', 5000, 'tuesday');
    const tuesday = history.archive('c1', { cwd: '/work/new' });
    talk(history, 'c1', 9000, 'wednesday');
    const wednesday = history.archive('c1', { cwd: '/work/new' });

    assert.deepEqual(
      history.listArchived('c1').map((c) => [c.id, c.preview, c.cwd, c.startedAt, c.endedAt]),
      [
        [wednesday.id, 'wednesday', '/work/new', 9000, 10000],
        [tuesday.id, 'tuesday', '/work/new', 5000, 6000],
        [monday.id, 'monday', '/work/old', 1000, 2000],
      ]
    );
    assert.equal(new Set([monday.id, tuesday.id, wednesday.id]).size, 3, 'every conversation has its own id');
  });

  test(`${name}: each contact has its own archive`, () => {
    const history = create();
    talk(history, 'c1', 1000, 'mine');
    const mine = history.archive('c1', { cwd: '/one' });
    talk(history, 'c2', 2000, 'theirs');
    const theirs = history.archive('c2', { cwd: '/two' });
    assert.deepEqual(
      history.listArchived('c1').map((c) => c.preview),
      ['mine']
    );
    assert.deepEqual(
      history.listArchived('c2').map((c) => c.preview),
      ['theirs']
    );
    assert.equal(history.readArchived('c1', theirs.id), null, "another contact's conversation is not readable");
    assert.equal(history.readArchived('c2', mine.id), null);
    assert.deepEqual(history.listArchived('nobody'), []);
  });

  test(`${name}: the archive keeps the newest ${ARCHIVE_LIMIT} conversations`, () => {
    const history = create();
    const archived = [];
    for (let i = 0; i < ARCHIVE_LIMIT + 2; i += 1) {
      talk(history, 'c1', i * 10000, `chat ${i}`);
      archived.push(history.archive('c1', { cwd: '/work' }));
    }
    const listed = history.listArchived('c1');
    assert.equal(listed.length, ARCHIVE_LIMIT);
    assert.equal(listed[0].preview, `chat ${ARCHIVE_LIMIT + 1}`, 'the newest is first');
    assert.equal(listed.at(-1).preview, 'chat 2', 'the two oldest went');
    assert.equal(history.readArchived('c1', archived[0].id), null);
    assert.equal(history.readArchived('c1', archived[1].id), null);
    assert.equal(history.readArchived('c1', archived[2].id).entries[0].text, 'chat 2');
  });

  test(`${name}: reading a conversation that is not in the archive gives nothing`, () => {
    const history = create();
    assert.equal(history.readArchived('c1', 'nope'), null);
    talk(history, 'c1', 1000);
    history.archive('c1', { cwd: '/work' });
    assert.equal(history.readArchived('c1', 'nope'), null);
    assert.equal(history.readArchived('c1', undefined), null);
  });

  test(`${name}: one past conversation can be deleted`, () => {
    const history = create();
    talk(history, 'c1', 1000, 'keep');
    const keep = history.archive('c1', { cwd: '/work' });
    talk(history, 'c1', 5000, 'drop');
    const drop = history.archive('c1', { cwd: '/work' });
    talk(history, 'c1', 9000, 'now');

    history.deleteArchived('c1', drop.id);
    history.deleteArchived('c1', 'nope');

    assert.deepEqual(history.listArchived('c1'), [keep]);
    assert.equal(history.readArchived('c1', drop.id), null);
    assert.equal(history.readArchived('c1', keep.id).entries.length, 2);
    assert.equal(history.read('c1').length, 2, 'the conversation going on is untouched');
  });

  test(`${name}: deleting the whole archive keeps the conversation going on`, () => {
    const history = create();
    talk(history, 'c1', 1000, 'one');
    const one = history.archive('c1', { cwd: '/work' });
    talk(history, 'c1', 5000, 'two');
    history.archive('c1', { cwd: '/work' });
    talk(history, 'c2', 6000, 'other');
    history.archive('c2', { cwd: '/work' });
    talk(history, 'c1', 9000, 'now');

    history.clearArchive('c1');
    history.clearArchive('nobody');

    assert.deepEqual(history.listArchived('c1'), []);
    assert.equal(history.readArchived('c1', one.id), null);
    assert.equal(history.read('c1').length, 2);
    assert.equal(history.listArchived('c2').length, 1, "another contact's archive is untouched");
    // The archive still works afterwards.
    assert.equal(history.archive('c1', { cwd: '/work' }).preview, 'now');
    assert.equal(history.listArchived('c1').length, 1);
  });

  test(`${name}: purging a contact removes the conversation going on and the archive`, () => {
    const history = create();
    talk(history, 'c1', 1000, 'old');
    const old = history.archive('c1', { cwd: '/work' });
    talk(history, 'c1', 5000, 'now');
    talk(history, 'c2', 6000, 'other');
    history.archive('c2', { cwd: '/work' });

    history.purge('c1');
    history.purge('nobody');

    assert.deepEqual(history.read('c1'), []);
    assert.deepEqual(history.listArchived('c1'), []);
    assert.equal(history.readArchived('c1', old.id), null);
    assert.equal(history.listArchived('c2').length, 1);
  });
}

// ---- on disk ---------------------------------------------------------------------------------

test('an archived conversation is one self-describing file, with an index beside it', () => {
  const dir = tmp();
  const history = new History(dir);
  talk(history, 'c1', 1000, 'hi');
  const { id } = history.archive('c1', { cwd: '/work/api' });

  const folder = path.join(dir, 'archive', 'c1');
  assert.deepEqual(fs.readdirSync(folder).sort(), [`${id}.json`, 'index.json'].sort());
  assert.equal(fs.existsSync(path.join(dir, 'c1.json')), false, 'the live file is gone');
  const saved = JSON.parse(fs.readFileSync(path.join(folder, `${id}.json`), 'utf8'));
  assert.deepEqual(Object.keys(saved), ['version', 'id', 'contactId', 'cwd', 'startedAt', 'endedAt', 'entries']);
  assert.deepEqual(
    [saved.version, saved.id, saved.contactId, saved.cwd, saved.startedAt, saved.endedAt],
    [1, id, 'c1', '/work/api', 1000, 2000]
  );
  assert.deepEqual(
    saved.entries.map((e) => [e.kind, e.text]),
    [
      ['user', 'hi'],
      ['assistant', 're: hi'],
    ]
  );
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(folder, 'index.json'), 'utf8')), [
    { id, cwd: '/work/api', startedAt: 1000, endedAt: 2000, preview: 'hi', messages: 2 },
  ]);
});

test('a conversation picked up again is written at once, and still there after a restart', () => {
  const dir = tmp();
  const history = new History(dir);
  talk(history, 'c1', 1000, 'picked up');
  const entries = history.read('c1');
  history.archive('c1', { cwd: '/work' });
  history.begin('c1', entries);
  assert.deepEqual(new History(dir).read('c1'), entries);
  assert.ok(history.lastActive('c1') >= Date.now() - 1000, 'it was active just now');
});

test('the archive is still there after a restart', () => {
  const dir = tmp();
  const history = new History(dir);
  talk(history, 'c1', 1000, 'before');
  const summary = history.archive('c1', { cwd: '/work' });
  const reopened = new History(dir);
  assert.deepEqual(reopened.listArchived('c1'), [summary]);
  assert.equal(reopened.readArchived('c1', summary.id).entries.length, 2);
});

test('listing reads the index, not every conversation', () => {
  const dir = tmp();
  const history = new History(dir);
  talk(history, 'c1', 1000, 'hi');
  const { id } = history.archive('c1', { cwd: '/work' });
  // With the conversation unreadable, only the index can answer.
  fs.writeFileSync(path.join(dir, 'archive', 'c1', `${id}.json`), 'not json');
  assert.deepEqual(
    history.listArchived('c1').map((c) => c.preview),
    ['hi']
  );
  assert.equal(history.readArchived('c1', id), null);
});

test('a past conversation that can no longer be read is left out of the ones read in turn', async () => {
  const dir = tmp();
  const history = new History(dir);
  talk(history, 'c1', 1000, 'broken');
  const { id } = history.archive('c1', { cwd: '/work' });
  talk(history, 'c1', 5000, 'fine');
  history.archive('c1', { cwd: '/work' });
  fs.writeFileSync(path.join(dir, 'archive', 'c1', `${id}.json`), 'not json');
  assert.deepEqual(
    (await all(history.eachArchived('c1'))).map(([summary]) => summary.preview),
    ['fine']
  );
});

test('a lost or broken index is rebuilt from the conversations', () => {
  const dir = tmp();
  const history = new History(dir);
  talk(history, 'c1', 1000, 'older');
  history.archive('c1', { cwd: '/work' });
  talk(history, 'c1', 5000, 'newer');
  history.archive('c1', { cwd: '/work' });
  const listed = history.listArchived('c1');
  const index = path.join(dir, 'archive', 'c1', 'index.json');

  fs.rmSync(index);
  assert.deepEqual(history.listArchived('c1'), listed);
  assert.deepEqual(JSON.parse(fs.readFileSync(index, 'utf8')), listed, 'and written back');

  fs.writeFileSync(index, '{ broken');
  // A file that is not a conversation is left out.
  fs.writeFileSync(path.join(dir, 'archive', 'c1', 'stray.json'), '{"hello":"world"}');
  fs.writeFileSync(path.join(dir, 'archive', 'c1', 'notes.txt'), 'hi');
  assert.deepEqual(history.listArchived('c1'), listed);

  // Archiving with the index gone lists the new conversation once.
  fs.rmSync(index);
  talk(history, 'c1', 9000, 'newest');
  history.archive('c1', { cwd: '/work' });
  assert.deepEqual(
    history.listArchived('c1').map((c) => c.preview),
    ['newest', 'newer', 'older']
  );
});

test('conversations that fall off the end of the archive are deleted from disk', () => {
  const dir = tmp();
  const history = new History(dir);
  for (let i = 0; i < ARCHIVE_LIMIT + 3; i += 1) {
    talk(history, 'c1', i * 10000, `chat ${i}`);
    history.archive('c1', { cwd: '/work' });
  }
  assert.equal(fs.readdirSync(path.join(dir, 'archive', 'c1')).length, ARCHIVE_LIMIT + 1, 'the limit, plus the index');
});

test('deleting removes the files, and purging leaves nothing of the contact behind', () => {
  const dir = tmp();
  const history = new History(dir);
  talk(history, 'c1', 1000, 'one');
  const one = history.archive('c1', { cwd: '/work' });
  talk(history, 'c1', 5000, 'two');
  const two = history.archive('c1', { cwd: '/work' });
  talk(history, 'c1', 9000, 'now');
  talk(history, 'c2', 9000, 'other');
  const folder = path.join(dir, 'archive', 'c1');

  history.deleteArchived('c1', one.id);
  assert.deepEqual(fs.readdirSync(folder).sort(), [`${two.id}.json`, 'index.json'].sort());

  history.purge('c1');
  assert.equal(fs.existsSync(folder), false);
  assert.equal(fs.existsSync(path.join(dir, 'c1.json')), false);
  assert.equal(fs.existsSync(path.join(dir, 'c2.json')), true);
});

test('an id that is not in the archive cannot reach other files', () => {
  const dir = tmp();
  const history = new History(dir);
  talk(history, 'c1', 1000, 'archived');
  history.archive('c1', { cwd: '/work' });
  talk(history, 'c1', 5000, 'live');
  talk(history, 'c2', 5000, 'other');

  // history/archive/c1/../../c2.json is another contact's live conversation.
  assert.equal(history.readArchived('c1', '../../c2'), null);
  history.deleteArchived('c1', '../../c2');
  history.deleteArchived('c1', '../../c1');
  history.deleteArchived('c1', 'index');
  assert.equal(history.read('c2').length, 2);
  assert.equal(history.read('c1').length, 2);
  assert.equal(history.listArchived('c1').length, 1);
});
