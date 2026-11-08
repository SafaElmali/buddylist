import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempDir } from './fixtures/temp-dir.js';

// Claude Code's own folder, for this file alone: the SDK reads real transcripts out of it.
const config = tempDir('cm-claude-');
process.env.CLAUDE_CONFIG_DIR = config;
const { elsewhere } = await import('../src/providers/claude/sessions.js');

const TERMINAL = '11111111-1111-4111-8111-111111111111';
const APP = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';

const project = () => fs.realpathSync(tempDir('cm-project-'));

/**
 * Writes a transcript the way Claude Code keeps one: a line per message, under the folder's name.
 * @param {string} cwd
 * @param {string} id
 * @param {string} entrypoint  what it was held in: "cli" for a terminal, "sdk-ts" for an app such as this one
 * @param {object[]} messages
 */
function keep(cwd, id, entrypoint, messages) {
  const dir = path.join(config, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  const uuid = (i) => `${id.slice(0, 8)}-0000-4000-8000-${String(i).padStart(12, '0')}`;
  const lines = messages.map((message, i) => ({
    sessionId: id,
    cwd,
    entrypoint,
    userType: 'external',
    version: '2.1.0',
    isSidechain: false,
    uuid: uuid(i),
    parentUuid: i ? uuid(i - 1) : null,
    timestamp: new Date(Date.UTC(2026, 9, 1, 10, i)).toISOString(),
    ...message,
  }));
  fs.writeFileSync(path.join(dir, `${id}.jsonl`), `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);
}

const talk = (question) => [
  { type: 'user', message: { role: 'user', content: question } },
  {
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [
        { type: 'text', text: 'On it.' },
        { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'npm test' } },
      ],
    },
  },
  {
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' }] },
  },
];

test('the conversations held in a folder’s terminal are listed, without the app’s own', async () => {
  const cwd = project();
  keep(cwd, TERMINAL, 'cli', talk('fix the\n  login bug'));
  keep(cwd, APP, 'sdk-ts', talk('asked in the app'));
  keep(project(), OTHER, 'cli', talk('another project'));

  const listed = await elsewhere.list(cwd);
  assert.deepEqual(
    listed.map(({ endedAt: _endedAt, ...conversation }) => conversation),
    [{ id: TERMINAL, cwd, startedAt: Date.UTC(2026, 9, 1, 10, 0), preview: 'fix the login bug' }]
  );
  assert.ok(listed[0].endedAt >= listed[0].startedAt);
  assert.equal(elsewhere.name, 'Claude Code');
  assert.deepEqual(await elsewhere.list(path.join(cwd, 'no-such-folder')), []);
});

test('every folder’s are listed at once, with the title and branch Claude Code has of each', async () => {
  const shop = project();
  const blog = project();
  const onBranch = (branch, messages) => messages.map((message) => ({ ...message, gitBranch: branch }));
  keep(shop, TERMINAL, 'cli', [
    ...onBranch('fix/double-charge', talk('payments charge twice')),
    { type: 'custom-title', customTitle: 'Stripe idempotency keys' },
  ]);
  keep(blog, OTHER, 'cli', onBranch('HEAD', talk('add an RSS feed')));
  keep(blog, APP, 'sdk-ts', talk('asked in the app'));

  const listed = (await elsewhere.listAll()).filter((c) => c.cwd === shop || c.cwd === blog);
  assert.deepEqual(
    listed
      .map(({ id, cwd, preview, title, branch }) => ({ id, cwd, preview, title, branch }))
      .sort((a, b) => a.cwd.localeCompare(b.cwd)),
    [
      {
        id: TERMINAL,
        cwd: shop,
        preview: 'payments charge twice',
        title: 'Stripe idempotency keys',
        branch: 'fix/double-charge',
      },
      // A detached HEAD is on no branch, and a conversation with no other name goes by its first message.
      { id: OTHER, cwd: blog, preview: 'add an RSS feed', title: undefined, branch: undefined },
    ].sort((a, b) => a.cwd.localeCompare(b.cwd)),
    'the app’s own are left out'
  );
  assert.ok(listed.every((c) => c.startedAt <= c.endedAt));
  assert.deepEqual(
    (await elsewhere.list(shop)).map((c) => [c.title, c.branch]),
    [['Stripe idempotency keys', 'fix/double-charge']],
    'a folder’s own listing has them too'
  );
});

test('one of them is read whole, and only through the folder it was held in', async () => {
  const cwd = project();
  const other = project();
  keep(cwd, TERMINAL, 'cli', talk('fix the login bug'));
  keep(other, OTHER, 'cli', talk('another project'));

  const read = await elsewhere.read(cwd, TERMINAL);
  assert.deepEqual([read.id, read.cwd], [TERMINAL, cwd]);
  assert.deepEqual(
    read.entries.map((e) => [e.kind, e.text ?? e.activity.command, e.output]),
    [
      ['user', 'fix the login bug', undefined],
      ['assistant', 'On it.', undefined],
      ['tool', 'npm test', 'ok'],
    ]
  );
  assert.equal(read.entries[0].time, Date.UTC(2026, 9, 1, 10, 0));

  assert.equal(await elsewhere.read(cwd, OTHER), null, 'another folder’s conversation');
  assert.equal(await elsewhere.read(cwd, '44444444-4444-4444-8444-444444444444'), null, 'one that is gone');
  for (const id of ['', 'nope', `../${TERMINAL}`, `${TERMINAL}.jsonl`]) {
    assert.equal(await elsewhere.read(cwd, id), null, JSON.stringify(id));
  }
});

test('one of them is copied to be continued, and stays as it was', async () => {
  const cwd = project();
  keep(cwd, TERMINAL, 'cli', talk('fix the login bug'));
  const kept = path.join(config, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'), `${TERMINAL}.jsonl`);
  const before = fs.readFileSync(kept, 'utf8');

  const copy = await elsewhere.fork(cwd, TERMINAL);
  assert.match(copy, /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
  assert.notEqual(copy, TERMINAL);
  assert.equal(fs.readFileSync(kept, 'utf8'), before, 'the one copied is not touched');
  const read = await elsewhere.read(cwd, copy);
  assert.deepEqual(
    read.entries.map((e) => [e.kind, e.text ?? e.activity.command]),
    (await elsewhere.read(cwd, TERMINAL)).entries.map((e) => [e.kind, e.text ?? e.activity.command]),
    'the copy has all that was said'
  );
  assert.deepEqual(
    (await elsewhere.list(cwd)).map((c) => c.id).sort(),
    [TERMINAL, copy].sort(),
    'Claude Code lists the copy too: the app leaves out its own'
  );

  await assert.rejects(elsewhere.fork(cwd, '44444444-4444-4444-8444-444444444444'), /no longer has/);
  await assert.rejects(elsewhere.fork(project(), TERMINAL), /no longer has/, 'only within its folder');
  await assert.rejects(elsewhere.fork(cwd, `../${TERMINAL}`), /no longer has/);
});

// Permissions don't hold back the root user, so there is nothing to see as root.
const asRoot = process.getuid?.() === 0;

test(
  'kept where they can’t be read, they are not taken for none: listing and reading say why',
  { skip: asRoot },
  async (t) => {
    const cwd = project();
    keep(cwd, TERMINAL, 'cli', talk('fix the login bug'));
    const projects = path.join(config, 'projects');
    const file = path.join(projects, cwd.replace(/[^a-zA-Z0-9]/g, '-'), `${TERMINAL}.jsonl`);

    fs.chmodSync(file, 0o000);
    t.after(() => fs.chmodSync(file, 0o644));
    await assert.rejects(elsewhere.read(cwd, TERMINAL), /EACCES/, 'the SDK would say it has none');
    assert.equal(await elsewhere.read(cwd, '44444444-4444-4444-8444-444444444444'), null, 'one that is gone is gone');
    fs.chmodSync(file, 0o644);

    fs.chmodSync(projects, 0o000);
    t.after(() => fs.chmodSync(projects, 0o755));
    await assert.rejects(elsewhere.list(cwd), /EACCES/);
    await assert.rejects(elsewhere.listAll(), /EACCES/);
    fs.chmodSync(projects, 0o755);
    assert.equal((await elsewhere.list(cwd)).length, 1);
  }
);

test('with nowhere they are kept, Claude Code has kept none', async () => {
  const before = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = path.join(config, 'never-used');
  try {
    assert.deepEqual(await elsewhere.listAll(), []);
    assert.deepEqual(await elsewhere.list(project()), []);
    assert.equal(await elsewhere.read(project(), TERMINAL), null);
  } finally {
    process.env.CLAUDE_CONFIG_DIR = before;
  }
});
