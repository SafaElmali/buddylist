import { test } from 'node:test';
import assert from 'node:assert/strict';
import { completionAt } from '../src/renderer/chat/completion-menu.js';
import { completeMention, dropMention, mentionAt, outputAt } from '../src/renderer/chat/mention-completion.js';
import { mentions } from '../src/shared/mentions.js';

const claude = { id: 'c1', name: 'Claude' };
const codex = { id: 'c2', name: 'Codex' };
const api = { id: 'c3', name: 'Claude (api)' };
const people = [claude, codex];
/** The names offered with the caret at the end of `text`, or at `|`. */
const offered = (typed, among = people) => {
  const caret = typed.includes('|') ? typed.indexOf('|') : typed.length;
  return mentionAt(typed.replace('|', ''), caret, among)?.matches.map((p) => p.name) ?? null;
};

test('an @ offers everyone, and what follows it narrows the names down', () => {
  assert.deepEqual(offered('@'), ['Claude', 'Codex']);
  assert.deepEqual(offered('hey @'), ['Claude', 'Codex']);
  assert.deepEqual(offered('@c'), ['Claude', 'Codex']);
  assert.deepEqual(offered('@co'), ['Codex']);
  assert.deepEqual(offered('@CL'), ['Claude'], 'in any letter case');
  assert.deepEqual(offered('line one\n@cod'), ['Codex']);
  assert.equal(offered('@x'), null);
  assert.equal(offered('no mention here'), null);
  assert.equal(offered(''), null);
});

test('it is the mention the caret is in that is completed', () => {
  assert.deepEqual(offered('@Codex and @cl'), ['Claude']);
  assert.deepEqual(offered('@co| and @Claude'), ['Codex']);
  assert.equal(offered('|@co'), null, 'the caret is in front of it');
  assert.equal(offered('@Codex wh'), null, 'the mention is done, and what follows is the message');
  assert.equal(offered('@co\nmore'), null);
  assert.equal(mentionAt('@co', 3, people).at, 0);
  assert.equal(mentionAt('hi @co', 6, people).at, 3);
});

test('a name typed in full has nothing left to complete', () => {
  assert.equal(offered('@Codex'), null, 'so Enter sends the message');
  assert.equal(offered('@codex'), null);
  assert.deepEqual(offered('@Claude', [claude, api, codex]), ['Claude', 'Claude (api)'], 'unless it starts another');
  assert.deepEqual(offered('@claude', [api, claude]), ['Claude', 'Claude (api)'], 'the one typed to its end first');
  assert.deepEqual(offered('@Claude (', [claude, api, codex]), ['Claude (api)']);
  assert.equal(offered('@Claude (api)', [claude, api, codex]), null);
});

test('what is not a mention is not completed', () => {
  assert.equal(offered('me@c'), null, 'an address');
  assert.equal(offered('@CLAUDE.md'), null, 'a file you are sending');
  assert.equal(offered('@claude/no'), null);
  assert.equal(offered('/review @co'), null, 'a slash command is the host’s alone');
  assert.equal(offered('@c', [{ id: 'x', name: '  ' }]), null, 'nobody goes by an empty name');
});

test('completing writes the name out, with a space after it', () => {
  assert.deepEqual(completeMention('@co', 0, 3, codex), { text: '@Codex ', caret: 7 });
  assert.deepEqual(completeMention('hey @c', 4, 6, claude), { text: 'hey @Claude ', caret: 12 });
  assert.deepEqual(completeMention('@ please review', 0, 1, codex), { text: '@Codex please review', caret: 7 });
  assert.deepEqual(completeMention('@cl, what do you think?', 0, 3, claude), {
    text: '@Claude , what do you think?',
    caret: 8,
  });
  assert.deepEqual(completeMention('@cla', 0, 4, { id: 'c3', name: ' Claude (api) ' }), {
    text: '@Claude (api) ',
    caret: 14,
  });
});

test('a completed mention is a mention when it is sent, whatever is typed next', () => {
  for (const [typed, person, among] of [
    ['@co', codex, people],
    ['ask @c', claude, people],
    ['@claude (', api, [claude, api, codex]],
    ['@Cl', claude, [claude, api, codex]],
  ]) {
    const caret = typed.length;
    const { at } = mentionAt(typed, caret, among);
    const done = completeMention(typed, at, caret, person);
    assert.deepEqual(mentions(done.text, among), [person.id], typed);
    const more = `${done.text.slice(0, done.caret)}md is a file${done.text.slice(done.caret)}`;
    assert.deepEqual(mentions(more, among), [person.id], `${typed}, with more typed after it`);
  }
});

// ---- the terminals beside the conversation ------------------------------------------------------

const terminal = { kind: 'terminal', id: 't1', name: 'Terminal' };
const second = { kind: 'terminal', id: 't2', name: 'Terminal 2' };
const dev = { kind: 'script', id: 'run', name: 'dev' };
const outputs = [terminal, second, dev];
/** The terminals offered with the caret at the end of `typed`. */
const terminalsFor = (typed, among = outputs) =>
  outputAt(typed, typed.length, among)?.matches.map(({ name }) => name) ?? null;

test('an @ offers the terminals too, and what follows it narrows them down by name, even one typed in full', () => {
  assert.deepEqual(terminalsFor('@'), ['Terminal', 'Terminal 2', 'dev']);
  assert.deepEqual(terminalsFor('why this @t'), ['Terminal', 'Terminal 2']);
  assert.deepEqual(terminalsFor('@terminal 2'), ['Terminal 2'], 'a name with a space in it');
  assert.deepEqual(terminalsFor('@DEV'), ['dev'], 'picking it is the only way its output goes with the message');
  assert.equal(terminalsFor('@x'), null);
  assert.equal(terminalsFor('me@t'), null, 'an address');
  assert.equal(terminalsFor('/review @t'), null, 'a slash command is the host’s alone');
  assert.equal(terminalsFor('@t\n'), null);
  assert.equal(terminalsFor('@', []), null, 'no terminal open: nothing to offer');
});

test('picking a terminal takes its @ out of the box, and the words around it stay', () => {
  assert.deepEqual(dropMention('@ter', 0, 4), { text: '', caret: 0 });
  assert.deepEqual(dropMention('why this @ter', 9, 13), { text: 'why this ', caret: 9 });
  assert.deepEqual(dropMention('see @ter now', 4, 8), { text: 'see now', caret: 4 });
  assert.deepEqual(dropMention('@ter now', 0, 4), { text: 'now', caret: 0 });
  assert.deepEqual(dropMention('(@ter)', 1, 5), { text: '()', caret: 1 });
});

/** A conversation window's context, with these agents in it. */
const windowWith = (participants) => ({
  contact: { id: participants[0].id, status: 'online' },
  contacts: [],
  participants: participants.map((p) => ({ ...p, state: 'idle', paused: false })),
  provider: { commonCommands: [] },
  commands: [],
});

test('in the @ list the terminals have a place of their own, after the agents', () => {
  const list = completionAt('@', 1, windowWith(people), true, { outputs });
  assert.deepEqual(
    list.items.map((item) => (item.separator ? '—' : `${item.label}${item.hint ? ` (${item.hint})` : ''}`)),
    ['Claude', 'Codex', '—', 'Terminal (Terminal)', 'Terminal 2 (Terminal)', 'dev (Script)']
  );
  assert.equal(list.from, 0);
  assert.notEqual(completionAt('@', 1, windowWith(people), true, { outputs: [] }).key, list.key, 'a new list');
  // With one agent, the terminals are the list, as files are without them.
  const solo = completionAt('ask @t', 6, windowWith([claude]), true, { outputs });
  assert.deepEqual(
    solo.items.map(({ label }) => label),
    ['Terminal', 'Terminal 2']
  );
  assert.equal(solo.from, 4);
  assert.equal(completionAt('@', 1, windowWith([claude]), true, { outputs: [] }), null, 'no terminal open');
});

test('picking a terminal from the list writes no name: its @ goes, and it goes in the box as a card', () => {
  const picked = [];
  const [item] = completionAt('look at @d', 10, windowWith([claude]), true, {
    outputs,
    pick: (card) => picked.push(card),
  }).items;
  assert.deepEqual(item.complete('look at @d', 10), { text: 'look at ', caret: 8 });
  item.picked();
  assert.deepEqual(picked, [dev]);
});
