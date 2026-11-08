import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Conversation } from '../src/renderer/chat/conversation.js';
import { hasReply, NO_RESPONSE } from '../src/shared/reply-text.js';
import { page } from './fixtures/dom.js';

for (const name of ['shop manager', 'Claude']) {
  for (const text of ['', ' \n ', NO_RESPONSE, ` ${NO_RESPONSE}\n`]) {
    test(`${name}'s silent reply leaves only the result line: ${JSON.stringify(text)}`, (t) => {
      const document = page(t);
      const root = document.createElement('div');
      document.body.append(root);
      const conversation = new Conversation(root, {
        participants: [{ id: 'agent', name }],
        profile: {},
      });
      conversation.startLive({ key: 'silent' });
      assert.equal(root.querySelectorAll('.msg.them').length, 1);
      conversation.endLive({ key: 'silent', text });
      assert.equal(root.querySelectorAll('.msg.them').length, 0);
      assert.equal(conversation.live.size, 0);
      assert.equal(conversation.lastReceived, null);
      conversation.addResult({ durationMs: 2300, costUsd: 0.0813 });
      assert.equal(root.querySelectorAll('.result').length, 1);
      assert.match(root.textContent, /Done in 2.3s · \$0.0813/);
      // Reopening old history also hides placeholders saved before this fix.
      conversation.addAssistant({ id: 'old', text });
      assert.equal(root.querySelectorAll('.msg.them').length, 0);
      assert.equal(root.querySelectorAll('.result').length, 1);
    });
  }
}

test('only the fixed whole placeholder is silent; real replies remain visible', () => {
  assert.equal(hasReply(NO_RESPONSE), false);
  assert.equal(hasReply('No response needed.'), true);
  assert.equal(hasReply(`The log says "${NO_RESPONSE}"`), true);
  assert.equal(hasReply(`${NO_RESPONSE}\nCI passed.`), true);
});

test('a turn that failed says so in one sentence: one full stop, also after an error that ends in one', (t) => {
  const document = page(t);
  const root = document.createElement('div');
  document.body.append(root);
  const conversation = new Conversation(root, { participants: [{ id: 'agent', name: 'Gemini' }], profile: {} });
  const failed = (errorText) => conversation.addResult({ isError: true, errorText }).textContent.trim();
  assert.equal(failed('The API is down'), 'Stopped early: The API is down.');
  assert.equal(
    failed('Gemini stopped after too many steps in one turn.'),
    'Stopped early: Gemini stopped after too many steps in one turn.'
  );
  assert.equal(failed(''), 'Stopped early: something went wrong.');
});
