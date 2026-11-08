import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codexElsewhere } from '../src/providers/codex/sessions.js';
import { toEntries } from '../src/providers/codex/transcript.js';

const ID = '0199cc00-0000-7000-8000-000000000001';
const COPY = '0199cc00-0000-7000-8000-000000000002';
const cwd = '/projects/shop';
const thread = (patch = {}) => ({
  id: ID,
  cwd,
  createdAt: 100,
  updatedAt: 200,
  preview: 'Fix\n checkout',
  name: 'Keyboard checkout',
  gitInfo: { branch: 'feat/keyboard' },
  source: 'cli',
  originator: 'codex-tui',
  ephemeral: false,
  turns: [],
  ...patch,
});
const turn = (id, items, patch = {}) => ({
  id,
  items,
  status: 'completed',
  startedAt: 110,
  itemsView: 'full',
  ...patch,
});
const message = (id, text) => ({ type: 'agentMessage', id, text });

function server({ pages = [{ data: [thread()], nextCursor: null }], read = thread(), request } = {}) {
  const calls = [];
  let closed = 0;
  let hooks;
  const connect = (handlers) => {
    hooks = handlers;
    return {
      request: async (method, params) => {
        calls.push({ method, params });
        const override = await request?.(method, params, handlers);
        if (override !== undefined) return override;
        if (method === 'thread/list') return pages[Number(params.cursor || 0)];
        if (method === 'thread/read') return { thread: read };
        if (method === 'config/read') return { config: { mcp_servers: { example: {} } } };
        if (method === 'thread/fork') return { thread: thread({ id: COPY }) };
        return {};
      },
      notify: (method) => calls.push({ method }),
      close: () => closed++,
    };
  };
  const source = codexElsewhere({ command: () => '/custom/codex', connect, patienceMs: 100 });
  return {
    source,
    calls,
    get closed() {
      return closed;
    },
    get hooks() {
      return hooks;
    },
  };
}

test('Codex lists every page, converts seconds and names, and filters app, ephemeral, archived and helper threads', async () => {
  const fake = server({
    pages: [
      {
        data: [
          thread({ id: 'ours', originator: 'buddylist' }),
          thread({ id: 'quick', ephemeral: true }),
          thread({ id: 'archived', archived: true }),
          thread({ id: 'child', source: { subAgent: 'review' } }),
          thread({ id: 'other-child', parentThreadId: ID }),
        ],
        nextCursor: '1',
      },
      {
        data: [thread(), thread({ id: COPY, cwd: '/projects/blog', name: '', gitInfo: { branch: 'HEAD' } }), thread()],
        nextCursor: null,
      },
    ],
  });
  assert.deepEqual(await fake.source.listAll(), [
    {
      id: ID,
      cwd,
      startedAt: 100000,
      endedAt: 200000,
      preview: 'Fix checkout',
      title: 'Keyboard checkout',
      branch: 'feat/keyboard',
    },
    { id: COPY, cwd: '/projects/blog', startedAt: 100000, endedAt: 200000, preview: 'Fix checkout' },
  ]);
  assert.equal(fake.hooks.command, '/custom/codex');
  const lists = fake.calls.filter((c) => c.method === 'thread/list');
  assert.equal(lists.length, 2);
  assert.equal(lists[0].params.archived, false);
  assert.deepEqual(lists[0].params.modelProviders, []);
  assert.equal(lists[0].params.sourceKinds, undefined, 'use Codex’s interactive history, not programmatic exec runs');
  assert.equal(lists[1].params.cursor, '1');
  assert.equal(fake.closed, 1);
  assert.ok(!fake.calls.some((c) => /thread\/(start|resume|fork)|turn\/start/.test(c.method)));
});

test('folder listings are scoped even when an old server ignores the cwd filter; empty paths start nothing', async () => {
  const fake = server({ pages: [{ data: [thread(), thread({ id: COPY, cwd: '/other' })] }] });
  assert.deepEqual(await fake.source.list(''), []);
  assert.equal(fake.calls.length, 0);
  assert.equal((await fake.source.list(cwd)).length, 1);
  assert.equal(fake.calls.find((c) => c.method === 'thread/list').params.cwd, cwd);
});

test('listing caps the newest 100 per folder and 500 overall, after filtering', async () => {
  const data = Array.from({ length: 600 }, (_, i) => thread({ id: `thread-${i}` }));
  const fake = server({
    pages: Array.from({ length: 6 }, (_, i) => ({
      data: data.slice(i * 100, (i + 1) * 100),
      nextCursor: i < 5 ? String(i + 1) : null,
    })),
  });
  assert.equal((await fake.source.list(cwd)).length, 100);
  assert.equal((await fake.source.listAll()).length, 500);
});

test('read is read-only and checks folder, active membership and ids before loading a legacy transcript', async () => {
  const fake = server({ read: thread({ turns: [turn('t1', [message('m1', 'Done.')])] }) });
  assert.equal(await fake.source.read(cwd, '../secrets'), null);
  assert.equal(fake.calls.length, 0);
  assert.equal(await fake.source.read('/other', ID), null);
  const full = await fake.source.read(cwd, ID);
  assert.equal(full.entries[0].text, 'Done.');
  assert.equal(full.cwd, cwd);
  assert.ok(!fake.calls.some((c) => /thread\/(resume|fork|start)|turn\/start/.test(c.method)));
  assert.equal(
    await server({ pages: [{ data: [] }] }).source.read(cwd, ID),
    null,
    'an archived or deleted thread is absent'
  );
  assert.equal(
    (await server({ read: thread({ cwd: '/old-desktop-folder' }) }).source.read(cwd, ID)).cwd,
    cwd,
    'the active listing owns the folder association, even if the rollout retains an old cwd'
  );
});

test('paginated history requests full turns newest first, then renders them chronologically', async () => {
  const fake = server({
    read: thread({ historyMode: 'paginated' }),
    request: (method, params) => {
      if (method !== 'thread/turns/list') return;
      assert.equal(params.itemsView, 'full');
      assert.equal(params.sortDirection, 'desc');
      return params.cursor
        ? { data: [turn('old', [message('m1', 'First')])], nextCursor: null }
        : { data: [turn('new', [message('m2', 'Second')])], nextCursor: 'older' };
    },
  });
  assert.deepEqual(
    (await fake.source.read(cwd, ID)).entries.map((e) => e.text),
    ['First', 'Second']
  );
  assert.equal(fake.calls.filter((c) => c.method === 'thread/read').length, 1);
});

test('long paginated transcripts stop at the display limit and explain omitted messages', async () => {
  const fake = server({
    read: thread({ historyMode: 'paginated' }),
    request: (method) => {
      if (method === 'thread/turns/list')
        return {
          data: [
            turn(
              'many',
              Array.from({ length: 2001 }, (_, i) => message(`m${i}`, `Reply ${i}`))
            ),
          ],
          nextCursor: 'older',
        };
    },
  });
  const { entries } = await fake.source.read(cwd, ID);
  assert.equal(entries.length, 2001);
  assert.equal(entries[0].kind, 'notice');
  assert.equal(entries[1].text, 'Reply 1');
  assert.equal(fake.calls.filter((c) => c.method === 'thread/turns/list').length, 1);
});

test('Continue uses a persistent fork, no turn or resume, and rejects a same-id response', async () => {
  const fake = server();
  assert.equal(await fake.source.fork(cwd, ID), COPY);
  const params = fake.calls.find((c) => c.method === 'thread/fork').params;
  assert.equal(params.threadId, ID);
  assert.equal(params.cwd, cwd);
  assert.equal(params.ephemeral, false);
  assert.equal(params.excludeTurns, true);
  assert.equal(params.sandbox, 'read-only');
  assert.deepEqual(params.config, { mcp_servers: { example: { enabled: false } } });
  assert.ok(!fake.calls.some((c) => ['thread/start', 'thread/resume', 'turn/start'].includes(c.method)));
  assert.equal(fake.closed, 1);
  const same = server({ request: (method) => (method === 'thread/fork' ? { thread: thread() } : undefined) });
  await assert.rejects(same.source.fork(cwd, ID), /separate copy/);
  await assert.rejects(fake.source.fork('/wrong', ID), /no longer has/);
});

test('unsupported and missing CLIs, disconnects, repeated cursors and timeouts explain the failure and close', async () => {
  for (const [request, reason] of [
    [
      () => {
        throw Object.assign(new Error('Method not found'), { code: -32601 });
      },
      /Update it/,
    ],
    [
      () => {
        throw new Error('Couldn’t find the Codex CLI');
      },
      /Couldn’t find/,
    ],
    [
      (_method, _params, hooks) => {
        hooks.onClose(new Error('Disconnected'));
        return new Promise(() => {});
      },
      /Disconnected/,
    ],
    [() => new Promise(() => {}), /took too long/],
  ]) {
    const fake = server({ request });
    await assert.rejects(fake.source.listAll(), reason);
    assert.equal(fake.closed, 1);
  }
  const looping = server({
    pages: [
      { data: [], nextCursor: '1' },
      { data: [], nextCursor: '1' },
    ],
  });
  await assert.rejects(looping.source.listAll(), /repeated a page/);
  assert.equal(looping.closed, 1);
});

test('item mapping shares live activities, preserves untrusted text, skips internal reasoning and keeps stable ids', () => {
  const items = [
    {
      type: 'userMessage',
      id: 'u',
      content: [
        { type: 'text', text: '<script>unsafe()</script>' },
        { type: 'localImage', path: '/private/picture.png' },
      ],
    },
    { type: 'reasoning', id: 'r', content: ['internal'] },
    { type: 'hookPrompt', id: 'h', fragments: ['internal'] },
    message('a', '**Done** <img src=x onerror=unsafe()>'),
    { type: 'commandExecution', id: 'c', command: 'npm test', status: 'failed', aggregatedOutput: 'Failed' },
    {
      type: 'fileChange',
      id: 'f',
      status: 'completed',
      changes: [{ path: '/shop/cart.js', kind: { type: 'update' }, diff: '@@ -1 +1 @@\n-old\n+new\n' }],
    },
    {
      type: 'mcpToolCall',
      id: 'm',
      server: 'docs',
      tool: 'lookup',
      status: 'completed',
      result: { content: [{ type: 'text', text: 'Found' }] },
    },
    { type: 'webSearch', id: 'w', query: 'keyboard navigation' },
    { type: 'contextCompaction', id: 'cc' },
  ];
  const t = thread({ turns: [turn('t', items)] });
  const entries = toEntries(t);
  assert.deepEqual(
    entries.map((e) => e.kind),
    ['user', 'assistant', 'tool', 'tool', 'tool', 'tool', 'notice']
  );
  assert.equal(entries[0].text, '<script>unsafe()</script>');
  assert.equal(entries[0].images, 1);
  assert.equal(entries[0].pictures, undefined);
  assert.equal(entries[1].text, items[3].text);
  assert.equal(entries[2].isError, true);
  assert.equal(entries[2].output, 'Failed');
  assert.equal(entries[3].activity.kind, 'edit');
  assert.equal(entries[3].activity.changes[0].after, 'new');
  assert.equal(entries[4].output, 'Found');
  assert.equal(entries[5].activity.kind, 'web');
  assert.equal(entries[0].time, 110000);
  assert.deepEqual(entries, toEntries(t));
  const newest = toEntries(t, { limit: 2 });
  assert.equal(newest.length, 3);
  assert.equal(newest[0].text, 'Earlier messages are not shown.');
});
