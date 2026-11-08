import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outputStyleItems, outputStyleLabel } from '../src/renderer/chat/output-styles.js';
import { descriptor as claude } from '../src/providers/claude/descriptor.js';
import { descriptor as codex } from '../src/providers/codex/descriptor.js';

const BUILT_IN = claude.outputStyles.map((style) => style.id);

// What the conversation window knows: the provider, and what the session has said so far.
const state = (extra = {}) => ({ provider: claude, outputStyles: [], outputStyle: null, ...extra });
const labels = (items) => items.map((item) => (item.separator ? '-' : item.label));
const checked = (items) => items.filter((item) => item.checked).map((item) => item.label);

test('before the first message, the menu has the provider’s built-in styles and says more will come', () => {
  const items = outputStyleItems(state(), () => {});
  assert.deepEqual(labels(items), [
    'Default',
    'Proactive',
    'Concise',
    'Explanatory',
    'Learning',
    '-',
    'Your own styles appear after your first message',
  ]);
  assert.equal(items.at(-1).disabled, true);
  assert.equal(items.at(-1).action, undefined);
  assert.deepEqual(checked(items), [], 'which style is in use isn’t known yet');
});

test('once the session has said, the menu has its styles, with the one in use checked', () => {
  const items = outputStyleItems(
    state({ outputStyles: ['default', 'Concise', 'Pirate'], outputStyle: 'Concise' }),
    () => {}
  );
  assert.deepEqual(labels(items), ['Default', 'Concise', 'Pirate']);
  assert.deepEqual(checked(items), ['Concise']);
});

test('a style chosen before the first message is checked', () => {
  assert.deepEqual(checked(outputStyleItems(state({ outputStyle: 'Learning' }), () => {})), ['Learning']);
});

test('a style of your own that the contact already uses is listed before the session names it', () => {
  const items = outputStyleItems(state({ outputStyle: 'Pirate' }), () => {});
  assert.deepEqual(labels(items).slice(0, 6), [...claude.outputStyles.map((style) => style.label), 'Pirate']);
  assert.deepEqual(checked(items), ['Pirate']);
});

test('choosing a style passes on its name, not its label', () => {
  const chosen = [];
  const items = outputStyleItems(state({ outputStyles: [...BUILT_IN, 'Pirate'] }), (id) => chosen.push(id));
  for (const item of items) item.action();
  assert.deepEqual(chosen, [...BUILT_IN, 'Pirate']);
});

test('a built-in style goes by the provider’s label, any other by its own name', () => {
  assert.equal(outputStyleLabel(state(), 'default'), 'Default');
  assert.equal(outputStyleLabel(state(), 'Pirate'), 'Pirate');
  assert.equal(outputStyleLabel(state({ provider: codex }), 'default'), 'default');
});

test('a provider without output styles has no menu', () => {
  assert.deepEqual(
    outputStyleItems(state({ provider: codex }), () => {}),
    []
  );
  // Not even for a style left on the contact from somewhere else.
  assert.deepEqual(
    outputStyleItems(state({ provider: codex, outputStyle: 'Concise' }), () => {}),
    []
  );
});

test('the list the session gave is not changed by showing it', () => {
  const outputStyles = ['default', 'Concise'];
  outputStyleItems(state({ outputStyles, outputStyle: 'Pirate' }), () => {});
  assert.deepEqual(outputStyles, ['default', 'Concise']);
});
