import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Recall, sentMessages } from '../src/renderer/chat/recall.js';
import { outputBlock } from '../src/shared/terminal-mentions.js';

/** A conversation's list with these messages sent in it, oldest first. */
const sent = (...texts) => {
  const recall = new Recall();
  recall.add(...texts);
  return recall;
};

test('the messages are your own lines of the saved conversation, oldest first', () => {
  const entries = [
    { id: '1', kind: 'user', text: 'fix the build', images: 0 },
    { id: '2', kind: 'assistant', text: 'On it.' },
    { id: '3', kind: 'tool', tool: 'Bash', input: { command: 'npm test' } },
    { id: '4', kind: 'notice', text: 'Mode changed: Plan mode.' },
    { id: '5', kind: 'user', text: 'what is in this?', images: 2 },
    { id: '6', kind: 'assistant', text: 'A diagram.', speaker: 'c2', speakerName: 'Codex' },
    { id: '7', kind: 'nudge', from: 'me' },
    { id: '8', kind: 'user', text: '@Codex take a look' },
  ];
  assert.deepEqual(sentMessages(entries), ['fix the build', 'what is in this?', '@Codex take a look']);
  assert.deepEqual(sentMessages([]), []);
});

test('↑ goes back through the messages, the newest first, and stops at the first one', () => {
  const recall = sent('one', 'two', 'three');
  assert.equal(recall.back(''), 'three');
  assert.equal(recall.back('three'), 'two');
  assert.equal(recall.back('two'), 'one');
  assert.equal(recall.back('one'), null, 'there is none before the first');
  assert.equal(recall.forward('one'), 'two', 'and it is still at the first');
});

test('↓ comes forward again, and past the newest brings back what you were writing', () => {
  const recall = sent('one', 'two');
  assert.equal(recall.back('half a thought'), 'two');
  assert.equal(recall.back('two'), 'one');
  assert.equal(recall.forward('one'), 'two');
  assert.equal(recall.forward('two'), 'half a thought');
  assert.equal(recall.forward('half a thought'), null, 'the box has what you are writing already');
  assert.equal(recall.stepping, false);
});

test('an empty box comes back empty, and a draft of several lines whole', () => {
  const recall = sent('one');
  assert.equal(recall.back(''), 'one');
  assert.equal(recall.forward('one'), '');
  assert.equal(recall.back('first line\nsecond line'), 'one');
  assert.equal(recall.forward('one'), 'first line\nsecond line');
});

test('with nothing sent yet, neither key has anything to bring back', () => {
  const recall = new Recall();
  assert.equal(recall.back('typing'), null);
  assert.equal(recall.forward('typing'), null);
  assert.equal(recall.stepping, false);
});

test('↓ brings nothing while the box has what you are writing', () => {
  assert.equal(sent('one').forward('typing'), null);
});

test('what you change in a message you went back to is there again when you come back to it', () => {
  const recall = sent('one', 'two');
  assert.equal(recall.back('draft'), 'two');
  assert.equal(recall.back('two, and more'), 'one');
  assert.equal(recall.forward('one'), 'two, and more');
  assert.equal(recall.forward('two, and more'), 'draft', 'the draft is still kept');
  assert.equal(recall.back('draft'), 'two, and more');
  assert.equal(recall.back('two'), 'one', 'changed back to how it was sent');
  assert.equal(recall.forward('one'), 'two');
});

test('what you are writing is the box, unless it has a message you sent as you sent it', () => {
  const recall = sent('one', 'two');
  assert.equal(recall.unsent('typing'), 'typing', 'not going through the messages');
  recall.back('typing');
  assert.equal(recall.unsent('two'), 'typing', 'a message you sent is not unsent');
  assert.equal(recall.unsent('two, and more'), 'two, and more', 'changed, it is yours');
});

test('sending a message you went back to gives back what you were writing', () => {
  const recall = sent('one', 'two');
  recall.back('half a thought');
  recall.back('two');
  assert.equal(recall.sending(), 'half a thought');
  assert.equal(recall.stepping, false);
  assert.equal(recall.forward(''), null, 'the box is back at what you are writing');
});

test('sending what you are writing gives back nothing, and starts the next ↑ at the newest', () => {
  const recall = sent('one', 'two');
  assert.equal(recall.sending(), '');
  recall.back('');
  recall.back('two, changed');
  recall.forward('one');
  assert.equal(recall.sending(), '', 'from the draft, which was empty');
  recall.add('three');
  assert.equal(recall.back(''), 'three');
  assert.equal(recall.back('three'), 'two', 'what was changed on the way is let go');
});

test('a message sent is the newest, and the same words twice in a row are listed once', () => {
  const recall = sent('one', 'two');
  recall.add('two');
  recall.add('   ');
  recall.add('three');
  recall.add('one');
  assert.equal(recall.back(''), 'one');
  assert.equal(recall.back('one'), 'three');
  assert.equal(recall.back('three'), 'two');
  assert.equal(recall.back('two'), 'one');
  assert.equal(recall.back('one'), null);
});

test('a message said while going through them is next after the newest, and keeps the place', () => {
  const recall = sent('one', 'two');
  assert.equal(recall.back('draft'), 'two');
  assert.equal(recall.back('two'), 'one');
  recall.add('three');
  assert.equal(recall.forward('one'), 'two');
  assert.equal(recall.forward('two'), 'three');
  assert.equal(recall.forward('three'), 'draft');
});

test('a new conversation has no messages to bring back', () => {
  const recall = sent('one', 'two');
  recall.back('draft');
  recall.clear();
  assert.equal(recall.stepping, false);
  assert.equal(recall.back(''), null);
  recall.add('fresh');
  assert.equal(recall.back(''), 'fresh');
});

test('a window opened again lists the conversation’s own messages, as it had them', () => {
  // Each message is listed as it is said, and kept in the conversation's history with the replies.
  const open = new Recall();
  const history = [];
  for (const text of ['first', 'second', 'second']) {
    open.add(text);
    history.push({ kind: 'user', text }, { kind: 'assistant', text: `ok: ${text}` });
  }
  const reopened = new Recall();
  reopened.add(...sentMessages(history));
  for (const recall of [open, reopened]) {
    assert.equal(recall.back(''), 'second');
    assert.equal(recall.back('second'), 'first');
    assert.equal(recall.back('first'), null);
  }
});

test('what a terminal printed is not brought back with a message: only its words, and one of none is no message', () => {
  const block = outputBlock({
    kind: 'terminal',
    name: 'Terminal',
    cwd: '/w',
    text: 'hello',
    cut: false,
    selection: false,
  });
  const recall = sent('first', `fix it\n@src/app.js\n\n${block}`, block);
  assert.equal(recall.back(''), 'fix it\n@src/app.js');
  assert.equal(recall.back('fix it\n@src/app.js'), 'first');
});
