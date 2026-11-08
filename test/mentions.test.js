import { test } from 'node:test';
import assert from 'node:assert/strict';
import { levels, mentionRanges, mentions, sameName } from '../src/shared/mentions.js';
import { outputBlock } from '../src/shared/terminal-mentions.js';

const claude = { id: 'c1', name: 'Claude' };
const codex = { id: 'c2', name: 'Codex' };
const people = [claude, codex];

test('an @ in front of a name mentions them, in any letter case', () => {
  assert.deepEqual(mentions('@Codex please review', people), ['c2']);
  assert.deepEqual(mentions('what do you think, @claude?', people), ['c1']);
  assert.deepEqual(mentions('@CODEX', people), ['c2']);
  assert.deepEqual(mentions('nobody is named here', people), []);
  assert.deepEqual(mentions('Claude and Codex, without the @', people), []);
  assert.deepEqual(mentions('', people), []);
});

test('several mentions come back in the order they are made, each once', () => {
  assert.deepEqual(mentions('@Codex first, then @Claude', people), ['c2', 'c1']);
  assert.deepEqual(mentions('@Claude @Codex @Claude again', people), ['c1', 'c2']);
});

test('punctuation after a name still makes a mention', () => {
  for (const text of [
    '@Codex.',
    '@Codex, over to you',
    '@Codex: look',
    '@Codex!',
    '@Codex?',
    "@Codex's turn",
    '(@Codex)',
    '"@Codex"',
    '@Codex… well',
    '@Codex\nnext line',
    'thanks @Codex',
  ]) {
    assert.deepEqual(mentions(text, people), ['c2'], text);
  }
});

test('a file sent with Send Files is not a mention of someone with that name', () => {
  for (const text of [
    '@CLAUDE.md',
    'read @CLAUDE.md first',
    '@claude/notes.txt',
    '@codex-setup.sh',
    '@codex_notes',
    '@Claude.config.json and @codex/README.md',
    '@claude\\notes.txt',
    '@"claude notes.txt"',
    '@/Users/you/claude/codex.md',
    '@Claude2',
    '@Codexes',
  ]) {
    assert.deepEqual(mentions(text, people), [], text);
  }
  assert.deepEqual(mentions('@Claude read @CLAUDE.md, then @codex-setup.sh. @Codex', people), ['c1', 'c2']);
});

test('an address is not a mention', () => {
  assert.deepEqual(mentions('write to me@claude.ai or support@codex', people), []);
  assert.deepEqual(mentions('a@Claude', people), []);
});

test('a name in a quote is in what someone else said: it mentions nobody', () => {
  const reply = '> @Codex please review the login page\n\nNot yet, @Claude: first the tests.';
  assert.deepEqual(mentions(reply, people), ['c1']);
  assert.deepEqual(mentions('> Ask @Codex\n>\n> or @Claude\n\nok', people), []);
  assert.deepEqual(mentions('  > @Codex, indented as Markdown lets a quote be', people), []);
  assert.deepEqual(mentions('4 > 3, @Codex', people), ['c2'], 'a ">" in a line is no quote');
  assert.deepEqual(
    mentionRanges(reply, people).map(({ start, end }) => reply.slice(start, end)),
    ['@Claude'],
    'only the mention under the quote is marked'
  );
  assert.deepEqual(levels('> @Claude(high) you said\n@Codex(low)', people), [{ id: 'c2', effort: 'low' }]);
});

test('the longest name wins, so one name can start with another', () => {
  const api = { id: 'c3', name: 'Claude (api)' };
  const everyone = [claude, api, codex];
  assert.deepEqual(mentions('@Claude (api) take this one', everyone), ['c3']);
  assert.deepEqual(mentions('@Claude take this one', everyone), ['c1']);
  assert.deepEqual(mentions('@claude (API), then @Claude.', everyone), ['c3', 'c1']);
  // "Claude (apiary)" is nobody: what is left is a mention of Claude.
  assert.deepEqual(mentions('@Claude (apiary)', everyone), ['c1']);
});

test('names with spaces and brackets are matched whole', () => {
  const website = { id: 'w', name: 'Claude (website)' };
  assert.deepEqual(mentions('@Claude (website): your turn', [website, codex]), ['w']);
  assert.deepEqual(mentions('@Claude your turn', [website, codex]), [], 'half a name is nobody');
});

test('someone without a name cannot be mentioned', () => {
  assert.deepEqual(mentions('@ you there, @Codex', [{ id: 'x', name: '  ' }, codex]), ['c2']);
});

test('every mention is found where it is written, from its @ to the end of the name', () => {
  const text = 'hey @codex, ask @Claude and then @Codex again';
  const ranges = mentionRanges(text, people);
  assert.deepEqual(
    ranges.map(({ start, end, id }) => [text.slice(start, end), id]),
    [
      ['@codex', 'c2'],
      ['@Claude', 'c1'],
      ['@Codex', 'c2'],
    ],
    'each time it is made, as it was typed'
  );
  assert.deepEqual(mentionRanges('read @CLAUDE.md and write to me@codex', people), []);
  const api = { id: 'c3', name: 'Claude (api)' };
  const whole = '@Claude (api): yours';
  assert.deepEqual(
    mentionRanges(whole, [claude, api]).map(({ start, end }) => whole.slice(start, end)),
    ['@Claude (api)']
  );
});

test('nothing is marked in a text whose letters do not keep their place in lower case', () => {
  // "İ" is two characters in lower case, so what comes after it would be marked one off.
  assert.deepEqual(mentionRanges('İ @Codex', people), []);
  assert.deepEqual(mentions('İ @Codex', people), ['c2'], 'who is mentioned is known all the same');
});

test('two names are the same when a mention could not tell them apart', () => {
  assert.equal(sameName('Claude', 'claude'), true);
  assert.equal(sameName(' Claude ', 'Claude'), true);
  assert.equal(sameName('Claude', 'Claude 2'), false);
  assert.equal(sameName('Claude (opus)', 'Claude'), false);
});

// ---- an effort level behind a name ---------------------------------------------------------------

test('a level in brackets right behind a name is given to that agent', () => {
  assert.deepEqual(levels('@Codex(high) please review', people), [{ id: 'c2', effort: 'high' }]);
  assert.deepEqual(levels('First @claude(LOW), then @CODEX(Max).', people), [
    { id: 'c1', effort: 'low' },
    { id: 'c2', effort: 'max' },
  ]);
  assert.deepEqual(mentions('@Codex(high) please review', people), ['c2'], 'and it is a mention like any other');
});

test('a mention without a level, or with something else in brackets, gives none', () => {
  for (const text of [
    '@Codex please review',
    '@Codex (high) please',
    '@Codex(high priority) first',
    '@Codex()',
    '(high) @Codex',
    'Codex(high)',
    'mail me@codex(high)',
    '@CLAUDE.md(high)',
  ]) {
    assert.deepEqual(levels(text, people), [], text);
  }
});

test('any word in the brackets comes back: whether it is a level is for whoever asked', () => {
  assert.deepEqual(levels('@Codex(level) @Claude(ultra)', people), [
    { id: 'c2', effort: 'level' },
    { id: 'c1', effort: 'ultra' },
  ]);
});

test('a level given twice comes back twice, in the order it was written', () => {
  assert.deepEqual(levels('@Codex(low), no: @Codex(high)', people), [
    { id: 'c2', effort: 'low' },
    { id: 'c2', effort: 'high' },
  ]);
});

test('a name with brackets of its own keeps them apart from the level', () => {
  const api = { id: 'c3', name: 'Claude (api)' };
  assert.deepEqual(levels('@Claude (api)(xhigh) and @Claude(low)', [...people, api]), [
    { id: 'c3', effort: 'xhigh' },
    { id: 'c1', effort: 'low' },
  ]);
  assert.deepEqual(levels('@Claude (api) please', [...people, api]), []);
});

test('a name in what a terminal printed, which a message hands over, mentions nobody', () => {
  const block = outputBlock({
    kind: 'terminal',
    name: 'Terminal',
    cwd: '/work',
    text: '@Codex: the build failed\nask @claude(high)',
    cut: false,
    selection: false,
  });
  assert.deepEqual(mentions(block, people), []);
  assert.deepEqual(mentions(`@Claude why?\n\n${block}`, people), ['c1']);
  assert.deepEqual(levels(`${block}\n\n@codex(high) you too`, people), [{ id: 'c2', effort: 'high' }]);
  assert.deepEqual(
    mentionRanges(`${block}\n@Codex`, people).map(({ id }) => id),
    ['c2']
  );
});
