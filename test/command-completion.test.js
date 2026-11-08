import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commandAt, commandNames, commandsMatching, completeCommand } from '../src/renderer/chat/command-completion.js';

const names = ['compact', 'review', 'pdf:pdf', 'presentations:Presentations', 'review-agent', 'skill-creator'];
/** The commands offered with the caret at the end of `typed`, or at `|`. */
const offered = (typed, among = names) => {
  const caret = typed.includes('|') ? typed.indexOf('|') : typed.length;
  return commandAt(typed.replace('|', ''), caret, among)?.matches ?? null;
};
/** `typed` with `name` picked, the caret shown as `|`. */
const picked = (typed, name) => {
  const { text, caret } = completeCommand(typed.replace('|', ''), typed.indexOf('|'), name);
  return `${text.slice(0, caret)}|${text.slice(caret)}`;
};

test('the commands on offer are the session’s own, and its provider’s usual ones until it names them', () => {
  const provider = { commonCommands: ['compact', 'review'] };
  assert.deepEqual(commandNames({ commands: [], provider }), ['compact', 'review']);
  assert.deepEqual(commandNames({ commands: ['init', '/memory'], provider }), ['init', 'memory']);
  assert.deepEqual(commandNames({ commands: [], provider: { commonCommands: [] } }), []);
});

test('a slash offers every command, and what follows it narrows them down', () => {
  assert.deepEqual(offered('/'), names);
  assert.deepEqual(offered('/c'), ['compact', 'skill-creator'], 'the ones that start with it come first');
  assert.deepEqual(offered('/re'), ['review', 'review-agent', 'presentations:Presentations', 'skill-creator']);
  assert.deepEqual(offered('/rev'), ['review', 'review-agent']);
  assert.deepEqual(offered('/pdf'), ['pdf:pdf']);
  assert.deepEqual(offered('/agent'), ['review-agent'], 'found anywhere in the name');
  assert.deepEqual(offered('/CREATOR'), ['skill-creator'], 'in any letter case');
  assert.equal(offered('/x'), null);
  assert.equal(offered('/', []), null, 'a provider without commands offers none');
});

test('searching the commands finds what is typed anywhere in a name, the ones that start with it first', () => {
  assert.deepEqual(commandsMatching(names, ''), names, 'nothing typed finds every one, in their own order');
  assert.deepEqual(commandsMatching(names, 're'), [
    'review',
    'review-agent',
    'presentations:Presentations',
    'skill-creator',
  ]);
  assert.deepEqual(commandsMatching(names, 'AGENT'), ['review-agent'], 'in any letter case');
  assert.deepEqual(commandsMatching(names, 'pdf:'), ['pdf:pdf']);
  assert.deepEqual(
    commandsMatching(names, 'review'),
    ['review', 'review-agent'],
    'a full name and the longer ones it starts'
  );
  assert.deepEqual(commandsMatching(names, 'x'), []);
  assert.deepEqual(commandsMatching([], 'rev'), []);
});

test('only the first word of a message is a command, while the caret is in it', () => {
  assert.equal(offered('rev'), null);
  assert.equal(offered('try /rev'), null);
  assert.equal(offered(' /rev'), null);
  assert.equal(offered('line one\n/rev'), null);
  assert.equal(offered('/review the la'), null, 'the command is done, and what follows is for it');
  assert.equal(offered('/rev\n'), null);
  assert.equal(offered('|/rev'), null, 'the caret is in front of it');
  assert.equal(offered(''), null);
  assert.deepEqual(offered('/re|v the last commit'), [
    'review',
    'review-agent',
    'presentations:Presentations',
    'skill-creator',
  ]);
  assert.equal(offered('/Users/me/app.js'), null, 'a path is no command');
});

test('a command typed in full has nothing left to complete, so Enter sends it', () => {
  assert.equal(offered('/compact'), null);
  assert.equal(offered('/review'), null, 'even where it starts a longer one');
  assert.deepEqual(offered('/review-'), ['review-agent']);
  assert.equal(offered('/pdf:pdf'), null);
  assert.deepEqual(
    offered('/presentations:presentations'),
    ['presentations:Presentations'],
    'in other letters than its own it is not the command yet'
  );
});

test('picking writes the command out, with a space after it', () => {
  assert.equal(picked('/|', 'compact'), '/compact |');
  assert.equal(picked('/rev|', 'review'), '/review |');
  assert.equal(picked('/agent|', 'review-agent'), '/review-agent |');
  assert.equal(picked('/rev| the last commit', 'review'), '/review |the last commit');
  assert.equal(picked('/re|v the last commit', 'review'), '/review |the last commit', 'the rest of the word goes');
  assert.equal(picked('/re|view', 'review-agent'), '/review-agent |');
  assert.equal(picked('/c|\nsecond line', 'compact'), '/compact |\nsecond line');
});

test('a picked command is typed in full, whatever it is told next', () => {
  for (const [typed, name] of [
    ['/', 'compact'],
    ['/rev', 'review'],
    ['/present', 'presentations:Presentations'],
  ]) {
    const done = completeCommand(typed, typed.length, name);
    assert.equal(commandAt(done.text, done.caret, names), null, typed);
    assert.equal(commandAt(`${done.text}the last commit`, done.caret + 3, names), null, `${typed}, with more typed`);
    assert.equal(commandAt(done.text, done.caret - 1, names), null, `${typed}, with the caret back at its end`);
  }
});
