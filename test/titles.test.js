import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conversationName, conversationTitle, windowTitle } from '../src/shared/titles.js';

test('a conversation is called after its contact', () => {
  assert.equal(conversationTitle(['Claude']), 'Claude - Conversation');
});

test('a conversation with guests is called after everyone in it, the host first', () => {
  assert.equal(conversationTitle(['Claude', 'Codex']), 'Claude, Codex - Conversation');
  assert.equal(
    conversationTitle(['Claude (api)', 'Codex (api)', 'Opus']),
    'Claude (api), Codex (api), Opus - Conversation'
  );
});

test('the title bar has the name and the kind of window apart, and they make the title together', () => {
  assert.deepEqual(conversationName(['Claude', 'Codex']), { name: 'Claude, Codex', kind: 'Conversation' });
  assert.equal(windowTitle(conversationName(['Claude', 'Codex'])), conversationTitle(['Claude', 'Codex']));
});
